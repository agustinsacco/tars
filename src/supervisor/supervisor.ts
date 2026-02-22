import { GeminiCli } from './gemini-cli.js';
import { SessionManager } from './session-manager.js';
import { GeminiOutputHandler } from '../types/index.js';
import logger from '../utils/logger.js';
import { Config } from '../config/config.js';
import { MemoryManager } from '../memory/memory-manager.js';

/**
 * Tars Supervisor - Core Orchestrator
 * Handles session management and Gemini CLI execution.
 * Context compression is delegated to the Gemini CLI's built-in compressionThreshold.
 */
export class Supervisor {
    private readonly config: Config;
    public readonly memory: MemoryManager;
    private isProcessing: boolean = false;

    constructor(
        private readonly gemini: GeminiCli,
        private readonly sessionManager: SessionManager
    ) {
        this.config = Config.getInstance();
        this.memory = new MemoryManager(this.config);
    }

    /**
     * Executes a user prompt through the Gemini CLI
     */
    public async run(
        content: string,
        onEvent: GeminiOutputHandler,
        sessionId?: string
    ): Promise<void> {
        logger.info(
            `🤖 Supervisor processing request: ${content.substring(0, 50)}${content.length > 50 ? '...' : ''}`
        );

        // Track whether memory-mutating tools were used this turn
        let memoryMutated = false;

        try {
            // Get or create session
            let sessionIdToUse = sessionId || (await this.sessionManager.load());

            // Lock the supervisor
            this.isProcessing = true;

            // Track user activity for idle suppression
            await this.sessionManager.touchActivity();

            // Run Gemini CLI
            await this.gemini.run(
                content,
                (event) => {
                    // Learn session ID from Gemini CLI if it was newly generated
                    if (event.sessionId) {
                        sessionIdToUse = event.sessionId;
                        if (sessionIdToUse) {
                            this.sessionManager
                                .save(sessionIdToUse)
                                .catch((e) => logger.error(`Failed to save session: ${e}`));
                        }
                    }

                    // Detect memory-mutating MCP tool calls
                    if (event.type === 'tool_call' && event.toolName) {
                        const toolName = event.toolName;
                        if (
                            toolName.includes('memory_store_fact') ||
                            toolName.includes('memory_delete_fact')
                        ) {
                            logger.info(`[Supervisor] Memory mutation detected: ${toolName}`);
                            memoryMutated = true;
                        }
                    }

                    // Extract data for session tracking
                    if (event.type === 'done') {
                        if (event.usageStats) {
                            this.sessionManager
                                .updateUsage(event.usageStats)
                                .catch((e) => logger.error(`Failed to update usage: ${e}`));
                        }
                        if (sessionIdToUse) {
                            this.sessionManager
                                .save(sessionIdToUse)
                                .catch((e) => logger.error(`Failed to save session: ${e}`));
                        }
                    }
                    onEvent(event);
                },
                sessionIdToUse || undefined
            );

            // If a memory-mutating tool was used, invalidate the session so the
            // next turn starts fresh and picks up the updated facts
            if (memoryMutated) {
                logger.info('[Supervisor] Memory was mutated this turn — invalidating session');
                await this.sessionManager.forceInvalidate();
            }
        } catch (error: any) {
            // Auto-recovery for invalid sessions (e.g. after project path changes)
            if (error.message && error.message.includes('code 42')) {
                logger.warn('⚠️ Session invalid (code 42). Clearing session state and retrying...');
                await this.sessionManager.clear();
                return this.run(content, onEvent);
            }

            logger.error(`❌ Supervisor execution error: ${error.message}`);
            onEvent({ type: 'error', error: error.message });
        } finally {
            this.isProcessing = false;
        }
    }

    /**
     * Specialized execution for background tasks.
     * Runs in ephemeral sessions (no --resume) to avoid bloating the main conversation.
     */
    public async executeTask(prompt: string): Promise<string> {
        if (this.isProcessing) {
            logger.warn('⚠️ Supervisor is busy, skipping background task');
            throw new Error('Supervisor is busy');
        }

        logger.info(`⚙️ Executing background task...`);

        try {
            this.isProcessing = true;
            // Run without session ID — ephemeral session that won't bloat main context
            const result = await this.gemini.runSync(prompt);
            return result;
        } catch (error: any) {
            logger.error(`❌ Background task failed: ${error.message}`);
            throw error;
        } finally {
            this.isProcessing = false;
        }
    }

    /**
     * Checks if the supervisor is currently processing a request
     */
    public isBusy(): boolean {
        return this.isProcessing;
    }
}
