import fs from 'fs';
import path from 'path';
import logger from '../utils/logger.js';
import { UsageStats } from '../types/index.js';

/**
 * Session data stored to disk
 */
export interface SessionData {
    sessionId: string;
    createdAt: string;
    totalInputTokens: number;
    totalOutputTokens: number;
    totalCachedTokens: number;
    interactionCount: number;
    lastInteractionAt: string;
    lastInputTokens: number;
}

/**
 * Manages Gemini CLI session persistence with token tracking
 */
export class SessionManager {
    private readonly sessionFilePath: string;
    private sessionData: SessionData | null = null;

    constructor(sessionFilePath: string) {
        this.sessionFilePath = sessionFilePath;
    }

    /**
     * Load session data from storage
     */
    load(): string | null {
        if (!fs.existsSync(this.sessionFilePath)) {
            return null;
        }

        try {
            const raw = fs.readFileSync(this.sessionFilePath, 'utf-8');
            const parsed = JSON.parse(raw);

            // Check if sessionId exists
            if (!parsed.sessionId) {
                return null;
            }

            this.sessionData = parsed as SessionData;

            return this.sessionData.sessionId;
        } catch (e) {
            logger.warn(`[SessionManager] Failed to load session: ${e}`);
            return null;
        }
    }

    /**
     * Save or initialize session
     */
    save(sessionId: string): void {
        try {
            // Initialize new session data if not exists
            if (!this.sessionData || this.sessionData.sessionId !== sessionId) {
                this.sessionData = {
                    sessionId,
                    createdAt: new Date().toISOString(),
                    totalInputTokens: 0,
                    totalOutputTokens: 0,
                    totalCachedTokens: 0,
                    interactionCount: 0,
                    lastInteractionAt: new Date().toISOString(),
                    lastInputTokens: 0
                };
            }

            const dir = path.dirname(this.sessionFilePath);
            fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(this.sessionFilePath, JSON.stringify(this.sessionData, null, 2));
            logger.info(`[SessionManager] Session saved: ${sessionId}`);
        } catch (e) {
            logger.error(`[SessionManager] Failed to save session: ${e}`);
        }
    }

    /**
     * Update session with usage stats from latest interaction
     */
    updateUsage(usage: UsageStats): void {
        if (!this.sessionData) {
            logger.warn('[SessionManager] Cannot update usage - no active session');
            return;
        }

        this.sessionData.totalInputTokens += usage.inputTokens;
        this.sessionData.totalOutputTokens += usage.outputTokens;
        this.sessionData.totalCachedTokens += usage.cachedTokens || 0;
        this.sessionData.interactionCount++;
        this.sessionData.lastInteractionAt = new Date().toISOString();
        this.sessionData.lastInputTokens = usage.inputTokens;

        // Persist to disk
        try {
            fs.writeFileSync(this.sessionFilePath, JSON.stringify(this.sessionData, null, 2));
        } catch (e) {
            logger.error(`[SessionManager] Failed to update usage: ${e}`);
        }
    }

    /**
     * Get current session statistics
     */
    getStats(): SessionData | null {
        return this.sessionData ? { ...this.sessionData } : null;
    }

    /**
     * Clear the stored session
     */
    clear(): void {
        if (fs.existsSync(this.sessionFilePath)) {
            try {
                fs.unlinkSync(this.sessionFilePath);
                this.sessionData = null;
                logger.info('[SessionManager] Session cleared');
            } catch (e) {
                logger.error(`[SessionManager] Failed to clear session: ${e}`);
            }
        }
    }

    /**
     * Check if a session exists
     */
    exists(): boolean {
        return fs.existsSync(this.sessionFilePath);
    }
}
