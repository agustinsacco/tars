import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TuiChannel } from '../../channels/tui/tui-channel.js';
import { Config } from '../../config/config.js';
import { Readable, Writable } from 'stream';

// Mock Config
vi.mock('../../config/config.js', () => ({
    Config: {
        getInstance: vi.fn().mockReturnValue({
            piProvider: 'google',
            piModel: 'gemini-2.5-flash',
            contextWindowTokens: 128000,
            assistantName: 'Tars'
        })
    }
}));

// Mock version
vi.mock('../../utils/version.js', () => ({
    versionString: '1.35.0'
}));

/**
 * Creates a mock input stream that can be programmatically written to.
 */
function createMockInput(): Readable {
    const input = new Readable({ read() {} });
    return input;
}

/**
 * Creates a mock output stream that captures written content.
 */
function createMockOutput(): Writable & { captured: string; columns: number } {
    const captured: string[] = [];
    const output = new Writable({
        write(chunk, _encoding, callback) {
            captured.push(chunk.toString());
            callback();
        }
    }) as Writable & { captured: string; columns: number };

    Object.defineProperty(output, 'captured', {
        get: () => captured.join('')
    });
    output.columns = 80;

    return output;
}

describe('TuiChannel', () => {
    let channel: TuiChannel;
    let mockInput: Readable;
    let mockOutput: ReturnType<typeof createMockOutput>;

    beforeEach(() => {
        vi.clearAllMocks();
        mockInput = createMockInput();
        mockOutput = createMockOutput();
    });

    afterEach(() => {
        try {
            mockInput.destroy();
        } catch {}
    });

    describe('Interface Compliance', () => {
        it('should implement CommunicationChannel interface', () => {
            channel = new TuiChannel({ input: mockInput, output: mockOutput });
            expect(channel.id).toBe('tui');
            expect(channel.isEnabled).toBe(true);
            expect(typeof channel.start).toBe('function');
            expect(typeof channel.stop).toBe('function');
            expect(typeof channel.notify).toBe('function');
            expect(typeof channel.editStatus).toBe('function');
            expect(typeof channel.clearStatus).toBe('function');
            expect(typeof channel.onMessage).toBe('function');
        });

        it('should have channel id "tui"', () => {
            channel = new TuiChannel({ input: mockInput, output: mockOutput });
            expect(channel.id).toBe('tui');
        });

        it('should always be enabled', () => {
            channel = new TuiChannel({ input: mockInput, output: mockOutput });
            expect(channel.isEnabled).toBe(true);
        });
    });

    describe('Startup', () => {
        it('should render logo and header on start', async () => {
            channel = new TuiChannel({ input: mockInput, output: mockOutput });
            await channel.start();
            // Wait for nextTick rendering to complete
            await new Promise((r) => setTimeout(r, 20));

            // Check that the output contains the ASCII logo
            expect(mockOutput.captured).toContain('████████');
            // Check that the header contains version and model info
            expect(mockOutput.captured).toContain('1.35.0');
            expect(mockOutput.captured).toContain('google');
            expect(mockOutput.captured).toContain('gemini-2.5-flash');
            expect(mockOutput.captured).toContain('/exit');

            await channel.stop();
        });
    });

    describe('Message Handling', () => {
        it('should route user input to registered message handler', async () => {
            channel = new TuiChannel({ input: mockInput, output: mockOutput });
            const handler = vi.fn().mockResolvedValue(undefined);
            channel.onMessage(handler);

            await channel.start();
            // Wait for first render frame
            await new Promise((r) => setTimeout(r, 20));

            // Simulate user input character-by-character
            for (const char of 'hello world\r') {
                mockInput.push(char);
            }

            // Wait for rendering and submission
            await new Promise((r) => setTimeout(r, 50));

            expect(handler).toHaveBeenCalledTimes(1);
            const msg = handler.mock.calls[0][0];
            expect(msg.content).toBe('hello world');
            expect(msg.senderId).toBe('tui-user');
            expect(msg.senderName).toBe('user');
            expect(msg.channelId).toBe('tui');

            await channel.stop();
        });

        it('should handle empty input gracefully', async () => {
            channel = new TuiChannel({ input: mockInput, output: mockOutput });
            const handler = vi.fn().mockResolvedValue(undefined);
            channel.onMessage(handler);

            await channel.start();
            await new Promise((r) => setTimeout(r, 20));

            // Send empty line (carriage return only)
            mockInput.push('\r');
            await new Promise((r) => setTimeout(r, 50));

            // Handler should not be called for empty input
            expect(handler).not.toHaveBeenCalled();

            await channel.stop();
        });

        it('should not forward /exit to message handler', async () => {
            const exitFn = vi.fn().mockResolvedValue(undefined);
            const mockExit = vi
                .spyOn(process, 'exit')
                .mockImplementation((code?: string | number | null) => {
                    return undefined as never;
                });

            channel = new TuiChannel({
                input: mockInput,
                output: mockOutput,
                onExit: exitFn
            });

            const handler = vi.fn().mockResolvedValue(undefined);
            channel.onMessage(handler);

            await channel.start();
            await new Promise((r) => setTimeout(r, 20));

            for (const char of '/exit\r') {
                mockInput.push(char);
            }
            await new Promise((r) => setTimeout(r, 50));

            // Handler should NOT be called
            expect(handler).not.toHaveBeenCalled();
            // Exit callback should have been called
            expect(exitFn).toHaveBeenCalled();
            // process.exit should have been called
            expect(mockExit).toHaveBeenCalledWith(0);
            // Goodbye message should appear
            expect(mockOutput.captured).toContain('Goodbye');

            mockExit.mockRestore();
            await channel.stop();
        });
    });

    describe('Notifications & Status', () => {
        it('should print notifications via notify()', async () => {
            channel = new TuiChannel({ input: mockInput, output: mockOutput });

            await channel.notify('Hello from notification');

            expect(mockOutput.captured).toContain('Hello from notification');
        });

        it('should return false from editStatus when no status exists', async () => {
            channel = new TuiChannel({ input: mockInput, output: mockOutput });

            const result = await channel.editStatus('new status');
            expect(result).toBe(false);
        });

        it('should return true from editStatus after sendStatus', async () => {
            channel = new TuiChannel({ input: mockInput, output: mockOutput });

            await channel.sendStatus('initial status');
            const result = await channel.editStatus('updated status');
            expect(result).toBe(true);
            expect(mockOutput.captured).toContain('updated status');
        });

        it('should not make an ordinary notification editable as status', async () => {
            channel = new TuiChannel({ input: mockInput, output: mockOutput });

            await channel.notify('durable notification');

            await expect(channel.editStatus('replacement')).resolves.toBe(false);
            expect(mockOutput.captured).not.toContain('replacement');
        });
    });

    describe('Token Streaming', () => {
        it('should write text directly via streamText()', () => {
            channel = new TuiChannel({ input: mockInput, output: mockOutput });

            channel.streamText('Hello');
            channel.streamText(' World');

            expect(mockOutput.captured).toBe('Hello World');
        });
    });

    describe('ChannelMessage Shape', () => {
        it('should provide reply and typing methods', async () => {
            channel = new TuiChannel({ input: mockInput, output: mockOutput });
            let capturedMessage: any;
            channel.onMessage(async (msg) => {
                capturedMessage = msg;
                // Test reply
                await msg.reply('response text');
                // Test typing methods (should not throw)
                msg.startTyping();
                msg.stopTyping();
            });

            await channel.start();
            await new Promise((r) => setTimeout(r, 20));

            for (const char of 'test prompt\r') {
                mockInput.push(char);
            }
            await new Promise((r) => setTimeout(r, 50));

            expect(capturedMessage).toBeDefined();
            expect(typeof capturedMessage.reply).toBe('function');
            expect(typeof capturedMessage.startTyping).toBe('function');
            expect(typeof capturedMessage.stopTyping).toBe('function');

            // Wait for nextTick rendering of the reply
            await new Promise((r) => setTimeout(r, 20));
            // Reply content should appear in output
            expect(mockOutput.captured).toContain('response text');

            await channel.stop();
        });
    });
});
