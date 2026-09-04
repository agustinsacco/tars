import path from 'path';
import { type Supervisor } from './supervisor.js';
import logger from '../utils/logger.js';
import { type Config } from '../config/config.js';
import { AttachmentProcessor } from '../utils/attachment-processor.js';
import { type SessionManager } from './session-manager.js';
import { type InitiativeService } from '../initiative/initiative-service.js';

/**
 * HeartbeatService - Manages background maintenance and autonomous health checks.
 */
export class HeartbeatService {
    private interval: NodeJS.Timeout | null = null;
    private isExecuting: boolean = false;
    private processor: AttachmentProcessor;
    private lastSyncTime: number = 0;

    // Minimum interval between memory syncs
    private static readonly SYNC_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

    constructor(
        private readonly supervisor: Supervisor,
        private readonly config: Config,
        private readonly sessionManager?: SessionManager,
        private readonly initiativeService?: InitiativeService
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
        await this.runInitiativeSafely();

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

            // 3. Goal-grounded initiative runs independently of user activity.
            await this.runInitiativeSafely();

            // 4. Optional: invoke the agent every heartbeat to manage tasks and do work.
            await this.runAgentSafely();

            logger.debug('💓 Heartbeat tick completed successfully');
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            logger.error(`❌ Heartbeat tick error: ${message}`);
        } finally {
            this.isExecuting = false;
        }
    }

    private async runInitiativeSafely(): Promise<void> {
        try {
            await this.initiativeService?.tick();
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            logger.warn(`Initiative check failed; heartbeat will continue: ${message}`);
        }
    }

    /**
     * Optional autonomous agent invocation on every heartbeat tick.
     * Gated by config.heartbeatRunAgent (default off). Runs after maintenance and
     * initiative so the agent sees freshly synced memory. Failures — including the
     * supervisor being busy with a live run — never abort the heartbeat.
     */
    private async runAgentSafely(): Promise<void> {
        if (!this.config.heartbeatRunAgent) return;
        try {
            logger.debug('💓 Heartbeat agent invocation starting');
            // allowNotifications: true exposes the send_notification tool so the agent can
            // reach the owner when it judges something important; otherwise it stays quiet.
            await this.supervisor.executeTask(this.config.heartbeatAgentPrompt, {
                allowNotifications: true
            });
            logger.debug('💓 Heartbeat agent invocation completed');
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            if (message.toLowerCase().includes('busy')) {
                logger.debug('💓 Heartbeat agent invocation skipped: supervisor busy');
                return;
            }
            logger.warn(`Heartbeat agent invocation failed; heartbeat will continue: ${message}`);
        }
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
