import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
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
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            logger.error(`[SecretsManager] Failed to load secrets: ${message}`);
            throw error;
        }
    }

    /**
     * Set a secret value
     */
    set(key: string, value: string): void {
        try {
            if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
                throw new Error('Secret names may only contain letters, numbers, and underscores');
            }
            const secrets = this.load();
            secrets[key] = value;

            this.saveFilesystem(secrets);
            logger.info(`[SecretsManager] Secret set: ${key}`);
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            logger.error(`[SecretsManager] Failed to set secret ${key}: ${message}`);
            throw error;
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
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            logger.error(`[SecretsManager] Failed to remove secret ${key}: ${message}`);
            throw error;
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
            .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
            .join('\n');

        const dir = path.dirname(this.secretsPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        const tempPath = `${this.secretsPath}.${process.pid}.${randomUUID()}.tmp`;
        try {
            fs.writeFileSync(tempPath, content, { mode: 0o600 });
            fs.renameSync(tempPath, this.secretsPath);
            fs.chmodSync(this.secretsPath, 0o600);
        } catch (error: unknown) {
            try {
                fs.unlinkSync(tempPath);
            } catch {
                // Best-effort cleanup.
            }
            throw error;
        }
    }
}
