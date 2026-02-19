import { ChildProcess, spawn } from 'node:child_process';
import EventEmitter from 'node:events';
import logger from '../utils/logger.js';
import { Config } from '../config/config.js';
import path from 'path';
import os from 'os';
import fs from 'fs';
import crypto from 'crypto';

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
            // 1. Total Safety Timeout (5m) - Absolute max for any task
            // 2. Idleness Timeout (120s) - Reset every time we get data
            let idleTimeout: NodeJS.Timeout;
            const TOTAL_TIMEOUT = 300000;
            const IDLE_TIMEOUT = 120000;

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

        // Always try to compact after interaction
        if (sessionId) {
            await this.compactSession(sessionId);
        }

        return fullContent;
    }

    /**
     * Removes the last interaction (user prompt + assistant response) from the history.
     * Used for "Silent Heartbeats" to prevent context bloat.
     */
    public async pruneLastTurn(sessionId: string): Promise<void> {
        try {
            const filePath = this.getSessionFilePath(sessionId);
            if (!filePath) return;

            const raw = fs.readFileSync(filePath, 'utf-8');
            const session = JSON.parse(raw);

            if (session.messages && session.messages.length > 0) {
                let lastUserIndex = -1;
                for (let i = session.messages.length - 1; i >= 0; i--) {
                    if (session.messages[i].type === 'user') {
                        lastUserIndex = i;
                        break;
                    }
                }

                if (lastUserIndex !== -1) {
                    session.messages = session.messages.slice(0, lastUserIndex);
                    fs.writeFileSync(filePath, JSON.stringify(session, null, 2));
                    logger.debug(`✂️ Pruned session history at index ${lastUserIndex}`);
                }
            } else if (session.history && session.history.length > 0) {
                // Compatibility for alternate formats
                let lastUserIndex = -1;
                for (let i = session.history.length - 1; i >= 0; i--) {
                    if (session.history[i].role === 'user') {
                        lastUserIndex = i;
                        break;
                    }
                }
                if (lastUserIndex !== -1) {
                    session.history = session.history.slice(0, lastUserIndex);
                    fs.writeFileSync(filePath, JSON.stringify(session, null, 2));
                }
            }
        } catch (error: any) {
            logger.error(`❌ Pruning failed: ${error.message}`);
        }
    }

    /**
     * Compacts the session by removing non-essential metadata (like resultDisplay)
     * to prevent hitting token/quota limits.
     */
    public async compactSession(sessionId: string): Promise<void> {
        try {
            const filePath = this.getSessionFilePath(sessionId);
            if (!filePath) return;

            const stats = fs.statSync(filePath);
            if (stats.size < 50 * 1024) return; // Only compact if > 50KB

            logger.info(`🧹 Compacting bloated session (${(stats.size / 1024).toFixed(1)} KB)...`);

            const raw = fs.readFileSync(filePath, 'utf-8');
            const session = JSON.parse(raw);

            const cleanMessages = (msgs: any[]) => {
                if (!msgs) return msgs;
                return msgs.map((m: any) => {
                    if (m.resultDisplay) delete m.resultDisplay;
                    if (m.thoughts && m.thoughts.length > 3) m.thoughts = m.thoughts.slice(-3);

                    if (m.content && Array.isArray(m.content)) {
                        m.content = m.content.map((item: any) => {
                            if (item.result) {
                                item.result = item.result.map((r: any) => {
                                    if (r.functionResponse?.response?.resultDisplay) {
                                        delete r.functionResponse.response.resultDisplay;
                                    }
                                    return r;
                                });
                            }
                            return item;
                        });
                    }
                    return m;
                });
            };

            if (session.messages) session.messages = cleanMessages(session.messages);
            if (session.history) session.history = cleanMessages(session.history);

            fs.writeFileSync(filePath, JSON.stringify(session, null, 2));
            const newStats = fs.statSync(filePath);
            logger.info(
                `✨ Compacted: ${(stats.size / 1024).toFixed(1)} KB -> ${(newStats.size / 1024).toFixed(1)} KB`
            );
        } catch (error: any) {
            logger.error(`❌ Compaction failed: ${error.message}`);
        }
    }

    private getSessionFilePath(sessionId: string): string | null {
        try {
            // The Gemini CLI calculates the project hash based on the CWD.
            // Since we pin CWD to homeDir, the hash must match.
            const projectDir = this.config.homeDir;
            const projectHash = crypto.createHash('sha256').update(projectDir).digest('hex');
            const chatsDir = path.join(this.config.homeDir, '.gemini', 'tmp', projectHash, 'chats');

            if (!fs.existsSync(chatsDir)) {
                logger.debug(`[GeminiCli] Chats directory not found: ${chatsDir}`);
                return null;
            }

            const files = fs
                .readdirSync(chatsDir)
                .filter(
                    (f) =>
                        f.startsWith('session-') &&
                        f.includes(sessionId.substring(0, 8)) &&
                        f.endsWith('.json')
                )
                .map((f) => ({
                    name: f,
                    time: fs.statSync(path.join(chatsDir, f)).mtime.getTime()
                }))
                .sort((a, b) => b.time - a.time);

            return files.length > 0 ? path.join(chatsDir, files[0].name) : null;
        } catch {
            return null;
        }
    }
}
