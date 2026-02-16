import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HeartbeatService } from '../../supervisor/heartbeat-service.js';
import { Supervisor } from '../../supervisor/supervisor.js';
import { Config } from '../../config/config.js';
import { readFile } from 'fs/promises';

vi.mock('fs/promises');

describe('HeartbeatService', () => {
    let service: HeartbeatService;
    let mockSupervisor: any;
    let mockConfig: any;

    beforeEach(() => {
        vi.clearAllMocks();
        mockSupervisor = {
            executeTask: vi.fn().mockResolvedValue('success')
        };
        mockConfig = {
            homeDir: '/tmp/.tars',
            heartbeatIntervalMs: 1000,
            taskFilePath: '/tmp/tasks.json'
        };
        service = new HeartbeatService(mockSupervisor as any, mockConfig as any);
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
