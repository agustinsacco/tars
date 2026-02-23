import {
    Config as CoreConfig,
    GeminiClient,
    GeminiEventType,
    AuthType,
    promptIdContext,
    Scheduler,
    type ServerGeminiStreamEvent
} from '@google/gemini-cli-core';
import { EventEmitter } from 'events';
import { Config as TarsConfig } from '../config/config.js';
import logger from '../utils/logger.js';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import path from 'path';

export interface GeminiEngineEvent {
    type: string;
    role?: 'user' | 'assistant' | 'system';
    content?: string;
    toolName?: string;
    toolArgs?: any;
    usageStats?: {
        inputTokens: number;
        outputTokens: number;
        cachedTokens: number;
    };
    sessionId?: string;
    error?: string;
}

export type GeminiOutputHandler = (event: GeminiEngineEvent) => void;

/**
 * Detects the best authentication type based on environment variables.
 * (Local implementation since it's not exported from core index)
 */
function getAuthTypeFromEnv(): AuthType | undefined {
    if (process.env['GOOGLE_GENAI_USE_GCA'] === 'true') {
        return AuthType.LOGIN_WITH_GOOGLE;
    }
    if (process.env['GOOGLE_GENAI_USE_VERTEXAI'] === 'true') {
        return AuthType.USE_VERTEX_AI;
    }
    if (process.env['GEMINI_API_KEY']) {
        return AuthType.USE_GEMINI;
    }
    return undefined;
}

/**
 * GeminiEngine - Native replacement for GeminiCli subprocess
 *
 * Uses @google/gemini-cli-core directly to interact with Gemini models.
 * Operates within the ~/.tars isolated environment by overriding HOME.
 */
export class GeminiEngine extends EventEmitter {
    private coreConfig!: CoreConfig;
    private client!: GeminiClient;
    private initialized = false;
    private currentSessionId: string | null = null;

    constructor(private readonly tarsConfig: TarsConfig) {
        super();
    }

    /**
     * Initializes the core Gemini client with proper auth and config.
     */
    public async initialize(): Promise<void> {
        if (this.initialized) return;

        logger.info('🚀 Initializing Gemini Engine (Native Core)...');

        const savedHome = process.env.HOME;
        try {
            // Ensure home directory exists
            if (!fs.existsSync(this.tarsConfig.homeDir)) {
                fs.mkdirSync(this.tarsConfig.homeDir, { recursive: true });
            }

            // Isolating to ~/.tars
            process.env.HOME = this.tarsConfig.homeDir;
            process.env.GEMINI_CLI_HOME = this.tarsConfig.homeDir;

            // Tell the Gemini Core PromptProvider to use our custom system.md
            const systemMdPath = path.join(this.tarsConfig.homeDir, '.gemini', 'system.md');
            process.env.GEMINI_SYSTEM_MD = systemMdPath;

            const authType = getAuthTypeFromEnv() || AuthType.LOGIN_WITH_GOOGLE;

            this.coreConfig = new CoreConfig({
                sessionId: uuidv4(),
                targetDir: this.tarsConfig.homeDir,
                cwd: this.tarsConfig.homeDir,
                model: this.tarsConfig.geminiModel,
                debugMode: true,
                approvalMode: 'yolo' as any, // Tars runs autonomously
                enableHooks: true,
                mcpEnabled: true,
                extensionsEnabled: true,
                enableAgents: true, // Enable agents support
                skillsSupport: true,
                adminSkillsEnabled: true,
                noBrowser: true
            });

            await this.coreConfig.refreshAuth(authType);
            await this.coreConfig.initialize();

            this.client = this.coreConfig.getGeminiClient();
            this.initialized = true;
            this.currentSessionId = this.coreConfig.getSessionId();
            logger.info('✨ Gemini Engine initialized successfully.');
        } catch (error: any) {
            logger.error(`❌ Failed to initialize Gemini Engine: ${error.message}`);
            throw error;
        } finally {
            process.env.HOME = savedHome;
        }
    }

    /**
     * Executes a prompt and streams events back.
     */
    public async run(
        prompt: string,
        onEvent: GeminiOutputHandler,
        sessionId?: string
    ): Promise<void> {
        if (!this.initialized) {
            await this.initialize();
        }

        const sid = sessionId || this.coreConfig.getSessionId();
        const savedHome = process.env.HOME;

        try {
            process.env.HOME = this.tarsConfig.homeDir;
            process.env.GEMINI_CLI_HOME = this.tarsConfig.homeDir;

            // Session Swapping Logic
            if (this.currentSessionId !== sid) {
                logger.debug(`🔄 Swapping Gemini session to: ${sid}`);
                const resumedData = await this.loadResumedSessionData(sid);
                // @ts-ignore - access private to swap session
                await this.client.startChat(undefined, resumedData || undefined);
                this.currentSessionId = sid;
            }

            let currentRequestParts: any[] = [{ text: prompt }];
            let turnCount = 0;
            const maxTurns = 10;
            const abortController = new AbortController();

            while (turnCount < maxTurns) {
                turnCount++;
                const toolRequests: any[] = [];
                let hasRealContent = false;

                const stream = await promptIdContext.run(sid, () => {
                    return this.client.sendMessageStream(
                        currentRequestParts,
                        abortController.signal,
                        'tars-request' // Proper promptId
                    );
                });

                let finalUsageStats: any = undefined;
                for await (const event of stream) {
                    logger.debug(
                        `📨 Raw Gemini Event [Turn ${turnCount}]: ${JSON.stringify(event).substring(0, 200)}...`
                    );

                    if (event.type === GeminiEventType.ToolCallRequest) {
                        toolRequests.push(event.value);
                    }

                    if (event.type === GeminiEventType.Finished) {
                        finalUsageStats = event.value.usageMetadata;
                        continue; // Don't emit done yet
                    }

                    const normalized = this.normalizeEvent(event, sid);
                    if (normalized) {
                        if (normalized.type === 'text' && normalized.content) {
                            hasRealContent = true;
                        }
                        onEvent(normalized);
                    }
                }

                if (toolRequests.length === 0) {
                    logger.debug(`✅ Interaction complete after ${turnCount} turns.`);
                    // Emit final done event
                    onEvent({
                        type: 'done',
                        usageStats: finalUsageStats
                            ? {
                                  inputTokens: finalUsageStats.promptTokenCount || 0,
                                  outputTokens: finalUsageStats.candidatesTokenCount || 0,
                                  cachedTokens: finalUsageStats.cachedContentTokenCount || 0
                              }
                            : undefined,
                        sessionId: sid
                    });
                    break;
                }

                logger.debug(`🛠️ Executing ${toolRequests.length} tool calls...`);

                // Execute tools using Scheduler
                const scheduler = new Scheduler({
                    config: this.coreConfig,
                    messageBus: this.coreConfig.getMessageBus(),
                    getPreferredEditor: () => undefined,
                    schedulerId: sid
                });

                const completedCalls = await scheduler.schedule(
                    toolRequests,
                    abortController.signal
                );

                // Emit tool responses so the Supervisor can log them
                for (const call of completedCalls) {
                    const normalized = this.normalizeEvent(
                        {
                            type: GeminiEventType.ToolCallResponse,
                            value: call
                        } as any,
                        sid
                    );
                    if (normalized) onEvent(normalized);
                }

                // Record results in chat recording service for persistence/memory
                const model = this.tarsConfig.geminiModel;
                this.client.getChat().recordCompletedToolCalls(model, completedCalls);

                // Prepare next request with tool results
                currentRequestParts = completedCalls
                    .map((call) => {
                        // Extract the functionResponse part
                        return call.response.responseParts.find(
                            (p) => 'functionResponse' in (p as any)
                        ) as any;
                    })
                    .filter(Boolean);

                if (currentRequestParts.length === 0) {
                    logger.warn('⚠️ No tool responses generated after execution.');
                    break;
                }
            }
        } catch (error: any) {
            logger.error(`❌ Gemini Engine run error: ${error.message}`);
            onEvent({ type: 'error', error: error.message });
            throw error;
        } finally {
            process.env.HOME = savedHome;
        }
    }

    /**
     * Synchronous-style run for background tasks.
     */
    public async runSync(prompt: string, sessionId?: string): Promise<string> {
        let fullContent = '';
        await this.run(
            prompt,
            (event) => {
                if (event.content && event.role === 'assistant') {
                    fullContent += event.content;
                }
            },
            sessionId
        );
        return fullContent;
    }

    /**
     * Maps native core events to Tars-compatible event format.
     */
    private normalizeEvent(
        event: ServerGeminiStreamEvent,
        sessionId: string
    ): GeminiEngineEvent | null {
        switch (event.type) {
            case GeminiEventType.Content:
                return {
                    type: 'text',
                    role: 'assistant',
                    content: event.value,
                    sessionId
                };

            case GeminiEventType.Thought:
                // ThoughtSummary has subject and description
                const thoughtText = event.value.subject
                    ? `**${event.value.subject}** ${event.value.description}`
                    : event.value.description;

                return {
                    type: 'thought',
                    content: thoughtText,
                    sessionId
                };

            case GeminiEventType.ToolCallRequest:
                return {
                    type: 'tool_call',
                    toolName: event.value.name,
                    toolArgs: event.value.args,
                    sessionId
                };

            case GeminiEventType.ToolCallResponse:
                // resultDisplay can be string | FileDiff | AnsiOutput | TodoList
                const display = event.value.resultDisplay;
                let content = '';

                if (typeof display === 'string') {
                    content = display;
                } else if (display) {
                    content = JSON.stringify(display);
                } else if (event.value.error) {
                    content = event.value.error.message;
                }

                return {
                    type: 'tool_response',
                    toolName: event.value.callId,
                    content,
                    sessionId
                };

            case GeminiEventType.Finished:
                return {
                    type: 'done',
                    usageStats: event.value.usageMetadata
                        ? {
                              inputTokens: event.value.usageMetadata.promptTokenCount || 0,
                              outputTokens: event.value.usageMetadata.candidatesTokenCount || 0,
                              cachedTokens: event.value.usageMetadata.cachedContentTokenCount || 0
                          }
                        : undefined,
                    sessionId
                };

            case GeminiEventType.Error:
                return {
                    type: 'error',
                    error: event.value instanceof Error ? event.value.message : String(event.value),
                    sessionId
                };

            default:
                return null;
        }
    }

    /**
     * Attempts to find and load session history from the Core's history directory.
     */
    private async loadResumedSessionData(sessionId: string): Promise<any | null> {
        try {
            // Core history is usually in ~/.gemini/tmp/<hash>/chats/
            // But we isolated HOME to ~/.tars, so it's in ~/.tars/.gemini/...
            const projectRoot = this.tarsConfig.homeDir;
            // Native core uses project root hash as subdirectory
            const crypto = await import('node:crypto');
            const projectHash = crypto.createHash('md5').update(projectRoot).digest('hex');

            const chatsDir = path.join(
                this.tarsConfig.homeDir,
                '.gemini',
                'tmp',
                projectHash,
                'chats'
            );
            if (!fs.existsSync(chatsDir)) return null;

            const files = fs.readdirSync(chatsDir);
            // File pattern: session-YYYY-MM-DDTHH-MM-8CHARS.json
            // We search for matches containing our session ID prefix
            const shortId = sessionId.slice(0, 8);
            const sessionFile = files.find((f) => f.includes(`-${shortId}.json`));

            if (!sessionFile) return null;

            const filePath = path.join(chatsDir, sessionFile);
            const content = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

            return {
                conversation: content,
                filePath
            };
        } catch (e) {
            logger.warn(`⚠️ Failed to load resumed session data: ${e}`);
            return null;
        }
    }
}
