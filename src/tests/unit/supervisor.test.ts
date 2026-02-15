import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Supervisor } from '../../supervisor/supervisor.js';

describe('Supervisor', () => {
    let supervisor: Supervisor;
    let mockGemini: any;
    let mockSessionManager: any;

    beforeEach(() => {
        mockGemini = {
            run: vi.fn().mockImplementation(async (content, onEvent) => {
                onEvent({ type: 'done' });
            }),
            runSync: vi.fn().mockResolvedValue('task output')
        };
        mockSessionManager = {
            load: vi.fn().mockReturnValue('existing-session'),
            save: vi.fn(),
            updateUsage: vi.fn()
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

        expect(mockSessionManager.save).toHaveBeenCalledWith(expect.stringContaining('tars-'));
        expect(mockGemini.run).toHaveBeenCalledWith(
            'hello',
            expect.any(Function),
            expect.stringContaining('tars-')
        );
    });

    it('should execute tasks synchronously', async () => {
        const result = await supervisor.executeTask('background prompt');
        expect(result).toBe('task output');
        expect(mockGemini.runSync).toHaveBeenCalledWith('background prompt');
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
