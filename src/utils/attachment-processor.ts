import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';

import { Config } from '../config/config.js';
import logger from './logger.js';

const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 15_000;
const DISCORD_ATTACHMENT_HOSTS = new Set(['cdn.discordapp.com', 'media.discordapp.net']);

export interface RemoteAttachment {
    id: string;
    name: string;
    url: string;
    size: number;
    contentType: string | null;
}

function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function sanitizeFileName(fileName: string): string {
    const baseName = path.basename(fileName).replace(/[\u0000-\u001f\u007f]/g, '');
    const safeName = baseName.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 180);
    return safeName || 'attachment';
}

async function readLimitedBody(response: Response): Promise<Buffer> {
    if (!response.body) return Buffer.alloc(0);
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        totalBytes += value.byteLength;
        if (totalBytes > MAX_ATTACHMENT_BYTES) {
            await reader.cancel('Attachment exceeds the configured size limit');
            throw new Error(`Attachment exceeds ${MAX_ATTACHMENT_BYTES} bytes`);
        }
        chunks.push(value);
    }

    return Buffer.concat(chunks, totalBytes);
}

/** Handles bounded Discord downloads and temporary response files. */
export class AttachmentProcessor {
    private readonly uploadDir: string;
    private readonly tmpDir: string;

    constructor(config: Pick<Config, 'homeDir'>) {
        this.uploadDir = path.join(config.homeDir, 'data', 'uploads');
        this.tmpDir = path.join(config.homeDir, 'data', 'tmp');
        fs.mkdirSync(this.uploadDir, { recursive: true, mode: 0o700 });
        fs.mkdirSync(this.tmpDir, { recursive: true, mode: 0o700 });
    }

    public async download(attachment: RemoteAttachment): Promise<string> {
        const url = new URL(attachment.url);
        if (url.protocol !== 'https:' || !DISCORD_ATTACHMENT_HOSTS.has(url.hostname)) {
            throw new Error('Attachment URL is not an approved Discord CDN URL');
        }
        if (attachment.size > MAX_ATTACHMENT_BYTES) {
            throw new Error(`Attachment exceeds ${MAX_ATTACHMENT_BYTES} bytes`);
        }

        const fileName = `${attachment.id}-${sanitizeFileName(attachment.name)}`;
        const destination = path.join(this.uploadDir, fileName);
        const tempPath = `${destination}.${randomUUID()}.tmp`;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);

        try {
            logger.info(
                `⬇️ Downloading attachment: ${sanitizeFileName(attachment.name)} (${attachment.contentType || 'unknown'})`
            );
            const response = await fetch(url, {
                redirect: 'error',
                signal: controller.signal
            });
            if (!response.ok) throw new Error(`Fetch failed: HTTP ${response.status}`);

            const declaredLength = Number(response.headers.get('content-length') || 0);
            if (declaredLength > MAX_ATTACHMENT_BYTES) {
                throw new Error(`Attachment exceeds ${MAX_ATTACHMENT_BYTES} bytes`);
            }

            const data = await readLimitedBody(response);
            fs.writeFileSync(tempPath, data, { mode: 0o600 });
            fs.renameSync(tempPath, destination);
            return destination;
        } catch (error: unknown) {
            try {
                fs.unlinkSync(tempPath);
            } catch {
                // Best-effort cleanup.
            }
            logger.error(`❌ Failed to download attachment: ${getErrorMessage(error)}`);
            throw error;
        } finally {
            clearTimeout(timeout);
        }
    }

    public saveResponse(content: string, extension: string = 'md'): string {
        const safeExtension = extension.replace(/[^A-Za-z0-9]/g, '').slice(0, 10) || 'txt';
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const destination = path.join(this.tmpDir, `response-${timestamp}.${safeExtension}`);
        fs.writeFileSync(destination, content, { encoding: 'utf-8', mode: 0o600 });
        return destination;
    }

    public cleanup(): void {
        this.cleanDirectory(this.tmpDir, 60 * 60 * 1_000);
        this.cleanDirectory(this.uploadDir, 24 * 60 * 60 * 1_000);
    }

    private cleanDirectory(directory: string, maxAgeMs: number): void {
        try {
            const now = Date.now();
            for (const file of fs.readdirSync(directory)) {
                const filePath = path.join(directory, file);
                const stats = fs.lstatSync(filePath);
                if (!stats.isFile() || now - stats.mtimeMs <= maxAgeMs) continue;
                fs.unlinkSync(filePath);
                logger.debug(`🧹 Deleted old file: ${filePath}`);
            }
        } catch (error: unknown) {
            logger.error(`Cleanup failed for ${directory}: ${getErrorMessage(error)}`);
        }
    }
}
