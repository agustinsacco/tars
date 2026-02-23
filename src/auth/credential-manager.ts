import { AuthType } from '@google/gemini-cli-core';
import fs from 'fs/promises';
import path from 'path';
import logger from '../utils/logger.js';

export class TarsCredentialManager {
    constructor(private readonly homeDir: string) { }

    /**
     * Resolves the authentication type to use.
     * Precedence: Environment Variable -> Config File -> OAuth (Default)
     */
    public async getAuthType(): Promise<AuthType> {
        // 1. Check environment variables (e.g. GEMINI_API_KEY)
        if (process.env.GEMINI_API_KEY) {
            return AuthType.USE_GEMINI;
        }

        if (process.env.GOOGLE_GENAI_USE_VERTEXAI === 'true') {
            return AuthType.USE_VERTEX_AI;
        }

        // 2. Check settings.json in Tars isolated storage
        const settingsPath = path.join(this.homeDir, '.gemini', 'settings.json');
        try {
            const data = await fs.readFile(settingsPath, 'utf-8');
            const settings = JSON.parse(data);
            const selectedType = settings.security?.auth?.selectedType;

            if (selectedType === 'gemini-api-key') return AuthType.USE_GEMINI;
            if (selectedType === 'vertex-ai') return AuthType.USE_VERTEX_AI;
            if (selectedType === 'oauth-personal') return AuthType.LOGIN_WITH_GOOGLE;
        } catch {
            // Ignore missing settings, fall through
        }

        // 3. Default to OAuth (Personal) if nothing else is found
        return AuthType.LOGIN_WITH_GOOGLE;
    }

    /**
     * Clear all credentials – both API key and OAuth tokens.
     */
    public async clearAll(): Promise<void> {
        const geminiDir = path.join(this.homeDir, '.gemini');
        const filesToClear = [
            'oauth_creds.json',
            'google_accounts.json',
            'state.json'
        ];

        for (const file of filesToClear) {
            try {
                await fs.unlink(path.join(geminiDir, file));
            } catch {
                // Ignore missing files
            }
        }

        // Also clear any API key from process environment if possible
        delete process.env.GEMINI_API_KEY;

        logger.info('✨ All Tars credentials cleared.');
    }
}
