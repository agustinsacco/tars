import fs from 'fs/promises';
import { Task } from '../types/index.js';
import { Supervisor } from './supervisor.js';
import logger from '../utils/logger.js';
import { Config } from '../config/config.js';
import { CronExpressionParser } from 'cron-parser';
import { DiscordBot } from '../discord/discord-bot.js';

/**
 * CronService - Dedicated operator for scheduled tasks.
 * Runs on a tight interval to ensure precisely timed execution.
 */
export class CronService {
    private interval: NodeJS.Timeout | null = null;
    private isExecuting: boolean = false;
    private static readonly POLL_INTERVAL_MS = 60 * 1000; // Check every minute

    constructor(
        private readonly supervisor: Supervisor,
        private readonly config: Config,
        private readonly discordBot: DiscordBot
    ) { }

    public async start(): Promise<void> {
        const tasks = await this.loadTasks();
        const activeTasks = tasks.filter((t) => t.enabled);

        logger.info(
            `⏰ Cron service started (Precision: ${CronService.POLL_INTERVAL_MS / 1000}s, Monitoring ${activeTasks.length} active tasks)`
        );

        // Start the polling loop
        this.interval = setInterval(() => this.tick(), CronService.POLL_INTERVAL_MS);

        // Initial tick to catch any tasks immediately
        this.tick();
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
                await this.saveTasks(tasks);
            }
        } catch (error: any) {
            logger.error(`❌ Cron service tick error: ${error.message}`);
        } finally {
            this.isExecuting = false;
        }
    }

    private async runTask(task: Task): Promise<void> {
        logger.info(`🚀 [CRON] Running task: ${task.title} (${task.id})`);

        try {
            // Tasks run in their own ephemeral session within the engine
            const contextualPrompt = `[SYSTEM: You are executing a scheduled background task. This is a NON-INTERACTIVE session. You CANNOT speak to the user or use the ask_user tool. Execute the directive autonomously and output a summary of your actions.]\n\nTask Directive: ${task.prompt}`;
            const result = await this.supervisor.executeTask(contextualPrompt);
            logger.info(`✅ [CRON] Task ${task.id} completed. Result length: ${result.length}`);
            // Notify if requested
            if (task.mode === 'notify') {
                await this.discordBot.notify(`**${task.title}**\n${result}`);
            }

            task.lastRun = new Date().toISOString();
            task.failedCount = 0;

            // Check if it's a one-off task (not a cron expression)
            try {
                CronExpressionParser.parse(task.schedule);
            } catch {
                // If it fails to parse as cron, it's a one-off (ISO date). Disable it.
                task.enabled = false;
                logger.info(`✅ [CRON] One-off task ${task.id} disabled after successful execution.`);
            }
        } catch (error: any) {
            logger.error(`❌ [CRON] Task ${task.id} failed: ${error.message}`);
            task.failedCount++;

            if (task.failedCount >= 3) {
                try {
                    CronExpressionParser.parse(task.schedule);
                } catch {
                    task.enabled = false;
                    logger.warn(`⚠️ [CRON] One-off task ${task.id} disabled after 3 failures.`);
                }
            }
        } finally {
            if (task.enabled) {
                task.nextRun = this.calculateNextRun(task.schedule);
            }
            task.updatedAt = new Date().toISOString();
        }
    }

    private calculateNextRun(schedule: string): string {
        try {
            const interval = CronExpressionParser.parse(schedule);
            const next = interval.next().toISOString();
            return (next as any) || new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
        } catch (err) {
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
        try {
            const data = await fs.readFile(this.config.taskFilePath, 'utf-8');
            return JSON.parse(data);
        } catch (error: any) {
            if (error.code === 'ENOENT') return [];
            throw error;
        }
    }

    private async saveTasks(tasks: Task[]): Promise<void> {
        const data = JSON.stringify(tasks, null, 2);
        await fs.writeFile(this.config.taskFilePath, data, 'utf-8');
    }
}
