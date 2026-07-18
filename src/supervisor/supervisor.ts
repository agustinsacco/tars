import { TarsEngine, StatusUpdateHandler } from './tars-engine.js';
import { SessionManager } from './session-manager.js';
import { TarsOutputHandler, AttachmentContext, type TarsEvent } from '../types/index.js';
import logger from '../utils/logger.js';
import { Config } from '../config/config.js';
import { MemoryManager } from '../memory/memory-manager.js';
import { DLPService } from '../utils/dlp-service.js';

function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function getStringProperty(value: unknown, property: string): string | undefined {
    if (typeof value !== 'object' || value === null) return undefined;
    const candidate = Reflect.get(value, property);
    return typeof candidate === 'string' ? candidate : undefined;
}

function scrubEvent(event: TarsEvent): TarsEvent {
    const scrubbedEvent: TarsEvent = { ...event };
    if (event.content !== undefined) {
        scrubbedEvent.content =
            event.type === 'tool_response'
                ? DLPService.scrubTextOrJson(event.content)
                : DLPService.scrub(event.content);
    }
    if (event.error !== undefined) scrubbedEvent.error = DLPService.scrub(event.error);
    if (event.toolArgs !== undefined) scrubbedEvent.toolArgs = DLPService.scrubDeep(event.toolArgs);
    return scrubbedEvent;
}

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

        logger.info(`🤖 Supervisor processing request (${content.length} characters)`);

        // Track whether memory-mutating tools were used this turn
        let memoryMutated = false;

        // Declare outside try for catch/finally block access
        let sessionIdToUse: string | null = null;

        try {
            // Lock the supervisor synchronously
            this.processingSince = Date.now();

            // Get or create session asynchronously
            sessionIdToUse = sessionId || (await this.sessionManager.load());

            // Track user activity for idle suppression
            await this.sessionManager.touchActivity();

            // Proactive compression check before run starts
            if (sessionIdToUse) {
                await this.performCompressionIfNeeded(sessionIdToUse);
            }

            let toolCallCount = 0;
            const callIdToNameMap = new Map<string, string>();

            // Run Tars CLI with context overflow retry logic
            let retryCount = 0;
            const maxRetries = 2;

            while (retryCount <= maxRetries) {
                try {
                    await this.tarsEngine.run(
                        content,
                        async (event) => {
                            // Learn session ID from Tars CLI if it was newly generated
                            if (event.sessionId && !sessionIdToUse) {
                                sessionIdToUse = event.sessionId;
                                await this.sessionManager.save(sessionIdToUse);
                            }

                            // Log all tool calls for observability
                            if (event.type === 'tool_call' && event.toolName) {
                                toolCallCount++;
                                if (event.callId) {
                                    callIdToNameMap.set(event.callId, event.toolName);
                                }

                                const argsPreview = JSON.stringify(
                                    DLPService.scrubDeep(event.toolArgs ?? {})
                                );
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
                                    toolName.includes('memory_delete_fact') ||
                                    (toolName.includes('manage_facts') &&
                                        (getStringProperty(event.toolArgs, 'action') === 'store' ||
                                            getStringProperty(event.toolArgs, 'action') ===
                                                'delete'))
                                ) {
                                    logger.info(`   ✨ Memory Mutation: ${toolName}`);
                                    memoryMutated = true;
                                }
                            }

                            // Log tool responses
                            if (event.type === 'tool_response' && event.toolName) {
                                const toolName =
                                    callIdToNameMap.get(event.toolName) || 'unknown_tool';
                                const content = DLPService.scrubTextOrJson(event.content || '');

                                let summary = '';
                                if (content.startsWith('[') || content.startsWith('{')) {
                                    try {
                                        const parsed = JSON.parse(content);
                                        if (Array.isArray(parsed)) {
                                            summary = ` -> ${parsed.length} results found`;
                                        }
                                    } catch {
                                        // Non-JSON output has no structured result count.
                                    }
                                }

                                const preview = content
                                    .substring(0, 100)
                                    .replace(/\n/g, ' ')
                                    .trim();
                                logger.info(`✅ [Tool] ${toolName}${summary}`);
                                logger.info(
                                    `   📤 Output: ${preview}${content.length > 100 ? '...' : ''} (${content.length} chars)`
                                );
                            }

                            // Extract data for session tracking
                            if (event.type === 'done') {
                                if (event.usageStats) {
                                    await this.sessionManager.updateUsage(event.usageStats);
                                    // Compression check is done at the START of each user request,
                                    // not after every turn within a request, to avoid interrupting
                                    // multi-turn tasks.
                                }
                            }
                            await onEvent(scrubEvent(event));
                        },
                        sessionIdToUse || undefined,
                        attachments,
                        onStatus
                    );
                    // Success - break out of retry loop
                    break;
                } catch (error: unknown) {
                    const errorMessage = getErrorMessage(error);
                    const isContextOverflow = errorMessage.includes(
                        'exceeds the available context size'
                    );

                    if (isContextOverflow && retryCount < maxRetries) {
                        retryCount++;
                        logger.info(
                            `🔄 Context overflow detected (attempt ${retryCount}/${maxRetries}). Triggering compression and retry...`
                        );

                        // Force compression
                        if (!sessionIdToUse) throw error;
                        await this.performCompressionIfNeeded(sessionIdToUse, true);

                        // Small delay before retry
                        await new Promise((resolve) => setTimeout(resolve, 500));
                        continue;
                    }

                    // Not a context overflow or max retries reached
                    throw error;
                }
            }

            // If a memory-mutating tool was used, refresh system instruction in-place
            // instead of destroying the session
            if (memoryMutated) {
                logger.info('[Supervisor] Memory mutated — refreshing system instruction in-place');
                this.tarsEngine.refreshSystemInstruction();
            }
        } catch (error: unknown) {
            const errorMessage = DLPService.scrub(getErrorMessage(error));
            logger.error(`❌ Supervisor execution error: ${errorMessage}`);
            await onEvent({ type: 'error', error: errorMessage });
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
            const result = await this.tarsEngine.runSync(prompt, activeSessionId || undefined, {
                allowNotifications: false
            });

            return result;
        } catch (error: unknown) {
            const errorMessage = DLPService.scrub(getErrorMessage(error));
            logger.error(`❌ Background task failed: ${errorMessage}`);
            throw error;
        } finally {
            this.processingSince = null;
        }
    }

    /**
     * Checks if the session needs compression and performs it silently.
     * Compression happens transparently without interrupting the user experience.
     */
    private async performCompressionIfNeeded(
        sessionIdToUse: string,
        force: boolean = false
    ): Promise<void> {
        if (
            force ||
            this.sessionManager.needsCompression(
                this.config.contextWindowTokens,
                this.config.compressionThreshold
            )
        ) {
            logger.info('[Supervisor] Context threshold exceeded — triggering silent compression');

            // Silent compression - no user-facing messages
            // This keeps the user experience smooth during multi-turn tasks

            try {
                const didCompress = await this.tarsEngine.compressSession(force, sessionIdToUse);

                if (didCompress) {
                    await this.sessionManager.recordCompression();
                    logger.info('[Supervisor] Session memory compacted silently');
                }
            } catch (error: unknown) {
                logger.warn(`[Supervisor] Compression failed: ${getErrorMessage(error)}`);
            }
        }
    }

    public isBusy(): boolean {
        return this.processingSince !== null;
    }

    /**
     * Reports an unexpectedly long-running request without unlocking it.
     * Clearing a live request would allow concurrent agents to mutate one session.
     */
    public hasStaleRun(maxAgeMs: number): boolean {
        if (this.processingSince === null) return false;
        return Date.now() - this.processingSince > maxAgeMs;
    }
}
