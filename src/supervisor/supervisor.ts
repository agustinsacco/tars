import { TarsEngine, StatusUpdateHandler } from './tars-engine.js';
import { SessionManager } from './session-manager.js';
import { TarsOutputHandler, AttachmentContext } from '../types/index.js';
import logger from '../utils/logger.js';
import { Config } from '../config/config.js';
import { MemoryManager } from '../memory/memory-manager.js';

/**
 * Tars Supervisor - Core Orchestrator
 * Handles session management and Tars Engine execution.
 */
export class Supervisor {
    private readonly config: Config;
    public readonly memory: MemoryManager;
    private processingSince: number | null = null;

    constructor(
        private readonly tarsEngine: TarsEngine,
        private readonly sessionManager: SessionManager
    ) {
        this.config = Config.getInstance();
        this.memory = new MemoryManager(this.config);
    }

    /**
     * Executes a user prompt through the Tars CLI
     */
    public async run(
        content: string,
        onEvent: TarsOutputHandler,
        sessionId?: string,
        attachments?: AttachmentContext[],
        onStatus?: StatusUpdateHandler
    ): Promise<void> {
        if (this.processingSince !== null) {
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
            this.processingSince = Date.now();

            // Get or create session
            let sessionIdToUse = sessionId || (await this.sessionManager.load());

            // Track user activity for idle suppression
            await this.sessionManager.touchActivity();

            let toolCallCount = 0;
            const callIdToNameMap = new Map<string, string>();

            // Run Tars CLI
            await this.tarsEngine.run(
                content,
                async (event) => {
                    // Learn session ID from Tars CLI if it was newly generated
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
                                    const didCompress = await this.tarsEngine.compressSession();
                                    await this.sessionManager.recordCompression();

                                    if (didCompress) {
                                        await onEvent({
                                            type: 'text',
                                            role: 'assistant',
                                            content:
                                                '\n\n✨ *Session memory compacted to optimally save context space while retaining historical facts.*',
                                            sessionId: sessionIdToUse
                                        } as any);
                                    }
                                } catch (e: any) {
                                    logger.warn(`[Supervisor] Compression failed: ${e.message}`);
                                }
                            }
                        }
                    }
                    await onEvent(event as any);
                },
                sessionIdToUse || undefined,
                attachments,
                onStatus
            );

            // If a memory-mutating tool was used, refresh system instruction in-place
            // instead of destroying the session
            if (memoryMutated) {
                logger.info('[Supervisor] Memory mutated — refreshing system instruction in-place');
                this.tarsEngine.refreshSystemInstruction();
            }
        } catch (error: any) {
            logger.error(`❌ Supervisor execution error: ${error.message}`);
            onEvent({ type: 'error', error: error.message });
        } finally {
            this.processingSince = null;
        }
    }

    /**
     * Specialized execution for background tasks.
     * Runs in the active session so the model retains context of what it did.
     * No more orphan sessions or dangerous history injection.
     */
    public async executeTask(prompt: string): Promise<string> {
        if (this.processingSince !== null) {
            logger.warn('⚠️ Supervisor is busy, skipping background task');
            throw new Error('Supervisor is busy');
        }

        logger.info(`⚙️ Executing background task...`);

        try {
            this.processingSince = Date.now();

            // Run in the active session so context is shared
            const activeSessionId = await this.sessionManager.load();
            const result = await this.tarsEngine.runSync(prompt, activeSessionId || undefined);

            return result;
        } catch (error: any) {
            logger.error(`❌ Background task failed: ${error.message}`);
            throw error;
        } finally {
            this.processingSince = null;
        }
    }

    public isBusy(): boolean {
        return this.processingSince !== null;
    }

    /**
     * Checks if the supervisor lock has been held longer than maxAgeMs and forcefully releases it if so.
     * Returns true if a stale lock was released.
     */
    public checkAndReleaseStaleLock(maxAgeMs: number): boolean {
        if (this.processingSince !== null) {
            const age = Date.now() - this.processingSince;
            if (age > maxAgeMs) {
                logger.warn(
                    `⚠️ Supervisor lock has been held for ${Math.round(age / 1000)}s! Forcefully releasing stale lock.`
                );
                this.processingSince = null;
                return true;
            }
        }
        return false;
    }
}
