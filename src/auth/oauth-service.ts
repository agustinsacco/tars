import { getOauthClient, AuthType, Config, Storage } from '@google/gemini-cli-core';
import logger from '../utils/logger.js';
import path from 'path';
import fs from 'fs/promises';
import os from 'os';

/**
 * TarsOAuthService - Native OAuth Flow for Tars
 *
 * This service wraps the @google/gemini-cli-core auth logic but ensures
 * it operates exclusively within the ~/.tars isolated environment.
 */
export class TarsOAuthService {
    constructor(private readonly homeDir: string) {}

    /**
     * Executes the OAuth login flow.
     * This will open a browser for the user to authenticate.
     */
    public async login(): Promise<void> {
        logger.info('🔑 Starting native Google OAuth flow...');

        const savedHome = process.env.HOME;
        try {
            // Ensure home directory exists
            await fs.mkdir(this.homeDir, { recursive: true });

            // Force core to resolve its global directory within ~/.tars
            process.env.HOME = this.homeDir;

            // Create a minimal config for the auth client
            const config = new Config({
                targetDir: this.homeDir,
                cwd: this.homeDir,
                sessionId: 'setup-session',
                model: 'auto',
                debugMode: false,
                interactive: true,
                noBrowser: true // Native manual flow (Option 2)
            });

            // This triggers the interactive flow if tokens are missing or invalid
            const client = await getOauthClient(AuthType.LOGIN_WITH_GOOGLE, config);

            // Verify we actually got a client with credentials
            if (client) {
                logger.info('✅ Authentication successful.');
            } else {
                throw new Error('OAuth flow completed but client is unavailable.');
            }
        } catch (error: any) {
            logger.error(`❌ OAuth login failed: ${error.message}`);
            throw error;
        } finally {
            // Restore original HOME
            process.env.HOME = savedHome;
        }
    }

    /**
     * Checks if a valid OAuth credential exists in the Tars isolated storage.
     */
    public async isAuthenticated(): Promise<boolean> {
        const credsPath = path.join(this.homeDir, '.gemini', 'oauth_creds.json');
        try {
            await fs.access(credsPath);
            // Basic existence check is usually enough as core handles validity/refresh
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Clears cached credentials.
     */
    public async logout(): Promise<void> {
        const credsPath = path.join(this.homeDir, '.gemini', 'oauth_creds.json');
        try {
            await fs.unlink(credsPath);
            logger.info('🗑️ Tars credentials cleared.');
        } catch (err) {
            // Ignore if already deleted
        }
    }
}
