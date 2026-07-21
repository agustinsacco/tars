import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CronService } from '../../supervisor/cron-service.js';
import { type Supervisor } from '../../supervisor/supervisor.js';
import { type Config } from '../../config/config.js';
import { readFile } from 'fs/promises';
import { type DiscordChannel } from '../../channels/discord/discord-channel.js';
import type { Task } from '../../types/index.js';

function createTask(overrides: Partial<Task> = {}): Task {
    const now = new Date().toISOString();
    return {
        id: 'task-1',
        title: 'Task 1',
        prompt: 'Run the task',
        schedule: '0 0 * * *',
        nextRun: now,
        enabled: true,
        mode: 'silent',
        source: 'user',
        failedCount: 0,
        createdAt: now,
        updatedAt: now,
        ...overrides
    };
}

async function runTask(service: CronService, task: Task): Promise<void> {
    const privateService = service as unknown as {
        runTask(candidate: Task): Promise<void>;
    };
    await privateService.runTask(task);
}

vi.mock('fs/promises');

describe('CronService', () => {
    let service: CronService;
    let mockSupervisor: Partial<Supervisor>;
    let mockConfig: Partial<Config>;
    let mockDiscordChannel: Partial<DiscordChannel>;

    beforeEach(() => {
        vi.resetAllMocks();
        mockSupervisor = {
            executeTask: vi.fn().mockResolvedValue('task completed successfully')
        };
        mockConfig = {
            homeDir: '/mock',
            taskFilePath: '/mock/paths/tasks.json'
        };
        mockDiscordChannel = {
            notify: vi.fn().mockResolvedValue(undefined)
        };
        service = new CronService(
            mockSupervisor as any,
            mockConfig as any,
            mockDiscordChannel as any
        );
    });

    describe('calculateNextRun', () => {
        it('should calculate next run for cron expression', () => {
            const cron = '0 0 * * *'; // Every midnight
            const next = (service as any).calculateNextRun(cron);
            expect(new Date(next).getTime()).toBeGreaterThan(Date.now());
        });

        it('should handle specific ISO dates', () => {
            const futureDate = new Date(Date.now() + 100000).toISOString();
            const next = (service as any).calculateNextRun(futureDate);
            expect(next).toBe(futureDate);
        });

        it('should fallback to 24h if invalid schedule', () => {
            const next = (service as any).calculateNextRun('invalid-schedule');
            const expectedMin = Date.now() + 23 * 60 * 60 * 1000;
            expect(new Date(next).getTime()).toBeGreaterThan(expectedMin);
        });
    });

    describe('loadTasks', () => {
        it('should load tasks from disk', async () => {
            const now = new Date().toISOString();
            const mockTasks = [
                {
                    id: '1',
                    title: 'Task 1',
                    prompt: 'Run the task',
                    schedule: '0 0 * * *',
                    nextRun: now,
                    enabled: true,
                    mode: 'silent',
                    source: 'user',
                    failedCount: 0,
                    createdAt: now,
                    updatedAt: now
                }
            ];
            vi.mocked(readFile).mockResolvedValue(JSON.stringify(mockTasks));

            const tasks = await (service as any).loadTasks();
            expect(tasks).toEqual(mockTasks);
        });

        it('should return empty list if file missing', async () => {
            const error = new Error('ENOENT') as any;
            error.code = 'ENOENT';
            vi.mocked(readFile).mockRejectedValue(error);

            const tasks = await (service as any).loadTasks();
            expect(tasks).toEqual([]);
        });
    });

    describe('notification policy', () => {
        it('sends exactly one completion notification for notify tasks', async () => {
            // ARRANGE
            const task = createTask({ mode: 'notify' });
            const updateTask = vi.fn(
                async (
                    id: string,
                    update: (candidate: Task) => void | Promise<void>
                ): Promise<Task | null> => {
                    const persistedTask = { ...task };
                    await update(persistedTask);
                    return persistedTask;
                }
            );
            Reflect.set(service, 'taskStore', { updateTask });

            // ACT
            await runTask(service, task);

            // ASSERT
            expect(updateTask).toHaveBeenCalledOnce();
            expect(mockDiscordChannel.notify).toHaveBeenCalledOnce();
            expect(mockDiscordChannel.notify).toHaveBeenCalledWith('task completed successfully');
        });

        it('redacts and reports failures only when the task requests notifications', async () => {
            // ARRANGE
            const token = `ghp_${'a'.repeat(82)}`;
            const task = createTask({ mode: 'notify' });
            vi.mocked(mockSupervisor.executeTask!).mockRejectedValue(
                new Error(`provider rejected ${token}`)
            );
            Reflect.set(service, 'taskStore', {
                updateTask: async (
                    id: string,
                    update: (candidate: Task) => void | Promise<void>
                ): Promise<Task> => {
                    const persistedTask = { ...task };
                    await update(persistedTask);
                    return persistedTask;
                }
            });

            // ACT
            await runTask(service, task);

            // ASSERT
            expect(mockDiscordChannel.notify).toHaveBeenCalledOnce();
            const notification = vi.mocked(mockDiscordChannel.notify!).mock.calls[0][0];
            expect(notification).not.toContain(token);
            expect(notification).toContain('Scheduled task');
        });

        it('keeps failure notifications silent for silent tasks', async () => {
            // ARRANGE
            const task = createTask({ mode: 'silent' });
            vi.mocked(mockSupervisor.executeTask!).mockRejectedValue(new Error('failed'));
            Reflect.set(service, 'taskStore', {
                updateTask: async (
                    id: string,
                    update: (candidate: Task) => void | Promise<void>
                ): Promise<Task> => {
                    const persistedTask = { ...task };
                    await update(persistedTask);
                    return persistedTask;
                }
            });

            // ACT
            await runTask(service, task);

            // ASSERT
            expect(mockDiscordChannel.notify).not.toHaveBeenCalled();
        });

        it('reports failures for on-failure maintenance tasks', async () => {
            // ARRANGE
            const task = createTask({ mode: 'on-failure' });
            vi.mocked(mockSupervisor.executeTask!).mockRejectedValue(new Error('backup failed'));
            Reflect.set(service, 'taskStore', {
                updateTask: async (
                    _id: string,
                    update: (candidate: Task) => void | Promise<void>
                ): Promise<Task> => {
                    const persistedTask = { ...task };
                    await update(persistedTask);
                    return persistedTask;
                }
            });

            // ACT
            await runTask(service, task);

            // ASSERT
            expect(mockDiscordChannel.notify).toHaveBeenCalledWith(
                expect.stringContaining('backup failed')
            );
        });

        it.each(['on-change', 'action-required', 'digest'] as const)(
            'does not lose failures under the %s policy',
            async (mode) => {
                // ARRANGE
                const task = createTask({ mode });
                vi.mocked(mockSupervisor.executeTask!).mockRejectedValue(
                    new Error('monitor failed')
                );
                Reflect.set(service, 'taskStore', {
                    updateTask: async (
                        _id: string,
                        update: (candidate: Task) => void | Promise<void>
                    ): Promise<Task> => {
                        const persistedTask = { ...task };
                        await update(persistedTask);
                        return persistedTask;
                    }
                });
                const enqueue = vi.fn().mockResolvedValue(undefined);
                Reflect.set(service, 'digestStore', { enqueue });

                // ACT
                await runTask(service, task);

                // ASSERT
                if (mode === 'digest') {
                    expect(enqueue).toHaveBeenCalledWith(expect.stringContaining('monitor failed'));
                    expect(mockDiscordChannel.notify).not.toHaveBeenCalled();
                } else {
                    expect(mockDiscordChannel.notify).toHaveBeenCalledWith(
                        expect.stringContaining('monitor failed')
                    );
                }
            }
        );

        it('notifies action-required tasks only when the outcome requests attention', async () => {
            // ARRANGE
            const task = createTask({ mode: 'action-required' });
            vi.mocked(mockSupervisor.executeTask!).mockResolvedValue(
                JSON.stringify({
                    changed: true,
                    requiresAttention: true,
                    status: 'warning',
                    summary: 'A stop-loss threshold was crossed.'
                })
            );
            Reflect.set(service, 'taskStore', {
                updateTask: async (
                    _id: string,
                    update: (candidate: Task) => void | Promise<void>
                ): Promise<Task> => {
                    const persistedTask = { ...task };
                    await update(persistedTask);
                    return persistedTask;
                }
            });

            // ACT
            await runTask(service, task);

            // ASSERT
            expect(mockDiscordChannel.notify).toHaveBeenCalledWith(
                'A stop-loss threshold was crossed.'
            );
        });

        it('notifies on-change tasks when the outcome fingerprint changes', async () => {
            // ARRANGE
            const task = createTask({
                lastOutcomeFingerprint: 'a'.repeat(64),
                mode: 'on-change'
            });
            vi.mocked(mockSupervisor.executeTask!).mockResolvedValue(
                JSON.stringify({
                    changed: true,
                    requiresAttention: false,
                    status: 'ok',
                    summary: 'The monitored value changed.'
                })
            );
            Reflect.set(service, 'taskStore', {
                updateTask: async (
                    _id: string,
                    update: (candidate: Task) => void | Promise<void>
                ): Promise<Task> => {
                    const persistedTask = { ...task };
                    await update(persistedTask);
                    return persistedTask;
                }
            });

            // ACT
            await runTask(service, task);

            // ASSERT
            expect(mockDiscordChannel.notify).toHaveBeenCalledWith('The monitored value changed.');
        });
    });
});
