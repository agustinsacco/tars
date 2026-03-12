import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CronService } from '../../supervisor/cron-service.js';
import { Supervisor } from '../../supervisor/supervisor.js';
import { Config } from '../../config/config.js';
import { readFile } from 'fs/promises';
import { DiscordChannel } from '../../channels/discord/discord-channel.js';

vi.mock('fs/promises');

describe('CronService', () => {
    let service: CronService;
    let mockSupervisor: Partial<Supervisor>;
    let mockConfig: Partial<Config>;
    let mockDiscordChannel: Partial<DiscordChannel>;

    beforeEach(() => {
        vi.clearAllMocks();
        mockSupervisor = {
            executeTask: vi.fn().mockResolvedValue('task completed successfully')
        };
        mockConfig = {
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
            const mockTasks = [{ id: '1', title: 'Task 1' }];
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
});
