import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import logger from './logger.js';

/**
 * Manages secrets stored in ~/.tars/.env
 */
export class SecretsManager {
    private readonly secretsPath: string;

    constructor(homeDir: string) {
        this.secretsPath = path.join(homeDir, '.env');
    }

    /**
     * Load all secrets as an object
     */
    load(): Record<string, string> {
        if (!fs.existsSync(this.secretsPath)) {
            return {};
        }

        try {
            const content = fs.readFileSync(this.secretsPath, 'utf-8');
            return dotenv.parse(content);
        } catch (error: any) {
            logger.error(`[SecretsManager] Failed to load secrets: ${error.message}`);
            return {};
        }
    }

    /**
     * Set a secret value
     */
    set(key: string, value: string): void {
        try {
            const secrets = this.load();
            secrets[key] = value;

            this.saveFilesystem(secrets);
            logger.info(`[SecretsManager] Secret set: ${key}`);
        } catch (error: any) {
            logger.error(`[SecretsManager] Failed to set secret ${key}: ${error.message}`);
        }
    }

    /**
     * Delete a secret
     */
    remove(key: string): void {
        try {
            const secrets = this.load();
            if (key in secrets) {
                delete secrets[key];
                this.saveFilesystem(secrets);
                logger.info(`[SecretsManager] Secret removed: ${key}`);
            }
        } catch (error: any) {
            logger.error(`[SecretsManager] Failed to remove secret ${key}: ${error.message}`);
        }
    }

    /**
     * List all secret keys
     */
    list(): string[] {
        return Object.keys(this.load());
    }

    /**
     * Internal save helper
     */
    private saveFilesystem(secrets: Record<string, string>): void {
        const content = Object.entries(secrets)
            .map(([k, v]) => `${k}="${v.replace(/"/g, '\\"')}"`)
            .join('\n');

        const dir = path.dirname(this.secretsPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        fs.writeFileSync(this.secretsPath, content, { mode: 0o600 });
    }
}
