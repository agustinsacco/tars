import { promises as dns } from 'dns';
import http, { type IncomingMessage } from 'http';
import https from 'https';
import net, { type LookupFunction } from 'net';

import { search } from 'duck-duck-scrape';
import { parseHTML } from 'linkedom';
import TurndownService from 'turndown';
import { z } from 'zod';

export interface SearchResult {
    title: string;
    url: string;
    snippet: string;
}

const SearchResultSchema = z
    .object({
        title: z.string().default(''),
        url: z.string().url(),
        description: z.string().optional(),
        snippet: z.string().optional()
    })
    .passthrough();

const FETCH_TIMEOUT_MS = 15_000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const RESTRICTED_IPV6_RANGES = new net.BlockList();
RESTRICTED_IPV6_RANGES.addSubnet('::', 96, 'ipv6');
RESTRICTED_IPV6_RANGES.addSubnet('fec0::', 10, 'ipv6');

export interface ResolvedPublicTarget {
    readonly address: string;
    readonly family: 4 | 6;
}

interface PageResponse {
    readonly body: IncomingMessage;
    readonly status: number;
    readonly statusText: string;
    readonly url: URL;
}

type LookupAll = (
    hostname: string
) => Promise<ReadonlyArray<{ readonly address: string; readonly family: number }>>;

function isPrivateIpv4(address: string): boolean {
    const octets = address.split('.').map(Number);
    if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet))) return true;
    const [first, second] = octets;
    return (
        first === 0 ||
        first === 10 ||
        first === 127 ||
        (first === 100 && second >= 64 && second <= 127) ||
        (first === 169 && second === 254) ||
        (first === 172 && second >= 16 && second <= 31) ||
        (first === 192 && second === 0) ||
        (first === 192 && second === 168) ||
        (first === 198 && (second === 18 || second === 19)) ||
        first >= 224
    );
}

function isPrivateIpv6(address: string): boolean {
    const normalized = address.toLowerCase().split('%')[0];
    if (RESTRICTED_IPV6_RANGES.check(normalized, 'ipv6')) return true;
    if (normalized.startsWith('::ffff:')) {
        return isPrivateIpv4(normalized.slice('::ffff:'.length));
    }
    return (
        normalized === '::' ||
        normalized === '::1' ||
        normalized.startsWith('fc') ||
        normalized.startsWith('fd') ||
        /^fe[89ab]/.test(normalized) ||
        normalized.startsWith('ff')
    );
}

export function isPrivateAddress(address: string): boolean {
    const family = net.isIP(address);
    if (family === 4) return isPrivateIpv4(address);
    if (family === 6) return isPrivateIpv6(address);
    return true;
}

function normalizeHostname(hostname: string): string {
    return hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname;
}

export async function resolvePublicTarget(
    url: URL,
    lookupAll: LookupAll = async (hostname) => dns.lookup(hostname, { all: true, verbatim: true })
): Promise<ResolvedPublicTarget> {
    if (!['http:', 'https:'].includes(url.protocol)) {
        throw new Error('Only HTTP and HTTPS URLs are supported');
    }
    if (url.username || url.password) throw new Error('URLs with embedded credentials are blocked');

    const hostname = normalizeHostname(url.hostname.toLowerCase());
    if (
        hostname === 'localhost' ||
        hostname.endsWith('.localhost') ||
        hostname.endsWith('.local') ||
        hostname.endsWith('.internal') ||
        hostname === 'metadata.google.internal'
    ) {
        throw new Error('Private and local network targets are blocked');
    }

    if (net.isIP(hostname)) {
        if (isPrivateAddress(hostname)) {
            throw new Error('Private and local network targets are blocked');
        }
        return { address: hostname, family: net.isIP(hostname) as 4 | 6 };
    }

    const addresses = await lookupAll(hostname);
    if (addresses.length === 0 || addresses.some(({ address }) => isPrivateAddress(address))) {
        throw new Error('Private and local network targets are blocked');
    }
    const selected = addresses[0];
    if (selected.family !== 4 && selected.family !== 6) {
        throw new Error('Search target resolved to an unsupported address family');
    }
    return { address: selected.address, family: selected.family };
}

export function createPinnedLookup(target: ResolvedPublicTarget): LookupFunction {
    return (_hostname, options, callback) => {
        if (options.all) {
            callback(null, [{ address: target.address, family: target.family }]);
        } else {
            callback(null, target.address, target.family);
        }
    };
}

async function requestPage(
    url: URL,
    target: ResolvedPublicTarget,
    signal: AbortSignal
): Promise<PageResponse> {
    const requestImplementation = url.protocol === 'https:' ? https.request : http.request;
    return new Promise<PageResponse>((resolve, reject) => {
        const request = requestImplementation(
            url,
            {
                method: 'GET',
                signal,
                lookup: createPinnedLookup(target),
                headers: {
                    'User-Agent': 'Tars/1.0 (+https://github.com/agustinsacco/tars)',
                    Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9'
                }
            },
            (response) => {
                resolve({
                    body: response,
                    status: response.statusCode ?? 0,
                    statusText: response.statusMessage ?? '',
                    url
                });
            }
        );
        request.once('error', reject);
        request.end();
    });
}

async function fetchWithValidatedRedirects(url: URL, signal: AbortSignal): Promise<PageResponse> {
    let currentUrl = url;
    for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount++) {
        const target = await resolvePublicTarget(currentUrl);
        const response = await requestPage(currentUrl, target, signal);

        if (![301, 302, 303, 307, 308].includes(response.status)) return response;
        const location = response.body.headers.location;
        response.body.destroy();
        if (!location) throw new Error('Redirect response did not include a location');
        currentUrl = new URL(location, currentUrl);
    }

    throw new Error(`Page exceeded ${MAX_REDIRECTS} redirects`);
}

async function readTextBody(response: PageResponse): Promise<string> {
    const rawContentType = response.body.headers['content-type'];
    const contentType = (
        Array.isArray(rawContentType) ? rawContentType[0] : (rawContentType ?? '')
    ).toLowerCase();
    if (!contentType.includes('text/') && !contentType.includes('application/xhtml+xml')) {
        response.body.destroy();
        throw new Error(`Unsupported page content type: ${contentType || 'unknown'}`);
    }

    const declaredLength = Number(response.body.headers['content-length'] || 0);
    if (declaredLength > MAX_RESPONSE_BYTES) {
        response.body.destroy();
        throw new Error('Page response is too large');
    }
    const decoder = new TextDecoder();
    let totalBytes = 0;
    let content = '';
    for await (const chunk of response.body) {
        const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        totalBytes += value.byteLength;
        if (totalBytes > MAX_RESPONSE_BYTES) {
            response.body.destroy(new Error('Page response is too large'));
            throw new Error('Page response is too large');
        }
        content += decoder.decode(value, { stream: true });
    }
    return content + decoder.decode();
}

export async function performWebSearch(query: string, limit: number = 5): Promise<SearchResult[]> {
    const normalizedQuery = query.trim();
    if (!normalizedQuery) throw new Error('Search query cannot be empty');
    const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.min(10, Math.floor(limit))) : 5;
    const response = await search(normalizedQuery);
    const parsed = z.array(SearchResultSchema).safeParse(response.results || []);
    if (!parsed.success) throw new Error('Search provider returned an invalid response');

    return parsed.data.slice(0, safeLimit).map((result) => ({
        title: result.title,
        url: result.url,
        snippet: result.description || result.snippet || ''
    }));
}

export async function fetchWebPage(url: string, maxLength: number = 15_000): Promise<string> {
    const targetUrl = new URL(url);
    const safeMaxLength = Number.isFinite(maxLength)
        ? Math.max(1_000, Math.min(100_000, Math.floor(maxLength)))
        : 15_000;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    try {
        const response = await fetchWithValidatedRedirects(targetUrl, controller.signal);
        if (response.status < 200 || response.status >= 300) {
            response.body.destroy();
            throw new Error(`Failed to fetch page: HTTP ${response.status} ${response.statusText}`);
        }

        const html = await readTextBody(response);
        const { document } = parseHTML(html);
        document
            .querySelectorAll(
                'script, style, noscript, iframe, nav, header, footer, aside, svg, img, form, button'
            )
            .forEach((element) => element.remove());

        const bodyHtml = document.body
            ? document.body.innerHTML
            : document.documentElement.innerHTML;
        const turndown = new TurndownService({
            headingStyle: 'atx',
            codeBlockStyle: 'fenced'
        });
        let markdown = turndown.turndown(bodyHtml).trim();
        if (markdown.length > safeMaxLength) {
            markdown = `${markdown.substring(0, safeMaxLength)}\n\n...[Content truncated]...`;
        }

        return `<untrusted_web_content source="${response.url.toString()}">\n${markdown}\n</untrusted_web_content>`;
    } finally {
        clearTimeout(timeout);
    }
}
