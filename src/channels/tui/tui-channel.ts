import chalk from 'chalk';
import {
    TUI,
    ProcessTerminal,
    Editor,
    Markdown,
    Loader,
    CombinedAutocompleteProvider,
    Container
} from '@earendil-works/pi-tui';
import type { Terminal } from '@earendil-works/pi-tui';
import { type CommunicationChannel, type ChannelMessage } from '../types.js';
import { TuiRenderer } from './tui-renderer.js';
import { versionString } from '../../utils/version.js';
import { Config } from '../../config/config.js';

type TuiInput = NodeJS.ReadableStream & {
    readonly isRaw?: boolean;
    setRawMode?: (enabled: boolean) => void;
};
type TuiOutput = NodeJS.WritableStream & {
    readonly columns?: number;
    readonly rows?: number;
};

/**
 * Custom Terminal implementation wrapping Readable and Writable streams.
 * Used for testing and custom I/O redirection.
 */
export class StreamTerminal implements Terminal {
    private readonly input: TuiInput;
    private readonly output: TuiOutput;
    private inputHandler?: (data: string) => void;
    private wasRaw = false;

    constructor(input: TuiInput, output: TuiOutput) {
        this.input = input;
        this.output = output;
    }

    start(onInput: (data: string) => void, _onResize: () => void): void {
        this.inputHandler = onInput;
        this.wasRaw = this.input.isRaw ?? false;
        if (this.input.setRawMode) {
            try {
                this.input.setRawMode(true);
            } catch {
                // Some injected streams expose setRawMode but do not support it.
            }
        }
        this.input.resume();
        this.input.on('data', this.handleData);
    }

    private handleData = (chunk: Buffer | string) => {
        if (this.inputHandler) {
            this.inputHandler(chunk.toString('utf8'));
        }
    };

    stop(): void {
        this.input.removeListener('data', this.handleData);
        if (this.input.setRawMode) {
            try {
                this.input.setRawMode(this.wasRaw);
            } catch {
                // The stream may have closed before terminal state restoration.
            }
        }
        this.input.pause();
    }

    async drainInput(_maxMs = 1000, idleMs = 50): Promise<void> {
        await new Promise((resolve) => setTimeout(resolve, idleMs));
    }

    write(data: string): void {
        this.output.write(data);
    }

    get columns(): number {
        return this.output.columns ?? 80;
    }

    get rows(): number {
        return this.output.rows ?? 24;
    }

    get kittyProtocolActive(): boolean {
        return false;
    }

    moveBy(lines: number): void {
        if (lines > 0) {
            this.write(`\x1b[${lines}B`);
        } else if (lines < 0) {
            this.write(`\x1b[${-lines}A`);
        }
    }

    hideCursor(): void {
        this.write('\x1b[?25l');
    }

    showCursor(): void {
        this.write('\x1b[?25h');
    }

    clearLine(): void {
        this.write('\x1b[K');
    }

    clearFromCursor(): void {
        this.write('\x1b[J');
    }

    clearScreen(): void {
        this.write('\x1b[2J\x1b[H');
    }

    setTitle(title: string): void {
        this.write(`\x1b]0;${title}\x07`);
    }

    setProgress(_active: boolean): void {
        // Progress rendering is handled by the Tars status container.
    }
}

/**
 * Terminal UI (TUI) Channel Implementation for Tars.
 * Provides an interactive chat experience in the terminal with
 * real-time token streaming, status updates, and markdown rendering.
 */
export class TuiChannel implements CommunicationChannel {
    public readonly id = 'tui';
    public readonly isEnabled = true;

    private messageHandler?: (message: ChannelMessage) => Promise<void>;
    private terminal!: Terminal;
    private tui!: TUI;
    private chatContainer!: Container;
    private statusContainer!: Container;
    private editor!: Editor;

    private isProcessing: boolean = false;
    private onExitCallback?: () => Promise<void>;
    private isStopped: boolean = false;

    private activeStreamingComponent?: Markdown;
    private activeStreamingText: string = '';
    private activeStatusComponent?: Markdown;
    private loader?: Loader;
    private lastStatusLineCount: number = 0;

    // Allow injecting custom streams for testing
    private readonly input: TuiInput;
    private readonly output: TuiOutput;

    constructor(
        opts: {
            input?: TuiInput;
            output?: TuiOutput;
            onExit?: () => Promise<void>;
        } = {}
    ) {
        this.input = opts.input || process.stdin;
        this.output = opts.output || process.stdout;
        this.onExitCallback = opts.onExit;
    }

    /**
     * Start the TUI — render logo, show header, enter TUI rendering loop.
     */
    async start(): Promise<void> {
        const config = Config.getInstance();

        // 1. Initialize Terminal layer
        if (this.input === process.stdin && this.output === process.stdout) {
            this.terminal = new ProcessTerminal();
        } else {
            this.terminal = new StreamTerminal(this.input, this.output);
        }

        // 2. Initialize TUI manager
        this.tui = new TUI(this.terminal);

        // 3. Create initial static components (Logo & Header)
        const logo = TuiRenderer.renderLogo();
        const header = TuiRenderer.renderHeader({
            version: versionString,
            provider: config.piProvider,
            model: config.piModel,
            contextWindow: config.contextWindowTokens,
            assistantName: config.assistantName
        });

        this.tui.addChild(
            new Markdown(logo + '\n' + header + '\n', 1, 0, TuiRenderer.markdownTheme)
        );

        // 4. Create Chat History Container
        this.chatContainer = new Container();
        this.tui.addChild(this.chatContainer);

        // 5. Create Status updates Container (keeps status below chat but above editor)
        this.statusContainer = new Container();
        this.tui.addChild(this.statusContainer);

        // 6. Create Input Editor
        this.editor = new Editor(this.tui, TuiRenderer.editorTheme);

        // Configure Autocomplete
        const autocomplete = new CombinedAutocompleteProvider(
            [
                { name: 'help', description: 'Show list of available commands and usage guide' },
                { name: 'exit', description: 'Gracefully shut down the session and exit the TUI' },
                {
                    name: 'stats',
                    description: 'Display current session status and token statistics'
                },
                {
                    name: 'reset',
                    description: 'Clear session context and reset conversation history'
                }
            ],
            process.cwd()
        );
        this.editor.setAutocompleteProvider(autocomplete);

        // Setup Submit handler
        this.editor.onSubmit = async (value: string) => {
            if (this.isProcessing) return;

            const trimmed = value.trim();
            if (!trimmed) return;

            // Handle TUI-local commands
            const lowerVal = trimmed.toLowerCase();
            if (lowerVal === '/exit' || lowerVal === '/quit') {
                this.write('\n👋 Goodbye.\n');
                if (this.onExitCallback) {
                    await this.onExitCallback();
                }
                await this.stop();
                process.exit(0);
                return;
            }

            if (!this.messageHandler) return;

            // Clear input box
            this.editor.setText('');

            this.isProcessing = true;
            this.editor.disableSubmit = true;

            // Reset active stream states
            this.activeStreamingComponent = undefined;
            this.activeStreamingText = '';

            // Add user message to history
            this.chatContainer.addChild(
                new Markdown(`› ${trimmed}\n`, 1, 0, TuiRenderer.markdownTheme)
            );
            this.tui.requestRender();

            // Display "Thinking..." Loader
            this.loader = new Loader(
                this.tui,
                (s) => chalk.yellow(s),
                (s) => chalk.dim(s),
                'Thinking...'
            );
            this.tui.addChild(this.loader);
            this.tui.requestRender();

            const channelMessage: ChannelMessage = {
                content: trimmed,
                senderId: 'tui-user',
                senderName: 'user',
                channelId: 'tui',
                reply: async (content: string) => {
                    this.clearLastStatus();

                    if (!this.tui) {
                        const formatted = TuiRenderer.formatMarkdown(content);
                        this.write(formatted + '\n');
                        return;
                    }

                    if (this.loader) {
                        this.tui.removeChild(this.loader);
                        this.loader = undefined;
                    }

                    // Format and append response to chat history
                    this.chatContainer.addChild(
                        new Markdown(content, 1, 0, TuiRenderer.markdownTheme)
                    );
                    this.tui.requestRender();
                },
                startTyping: () => {},
                stopTyping: () => {
                    if (!this.tui) {
                        this.isProcessing = false;
                        return;
                    }

                    if (this.loader) {
                        this.tui.removeChild(this.loader);
                        this.loader = undefined;
                    }

                    this.isProcessing = false;
                    this.editor.disableSubmit = false;
                    this.tui.setFocus(this.editor);
                    this.tui.requestRender();
                }
            };

            await this.messageHandler(channelMessage);
        };

        this.tui.addChild(this.editor);
        this.tui.setFocus(this.editor);

        // 7. Start TUI loop
        this.tui.start();
    }

    /**
     * Stop the TUI channel.
     */
    async stop(): Promise<void> {
        if (this.isStopped) return;
        this.isStopped = true;
        this.tui?.stop();
    }

    /** Send a durable proactive notification to the terminal. */
    async notify(content: string): Promise<void> {
        if (!content.trim()) return;

        if (!this.tui) {
            const formatted = TuiRenderer.formatMarkdown(content);
            this.write(formatted + '\n');
            return;
        }

        this.chatContainer.addChild(new Markdown(content, 1, 0, TuiRenderer.markdownTheme));
        this.tui.requestRender();
    }

    /** Send and track a transient notification for in-place status editing. */
    async sendStatus(content: string): Promise<void> {
        if (!content.trim()) return;

        if (!this.tui) {
            const formatted = TuiRenderer.formatMarkdown(content);
            this.write(formatted + '\n');
            this.lastStatusLineCount = TuiRenderer.countLines(formatted, this.output.columns ?? 80);
            return;
        }

        // Clear existing status component if present
        this.statusContainer.clear();

        const statusMarkdown = new Markdown(content, 1, 0, TuiRenderer.markdownTheme);
        this.statusContainer.addChild(statusMarkdown);
        this.activeStatusComponent = statusMarkdown;

        this.tui.requestRender();
    }

    /**
     * Edit the last status notification in-place using TUI states.
     * Returns true if the edit succeeded.
     */
    async editStatus(content: string): Promise<boolean> {
        if (!this.tui) {
            if (this.lastStatusLineCount <= 0) return false;
            try {
                TuiRenderer.clearLines(this.output, this.lastStatusLineCount);
                const formatted = TuiRenderer.formatMarkdown(content);
                this.write(formatted + '\n');
                this.lastStatusLineCount = TuiRenderer.countLines(
                    formatted,
                    this.output.columns ?? 80
                );
                return true;
            } catch {
                return false;
            }
        }

        if (!this.activeStatusComponent) return false;

        this.activeStatusComponent.setText(content);
        this.tui.requestRender();
        return true;
    }

    /**
     * Clear the tracked status message.
     */
    clearStatus(): void {
        if (!this.tui) {
            if (this.lastStatusLineCount > 0) {
                try {
                    TuiRenderer.clearLines(this.output, this.lastStatusLineCount);
                } catch {
                    // The output stream may already be closed during shutdown.
                }
            }
            this.lastStatusLineCount = 0;
            return;
        }

        this.statusContainer.clear();
        this.activeStatusComponent = undefined;
        this.tui.requestRender();
    }

    /**
     * Register message handler.
     */
    onMessage(handler: (message: ChannelMessage) => Promise<void>): void {
        this.messageHandler = handler;
    }

    /**
     * Stream a text chunk directly to the terminal (no buffering).
     * Called by the event handler in bootstrap for real-time token streaming.
     */
    public streamText(text: string): void {
        if (!this.tui) {
            this.write(text);
            return;
        }

        // Remove loader spinner if active
        if (this.loader) {
            this.tui.removeChild(this.loader);
            this.loader = undefined;
        }

        if (!this.activeStreamingComponent) {
            this.activeStreamingComponent = new Markdown(text, 1, 0, TuiRenderer.markdownTheme);
            this.chatContainer.addChild(this.activeStreamingComponent);
            this.activeStreamingText = text;
        } else {
            this.activeStreamingText += text;
            this.activeStreamingComponent.setText(this.activeStreamingText);
        }

        this.tui.requestRender();
    }

    /**
     * Write directly to output stream (utility for commands).
     */
    private write(text: string): void {
        this.output.write(text);
    }

    /**
     * Clear last status lines (legacy compatibility helper).
     */
    private clearLastStatus(): void {
        this.clearStatus();
    }
}
