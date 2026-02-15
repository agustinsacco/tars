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

    it('should spawn the gemini process with correct arguments', async () => {
        const mockChild: any = new EventEmitter();
        mockChild.stdout = new EventEmitter();
        mockChild.stderr = new EventEmitter();

        vi.mocked(spawn).mockReturnValue(mockChild);

        const onEvent = vi.fn();
        const runPromise = cli.run('test prompt', onEvent, 'test-session');

        // Simulate stdout data
        mockChild.stdout.emit('data', Buffer.from('hello world'));

        // Simulate close
        mockChild.emit('close', 0);

        await runPromise;

        expect(spawn).toHaveBeenCalledWith(
            'gemini',
            ['chat', '--model', 'test-model', '--session', 'test-session', '--yolo', 'test prompt'],
            expect.any(Object)
        );
        expect(onEvent).toHaveBeenCalledWith({ type: 'text', content: 'hello world' });
        expect(onEvent).toHaveBeenCalledWith({ type: 'done' });
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
