import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { execSync } from 'child_process';

// Mock child_process
vi.mock('child_process', () => ({
    execSync: vi.fn()
}));

// Mock ora
vi.mock('ora', () => ({
    default: () => ({
        start: vi.fn().mockReturnThis(),
        succeed: vi.fn().mockReturnThis(),
        fail: vi.fn().mockReturnThis(),
        warn: vi.fn().mockReturnThis(),
        text: ''
    })
}));

// Mock chalk (pass-through)
vi.mock('chalk', () => ({
    default: {
        cyan: Object.assign((s: string) => s, { bold: (s: string) => s }),
        bold: (s: string) => s,
        green: Object.assign((s: string) => s, { bold: (s: string) => s }),
        yellow: (s: string) => s,
        dim: (s: string) => s,
        red: (s: string) => s
    }
}));

// Mock paths
vi.mock('../../utils/paths.js', () => ({
    getTarsHome: () => '/tmp/test-tars-home'
}));

describe('refresh', () => {
    const testHome = '/tmp/test-tars-home';
    const mockExecSync = vi.mocked(execSync);

    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('refreshExtensions', () => {
        it('should return false when extensions source does not exist', async () => {
            // Dynamic import to get after mocks are set up
            const { refreshExtensions } = await import('../../cli/commands/refresh.js');

            // existsSync for extensions source will return false
            vi.spyOn(fs, 'existsSync').mockReturnValue(false);

            const result = await refreshExtensions(testHome, true);
            expect(result).toBe(false);
        });

        it('should process extensions when source directory exists', async () => {
            const { refreshExtensions } = await import('../../cli/commands/refresh.js');

            const existsSyncSpy = vi.spyOn(fs, 'existsSync');
            // First call: extensions source dir exists
            existsSyncSpy.mockReturnValueOnce(true);
            // Second call: link target does not exist yet
            existsSyncSpy.mockReturnValueOnce(false);

            vi.spyOn(fs, 'readdirSync').mockReturnValue(['memory'] as any);
            vi.spyOn(fs, 'statSync').mockReturnValue({ isDirectory: () => true } as any);
            vi.spyOn(fsp, 'mkdir').mockResolvedValue(undefined);
            vi.spyOn(fsp, 'cp').mockResolvedValue(undefined);

            mockExecSync.mockReturnValue('' as any);

            const result = await refreshExtensions(testHome, true);
            expect(result).toBe(true);
            expect(mockExecSync).toHaveBeenCalledTimes(2); // npm install + npm run build
        });
    });

    describe('refreshDashboard', () => {
        it('should return false when dashboard source does not exist', async () => {
            const { refreshDashboard } = await import('../../cli/commands/refresh.js');

            vi.spyOn(fs, 'existsSync').mockReturnValue(false);

            const result = await refreshDashboard(testHome, true);
            expect(result).toBe(false);
        });

        it('should remove existing dashboard and rebuild', async () => {
            const { refreshDashboard } = await import('../../cli/commands/refresh.js');

            const existsSyncSpy = vi.spyOn(fs, 'existsSync');
            // First call: dash source exists
            existsSyncSpy.mockReturnValueOnce(true);
            // Second call: dash dest exists (needs removal)
            existsSyncSpy.mockReturnValueOnce(true);

            vi.spyOn(fsp, 'mkdir').mockResolvedValue(undefined);
            vi.spyOn(fsp, 'rm').mockResolvedValue(undefined);
            vi.spyOn(fsp, 'cp').mockResolvedValue(undefined);
            mockExecSync.mockReturnValue('' as any);

            const result = await refreshDashboard(testHome, true);
            expect(result).toBe(true);
            expect(fsp.rm).toHaveBeenCalled();
            expect(mockExecSync).toHaveBeenCalledTimes(3); // pm2 stop + npm install + npm run build
        });

        it('should return false on build failure', async () => {
            const { refreshDashboard } = await import('../../cli/commands/refresh.js');

            const existsSyncSpy = vi.spyOn(fs, 'existsSync');
            existsSyncSpy.mockReturnValueOnce(true); // dash source
            existsSyncSpy.mockReturnValueOnce(false); // no existing dest

            vi.spyOn(fsp, 'mkdir').mockResolvedValue(undefined);
            vi.spyOn(fsp, 'cp').mockResolvedValue(undefined);
            mockExecSync.mockImplementation(() => {
                throw new Error('build failed');
            });

            const result = await refreshDashboard(testHome, true);
            expect(result).toBe(false);
        });
    });
});
