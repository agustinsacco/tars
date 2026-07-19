import { type Task } from '../types/index.js';
import { type Supervisor } from './supervisor.js';
import logger from '../utils/logger.js';
import { type Config } from '../config/config.js';
import { CronExpressionParser } from 'cron-parser';
import { type ChannelManager } from '../channels/channel-manager.js';
import { TaskFileStore } from './task-file-store.js';
import { DLPService } from '../utils/dlp-service.js';

function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

/**
 * CronService - Dedicated operator for scheduled tasks.
 * Runs on a tight interval to ensure precisely timed execution.
 */
export class CronService {
    private interval: NodeJS.Timeout | null = null;
    private isExecuting: boolean = false;
    private readonly taskStore: TaskFileStore;
    private static readonly POLL_INTERVAL_MS = 60 * 1000; // Check every minute

    constructor(
        private readonly supervisor: Supervisor,
        private readonly config: Config,
        private readonly channelManager: ChannelManager
    ) {
        this.taskStore = new TaskFileStore(config.taskFilePath);
    }

    public async start(): Promise<void> {
        const tasks = await this.loadTasks();
        const activeTasks = tasks.filter((t) => t.enabled);

        logger.info(
            `⏰ Cron service started (Precision: ${CronService.POLL_INTERVAL_MS / 1000}s, Monitoring ${activeTasks.length} active tasks)`
        );

        // Start the polling loop
        this.interval = setInterval(() => void this.tick(), CronService.POLL_INTERVAL_MS);

        // Initial tick to catch any tasks immediately
        void this.tick();
    }

    public stop(): void {
        if (this.interval) {
            clearInterval(this.interval);
            this.interval = null;
        }
        logger.info('⏰ Cron service stopped');
    }

    private async tick(): Promise<void> {
        if (this.isExecuting) return;
        this.isExecuting = true;

        try {
            const tasks = await this.loadTasks();
            logger.debug(`⏰ Cron tick: Checking ${tasks.length} tasks...`);
            const now = new Date();
            const dueTasks = tasks.filter((t) => t.enabled && new Date(t.nextRun) <= now);

            if (dueTasks.length > 0) {
                logger.info(`⏰ Cron: Found ${dueTasks.length} due tasks`);
                for (const task of dueTasks) {
                    await this.runTask(task);
                }
            }
        } catch (error: unknown) {
            logger.error(`❌ Cron service tick error: ${getErrorMessage(error)}`);
        } finally {
            this.isExecuting = false;
        }
    }

    private async runTask(task: Task): Promise<void> {
        logger.info(`🚀 [CRON] Running task: ${task.title} (${task.id})`);

        try {
            const contextualPrompt = `[SYSTEM: Execute this scheduled task non-interactively. Do not ask questions or send notifications; the scheduler applies the task's notification policy. Return a concise result summary.]\n\nTask Directive: ${task.prompt}`;
            const result = await this.supervisor.executeTask(contextualPrompt);
            logger.info(`✅ [CRON] Task ${task.id} completed. Result length: ${result.length}`);

            const updatedTask = await this.taskStore.updateTask(task.id, (taskToUpdate) => {
                taskToUpdate.lastRun = new Date().toISOString();
                taskToUpdate.failedCount = 0;

                try {
                    CronExpressionParser.parse(taskToUpdate.schedule);
                } catch {
                    taskToUpdate.enabled = false;
                    logger.info(
                        `✅ [CRON] One-off task ${taskToUpdate.id} disabled after successful execution.`
                    );
                }

                if (taskToUpdate.enabled) {
                    taskToUpdate.nextRun = this.calculateNextRun(taskToUpdate.schedule);
                }
                taskToUpdate.updatedAt = new Date().toISOString();
            });

            if (!updatedTask) {
                logger.info(
                    `ℹ️ [CRON] Task ${task.id} was deleted during execution. Skipping sync.`
                );
                return;
            }

            if (updatedTask.mode === 'notify') {
                await this.notifySafely(result);
            }
        } catch (error: unknown) {
            const errorMessage = getErrorMessage(error);
            const safeErrorMessage = DLPService.scrub(errorMessage);
            // Don't count busy skips as failures — the supervisor is temporarily occupied
            if (errorMessage.includes('busy')) {
                logger.info(`⏳ [CRON] Task ${task.id} skipped — supervisor busy`);
                return;
            }

            logger.error(`❌ [CRON] Task ${task.id} failed: ${safeErrorMessage}`);

            const updatedTask = await this.taskStore.updateTask(task.id, (taskToUpdate) => {
                taskToUpdate.failedCount++;
                if (taskToUpdate.failedCount >= 3) {
                    try {
                        CronExpressionParser.parse(taskToUpdate.schedule);
                    } catch {
                        taskToUpdate.enabled = false;
                        logger.warn(
                            `⚠️ [CRON] One-off task ${taskToUpdate.id} disabled after 3 failures.`
                        );
                    }
                }
                taskToUpdate.updatedAt = new Date().toISOString();
            });

            if (updatedTask?.mode === 'notify') {
                await this.notifySafely(
                    `⚠️ Scheduled task "${updatedTask.title}" failed: ${safeErrorMessage}`
                );
            }
        }
    }

    private async notifySafely(content: string): Promise<void> {
        try {
            await this.channelManager.notify(content);
        } catch (error: unknown) {
            logger.error(
                `❌ [CRON] Notification delivery failed: ${DLPService.scrub(getErrorMessage(error))}`
            );
        }
    }

    private calculateNextRun(schedule: string): string {
        try {
            const interval = CronExpressionParser.parse(schedule);
            const next = interval.next().toISOString();
            return next || new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
        } catch {
            const date = new Date(schedule);
            if (!isNaN(date.getTime()) && schedule.includes('-')) {
                // Return a date far in the past/future so it doesn't immediately re-trigger
                // Although it should be disabled now, this is a safety net
                return date.toISOString();
            }

            logger.warn(
                `⚠️ [CRON] Unrecognized schedule format: "${schedule}". Falling back to 24h.`
            );
            return new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
        }
    }

    private async loadTasks(): Promise<Task[]> {
        return this.taskStore.loadTasks();
    }
}
