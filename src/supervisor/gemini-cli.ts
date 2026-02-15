import { spawn } from 'child_process';
import { GeminiEvent, GeminiOutputHandler } from '../types/index.js';
import logger from '../utils/logger.js';
import { Config } from '../config/config.js';
import path from 'path';
import os from 'os';

/**
 * Wrapper for the Gemini CLI process
 */
export class GeminiCli {
    private readonly config: Config;

    constructor(private readonly model: string) {
        this.config = Config.getInstance();
    }

    /**
     * Executes a prompt via Gemini CLI and streams events
     */
    public async run(
        prompt: string,
        onEvent: GeminiOutputHandler,
        sessionId?: string,
        extensions: string[] = []
    ): Promise<void> {
        const args = ['chat', '--model', this.model, '--output-format', 'stream-json'];

        if (sessionId) {
            args.push('--resume', sessionId);
        }

        // Add extensions
        for (const ext of extensions) {
            args.push('--extension', ext);
        }

        args.push('--yolo', prompt);

        logger.debug(`Executing Gemini CLI: gemini ${args.join(' ')}`);

        const env = {
            ...process.env,
            GEMINI_CLI_HOME: this.config.homeDir,
            GEMINI_SYSTEM_MD: this.config.systemPromptPath
        };

        return new Promise((resolve, reject) => {
            const childDescription = `gemini chat [session: ${sessionId || 'new'}]`;
            const child = spawn('gemini', args, { env });

            let buffer = '';
            let usageStats: any = {};

            child.stdout.on('data', (data) => {
                const chunk = data.toString();
                buffer += chunk;

                // Process line-by-line
                let newlineIndex: number;
                while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
                    const line = buffer.slice(0, newlineIndex).trim();
                    buffer = buffer.slice(newlineIndex + 1);

                    if (!line) continue;

                    try {
                        const event = JSON.parse(line);

                        if (event.type === 'init' && event.session_id) {
                            onEvent({ type: 'text', content: '', sessionId: event.session_id });
                        } else if (event.type === 'message' && event.role === 'assistant' && event.content) {
                            onEvent({ type: 'text', content: event.content });
                        } else if (event.type === 'result' && event.stats) {
                            usageStats = {
                                inputTokens: event.stats.input_tokens || 0,
                                outputTokens: event.stats.output_tokens || 0,
                                cachedTokens: event.stats.cached || 0
                            };
                        } else if (event.type === 'error') {
                            onEvent({ type: 'error', error: event.message || JSON.stringify(event) });
                        }
                    } catch (e) {
                        // Not JSON, likely a log message
                        // logger.debug(`[Gemini CLI Log] ${line}`);
                    }
                }
            });

            child.stderr.on('data', (data) => {
                const error = data.toString();
                logger.warn(`[Gemini CLI Stderr] ${error.trim()}`);
                // Don't emit errors to user from stderr as it often contains non-fatal warnings (like MCP discovery issues)
                // Real errors will come via the stream-json output or non-zero exit code.
            });

            child.on('close', (code) => {
                if (code === 0) {
                    onEvent({ type: 'done', usageStats });
                    resolve();
                } else {
                    reject(new Error(`${childDescription} exited with code ${code}`));
                }
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
                if (event.type === 'text' && event.content) {
                    fullContent += event.content;
                }
            },
            sessionId,
            extensions
        );
        return fullContent;
    }
}
