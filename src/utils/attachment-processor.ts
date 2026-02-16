import fs from 'fs';
import path from 'path';
import { Attachment } from 'discord.js';
import { Config } from '../config/config.js';
import logger from './logger.js';

/**
 * Handles downloading incoming Discord attachments and saving outgoing responses as files.
 */
export class AttachmentProcessor {
    private uploadDir: string;
    private tmpDir: string;

    constructor(config: Config) {
        this.uploadDir = path.join(config.homeDir, 'data', 'uploads');
        this.tmpDir = path.join(config.homeDir, 'data', 'tmp');

        // Ensure directories exist
        if (!fs.existsSync(this.uploadDir)) {
            fs.mkdirSync(this.uploadDir, { recursive: true });
        }
        if (!fs.existsSync(this.tmpDir)) {
            fs.mkdirSync(this.tmpDir, { recursive: true });
        }
    }

    /**
     * Download an attachment from Discord to local storage.
     */
    async download(attachment: Attachment): Promise<string> {
        try {
            const fileName = `${attachment.id}-${attachment.name}`;
            const dest = path.join(this.uploadDir, fileName);

            logger.info(
                `⬇️ Downloading attachment: ${attachment.name} (${attachment.contentType})`
            );

            const response = await fetch(attachment.url);
            if (!response.ok) throw new Error(`Fetch failed: ${response.statusText}`);

            const arrayBuffer = await response.arrayBuffer();
            fs.writeFileSync(dest, Buffer.from(arrayBuffer));

            logger.info(`✅ Saved attachment to: ${dest}`);
            return dest;
        } catch (error: any) {
            logger.error(`❌ Failed to download attachment: ${error.message}`);
            throw error;
        }
    }

    /**
     * Save a long response text to a temporary file for uploading.
     */
    saveResponse(content: string, extension: string = 'md'): string {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const fileName = `response-${timestamp}.${extension}`;
        const dest = path.join(this.tmpDir, fileName);

        fs.writeFileSync(dest, content);
        return dest;
    }

    /**
     * Clean up temporary files (1 hour) and uploads (24 hours).
     */
    cleanup(): void {
        const cleanDir = (dir: string, maxAgeMs: number) => {
            try {
                if (!fs.existsSync(dir)) return;
                const now = Date.now();
                const files = fs.readdirSync(dir);
                for (const file of files) {
                    const filePath = path.join(dir, file);
                    const stats = fs.statSync(filePath);
                    if (now - stats.mtimeMs > maxAgeMs) {
                        fs.unlinkSync(filePath);
                        logger.debug(`🧹 Deleted old file: ${filePath}`);
                    }
                }
            } catch (e: any) {
                logger.error(`Cleanup failed for ${dir}: ${e.message}`);
            }
        };

        cleanDir(this.tmpDir, 3600000); // 1 hour for tmp responses
        cleanDir(this.uploadDir, 86400000); // 24 hours for uploads
    }
}
