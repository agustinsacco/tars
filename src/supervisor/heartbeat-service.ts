import fs from 'fs/promises';
import path from 'path';
import { Task } from '../types/index.js';
import { Supervisor } from './supervisor.js';
import logger from '../utils/logger.js';
import { Config } from '../config/config.js';
import { CronExpressionParser } from 'cron-parser';
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

        // Run initial memory sync at startup
        await this.syncMemoryIfNeeded();

        // Start interval
        this.interval = setInterval(() => this.tick(), intervalMs);
    }

    public stop(): void {
        if (this.interval) {
            clearInterval(this.interval);
            this.interval = null;
        }
        logger.info('💓 Heartbeat service stopped');
    }

    private async tick(): Promise<void> {
        if (this.isExecuting) return;
        this.isExecuting = true;

        try {
            // 1. Maintenance & Sync (rate-limited)
            this.processor.cleanup();
            await this.syncMemoryIfNeeded();

            // 2. Autonomous check only if user was recently active
            if (this.isUserIdle()) {
                logger.debug('💤 Skipping autonomous check — user idle');
                return;
            }

            await this.autonomousCheck();
        } catch (error: any) {
            logger.error(`❌ Heartbeat tick error: ${error.message}`);
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
        } catch (error: any) {
            logger.error(`❌ Memory sync failed: ${error.message}`);
        }

        // Session file garbage collection (rate-limited by the same sync interval)
        if (this.sessionManager) {
            const tmpDir = path.join(this.config.homeDir, '.gemini', 'tmp');
            try {
                await this.sessionManager.garbageCollect(tmpDir, 3, 50);
            } catch (e: any) {
                logger.warn(`⚠️ Session GC failed: ${e.message}`);
            }
        }
    }

    private async autonomousCheck(): Promise<void> {
        const prompt = `Self-Correction and Autonomous Heartbeat:
Review your current objectives using the 'tars-memory' tools (specifically 'memory_list_facts') and check for any pending tasks.
If everything is on track and no immediate action is required, reply exactly with 'SILENT_ACK'.
If you detect an issue, a missed deadline, or a high-priority task that needs starting: provide a short internal reasoning, execute the necessary tools, and then use the 'send_notification' tool to proactively alert the user of what you are doing.`;

        try {
            const response = await this.supervisor.executeTask(prompt);

            if (response.includes('SILENT_ACK')) {
                return;
            }

            logger.info(`🤖 Tars Heartbeat initiated action: ${response.substring(0, 100)}...`);
        } catch (error: any) {
            logger.error(`❌ Autonomous check failed: ${error.message}`);
        }
    }
}
