import path from 'path';
import { Supervisor } from './supervisor.js';
import logger from '../utils/logger.js';
import { Config } from '../config/config.js';
import { AttachmentProcessor } from '../utils/attachment-processor.js';
import { SessionManager } from './session-manager.js';

/**
 * HeartbeatService - Manages background maintenance and autonomous health checks.
 */
export class HeartbeatService {
    private interval: NodeJS.Timeout | null = null;
    private isExecuting: boolean = false;
    private processor: AttachmentProcessor;
    private lastSyncTime: number = 0;

    // Only run heartbeats if user was active within this window
    private static readonly IDLE_THRESHOLD_MS = 2 * 60 * 60 * 1000; // 2 hours
    // Minimum interval between memory syncs
    private static readonly SYNC_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

    constructor(
        private readonly supervisor: Supervisor,
        private readonly config: Config,
        private readonly sessionManager?: SessionManager
    ) {
        this.processor = new AttachmentProcessor(config);
    }

    public async start(): Promise<void> {
        const intervalMs = this.config.heartbeatIntervalMs;
        logger.info(`💓 Heartbeat service started (Interval: ${intervalMs / 1000}s)`);

        // Load the active session before maintenance so its chat transcript is
        // never collected merely because the assistant was idle before restart.
        await this.sessionManager?.load();

        // Run initial memory sync at startup
        await this.syncMemoryIfNeeded();

        // Start interval
        this.interval = setInterval(() => void this.tick(), intervalMs);
    }

    public stop(): void {
        if (this.interval) {
            clearInterval(this.interval);
            this.interval = null;
        }
        logger.info('💓 Heartbeat service stopped');
    }

    private async tick(): Promise<void> {
        if (this.isExecuting) {
            logger.debug('💓 Heartbeat tick skipped: already executing');
            return;
        }
        this.isExecuting = true;
        logger.debug('💓 Heartbeat tick started');

        try {
            // 0. Check if user is idle - skip heavy work if so
            if (this.isUserIdle()) {
                logger.debug(
                    '💓 Heartbeat tick skipped: User is idle (>2h since last interaction)'
                );
                return;
            }

            // 1. Safety net: report unexpectedly long runs without unlocking them.
            const STALE_LOCK_MS = 10 * 60 * 1000; // 10 minutes
            if (this.supervisor.hasStaleRun(STALE_LOCK_MS)) {
                logger.warn(
                    '⚠️ Supervisor has been busy for more than 10 minutes; the live run remains locked to prevent concurrent session writes'
                );
            }

            // 2. Maintenance & Sync (rate-limited)
            this.processor.cleanup();
            await this.syncMemoryIfNeeded();

            logger.debug('💓 Heartbeat tick completed successfully');
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            logger.error(`❌ Heartbeat tick error: ${message}`);
        } finally {
            this.isExecuting = false;
        }
    }

    private isUserIdle(): boolean {
        if (!this.sessionManager) return false;
        const lastActivity = this.sessionManager.getLastUserInteraction();
        if (!lastActivity) return true;
        return Date.now() - lastActivity.getTime() > HeartbeatService.IDLE_THRESHOLD_MS;
    }

    private async syncMemoryIfNeeded(): Promise<void> {
        const now = Date.now();
        if (now - this.lastSyncTime < HeartbeatService.SYNC_INTERVAL_MS) return;

        try {
            await this.supervisor.memory.fullSync();
            this.lastSyncTime = now;
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            logger.error(`❌ Memory sync failed: ${message}`);
        }

        // Session file garbage collection (rate-limited by the same sync interval)
        if (this.sessionManager) {
            const chatsDir = path.join(this.config.homeDir, 'chats');
            try {
                const activeSessionId = this.sessionManager.getStats()?.sessionId;
                await this.sessionManager.garbageCollect(
                    chatsDir,
                    3,
                    50,
                    activeSessionId ? [activeSessionId] : []
                );
            } catch (error: unknown) {
                const message = error instanceof Error ? error.message : String(error);
                logger.warn(`⚠️ Session GC failed: ${message}`);
            }
        }
    }
}
