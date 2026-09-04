import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Supervisor } from '../../supervisor/supervisor.js';
import type { TarsEvent } from '../../types/index.js';

vi.mock('../../memory/memory-manager.js', () => {
    return {
        MemoryManager: vi.fn().mockImplementation(function MemoryManagerMock() {
            return {
                fullSync: vi.fn().mockResolvedValue(undefined),
                search: vi.fn().mockResolvedValue([])
            };
        })
    };
});

describe('Supervisor', () => {
    let supervisor: Supervisor;
    let mockGemini: any;
    let mockSessionManager: any;

    beforeEach(() => {
        mockGemini = {
            run: vi.fn().mockImplementation(async (content: string, onEvent: any) => {
                await onEvent({ type: 'done' });
            }),
            runSync: vi.fn().mockResolvedValue('task output'),
            compressSession: vi.fn().mockResolvedValue(true),
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
            undefined,
            undefined // onStatus (not passed from this call site)
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
            undefined,
            undefined // onStatus (not passed from this call site)
        );
    });

    it('should execute background tasks without persisting them in the active session', async () => {
        const result = await supervisor.executeTask('background prompt');
        expect(result).toBe('task output');
        expect(mockGemini.runSync).toHaveBeenCalledWith(
            'background prompt',
            '00000000-0000-4000-8000-000000000001',
            { allowNotifications: false, ephemeral: true }
        );
    });

    it('should execute background tasks with notifications when allowed', async () => {
        await supervisor.executeTask('heartbeat prompt', { allowNotifications: true });
        expect(mockGemini.runSync).toHaveBeenCalledWith(
            'heartbeat prompt',
            '00000000-0000-4000-8000-000000000001',
            { allowNotifications: true, ephemeral: true }
        );
    });

    it('should track user activity on run', async () => {
        await supervisor.run('hello', vi.fn());
        expect(mockSessionManager.touchActivity).toHaveBeenCalled();
    });

    it('should learn session ID from gemini events', async () => {
        mockSessionManager.load.mockReturnValue(null);
        mockGemini.run.mockImplementation(async (content: string, onEvent: any) => {
            await onEvent({ type: 'text', content: '', sessionId: 'new-uuid' });
            await onEvent({ type: 'done' });
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
            await onEvent({ type: 'done', usageStats });
        });

        await supervisor.run('hello', vi.fn());

        expect(mockSessionManager.updateUsage).toHaveBeenCalledWith(usageStats);
    });

    it('should refresh system instruction on memory mutation instead of invalidating session', async () => {
        mockGemini.run.mockImplementation(async (content: string, onEvent: any) => {
            await onEvent({
                type: 'tool_call',
                toolName: 'tars-memory_memory_store_fact',
                toolArgs: { key: 'test', value: 'data' }
            });
            await onEvent({ type: 'done' });
        });

        await supervisor.run('store test fact', vi.fn());

        expect(mockGemini.refreshSystemInstruction).toHaveBeenCalled();
        expect(mockSessionManager.forceInvalidate).not.toHaveBeenCalled();
    });

    it('should refresh system instruction on manage_facts memory mutation', async () => {
        mockGemini.run.mockImplementation(async (content: string, onEvent: any) => {
            await onEvent({
                type: 'tool_call',
                toolName: 'tars-memory_manage_facts',
                toolArgs: { action: 'store', key: 'test', value: 'data' }
            });
            await onEvent({ type: 'done' });
        });

        await supervisor.run('store test fact', vi.fn());

        expect(mockGemini.refreshSystemInstruction).toHaveBeenCalled();
        expect(mockSessionManager.forceInvalidate).not.toHaveBeenCalled();
    });

    it('should trigger compression when context threshold is exceeded', async () => {
        mockSessionManager.needsCompression.mockReturnValue(true);
        const usageStats = { inputTokens: 600000, outputTokens: 5000 };
        mockGemini.run.mockImplementation(async (content: string, onEvent: any) => {
            await onEvent({ type: 'done', usageStats });
        });

        const events: any[] = [];
        await supervisor.run('hello', (e) => events.push(e));

        expect(mockGemini.compressSession).toHaveBeenCalled();
        expect(mockSessionManager.recordCompression).toHaveBeenCalled();

        // Verify compression is silent (no user-facing messages)
        const compressionEvents = events.filter(
            (e) =>
                e.type === 'text' &&
                (e.content?.includes('Compacting') || e.content?.includes('compacted'))
        );
        expect(compressionEvents).toHaveLength(0);
    });

    it('should NOT trigger compression when under threshold', async () => {
        mockSessionManager.needsCompression.mockReturnValue(false);
        const usageStats = { inputTokens: 100, outputTokens: 50 };
        mockGemini.run.mockImplementation(async (content: string, onEvent: any) => {
            await onEvent({ type: 'done', usageStats });
        });

        await supervisor.run('hello', vi.fn());

        expect(mockGemini.compressSession).not.toHaveBeenCalled();
    });

    it('should gracefully handle compression failure', async () => {
        mockSessionManager.needsCompression.mockReturnValue(true);
        mockGemini.compressSession.mockRejectedValue(new Error('Compression timeout'));
        mockGemini.run.mockImplementation(async (content: string, onEvent: any) => {
            await onEvent({
                type: 'done',
                usageStats: { inputTokens: 600000, outputTokens: 5000 }
            });
        });

        const events: any[] = [];
        // Compression failures are now silent - should not throw
        await expect(supervisor.run('hello', (e) => events.push(e))).resolves.not.toThrow();

        // Verify no user-facing error message was sent (silent compression)
        const errorEvents = events.filter(
            (e) => e.type === 'text' && e.content?.includes('Memory compaction failed')
        );
        expect(errorEvents).toHaveLength(0);
    });

    it('records a compression only when history was actually compacted', async () => {
        // ARRANGE
        mockSessionManager.needsCompression.mockReturnValue(true);
        mockGemini.compressSession.mockResolvedValue(false);
        mockGemini.run.mockImplementation(async (content: string, onEvent: any) => {
            await onEvent({
                type: 'done',
                usageStats: { inputTokens: 600000, outputTokens: 5000 }
            });
        });

        // ACT
        await supervisor.run('hello', vi.fn());

        // ASSERT
        expect(mockGemini.compressSession).toHaveBeenCalledWith(false, 'existing-session');
        expect(mockSessionManager.recordCompression).not.toHaveBeenCalled();
    });

    it('redacts sensitive keys and token values before forwarding events', async () => {
        // ARRANGE
        const githubToken = `ghp_${'a'.repeat(82)}`;
        mockGemini.run.mockImplementation(async (content: string, onEvent: any) => {
            await onEvent({
                type: 'tool_call',
                toolName: 'example',
                toolArgs: { password: 'short-secret' }
            });
            await onEvent({
                type: 'tool_response',
                toolName: 'call-1',
                content: JSON.stringify({ token: 'short-secret', value: 'safe' })
            });
            await onEvent({ type: 'text', role: 'assistant', content: githubToken });
            await onEvent({ type: 'done' });
        });
        const events: TarsEvent[] = [];

        // ACT
        await supervisor.run('hello', (event) => events.push(event));

        // ASSERT
        expect(events[0].toolArgs).toEqual({ password: '[REDACTED_SECRET]' });
        expect(events[1].content).toBe(
            JSON.stringify({ token: '[REDACTED_SECRET]', value: 'safe' })
        );
        expect(events[2].content).not.toContain(githubToken);
    });

    it('waits for asynchronous event delivery before completing a run', async () => {
        // ARRANGE
        const sequence: string[] = [];
        mockGemini.run.mockImplementation(async (content: string, onEvent: any) => {
            await onEvent({ type: 'text', role: 'assistant', content: 'hello' });
            sequence.push('engine-finished');
        });

        // ACT
        await supervisor.run('hello', async () => {
            await Promise.resolve();
            sequence.push('event-delivered');
        });

        // ASSERT
        expect(sequence).toEqual(['event-delivered', 'engine-finished']);
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
