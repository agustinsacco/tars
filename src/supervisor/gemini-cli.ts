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
            const args = [
                '--output-format', 'stream-json',
                '--experimental-acp',
                '--yolo',
                '--include-directories', this.config.homeDir
            ];

            if (sessionId) {
                args.push('--session-id', sessionId);
            }

            // Add extensions (MCP servers) if any
            for (const ext of extensions) {
                args.push('--extensions', ext);
            }

            args.push('--prompt', prompt);

            const childDescription = `Gemini CLI (Session: ${sessionId || 'new'})`;
            const cmdStr = `HOME=${this.config.homeDir} gemini ${args.join(' ')}`;
            logger.info(`🚀 Spawning: ${cmdStr}`);

            const child = spawn('gemini', args, {
                env: {
                    ...process.env,
                    HOME: this.config.homeDir
                },
                stdio: ['ignore', 'pipe', 'pipe']
            });

            let stdoutBuffer = '';
            let usageStats = { inputTokens: 0, outputTokens: 0, cachedTokens: 0 };

            const timeout = setTimeout(() => {
                logger.warn(`🕒 ${childDescription} timed out after 60s. Killing...`);
                child.kill('SIGKILL');
                reject(new Error(`${childDescription} timed out`));
            }, 60000);

            child.stdout.on('data', (data) => {
                stdoutBuffer += data.toString();

                // Try to parse full JSON objects from the stream
                const lines = stdoutBuffer.split('\n');
                stdoutBuffer = lines.pop() || '';

                for (const line of lines) {
                    if (!line.trim()) continue;
                    try {
                        const event = JSON.parse(line);
                        // Track usage stats from the 'done' event or intermediate ones
                        if (event.tokens) {
                            usageStats = {
                                inputTokens: event.tokens.input,
                                outputTokens: event.tokens.output,
                                cachedTokens: event.tokens.cached || 0
                            };
                        }
                        onEvent(event);
                    } catch (e) {
                        // If it's not valid JSON, it's likely a status message or hook log.
                        // We skip it instead of blocking the buffer.
                        logger.debug(`[Gemini CLI Stdout] ${line.trim()}`);
                        continue;
                    }
                }
            });

            child.stderr.on('data', (data) => {
                const error = data.toString();
                logger.warn(`[Gemini CLI Stderr] ${error.trim()}`);
            });

            child.on('close', (code) => {
                clearTimeout(timeout);
                logger.info(`⏹️ ${childDescription} closed with code ${code}`);
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
            logger.info(`✨ Compacted: ${(stats.size / 1024).toFixed(1)} KB -> ${(newStats.size / 1024).toFixed(1)} KB`);
        } catch (error: any) {
            logger.error(`❌ Compaction failed: ${error.message}`);
        }
    }

    private getSessionFilePath(sessionId: string): string | null {
        try {
            const projectDir = this.config.homeDir;
            const projectHash = crypto.createHash('sha256').update(projectDir).digest('hex');
            const chatsDir = path.join(this.config.homeDir, '.gemini', 'tmp', projectHash, 'chats');

            if (!fs.existsSync(chatsDir)) return null;

            const files = fs.readdirSync(chatsDir)
                .filter(f => f.startsWith('session-') && f.includes(sessionId.substring(0, 8)) && f.endsWith('.json'))
                .map(f => ({ name: f, time: fs.statSync(path.join(chatsDir, f)).mtime.getTime() }))
                .sort((a, b) => b.time - a.time);

            return files.length > 0 ? path.join(chatsDir, files[0].name) : null;
        } catch {
            return null;
        }
    }
}
