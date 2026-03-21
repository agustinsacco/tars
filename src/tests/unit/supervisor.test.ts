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
            run: vi.fn().mockImplementation(async (content: string, onEvent: any) => {
                onEvent({ type: 'done' });
            }),
            runSync: vi.fn().mockResolvedValue('task output'),
            compressSession: vi.fn().mockResolvedValue(undefined),
            refreshSystemInstruction: vi.fn()
        };
        mockSessionManager = {
            load: vi.fn().mockResolvedValue('existing-session'),
            save: vi.fn().mockResolvedValue(undefined),
            updateUsage: vi.fn().mockResolvedValue(undefined),
            clear: vi.fn().mockResolvedValue(undefined),
            touchActivity: vi.fn().mockResolvedValue(undefined),
            forceInvalidate: vi.fn().mockResolvedValue(undefined),
            needsCompression: vi.fn().mockReturnValue(false),
            recordCompression: vi.fn().mockResolvedValue(undefined),
            getStats: vi.fn().mockReturnValue(null)
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
            'existing-session',
            undefined
        );
        expect(onEvent).toHaveBeenCalledWith({ type: 'done' });
    });

    it('should create new session if none exists', async () => {
        mockSessionManager.load.mockReturnValue(null);
        const onEvent = vi.fn();
        await supervisor.run('hello', onEvent);

        // Should NOT save a generated tars- ID anymore
        expect(mockSessionManager.save).not.toHaveBeenCalledWith(expect.stringContaining('tars-'));
        expect(mockGemini.run).toHaveBeenCalledWith(
            'hello',
            expect.any(Function),
            undefined,
            undefined
        );
    });

    it('should execute tasks in the active session (no more orphan sessions)', async () => {
        const result = await supervisor.executeTask('background prompt');
        expect(result).toBe('task output');
        // Should pass active session ID to runSync
        expect(mockGemini.runSync).toHaveBeenCalledWith('background prompt', 'existing-session');
    });

    it('should track user activity on run', async () => {
        await supervisor.run('hello', vi.fn());
        expect(mockSessionManager.touchActivity).toHaveBeenCalled();
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
    });

    it('should refresh system instruction on memory mutation instead of invalidating session', async () => {
        mockGemini.run.mockImplementation(async (content: string, onEvent: any) => {
            onEvent({
                type: 'tool_call',
                toolName: 'tars-memory_memory_store_fact',
                toolArgs: { key: 'test', value: 'data' }
            });
            onEvent({ type: 'done' });
        });

        await supervisor.run('store test fact', vi.fn());

        expect(mockGemini.refreshSystemInstruction).toHaveBeenCalled();
        expect(mockSessionManager.forceInvalidate).not.toHaveBeenCalled();
    });

    it('should trigger compression when context threshold is exceeded', async () => {
        mockSessionManager.needsCompression.mockReturnValue(true);
        const usageStats = { inputTokens: 600000, outputTokens: 5000 };
        mockGemini.run.mockImplementation(async (content: string, onEvent: any) => {
            onEvent({ type: 'done', usageStats });
        });

        await supervisor.run('hello', vi.fn());

        expect(mockGemini.compressSession).toHaveBeenCalled();
        expect(mockSessionManager.recordCompression).toHaveBeenCalled();
    });

    it('should NOT trigger compression when under threshold', async () => {
        mockSessionManager.needsCompression.mockReturnValue(false);
        const usageStats = { inputTokens: 100, outputTokens: 50 };
        mockGemini.run.mockImplementation(async (content: string, onEvent: any) => {
            onEvent({ type: 'done', usageStats });
        });

        await supervisor.run('hello', vi.fn());

        expect(mockGemini.compressSession).not.toHaveBeenCalled();
    });

    it('should gracefully handle compression failure', async () => {
        mockSessionManager.needsCompression.mockReturnValue(true);
        mockGemini.compressSession.mockRejectedValue(new Error('Compression timeout'));
        mockGemini.run.mockImplementation(async (content: string, onEvent: any) => {
            onEvent({ type: 'done', usageStats: { inputTokens: 600000, outputTokens: 5000 } });
        });

        // Should not throw
        await expect(supervisor.run('hello', vi.fn())).resolves.not.toThrow();
    });

    it('should show user-friendly busy message', async () => {
        // Start a long-running operation
        let resolveRun: () => void;
        const runPromise = new Promise<void>((resolve) => {
            resolveRun = resolve;
        });
        mockGemini.run.mockImplementation(async () => {
            await runPromise;
        });

        // Start first run (will hang)
        const firstRun = supervisor.run('first', vi.fn());

        // Try second run while first is processing
        await expect(supervisor.run('second', vi.fn())).rejects.toThrow(/retry in a moment/);

        // Clean up
        resolveRun!();
        await firstRun;
    });
});
