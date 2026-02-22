import { spawn } from 'node:child_process';
import EventEmitter from 'node:events';
import logger from '../utils/logger.js';
import { Config } from '../config/config.js';
import fs from 'fs';

/**
 * Wrapper for the Gemini CLI process
 */
export class GeminiCli extends EventEmitter {
    private config: Config;

    constructor(config: Config) {
        super();
        this.config = config;
    }

    /**
     * Executes a prompt via Gemini CLI with streaming events.
     */
    public run(
        prompt: string,
        onEvent: (event: any) => void,
        sessionId?: string,
        extensions: string[] = []
    ): Promise<void> {
        return new Promise((resolve, reject) => {
            const args = ['--output-format', 'stream-json', '--yolo', '--prompt', prompt];

            if (sessionId) {
                args.push('--resume', sessionId);
            }

            if (this.config.geminiModel && this.config.geminiModel !== 'auto') {
                args.push('--model', this.config.geminiModel);
            }

            // Add extensions (MCP servers) if any
            for (const ext of extensions) {
                args.push('--extensions', ext);
            }

            const childDescription = `Gemini CLI (Session: ${sessionId || 'new'})`;

            // Re-homing environment for subprocess
            // Pin CWD to homeDir (~/.tars) so the Gemini CLI doesn't discover
            // stray GEMINI.md files in whatever directory the user ran `tars start` from.
            const env = {
                ...process.env,
                HOME: this.config.homeDir,
                TARS_HOME: this.config.homeDir,
                GEMINI_CLI_HOME: this.config.homeDir,
                GEMINI_SYSTEM_MD: this.config.systemPromptPath,
                PWD: this.config.homeDir
            };

            logger.info(`🚀 [GeminiCli] Spawning: gemini ${args.join(' ')}`);

            const child = spawn('gemini', args, {
                env,
                cwd: this.config.homeDir,
                stdio: ['ignore', 'pipe', 'pipe']
            });

            const debugFile = `/tmp/gemini-debug-${Date.now()}.log`;
            const debugStream = fs.createWriteStream(debugFile);

            let stdoutBuffer = '';
            let usageStats = { inputTokens: 0, outputTokens: 0, cachedTokens: 0 };
            let hasResolved = false;

            // --- Timeout Logic ---
            // 1. Total Safety Timeout (10m) - Absolute max for any task
            // 2. Idleness Timeout (5m) - Reset every time we get data
            let idleTimeout: NodeJS.Timeout;
            const TOTAL_TIMEOUT = 600000;
            const IDLE_TIMEOUT = 300000;

            const resetIdleTimeout = () => {
                clearTimeout(idleTimeout);
                idleTimeout = setTimeout(() => {
                    if (hasResolved) return;
                    logger.warn(
                        `🕒 ${childDescription} idle for ${IDLE_TIMEOUT / 1000}s. Killing...`
                    );
                    cleanup(null, new Error('Idle timeout'));
                    child.kill('SIGKILL');
                }, IDLE_TIMEOUT);
            };

            const totalTimeout = setTimeout(() => {
                if (hasResolved) return;
                logger.warn(
                    `🕒 ${childDescription} reached absolute limit (${TOTAL_TIMEOUT / 1000}s). Killing...`
                );
                cleanup(null, new Error('Absolute timeout'));
                child.kill('SIGKILL');
            }, TOTAL_TIMEOUT);

            resetIdleTimeout();
            // ---------------------

            const cleanup = (code: number | null, error?: Error) => {
                if (hasResolved) return;
                hasResolved = true;
                clearTimeout(totalTimeout);
                clearTimeout(idleTimeout);
                debugStream.end();

                if (error) {
                    reject(error);
                    return;
                }

                logger.info(`⏹️ ${childDescription} closed with code ${code}`);
                if (code === 0 || code === null) {
                    onEvent({ type: 'done', usageStats });
                    resolve();
                } else {
                    reject(new Error(`${childDescription} exited with code ${code}`));
                }
            };

            child.stdout.on('data', (data) => {
                resetIdleTimeout(); // Reset timer on any output
                const chunk = data.toString();
                debugStream.write(chunk);
                stdoutBuffer += chunk;

                const lines = stdoutBuffer.split('\n');
                stdoutBuffer = lines.pop() || '';

                for (const line of lines) {
                    if (!line.trim()) continue;
                    try {
                        const event = JSON.parse(line);

                        // --- Normalize Event ---
                        // 1. Tool Calls
                        if (event.type === 'tool_use') {
                            event.type = 'tool_call';
                            event.toolName = event.tool_name;
                            event.toolArgs = event.parameters;
                        }

                        // 2. Tool Responses
                        if (event.type === 'tool_result') {
                            event.type = 'tool_response';
                            event.toolId = event.tool_id;
                            event.content = event.output;
                        }

                        // 3. Thoughts
                        if (event.thoughts && !event.content) {
                            onEvent({
                                type: 'thought',
                                content: Array.isArray(event.thoughts)
                                    ? event.thoughts.join('\n')
                                    : event.thoughts
                            });
                        }

                        if (event.type === 'message' && event.thoughts) {
                            // If message has thoughts, emit them separately or as a combined event
                            onEvent({
                                type: 'thought',
                                content: Array.isArray(event.thoughts)
                                    ? event.thoughts.join('\n')
                                    : event.thoughts
                            });
                        }

                        // 4. Session & Stats
                        if (event.stats) {
                            usageStats = {
                                inputTokens: event.stats.input_tokens || event.stats.input || 0,
                                outputTokens: event.stats.output_tokens || event.stats.output || 0,
                                cachedTokens: event.stats.cached || 0
                            };
                        }

                        if (event.session_id && !event.sessionId) {
                            event.sessionId = event.session_id;
                        }

                        onEvent(event);

                        // If we see a 'done' event, the CLI is effectively finished
                        if (
                            event.type === 'done' ||
                            (event.type === 'result' && event.status === 'success')
                        ) {
                            cleanup(0);
                            child.kill('SIGTERM');
                        }
                    } catch (e) {
                        continue;
                    }
                }
            });

            child.stderr.on('data', (data) => {
                const error = data.toString();
                logger.warn(`[Gemini CLI Stderr] ${error.trim()}`);
            });

            child.on('close', (code) => {
                cleanup(code);
            });

            child.on('error', (err) => {
                logger.error(`Failed to start ${childDescription}: ${err.message}`);
                reject(err);
            });
        });
    }

    /**
     * Synchronous execution (collects all output)
     */
    public async runSync(
        prompt: string,
        sessionId?: string,
        extensions: string[] = []
    ): Promise<string> {
        let fullContent = '';
        await this.run(
            prompt,
            (event) => {
                if (
                    (event.type === 'message' || event.type === 'text') &&
                    event.role === 'assistant' &&
                    event.content
                ) {
                    fullContent += event.content;
                }
            },
            sessionId,
            extensions
        );

        return fullContent;
    }
}
