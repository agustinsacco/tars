import fs from 'fs/promises';
import { Task } from '../types/index.js';
import { Supervisor } from './Supervisor.js';
import logger from '../utils/Logger.js';
import { Config } from '../config/Config.js';
import cronParser from 'cron-parser';

/**
 * HeartbeatService - Manages background task execution via file polling
 */
export class HeartbeatService {
    private interval: NodeJS.Timeout | null = null;
    private isExecuting: boolean = false;

    constructor(
        private readonly supervisor: Supervisor,
        private readonly config: Config
    ) { }

    public async start(): Promise<void> {
        const intervalMs = this.config.heartbeatIntervalMs;
        logger.info(`💓 Heartbeat service started (Interval: ${intervalMs / 1000}s)`);

        // Initial run
        this.tick();

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
            const tasks = await this.loadTasks();
            const now = new Date();
            const dueTasks = tasks.filter(t => t.enabled && new Date(t.nextRun) <= now);

            if (dueTasks.length > 0) {
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

    private async runTask(task: Task): Promise<void> {
        logger.info(`🚀 Running task: ${task.title} (${task.id})`);

        try {
            const result = await this.supervisor.executeTask(task.prompt, task.mode);
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
            // Check if it's a cron expression
            const interval = (cronParser as any).parseExpression(schedule);
            return interval.next().toISOString();
        } catch (err) {
            // If not cron, assume it's a one-time ISO date or a relative time (stub for now)
            try {
                const date = new Date(schedule);
                if (isNaN(date.getTime())) throw new Error('Invalid date');
                return date.toISOString();
            } catch {
                // Fallback: run in 24 hours if invalid
                return new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
            }
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
