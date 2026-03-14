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
    totalNetTokens: number;
    lastUserInteractionAt?: string;
}

/**
 * Manages Gemini CLI session persistence with token tracking
 */
export class SessionManager {
    private readonly sessionFilePath: string;
    private sessionData: SessionData | null = null;
    private readonly idleTimeoutMs: number;

    constructor(sessionFilePath: string, idleTimeoutMs: number = 2 * 60 * 60 * 1000) {
        this.sessionFilePath = sessionFilePath;
        this.idleTimeoutMs = idleTimeoutMs;
    }

    /**
     * Load session data from storage
     */
    async load(): Promise<string | null> {
        try {
            await fs.promises.access(this.sessionFilePath);
        } catch {
            return null;
        }

        try {
            const raw = await fs.promises.readFile(this.sessionFilePath, 'utf-8');
            const parsed = JSON.parse(raw);

            // Check if sessionId exists
            if (!parsed.sessionId) {
                return null;
            }

            this.sessionData = parsed as SessionData;
            if (this.sessionData.totalNetTokens === undefined) {
                this.sessionData.totalNetTokens = this.sessionData.totalInputTokens || 0;
            }

            // Check idle timeout — if exceeded, clear and force a new session
            if (this.sessionData.lastUserInteractionAt) {
                const lastActivity = new Date(this.sessionData.lastUserInteractionAt).getTime();
                const elapsed = Date.now() - lastActivity;
                if (elapsed > this.idleTimeoutMs) {
                    logger.info(
                        `[SessionManager] Session idle for ${Math.round(elapsed / 60000)}m (threshold: ${Math.round(this.idleTimeoutMs / 60000)}m). Expiring session.`
                    );
                    await this.clear();
                    return null;
                }
            }

            return this.sessionData.sessionId;
        } catch (e) {
            logger.warn(`[SessionManager] Failed to load session: ${e}`);
            return null;
        }
    }

    /**
     * Save or initialize session
     */
    async save(sessionId: string): Promise<void> {
        try {
            // Only save if it's a new session or we don't have session data yet
            if (this.sessionData && this.sessionData.sessionId === sessionId) {
                return;
            }

            this.sessionData = {
                sessionId,
                createdAt: new Date().toISOString(),
                totalInputTokens: 0,
                totalOutputTokens: 0,
                totalCachedTokens: 0,
                interactionCount: 0,
                lastInteractionAt: new Date().toISOString(),
                lastInputTokens: 0,
                totalNetTokens: 0
            };

            await this.atomicWrite();
            logger.info(`[SessionManager] New session initialized: ${sessionId}`);
        } catch (e) {
            logger.error(`[SessionManager] Failed to initialize session: ${e}`);
        }
    }

    /**
     * Update session with usage stats from latest interaction
     */
    async updateUsage(usage: UsageStats): Promise<void> {
        if (!this.sessionData) {
            logger.warn('[SessionManager] Cannot update usage - no active session');
            return;
        }

        const netInput = Math.max(0, usage.inputTokens - (usage.cachedTokens || 0));
        this.sessionData.totalNetTokens += netInput;
        this.sessionData.totalInputTokens = usage.inputTokens; // Current context size
        this.sessionData.totalOutputTokens += usage.outputTokens;
        this.sessionData.totalCachedTokens = usage.cachedTokens || 0; // Current cached state
        this.sessionData.interactionCount++;
        this.sessionData.lastInteractionAt = new Date().toISOString();
        this.sessionData.lastInputTokens = usage.inputTokens;

        // Persist to disk
        try {
            await this.atomicWrite();
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
    async clear(): Promise<void> {
        try {
            await fs.promises.unlink(this.sessionFilePath);
            this.sessionData = null;
            logger.info('[SessionManager] Session cleared');
        } catch (e: any) {
            if (e.code !== 'ENOENT') {
                logger.error(`[SessionManager] Failed to clear session: ${e}`);
            }
        }
    }

    /**
     * Force invalidate the session (e.g. after a memory update).
     * The next interaction will start a fresh session.
     */
    async forceInvalidate(): Promise<void> {
        logger.info('[SessionManager] Force-invalidating session (memory changed)');
        await this.clear();
    }

    /**
     * Check if a session exists
     */
    async exists(): Promise<boolean> {
        try {
            await fs.promises.access(this.sessionFilePath);
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Record user activity timestamp (for heartbeat idle suppression)
     */
    async touchActivity(): Promise<void> {
        if (!this.sessionData) return;
        this.sessionData.lastUserInteractionAt = new Date().toISOString();
        try {
            await this.atomicWrite();
        } catch (e) {
            logger.error(`[SessionManager] Failed to touch activity: ${e}`);
        }
    }

    /**
     * Writes session data to disk atomically.
     */
    private async atomicWrite(): Promise<void> {
        if (!this.sessionData) return;

        const tempPath = `${this.sessionFilePath}.tmp`;
        const dir = path.dirname(this.sessionFilePath);

        try {
            await fs.promises.mkdir(dir, { recursive: true });
            await fs.promises.writeFile(tempPath, JSON.stringify(this.sessionData, null, 2));
            await fs.promises.rename(tempPath, this.sessionFilePath);
        } catch (e) {
            // Cleanup temp file if it exists
            try {
                await fs.promises.unlink(tempPath);
            } catch {}
            throw e;
        }
    }

    /**
     * Get the last user interaction timestamp
     */
    getLastUserInteraction(): Date | null {
        if (!this.sessionData?.lastUserInteractionAt) return null;
        return new Date(this.sessionData.lastUserInteractionAt);
    }
}
