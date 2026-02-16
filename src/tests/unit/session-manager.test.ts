import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SessionManager } from '../../supervisor/session-manager.js';
import fs from 'fs';
import path from 'path';

vi.mock('fs');

describe('SessionManager', () => {
    let manager: SessionManager;
    const mockFilePath = '/tmp/tars-session.json';

    beforeEach(() => {
        vi.clearAllMocks();
        manager = new SessionManager(mockFilePath);
    });

    it('should return null if session file does not exist', () => {
        vi.mocked(fs.existsSync).mockReturnValue(false);
        expect(manager.load()).toBeNull();
    });

    it('should load session data if file exists', () => {
        const mockData = {
            sessionId: 'test-session-123',
            totalInputTokens: 100
        };
        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(mockData));

        const sessionId = manager.load();
        expect(sessionId).toBe('test-session-123');
        expect(manager.getStats()?.totalInputTokens).toBe(100);
    });

    it('should initialize and save a new session', () => {
        manager.save('new-session-id');

        expect(fs.writeFileSync).toHaveBeenCalled();
        const savedData = JSON.parse(vi.mocked(fs.writeFileSync).mock.calls[0][1] as string);
        expect(savedData.sessionId).toBe('new-session-id');
        expect(savedData.totalInputTokens).toBe(0);
    });

    it('should update usage stats', () => {
        const mockData = {
            sessionId: 'test-session',
            totalInputTokens: 100,
            totalOutputTokens: 50,
            totalCachedTokens: 10,
            interactionCount: 1
        };
        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(mockData));
        manager.load();

        manager.updateUsage({
            inputTokens: 50,
            outputTokens: 25,
            cachedTokens: 5
        });

        const stats = manager.getStats();
        // totalInputTokens represents "Context Size", not cumulative sum.
        expect(stats?.totalInputTokens).toBe(50);
        expect(stats?.totalOutputTokens).toBe(75);
        // totalCachedTokens represents "Current Cache", not cumulative sum.
        expect(stats?.totalCachedTokens).toBe(5);
        // totalNetTokens tracks the actual non-cached tokens consumed.
        // Initial: 100 (from mockData totalInputTokens)
        // New: 50 input - 5 cached = 45 net
        // Expected: 100 + 45 = 145
        expect(stats?.totalNetTokens).toBe(145);
        expect(stats?.interactionCount).toBe(2);
    });

    it('should clear the session file', () => {
        vi.mocked(fs.existsSync).mockReturnValue(true);
        manager.clear();
        expect(fs.unlinkSync).toHaveBeenCalledWith(mockFilePath);
        expect(manager.getStats()).toBeNull();
    });
});
