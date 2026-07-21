import crypto from 'node:crypto';
import path from 'node:path';

import { z } from 'zod';

import { type Task } from '../types/index.js';
import { type Supervisor } from './supervisor.js';
import logger from '../utils/logger.js';
import { type Config } from '../config/config.js';
import { CronExpressionParser } from 'cron-parser';
import { type ChannelManager } from '../channels/channel-manager.js';
import { TaskFileStore } from './task-file-store.js';
import { DLPService } from '../utils/dlp-service.js';
import { TaskDigestStore } from './task-digest-store.js';

const TaskOutcomeSchema = z.object({
    status: z.enum(['ok', 'warning', 'error']),
    changed: z.boolean(),
    requiresAttention: z.boolean(),
    summary: z.string().trim().min(1).max(8_000)
});

type TaskOutcome = z.infer<typeof TaskOutcomeSchema>;

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
    private readonly digestStore: TaskDigestStore;
    private static readonly POLL_INTERVAL_MS = 60 * 1000; // Check every minute

    constructor(
        private readonly supervisor: Supervisor,
        private readonly config: Config,
        private readonly channelManager: ChannelManager
    ) {
        this.taskStore = new TaskFileStore(config.taskFilePath);
        const homeDirectory = config.homeDir || path.dirname(path.dirname(config.taskFilePath));
        this.digestStore = new TaskDigestStore(
            path.join(homeDirectory, 'data', 'task-notification-digest.json')
        );
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
            await this.flushDigestIfDue();
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
            const contextualPrompt = `[SYSTEM: Execute this scheduled task non-interactively. Do not ask questions or send notifications; the scheduler applies the task's notification policy. Your final response MUST be one JSON object with exactly these fields: {"status":"ok|warning|error","changed":boolean,"requiresAttention":boolean,"summary":"concise result"}. Report status=error when the requested outcome was not achieved, even if tools ran.]\n\nTask Directive: ${task.prompt}`;
            const result = await this.supervisor.executeTask(contextualPrompt);
            const outcome = parseTaskOutcome(result);
            if (outcome.status === 'error') throw new Error(outcome.summary);
            logger.info(`✅ [CRON] Task ${task.id} completed. Result length: ${result.length}`);

            const fingerprint = fingerprintOutcome(outcome);
            const previousFingerprint = task.lastOutcomeFingerprint;

            const updatedTask = await this.taskStore.updateTask(task.id, (taskToUpdate) => {
                taskToUpdate.lastRun = new Date().toISOString();
                taskToUpdate.failedCount = 0;
                taskToUpdate.lastOutcomeFingerprint = fingerprint;

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

            await this.applyNotificationPolicy({
                outcome,
                previousFingerprint,
                task: updatedTask
            });
        } catch (error: unknown) {
            const errorMessage = getErrorMessage(error);
            const safeErrorMessage = DLPService.scrub(errorMessage);
            // Don't count busy skips as failures — the supervisor is temporarily occupied
            if (errorMessage.includes('busy')) {
                logger.info(`⏳ [CRON] Task ${task.id} skipped — supervisor busy`);
                return;
            }

            logger.error(`❌ [CRON] Task ${task.id} failed: ${safeErrorMessage}`);
            const outcome: TaskOutcome = {
                changed: true,
                requiresAttention: true,
                status: 'error',
                summary: `Scheduled task "${task.title}" failed: ${safeErrorMessage}`
            };
            const fingerprint = fingerprintOutcome(outcome);

            const updatedTask = await this.taskStore.updateTask(task.id, (taskToUpdate) => {
                taskToUpdate.failedCount++;
                taskToUpdate.lastOutcomeFingerprint = fingerprint;
                taskToUpdate.lastRun = new Date().toISOString();
                try {
                    CronExpressionParser.parse(taskToUpdate.schedule);
                    taskToUpdate.nextRun = this.calculateNextRun(taskToUpdate.schedule);
                } catch {
                    if (taskToUpdate.failedCount >= 3) {
                        taskToUpdate.enabled = false;
                        logger.warn(
                            `⚠️ [CRON] One-off task ${taskToUpdate.id} disabled after 3 failures.`
                        );
                    }
                }
                taskToUpdate.updatedAt = new Date().toISOString();
            });

            if (updatedTask) {
                await this.applyNotificationPolicy({
                    outcome,
                    previousFingerprint: task.lastOutcomeFingerprint,
                    task: updatedTask
                });
            }
        }
    }

    private async applyNotificationPolicy(input: {
        readonly outcome: TaskOutcome;
        readonly previousFingerprint?: string;
        readonly task: Task;
    }): Promise<void> {
        const { outcome, previousFingerprint, task } = input;
        if (task.mode === 'digest') {
            await this.digestStore.enqueue(`**${task.title}** — ${outcome.summary}`);
            return;
        }
        if (task.mode === 'notify') {
            await this.notifySafely(outcome.summary);
            return;
        }
        if (task.mode === 'on-failure' && outcome.status === 'error') {
            await this.notifySafely(outcome.summary);
            return;
        }
        if (task.mode === 'on-change' && outcome.changed) {
            const currentFingerprint = fingerprintOutcome(outcome);
            if (previousFingerprint !== currentFingerprint) {
                await this.notifySafely(outcome.summary);
            }
            return;
        }
        if (
            task.mode === 'action-required' &&
            (outcome.requiresAttention || ['warning', 'error'].includes(outcome.status))
        ) {
            await this.notifySafely(outcome.summary);
        }
    }

    private async flushDigestIfDue(): Promise<void> {
        const entries = await this.digestStore.getDueEntries();
        if (entries.length === 0) return;
        const delivered = await this.notifySafely(
            `## Scheduled task digest\n\n${entries.map((entry) => `- ${entry}`).join('\n')}`
        );
        if (delivered) await this.digestStore.markDelivered();
    }

    private async notifySafely(content: string): Promise<boolean> {
        try {
            await this.channelManager.notify(content);
            return true;
        } catch (error: unknown) {
            logger.error(
                `❌ [CRON] Notification delivery failed: ${DLPService.scrub(getErrorMessage(error))}`
            );
            return false;
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

function extractJsonObject(content: string): string | null {
    const trimmed = content
        .trim()
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/, '');
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    return trimmed.slice(start, end + 1);
}

export function parseTaskOutcome(content: string): TaskOutcome {
    const candidate = extractJsonObject(content);
    if (candidate) {
        try {
            const parsed: unknown = JSON.parse(candidate);
            const outcome = TaskOutcomeSchema.safeParse(parsed);
            if (outcome.success) return outcome.data;
        } catch {
            // Legacy plain-text task results are normalized below.
        }
    }

    const summary = content.trim() || 'Scheduled task returned no result.';
    return { status: 'warning', changed: true, requiresAttention: true, summary };
}

function fingerprintOutcome(outcome: TaskOutcome): string {
    return crypto
        .createHash('sha256')
        .update(JSON.stringify({ status: outcome.status, summary: outcome.summary }))
        .digest('hex');
}
