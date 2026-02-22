import fs from 'fs/promises';
import { Task } from '../types/index.js';
import { Supervisor } from './supervisor.js';
import logger from '../utils/logger.js';
import { Config } from '../config/config.js';
import { CronExpressionParser } from 'cron-parser';
import { AttachmentProcessor } from '../utils/attachment-processor.js';
import { SessionManager } from './session-manager.js';

/**
 * HeartbeatService - Manages background task execution via file polling
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

        // Start interval immediately, but first tick waits for interval
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

            // 2. Load Tasks
            const tasks = await this.loadTasks();
            const now = new Date();
            const dueTasks = tasks.filter((t) => t.enabled && new Date(t.nextRun) <= now);

            // 3. Scheduled tasks always run regardless of idle state
            if (dueTasks.length > 0) {
                logger.info(`💓 Found ${dueTasks.length} due tasks`);
                for (const task of dueTasks) {
                    await this.runTask(task);
                }
                await this.saveTasks(tasks);
                return;
            }

            // 4. Autonomous check only if user was recently active
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

    /**
     * Check if the user has been idle beyond the threshold
     */
    private isUserIdle(): boolean {
        if (!this.sessionManager) return false;
        const lastActivity = this.sessionManager.getLastUserInteraction();
        if (!lastActivity) return true; // No activity recorded = idle
        return Date.now() - lastActivity.getTime() > HeartbeatService.IDLE_THRESHOLD_MS;
    }

    /**
     * Rate-limited memory sync — only runs once per hour
     */
    private async syncMemoryIfNeeded(): Promise<void> {
        const now = Date.now();
        if (now - this.lastSyncTime < HeartbeatService.SYNC_INTERVAL_MS) return;

        try {
            await this.supervisor.memory.fullSync();
            this.lastSyncTime = now;
        } catch (error: any) {
            logger.error(`❌ Memory sync failed: ${error.message}`);
        }
    }

    private async autonomousCheck(): Promise<void> {
        const prompt = `Self-Correction and Autonomous Heartbeat:\nReview your current objectives in GEMINI.md and any pending tasks.\nIf everything is on track and no immediate action is required, reply exactly with 'SILENT_ACK'.\nIf you detect an issue, a missed deadline, or a high-priority task that needs starting, provide a short internal reasoning and then describe the action you are taking.`;

        try {
            const response = await this.supervisor.executeTask(prompt);

            if (response.includes('SILENT_ACK')) {
                // Heartbeat OK — ephemeral session, no pruning needed
                return;
            }

            // If the AI didn't say SILENT_ACK, it wants to do something!
            logger.info(`🤖 Tars Heartbeat initiated action: ${response.substring(0, 100)}...`);
        } catch (error: any) {
            logger.error(`❌ Autonomous check failed: ${error.message}`);
        }
    }

    private async runTask(task: Task): Promise<void> {
        logger.info(`🚀 Running task: ${task.title} (${task.id})`);

        try {
            const result = await this.supervisor.executeTask(task.prompt);
            logger.info(`✅ Task ${task.id} completed. Result length: ${result.length}`);

            task.lastRun = new Date().toISOString();
            task.failedCount = 0;
        } catch (error: any) {
            logger.error(`❌ Task ${task.id} failed: ${error.message}`);
            task.failedCount++;
        } finally {
            // Calculate next run
            task.nextRun = this.calculateNextRun(task.schedule);
            task.updatedAt = new Date().toISOString();
        }
    }

    private calculateNextRun(schedule: string): string {
        try {
            // 1. Try parsing as a cron expression (using the new 5.x API)
            const interval = CronExpressionParser.parse(schedule);
            const next = interval.next();
            const iso = next.toISOString();
            if (!iso) {
                throw new Error('Could not calculate next run from cron.');
            }
            return iso;
        } catch (err) {
            // 2. If not cron, try parsing as a specific ISO date
            const date = new Date(schedule);
            if (!isNaN(date.getTime()) && schedule.includes('-')) {
                return date.toISOString();
            }

            // 3. Absolute Fallback: Run in 24 hours if the schedule is totally unparseable
            logger.warn(`⚠️ Unrecognized schedule format: "${schedule}". Falling back to 24h.`);
            return new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
        }
    }

    private async loadTasks(): Promise<Task[]> {
        try {
            const data = await fs.readFile(this.config.taskFilePath, 'utf-8');
            return JSON.parse(data);
        } catch (error: any) {
            if (error.code === 'ENOENT') {
                return [];
            }
            throw error;
        }
    }

    private async saveTasks(tasks: Task[]): Promise<void> {
        const data = JSON.stringify(tasks, null, 2);
        await fs.writeFile(this.config.taskFilePath, data, 'utf-8');
    }
}
