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
            throw new Error(
                "I'm currently working on a task. Please retry in a moment — I should be free within 30-60 seconds."
            );
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

            let toolCallCount = 0;
            const callIdToNameMap = new Map<string, string>();

            // Run Gemini CLI
            await this.gemini.run(
                content,
                async (event) => {
                    // Learn session ID from Gemini CLI if it was newly generated
                    if (event.sessionId && !sessionIdToUse) {
                        sessionIdToUse = event.sessionId;
                        this.sessionManager
                            .save(sessionIdToUse)
                            .catch((e) => logger.error(`Failed to save session: ${e}`));
                    }

                    // Log all tool calls for observability
                    if (event.type === 'tool_call' && event.toolName) {
                        toolCallCount++;
                        if (event.callId) {
                            callIdToNameMap.set(event.callId, event.toolName);
                        }

                        const argsPreview = JSON.stringify(event.toolArgs || {});
                        const truncatedArgs =
                            argsPreview.length > 150
                                ? argsPreview.substring(0, 150) + '...'
                                : argsPreview;

                        logger.info(`🛠️  [Tool #${toolCallCount}] ${event.toolName}`);
                        logger.info(`   📥 Input: ${truncatedArgs}`);

                        // Detect memory-mutating MCP tool calls
                        const toolName = event.toolName;
                        if (
                            toolName.includes('memory_store_fact') ||
                            toolName.includes('memory_delete_fact')
                        ) {
                            logger.info(`   ✨ Memory Mutation: ${toolName}`);
                            memoryMutated = true;
                        }
                    }

                    // Log tool responses
                    if (event.type === 'tool_response' && event.toolName) {
                        const toolName = callIdToNameMap.get(event.toolName) || 'unknown_tool';
                        const content = event.content || '';

                        let summary = '';
                        if (content.startsWith('[') || content.startsWith('{')) {
                            try {
                                const parsed = JSON.parse(content);
                                if (Array.isArray(parsed)) {
                                    summary = ` -> ${parsed.length} results found`;
                                }
                            } catch (e) {}
                        }

                        const preview = content.substring(0, 100).replace(/\n/g, ' ').trim();
                        logger.info(`✅ [Tool] ${toolName}${summary}`);
                        logger.info(
                            `   📤 Output: ${preview}${content.length > 100 ? '...' : ''} (${content.length} chars)`
                        );
                    }

                    // Extract data for session tracking
                    if (event.type === 'done') {
                        if (event.usageStats) {
                            await this.sessionManager.updateUsage(event.usageStats);

                            // Proactive compression check
                            if (
                                this.sessionManager.needsCompression(
                                    this.config.contextWindowTokens,
                                    this.config.compressionThreshold
                                )
                            ) {
                                logger.info(
                                    '[Supervisor] Context threshold exceeded — triggering compression'
                                );
                                try {
                                    await this.gemini.compressSession();
                                    await this.sessionManager.recordCompression();
                                } catch (e: any) {
                                    logger.warn(`[Supervisor] Compression failed: ${e.message}`);
                                }
                            }
                        }
                    }
                    await onEvent(event as any);
                },
                sessionIdToUse || undefined,
                attachments
            );

            // If a memory-mutating tool was used, refresh system instruction in-place
            // instead of destroying the session
            if (memoryMutated) {
                logger.info('[Supervisor] Memory mutated — refreshing system instruction in-place');
                this.gemini.refreshSystemInstruction();
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
     * Runs in the active session so the model retains context of what it did.
     * No more orphan sessions or dangerous history injection.
     */
    public async executeTask(prompt: string): Promise<string> {
        if (this.isProcessing) {
            logger.warn('⚠️ Supervisor is busy, skipping background task');
            throw new Error('Supervisor is busy');
        }

        logger.info(`⚙️ Executing background task...`);

        try {
            this.isProcessing = true;

            // Run in the active session so context is shared
            const activeSessionId = await this.sessionManager.load();
            const result = await this.gemini.runSync(prompt, activeSessionId || undefined);

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
