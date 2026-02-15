import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GeminiCli } from '../../supervisor/gemini-cli.js';
import { spawn } from 'child_process';
import { EventEmitter } from 'events';

vi.mock('child_process');

describe('GeminiCli', () => {
    let cli: GeminiCli;

    beforeEach(() => {
        cli = new GeminiCli('test-model');
        vi.clearAllMocks();
    });

    it('should parse stream-json output correctly', async () => {
        const mockChild: any = new EventEmitter();
        mockChild.stdout = new EventEmitter();
        mockChild.stderr = new EventEmitter();

        vi.mocked(spawn).mockReturnValue(mockChild);

        const onEvent = vi.fn();
        const runPromise = cli.run('test prompt', onEvent, 'test-session');

        // Simulate stream-json output
        const event1 = JSON.stringify({ type: 'message', role: 'assistant', content: 'hello ' });
        const event2 = JSON.stringify({ type: 'message', role: 'assistant', content: 'world' });
        const result = JSON.stringify({
            type: 'result',
            stats: { input_tokens: 10, output_tokens: 20, cached: 5 }
        });

        mockChild.stdout.emit('data', Buffer.from(`${event1}\n${event2}\n${result}\n`));
        mockChild.emit('close', 0);

        await runPromise;

        expect(spawn).toHaveBeenCalledWith(
            expect.any(String),
            expect.arrayContaining(['--output-format', 'stream-json']),
            expect.any(Object)
        );
        expect(onEvent).toHaveBeenCalledWith({ type: 'text', content: 'hello ' });
        expect(onEvent).toHaveBeenCalledWith({ type: 'text', content: 'world' });
        expect(onEvent).toHaveBeenCalledWith({
            type: 'done',
            usageStats: { inputTokens: 10, outputTokens: 20, cachedTokens: 5 }
        });
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

        const runPromise = cli.run('test prompt', () => { });
        mockChild.emit('close', 1);

        await expect(runPromise).rejects.toThrow(/exited with code 1/);
    });
});
