import { search } from 'duck-duck-scrape';
import { parseHTML } from 'linkedom';
import TurndownService from 'turndown';

export interface SearchResult {
    title: string;
    url: string;
    snippet: string;
}

/**
 * Executes a DuckDuckGo search query and returns mapped search results.
 */
export async function performWebSearch(query: string, limit: number = 5): Promise<SearchResult[]> {
    const response = await search(query);
    const rawResults = response.results || [];
    return rawResults.slice(0, limit).map((r: any) => ({
        title: r.title || '',
        url: r.url || '',
        snippet: r.description || r.snippet || ''
    }));
}

/**
 * Fetches HTML from a URL, removes noise/boilerplate, and converts it to clean Markdown.
 */
export async function fetchWebPage(url: string, maxLength: number = 15000): Promise<string> {
    const res = await fetch(url, {
        headers: {
            'User-Agent':
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
    });

    if (!res.ok) {
        throw new Error(`Failed to fetch page: HTTP ${res.status} ${res.statusText}`);
    }

    const html = await res.text();
    const { document } = parseHTML(html);

    // Strip boilerplate, navigation, and script/style tags
    const elementsToRemove = document.querySelectorAll(
        'script, style, noscript, iframe, nav, header, footer, aside, svg, img, form, button'
    );
    elementsToRemove.forEach((el) => el.remove());

    const bodyHtml = document.body ? document.body.innerHTML : document.documentElement.innerHTML;

    const turndown = new TurndownService({
        headingStyle: 'atx',
        codeBlockStyle: 'fenced'
    });

    let markdown = turndown.turndown(bodyHtml).trim();

    if (markdown.length > maxLength) {
        markdown = markdown.substring(0, maxLength) + '\n\n...[Content truncated for brevity]...';
    }

    return markdown;
}
