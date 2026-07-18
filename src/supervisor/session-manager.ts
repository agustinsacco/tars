import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { z } from 'zod';
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

export const SessionIdSchema = z
    .string()
    .min(1)
    .max(128)
    .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, 'Session ID must be a safe filename token')
    .refine((value) => value !== '.' && value !== '..', 'Session ID is invalid');

const SessionDataSchema = z.object({
    sessionId: SessionIdSchema,
    createdAt: z
        .string()
        .datetime()
        .default(() => new Date().toISOString()),
    totalInputTokens: z.number().nonnegative().default(0),
    totalOutputTokens: z.number().nonnegative().default(0),
    totalCachedTokens: z.number().nonnegative().default(0),
    interactionCount: z.number().int().nonnegative().default(0),
    lastInteractionAt: z
        .string()
        .datetime()
        .default(() => new Date().toISOString()),
    lastInputTokens: z.number().nonnegative().default(0),
    totalNetTokens: z.number().nonnegative().default(0),
    lastUserInteractionAt: z.string().datetime().optional(),
    compressionCount: z.number().int().nonnegative().default(0)
});

/**
 * Manages Tars session persistence with token tracking
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
    async load(): Promise<string | null> {
        try {
            await fs.promises.access(this.sessionFilePath);
        } catch {
            return null;
        }

        try {
            const raw = await fs.promises.readFile(this.sessionFilePath, 'utf-8');
            const rawSession: unknown = JSON.parse(raw);
            const parsed = z.record(z.unknown()).parse(rawSession);
            const result = SessionDataSchema.safeParse({
                ...parsed,
                totalNetTokens: parsed.totalNetTokens ?? parsed.totalInputTokens ?? 0
            });
            if (!result.success) {
                logger.warn('[SessionManager] Ignoring invalid session metadata');
                return null;
            }

            this.sessionData = result.data;

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
            const validatedSessionId = SessionIdSchema.parse(sessionId);
            // Only save if it's a new session or we don't have session data yet
            if (this.sessionData && this.sessionData.sessionId === validatedSessionId) {
                return;
            }

            this.sessionData = {
                sessionId: validatedSessionId,
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
            logger.info(`[SessionManager] New session initialized: ${validatedSessionId}`);
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
        await this.updateContextEstimate(tokens);
        logger.info(`[SessionManager] Updated context token size post-compaction: ${tokens}`);
    }

    /**
     * Updates the current context estimate without counting a failed request as usage.
     */
    async updateContextEstimate(tokens: number): Promise<void> {
        if (!this.sessionData) return;
        this.sessionData.lastInputTokens = Number.isFinite(tokens) ? Math.max(0, tokens) : 0;
        try {
            await this.atomicWrite();
        } catch (e) {
            logger.error(`[SessionManager] Failed to update context estimate: ${e}`);
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
        } catch (error: unknown) {
            if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) {
                logger.error(`[SessionManager] Failed to clear session: ${error}`);
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

        const tempPath = `${this.sessionFilePath}.${process.pid}.${randomUUID()}.tmp`;
        const dir = path.dirname(this.sessionFilePath);

        try {
            await fs.promises.mkdir(dir, { recursive: true });
            await fs.promises.writeFile(tempPath, JSON.stringify(this.sessionData, null, 2), {
                encoding: 'utf-8',
                mode: 0o600
            });
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
     * Garbage-collects the current flat chats directory while retaining support
     * for the legacy project/chats layout during migration.
     */
    async garbageCollect(
        tmpDir: string,
        maxAgeDays: number = 3,
        maxCount: number = 50,
        protectedSessionIds: readonly string[] = []
    ): Promise<number> {
        let deleted = 0;
        const protectedNames = new Set(
            protectedSessionIds.flatMap((sessionId) => {
                const parsed = SessionIdSchema.safeParse(sessionId);
                if (!parsed.success) return [];
                return [`${parsed.data}.json`, `${parsed.data}.jsonl`];
            })
        );
        try {
            const entries = await fs.promises.readdir(tmpDir, { withFileTypes: true });
            const containsCurrentChats = entries.some(
                (entry) => entry.isFile() && entry.name.endsWith('.json')
            );
            const chatsDirectories = containsCurrentChats ? [tmpDir] : [];

            for (const entry of entries.filter((candidate) => candidate.isDirectory())) {
                const legacyChatsDir = path.join(tmpDir, entry.name, 'chats');
                try {
                    await fs.promises.access(legacyChatsDir);
                    chatsDirectories.push(legacyChatsDir);
                } catch {
                    // Not a legacy project directory.
                }
            }

            for (const chatsDir of chatsDirectories) {
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
                    if (protectedNames.has(path.basename(file.path))) continue;
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
        } catch (error: unknown) {
            const code =
                typeof error === 'object' && error !== null && 'code' in error
                    ? Reflect.get(error, 'code')
                    : undefined;
            if (code !== 'ENOENT') {
                const message = error instanceof Error ? error.message : String(error);
                logger.warn(`[SessionManager] GC failed: ${message}`);
            }
        }
        return deleted;
    }
}
