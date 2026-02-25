import { GeminiEngine } from './gemini-engine.js';
import { SessionManager } from './session-manager.js';
import { GeminiOutputHandler, AttachmentContext } from '../types/index.js';
import logger from '../utils/logger.js';
import { Config } from '../config/config.js';
import { MemoryManager } from '../memory/memory-manager.js';

/**
 * Tars Supervisor - Core Orchestrator
 * Handles session management and Gemini Engine execution.
 */
export class Supervisor {
    private readonly config: Config;
    public readonly memory: MemoryManager;
    private isProcessing: boolean = false;

    constructor(
        private readonly gemini: GeminiEngine,
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
        sessionId?: string,
        attachments?: AttachmentContext[]
    ): Promise<void> {
        if (this.isProcessing) {
            throw new Error('Supervisor is busy. Please wait for the current response to finish.');
        }

        logger.info(
            `🤖 Supervisor processing request: ${content.substring(0, 50)}${content.length > 50 ? '...' : ''}`
        );

        // Track whether memory-mutating tools were used this turn
        let memoryMutated = false;

        try {
            // Lock the supervisor
            this.isProcessing = true;

            // Get or create session
            let sessionIdToUse = sessionId || (await this.sessionManager.load());

            // Track user activity for idle suppression
            await this.sessionManager.touchActivity();

            // Run Gemini CLI
            await this.gemini.run(
                content,
                (event) => {
                    // Learn session ID from Gemini CLI if it was newly generated
                    if (event.sessionId && !sessionIdToUse) {
                        sessionIdToUse = event.sessionId;
                        this.sessionManager
                            .save(sessionIdToUse)
                            .catch((e) => logger.error(`Failed to save session: ${e}`));
                    }

                    // Log all tool calls for observability
                    if (event.type === 'tool_call' && event.toolName) {
                        logger.info(
                            `[Supervisor] 🛠️ Tool Call: ${event.toolName}(${JSON.stringify(event.toolArgs)})`
                        );

                        // Detect memory-mutating MCP tool calls
                        const toolName = event.toolName;
                        if (
                            toolName.includes('memory_store_fact') ||
                            toolName.includes('memory_delete_fact')
                        ) {
                            logger.info(`[Supervisor] Memory mutation detected: ${toolName}`);
                            memoryMutated = true;
                        }
                    }

                    // Log tool responses
                    if (event.type === 'tool_response' && event.toolName) {
                        const preview = event.content?.substring(0, 100);
                        logger.info(
                            `[Supervisor] ✅ Tool Response: ${event.toolName} -> ${preview}...`
                        );
                    }

                    // Extract data for session tracking
                    if (event.type === 'done') {
                        if (event.usageStats) {
                            this.sessionManager
                                .updateUsage(event.usageStats)
                                .catch((e) => logger.error(`Failed to update usage: ${e}`));
                        }
                    }
                    onEvent(event as any);
                },
                sessionIdToUse || undefined,
                attachments
            );

            // If a memory-mutating tool was used, invalidate the session so the
            // next turn starts fresh and picks up the updated facts
            if (memoryMutated) {
                logger.info('[Supervisor] Memory was mutated this turn — invalidating session');
                await this.sessionManager.forceInvalidate();
            }
        } catch (error: any) {
            logger.error(`❌ Supervisor execution error: ${error.message}`);
            onEvent({ type: 'error', error: error.message });
        } finally {
            this.isProcessing = false;
        }
    }

    /**
     * Specialized execution for background tasks.
     * Runs in ephemeral sessions (no --resume) to avoid bloating the main conversation.
     * Optionally injects the summary back into the main timeline so Tars remembers what it did.
     */
    public async executeTask(prompt: string): Promise<string> {
        if (this.isProcessing) {
            logger.warn('⚠️ Supervisor is busy, skipping background task');
            throw new Error('Supervisor is busy');
        }

        logger.info(`⚙️ Executing background task...`);

        try {
            this.isProcessing = true;

            // Check if there is an active session we should inject into later
            const activeSessionId = await this.sessionManager.load();

            // Run without session ID — ephemeral session that won't bloat main context with raw execution tool calls
            const result = await this.gemini.runSync(prompt);

            // If we have an active session, inject a synthetic summary so the user can ask about it
            if (activeSessionId) {
                await this.gemini.injectBackgroundHistory(activeSessionId, prompt, result);
            }

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
