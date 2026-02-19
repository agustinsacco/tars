import fs from 'fs/promises';
import { Task } from '../types/index.js';
import { Supervisor } from './supervisor.js';
import logger from '../utils/logger.js';
import { Config } from '../config/config.js';
import { CronExpressionParser } from 'cron-parser';
import { AttachmentProcessor } from '../utils/attachment-processor.js';

/**
 * HeartbeatService - Manages background task execution via file polling
 */
export class HeartbeatService {
    private interval: NodeJS.Timeout | null = null;
    private isExecuting: boolean = false;
    private processor: AttachmentProcessor;

    constructor(
        private readonly supervisor: Supervisor,
        private readonly config: Config
    ) {
        this.processor = new AttachmentProcessor(config);
    }

    public async start(): Promise<void> {
        const intervalMs = this.config.heartbeatIntervalMs;
        logger.info(`💓 Heartbeat service started (Interval: ${intervalMs / 1000}s)`);

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
            // 1. Maintenance & Sync
            this.processor.cleanup();
            await this.supervisor.memory.fullSync();

            // 2. Load Tasks
            const tasks = await this.loadTasks();
            const now = new Date();
            const dueTasks = tasks.filter((t) => t.enabled && new Date(t.nextRun) <= now);

            // 3. Autonomous Check (The OpenClaw style)
            // If no hard-scheduled tasks, we do a semantic "health check"
            if (dueTasks.length === 0) {
                await this.autonomousCheck();
            } else {
                logger.info(`💓 Found ${dueTasks.length} due tasks`);
                for (const task of dueTasks) {
                    await this.runTask(task);
                }
                await this.saveTasks(tasks);
            }
        } catch (error: any) {
            logger.error(`❌ Heartbeat tick error: ${error.message}`);
        } finally {
            this.isExecuting = false;
        }
    }

    private async autonomousCheck(): Promise<void> {
        // This is a "quiet" heartbeat. We ask the AI if anything needs attention
        // based on the context it has in memory.
        const prompt = `Self-Correction and Autonomous Heartbeat:\nReview your current objectives in GEMINI.md and any pending tasks.\nIf everything is on track and no immediate action is required, reply exactly with 'SILENT_ACK'.\nIf you detect an issue, a missed deadline, or a high-priority task that needs starting, provide a short internal reasoning and then describe the action you are taking.`;

        try {
            const response = await this.supervisor.executeTask(prompt);

            if (response.includes('SILENT_ACK')) {
                // Heartbeat OK, prune to prevent context bloat
                await this.supervisor.pruneLastTurn();
                return;
            }

            // If the AI didn't say SILENT_ACK, it wants to do something!
            logger.info(`🤖 Tars Heartbeat initiated action: ${response.substring(0, 100)}...`);
            // Here we could route this to Discord or a Log.
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
                // We check for '-' to ensure it's likely a date string and not a weird numeric cron fallback
                return date.toISOString();
            }

            // 3. Absolute Fallback: Run in 24 hours if the schedule is totally unparseable
            // This prevents the task from "looping" or getting stuck in the past
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
