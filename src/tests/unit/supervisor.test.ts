import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Supervisor } from '../../supervisor/supervisor.js';

vi.mock('../../memory/memory-manager.js', () => {
    return {
        MemoryManager: vi.fn().mockImplementation(() => ({
            fullSync: vi.fn().mockResolvedValue(undefined),
            search: vi.fn().mockResolvedValue([])
        }))
    };
});

describe('Supervisor', () => {
    let supervisor: Supervisor;
    let mockGemini: any;
    let mockSessionManager: any;

    beforeEach(() => {
        mockGemini = {
            run: vi.fn().mockImplementation(async (content, onEvent) => {
                onEvent({ type: 'done' });
            }),
            runSync: vi.fn().mockResolvedValue('task output'),
            pruneLastTurn: vi.fn(),
            compactSession: vi.fn()
        };
        mockSessionManager = {
            load: vi.fn().mockResolvedValue('existing-session'),
            save: vi.fn().mockResolvedValue(undefined),
            updateUsage: vi.fn().mockResolvedValue(undefined),
            clear: vi.fn().mockResolvedValue(undefined)
        };
        supervisor = new Supervisor(mockGemini as any, mockSessionManager as any);
    });

    it('should use existing session if available', async () => {
        const onEvent = vi.fn();
        await supervisor.run('hello', onEvent);

        expect(mockSessionManager.load).toHaveBeenCalled();
        expect(mockGemini.run).toHaveBeenCalledWith(
            'hello',
            expect.any(Function),
            'existing-session'
        );
        expect(onEvent).toHaveBeenCalledWith({ type: 'done' });
    });

    it('should create new session if none exists', async () => {
        mockSessionManager.load.mockReturnValue(null);
        const onEvent = vi.fn();
        await supervisor.run('hello', onEvent);

        // Should NOT save a generated tars- ID anymore
        expect(mockSessionManager.save).not.toHaveBeenCalledWith(expect.stringContaining('tars-'));
        expect(mockGemini.run).toHaveBeenCalledWith('hello', expect.any(Function), undefined);
    });

    it('should execute tasks synchronously', async () => {
        const result = await supervisor.executeTask('background prompt');
        expect(result).toBe('task output');
        expect(mockGemini.runSync).toHaveBeenCalledWith('background prompt', 'existing-session');
    });

    it('should learn session ID from gemini events', async () => {
        mockSessionManager.load.mockReturnValue(null);
        mockGemini.run.mockImplementation(async (content: string, onEvent: any) => {
            onEvent({ type: 'text', content: '', sessionId: 'new-uuid' });
            onEvent({ type: 'done' });
        });

        await supervisor.run('hello', vi.fn());

        expect(mockSessionManager.save).toHaveBeenCalledWith('new-uuid');
    });

    it('should handle errors from gemini cli', async () => {
        mockGemini.run.mockRejectedValue(new Error('CLI Error'));
        const onEvent = vi.fn();

        await supervisor.run('hello', onEvent);
        expect(onEvent).toHaveBeenCalledWith({ type: 'error', error: 'CLI Error' });
    });

    it('should update usage stats from gemini done event', async () => {
        const usageStats = { inputTokens: 10, outputTokens: 20 };
        mockGemini.run.mockImplementation(async (content: string, onEvent: any) => {
            onEvent({ type: 'done', usageStats });
        });

        await supervisor.run('hello', vi.fn());

        expect(mockSessionManager.updateUsage).toHaveBeenCalledWith(usageStats);
        expect(mockSessionManager.save).toHaveBeenCalled();
    });
});
