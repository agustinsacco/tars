import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GeminiCli } from '../../supervisor/gemini-cli.js';
import { spawn } from 'child_process';
import { EventEmitter } from 'events';

vi.mock('child_process');

describe('GeminiCli', () => {
    let cli: GeminiCli;

    beforeEach(() => {
        const mockConfig = {
            geminiModel: 'test-model',
            homeDir: '/tmp/tars-test'
        } as any;
        cli = new GeminiCli(mockConfig);
        vi.clearAllMocks();
    });

    it('should parse stream-json output correctly', async () => {
        const mockChild: any = new EventEmitter();
        mockChild.stdout = new EventEmitter();
        mockChild.stderr = new EventEmitter();
        mockChild.kill = vi.fn();

        vi.mocked(spawn).mockReturnValue(mockChild);

        const onEvent = vi.fn();
        const runPromise = cli.run('test prompt', onEvent, 'test-session');

        // Simulate stream-json output
        const event1 = { type: 'message', role: 'assistant', content: 'hello ' };
        const event2 = { type: 'message', role: 'assistant', content: 'world' };
        const result = {
            type: 'result',
            status: 'success',
            stats: { input_tokens: 10, output_tokens: 20, cached: 5 }
        };

        mockChild.stdout.emit(
            'data',
            Buffer.from(
                `${JSON.stringify(event1)}\n${JSON.stringify(event2)}\n${JSON.stringify(result)}\n`
            )
        );

        await runPromise;

        expect(spawn).toHaveBeenCalledWith(
            expect.any(String),
            expect.arrayContaining(['--resume', 'test-session']),
            expect.any(Object)
        );

        // Check for normalized events
        expect(onEvent).toHaveBeenCalledWith(
            expect.objectContaining({ type: 'message', content: 'hello ' })
        );
        expect(onEvent).toHaveBeenCalledWith(
            expect.objectContaining({ type: 'message', content: 'world' })
        );
        expect(onEvent).toHaveBeenCalledWith({
            type: 'done',
            usageStats: { inputTokens: 10, outputTokens: 20, cachedTokens: 5 }
        });
    });

    it('should capture sessionId from init event', async () => {
        const mockChild: any = new EventEmitter();
        mockChild.stdout = new EventEmitter();
        mockChild.stderr = new EventEmitter();
        mockChild.kill = vi.fn();

        vi.mocked(spawn).mockReturnValue(mockChild);

        const onEvent = vi.fn();
        const runPromise = cli.run('test prompt', onEvent);

        const initEvent = JSON.stringify({ type: 'init', session_id: 'new-uuid' });

        mockChild.stdout.emit('data', Buffer.from(`${initEvent}\n`));
        mockChild.emit('close', 0);

        await runPromise;

        expect(onEvent).toHaveBeenCalledWith(
            expect.objectContaining({ type: 'init', sessionId: 'new-uuid' })
        );
    });

    it('should handle process errors', async () => {
        const mockChild: any = new EventEmitter();
        mockChild.stdout = new EventEmitter();
        mockChild.stderr = new EventEmitter();
        vi.mocked(spawn).mockReturnValue(mockChild);

        const onEvent = vi.fn();
        const runPromise = cli.run('test prompt', onEvent);

        mockChild.emit('error', new Error('Spawn error'));

        await expect(runPromise).rejects.toThrow('Spawn error');
    });

    it('should handle non-zero exit codes', async () => {
        const mockChild: any = new EventEmitter();
        mockChild.stdout = new EventEmitter();
        mockChild.stderr = new EventEmitter();
        vi.mocked(spawn).mockReturnValue(mockChild);

        const runPromise = cli.run('test prompt', () => {});
        mockChild.emit('close', 1);

        await expect(runPromise).rejects.toThrow(/exited with code 1/);
    });
});
