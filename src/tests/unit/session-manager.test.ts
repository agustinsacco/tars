import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SessionManager } from '../../supervisor/session-manager.js';
import fs from 'fs';
import path from 'path';

vi.mock('fs', () => {
    return {
        default: {
            promises: {
                access: vi.fn(),
                readFile: vi.fn(),
                readdir: vi.fn(),
                writeFile: vi.fn(),
                unlink: vi.fn(),
                mkdir: vi.fn(),
                rename: vi.fn(),
                stat: vi.fn()
            },
            existsSync: vi.fn(),
            readFileSync: vi.fn(),
            writeFileSync: vi.fn(),
            unlinkSync: vi.fn(),
            mkdirSync: vi.fn()
        }
    };
});

describe('SessionManager', () => {
    let manager: SessionManager;
    const mockFilePath = '/tmp/tars-session.json';

    beforeEach(() => {
        vi.clearAllMocks();
        manager = new SessionManager(mockFilePath);
    });

    it('should return null if session file does not exist', async () => {
        vi.mocked(fs.promises.access).mockRejectedValue(new Error('ENOENT'));
        expect(await manager.load()).toBeNull();
    });

    it('should load session data if file exists', async () => {
        const mockData = {
            sessionId: 'test-session-123',
            totalInputTokens: 100,
            compressionCount: 2
        };
        vi.mocked(fs.promises.access).mockResolvedValue(undefined);
        vi.mocked(fs.promises.readFile).mockResolvedValue(JSON.stringify(mockData));

        const sessionId = await manager.load();
        expect(sessionId).toBe('test-session-123');
        expect(manager.getStats()?.totalInputTokens).toBe(100);
        expect(manager.getStats()?.compressionCount).toBe(2);
    });

    it('should default compressionCount to 0 if missing from stored data', async () => {
        const mockData = {
            sessionId: 'test-session-old',
            totalInputTokens: 50
        };
        vi.mocked(fs.promises.access).mockResolvedValue(undefined);
        vi.mocked(fs.promises.readFile).mockResolvedValue(JSON.stringify(mockData));

        await manager.load();
        expect(manager.getStats()?.compressionCount).toBe(0);
    });

    it('should NOT expire session after idle timeout (removed behavior)', async () => {
        const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
        const mockData = {
            sessionId: 'long-lived-session',
            totalInputTokens: 500,
            lastUserInteractionAt: threeHoursAgo,
            compressionCount: 0
        };
        vi.mocked(fs.promises.access).mockResolvedValue(undefined);
        vi.mocked(fs.promises.readFile).mockResolvedValue(JSON.stringify(mockData));

        const sessionId = await manager.load();
        // Session should survive — no idle expiry
        expect(sessionId).toBe('long-lived-session');
    });

    it('should initialize and save a new session', async () => {
        await manager.save('new-session-id');

        expect(fs.promises.mkdir).toHaveBeenCalled();
        expect(fs.promises.writeFile).toHaveBeenCalled();
        const savedData = JSON.parse(vi.mocked(fs.promises.writeFile).mock.calls[0][1] as string);
        expect(savedData.sessionId).toBe('new-session-id');
        expect(savedData.totalInputTokens).toBe(0);
        expect(savedData.compressionCount).toBe(0);
    });

    it('should update usage stats', async () => {
        const mockData = {
            sessionId: 'test-session',
            totalInputTokens: 100,
            totalOutputTokens: 50,
            totalCachedTokens: 10,
            interactionCount: 1,
            compressionCount: 0
        };
        vi.mocked(fs.promises.access).mockResolvedValue(undefined);
        vi.mocked(fs.promises.readFile).mockResolvedValue(JSON.stringify(mockData));
        await manager.load();

        await manager.updateUsage({
            inputTokens: 50,
            outputTokens: 25,
            cachedTokens: 5
        });

        const stats = manager.getStats();
        expect(stats?.totalInputTokens).toBe(50);
        expect(stats?.totalOutputTokens).toBe(75);
        expect(stats?.totalCachedTokens).toBe(5);
        expect(stats?.totalNetTokens).toBe(145);
        expect(stats?.interactionCount).toBe(2);

        expect(fs.promises.writeFile).toHaveBeenCalled();
    });

    it('should clear the session file', async () => {
        vi.mocked(fs.promises.unlink).mockResolvedValue(undefined);
        await manager.clear();
        expect(fs.promises.unlink).toHaveBeenCalledWith(mockFilePath);
        expect(manager.getStats()).toBeNull();
    });

    it('forceInvalidate should be a no-op (deprecated)', async () => {
        // Load a session first
        const mockData = { sessionId: 'persistent-session', compressionCount: 0 };
        vi.mocked(fs.promises.access).mockResolvedValue(undefined);
        vi.mocked(fs.promises.readFile).mockResolvedValue(JSON.stringify(mockData));
        await manager.load();

        // forceInvalidate should NOT clear the session
        await manager.forceInvalidate();
        expect(fs.promises.unlink).not.toHaveBeenCalled();
        expect(manager.getStats()?.sessionId).toBe('persistent-session');
    });

    describe('Context Usage Helpers', () => {
        beforeEach(async () => {
            const mockData = {
                sessionId: 'ctx-session',
                totalInputTokens: 500000,
                createdAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(), // 1 hour ago
                compressionCount: 1
            };
            vi.mocked(fs.promises.access).mockResolvedValue(undefined);
            vi.mocked(fs.promises.readFile).mockResolvedValue(JSON.stringify(mockData));
            await manager.load();
        });

        it('getContextUsagePercent returns correct fraction', () => {
            expect(manager.getContextUsagePercent(1000000)).toBeCloseTo(0.5);
        });

        it('getContextUsagePercent returns 0 for invalid window size', () => {
            expect(manager.getContextUsagePercent(0)).toBe(0);
        });

        it('needsCompression returns true when over threshold', () => {
            expect(manager.needsCompression(1000000, 0.4)).toBe(true);
        });

        it('needsCompression returns false when under threshold', () => {
            expect(manager.needsCompression(1000000, 0.6)).toBe(false);
        });

        it('getSessionUptime returns positive duration', () => {
            const uptime = manager.getSessionUptime();
            expect(uptime).toBeGreaterThan(0);
            // Should be roughly 1 hour (3.6M ms), give or take
            expect(uptime).toBeGreaterThan(3500000);
            expect(uptime).toBeLessThan(3700000);
        });

        it('recordCompression increments counter', async () => {
            await manager.recordCompression();
            expect(manager.getStats()?.compressionCount).toBe(2);
        });
    });

    describe('Garbage Collection', () => {
        it('should delete files older than maxAge', async () => {
            const tmpDir = '/tmp/tars-gc-test';
            const now = Date.now();
            const fourDaysAgo = now - 4 * 24 * 60 * 60 * 1000;

            vi.mocked(fs.promises.readdir).mockImplementation(async (dir: any) => {
                if (dir === tmpDir) {
                    return [{ name: 'project1', isDirectory: () => true }] as any;
                }
                if (dir.includes('chats')) {
                    return ['old-session.json', 'new-session.json'];
                }
                return [];
            });

            vi.mocked(fs.promises.access).mockResolvedValue(undefined);
            vi.mocked(fs.promises.stat).mockImplementation(async (filePath: any) => {
                if (filePath.includes('old-session')) {
                    return { mtimeMs: fourDaysAgo } as any;
                }
                return { mtimeMs: now } as any;
            });
            vi.mocked(fs.promises.unlink).mockResolvedValue(undefined);

            const deleted = await manager.garbageCollect(tmpDir, 3, 100);
            expect(deleted).toBe(1);
            expect(fs.promises.unlink).toHaveBeenCalledWith(
                expect.stringContaining('old-session.json')
            );
        });

        it('should handle missing directory gracefully', async () => {
            const error = new Error('ENOENT') as NodeJS.ErrnoException;
            error.code = 'ENOENT';
            vi.mocked(fs.promises.readdir).mockRejectedValue(error);

            const deleted = await manager.garbageCollect('/nonexistent', 3, 50);
            expect(deleted).toBe(0);
        });
    });
});
