import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SessionManager } from '../../supervisor/session-manager.js';
import fs from 'fs';

vi.mock('fs', () => {
    return {
        default: {
            promises: {
                access: vi.fn(),
                readFile: vi.fn(),
                writeFile: vi.fn(),
                unlink: vi.fn(),
                mkdir: vi.fn()
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
            totalInputTokens: 100
        };
        vi.mocked(fs.promises.access).mockResolvedValue(undefined);
        vi.mocked(fs.promises.readFile).mockResolvedValue(JSON.stringify(mockData));

        const sessionId = await manager.load();
        expect(sessionId).toBe('test-session-123');
        expect(manager.getStats()?.totalInputTokens).toBe(100);
    });

    it('should initialize and save a new session', async () => {
        await manager.save('new-session-id');

        expect(fs.promises.mkdir).toHaveBeenCalled();
        expect(fs.promises.writeFile).toHaveBeenCalled();
        const savedData = JSON.parse(vi.mocked(fs.promises.writeFile).mock.calls[0][1] as string);
        expect(savedData.sessionId).toBe('new-session-id');
        expect(savedData.totalInputTokens).toBe(0);
    });

    it('should update usage stats', async () => {
        const mockData = {
            sessionId: 'test-session',
            totalInputTokens: 100,
            totalOutputTokens: 50,
            totalCachedTokens: 10,
            interactionCount: 1
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
});
