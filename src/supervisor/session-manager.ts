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
    totalInputTokens: number; // Cumulative input tokens across all interactions
    totalOutputTokens: number;
    totalCachedTokens: number;
    interactionCount: number;
    lastInteractionAt: string;
    lastInputTokens: number; // Current context window size (tokens)
    totalNetTokens: number;
    lastUserInteractionAt?: string;
    compressionCount: number;
}

/**
 * Manages Tars session persistence with token tracking
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
            if (this.sessionData.compressionCount === undefined) {
                this.sessionData.compressionCount = 0;
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
                totalNetTokens: 0,
                lastUserInteractionAt: undefined,
                compressionCount: 0
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
        this.sessionData.totalInputTokens += usage.inputTokens; // Cumulative total
        this.sessionData.totalOutputTokens += usage.outputTokens;
        this.sessionData.totalCachedTokens = usage.cachedTokens || 0; // Current cached state
        this.sessionData.interactionCount++;
        this.sessionData.lastInteractionAt = new Date().toISOString();
        this.sessionData.lastInputTokens =
            (usage.lastInputTokens || usage.inputTokens) +
            (usage.lastOutputTokens || usage.outputTokens || 0); // Current active context size

        // Persist to disk
        try {
            await this.atomicWrite();
        } catch (e) {
            logger.error(`[SessionManager] Failed to update usage: ${e}`);
        }
    }

    /**
     * Update the estimated context window size after a compression/compaction.
     */
    async updateTokensAfterCompression(tokens: number): Promise<void> {
        if (!this.sessionData) return;
        this.sessionData.lastInputTokens = tokens;
        try {
            await this.atomicWrite();
            logger.info(`[SessionManager] Updated context token size post-compaction: ${tokens}`);
        } catch (e) {
            logger.error(`[SessionManager] Failed to update post-compaction tokens: ${e}`);
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
     * Force invalidate has been deprecated.
     * Sessions now persist across memory changes. System instruction is refreshed in-place.
     * @deprecated No longer destroys the session. Kept for API compatibility.
     */
    async forceInvalidate(): Promise<void> {
        logger.debug(
            '[SessionManager] forceInvalidate() called but is now a no-op. Sessions persist across memory changes.'
        );
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

    /**
     * Returns the fraction of the context window currently consumed
     * based on the most recent interaction's input token count.
     */
    getContextUsagePercent(contextWindowTokens: number): number {
        if (!this.sessionData || contextWindowTokens <= 0) return 0;
        return (this.sessionData.lastInputTokens || 0) / contextWindowTokens;
    }

    /**
     * Checks if the session needs compression based on threshold.
     */
    needsCompression(contextWindowTokens: number, threshold: number): boolean {
        return this.getContextUsagePercent(contextWindowTokens) >= threshold;
    }

    /**
     * Returns the session uptime in milliseconds.
     */
    getSessionUptime(): number {
        if (!this.sessionData) return 0;
        return Date.now() - new Date(this.sessionData.createdAt).getTime();
    }

    /**
     * Increment the compression counter.
     */
    async recordCompression(): Promise<void> {
        if (!this.sessionData) return;
        this.sessionData.compressionCount = (this.sessionData.compressionCount || 0) + 1;
        try {
            await this.atomicWrite();
        } catch (e) {
            logger.error(`[SessionManager] Failed to record compression: ${e}`);
        }
    }

    /**
     * Garbage-collects old session chat files from the given tmp directory.
     * Keeps the newest `maxCount` files and deletes anything older than `maxAgeDays`.
     */
    async garbageCollect(
        tmpDir: string,
        maxAgeDays: number = 3,
        maxCount: number = 50
    ): Promise<number> {
        let deleted = 0;
        try {
            // Find all chats directories recursively
            const entries = await fs.promises.readdir(tmpDir, { withFileTypes: true });
            for (const entry of entries) {
                if (!entry.isDirectory()) continue;
                const chatsDir = path.join(tmpDir, entry.name, 'chats');
                try {
                    await fs.promises.access(chatsDir);
                } catch {
                    continue;
                }

                const files = await fs.promises.readdir(chatsDir);
                const jsonFiles = files.filter((f) => f.endsWith('.json'));

                // Get stats and sort by mtime descending
                const fileStats = await Promise.all(
                    jsonFiles.map(async (f) => {
                        const filePath = path.join(chatsDir, f);
                        const stat = await fs.promises.stat(filePath);
                        return { path: filePath, mtime: stat.mtimeMs };
                    })
                );
                fileStats.sort((a, b) => b.mtime - a.mtime);

                const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;
                const now = Date.now();

                for (let i = 0; i < fileStats.length; i++) {
                    const file = fileStats[i];
                    const isOverCount = i >= maxCount;
                    const isOverAge = now - file.mtime > maxAgeMs;

                    if (isOverCount || isOverAge) {
                        try {
                            await fs.promises.unlink(file.path);
                            deleted++;
                        } catch (e) {
                            logger.warn(`[SessionManager] Failed to delete ${file.path}: ${e}`);
                        }
                    }
                }
            }

            if (deleted > 0) {
                logger.info(`[SessionManager] Garbage collected ${deleted} old session files`);
            }
        } catch (e: any) {
            if (e.code !== 'ENOENT') {
                logger.warn(`[SessionManager] GC failed: ${e.message}`);
            }
        }
        return deleted;
    }
}
