import {
    Agent,
    type AgentEvent,
    type AgentMessage,
    type AgentOptions
} from '@earendil-works/pi-agent-core';
import {
    getModels,
    type Api,
    type KnownProvider,
    type Model,
    type Message
} from '@earendil-works/pi-ai';
import type { ImageContent } from '@earendil-works/pi-ai/base';
import {
    createCodingTools,
    loadSkills,
    formatSkillsForPrompt
} from '@earendil-works/pi-coding-agent';
import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { type Config as TarsConfig } from '../config/config.js';
import logger from '../utils/logger.js';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import path from 'path';

import { type AttachmentContext, type TarsEvent } from '../types/index.js';

import { SendNotificationTool, type NotificationChannel } from '../tools/send-notification.js';
import { ManageTarsTool } from '../tools/manage-tars.js';
import { routeMcpTools } from '../tools/mcp-tool-router.js';

import { SessionIdSchema, type SessionManager } from './session-manager.js';
import { LocalRateLimiter } from './rate-limiter.js';
import { McpBridge } from './mcp-bridge.js';
import { DLPService } from '../utils/dlp-service.js';

export type TarsEngineEvent = TarsEvent;

export type TarsEngineOutputHandler = (event: TarsEngineEvent) => unknown | Promise<unknown>;

interface EngineRunOptions {
    readonly allowNotifications?: boolean;
    readonly ephemeral?: boolean;
}

/**
 * Snapshot of a completed tool call for status reporting.
 */
export interface ToolStatus {
    id?: string;
    name: string;
    status: 'running' | 'completed';
    responsePreview?: string;
    responseSize?: number; // bytes/chars
}

/**
 * Callback signature for live status updates during long-running tasks.
 */
export type StatusUpdateHandler = (
    turnCount: number,
    recentTools: ToolStatus[],
    isMilestone: boolean
) => void | Promise<void>;

type AgentFactory = (options: AgentOptions) => Agent;
type RuntimeTool = NonNullable<NonNullable<AgentOptions['initialState']>['tools']>[number];

function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function extractTextContent(content: unknown): string {
    if (typeof content === 'string') return content;
    if (!Array.isArray(content)) return '';

    return content
        .map((part: unknown) => {
            if (typeof part !== 'object' || part === null) return '';
            const text = Reflect.get(part, 'text');
            return typeof text === 'string' ? text : '';
        })
        .filter(Boolean)
        .join('\n');
}

function estimateSerializedCharacters(value: unknown): number {
    if (typeof value === 'string') return value.length;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value).length;
    if (Array.isArray(value)) {
        return value.reduce((total, item) => total + estimateSerializedCharacters(item), 0);
    }
    if (typeof value !== 'object' || value === null) return 0;

    const isImage = Reflect.get(value, 'type') === 'image';
    return Object.entries(value).reduce((total, [key, nestedValue]) => {
        if (isImage && key === 'data') return total + 4_000;
        if (['details', 'usage', 'timestamp'].includes(key)) return total;
        return total + key.length + estimateSerializedCharacters(nestedValue);
    }, 0);
}

const TimestampSchema = z.number().finite().nonnegative();
const TextContentSchema = z
    .object({
        type: z.literal('text'),
        text: z.string(),
        textSignature: z.string().optional()
    })
    .passthrough();
const ImageContentSchema = z
    .object({
        type: z.literal('image'),
        data: z.string(),
        mimeType: z.string()
    })
    .passthrough();
const ThinkingContentSchema = z
    .object({
        type: z.literal('thinking'),
        thinking: z.string(),
        thinkingSignature: z.string().optional(),
        redacted: z.boolean().optional()
    })
    .passthrough();
const ToolCallSchema = z
    .object({
        type: z.literal('toolCall'),
        id: z.string(),
        name: z.string(),
        arguments: z.record(z.unknown()),
        thoughtSignature: z.string().optional()
    })
    .passthrough();
const UsageSchema = z
    .object({
        input: z.number().finite().nonnegative(),
        output: z.number().finite().nonnegative(),
        cacheRead: z.number().finite().nonnegative(),
        cacheWrite: z.number().finite().nonnegative(),
        cacheWrite1h: z.number().finite().nonnegative().optional(),
        totalTokens: z.number().finite().nonnegative(),
        cost: z
            .object({
                input: z.number().finite().nonnegative(),
                output: z.number().finite().nonnegative(),
                cacheRead: z.number().finite().nonnegative(),
                cacheWrite: z.number().finite().nonnegative(),
                total: z.number().finite().nonnegative()
            })
            .passthrough()
    })
    .passthrough();
const AssistantDiagnosticSchema = z
    .object({
        type: z.string(),
        timestamp: TimestampSchema,
        error: z
            .object({
                name: z.string().optional(),
                message: z.string(),
                stack: z.string().optional(),
                code: z.union([z.string(), z.number()]).optional()
            })
            .passthrough()
            .optional(),
        details: z.record(z.unknown()).optional()
    })
    .passthrough();
const UserMessageSchema = z
    .object({
        role: z.literal('user'),
        content: z.union([z.string(), z.array(z.union([TextContentSchema, ImageContentSchema]))]),
        timestamp: TimestampSchema
    })
    .passthrough();
const AssistantMessageSchema = z
    .object({
        role: z.literal('assistant'),
        content: z.array(z.union([TextContentSchema, ThinkingContentSchema, ToolCallSchema])),
        api: z.string(),
        provider: z.string(),
        model: z.string(),
        responseModel: z.string().optional(),
        responseId: z.string().optional(),
        diagnostics: z.array(AssistantDiagnosticSchema).optional(),
        usage: UsageSchema,
        stopReason: z.enum(['stop', 'length', 'toolUse', 'error', 'aborted']),
        errorMessage: z.string().optional(),
        timestamp: TimestampSchema
    })
    .passthrough();
const ToolResultMessageSchema = z
    .object({
        role: z.literal('toolResult'),
        toolCallId: z.string(),
        toolName: z.string(),
        content: z.array(z.union([TextContentSchema, ImageContentSchema])),
        details: z.unknown().optional(),
        isError: z.boolean(),
        timestamp: TimestampSchema
    })
    .passthrough();
const AgentHistorySchema: z.ZodType<AgentMessage[]> = z.array(
    z.discriminatedUnion('role', [
        UserMessageSchema,
        AssistantMessageSchema,
        ToolResultMessageSchema
    ])
);
const LegacyContentPartSchema = z.object({ text: z.string().optional() }).passthrough();
const LegacyToolCallSchema = z
    .object({
        id: z.string().optional(),
        callId: z.string().optional(),
        name: z.string(),
        args: z.record(z.string(), z.unknown()).optional(),
        status: z.string().optional(),
        result: z.unknown().optional(),
        isError: z.boolean().optional()
    })
    .passthrough();
const LegacyMessageSchema = z
    .object({
        type: z.enum(['user', 'gemini']),
        content: z.union([z.string(), z.array(LegacyContentPartSchema)]).optional(),
        toolCalls: z.array(LegacyToolCallSchema).optional(),
        timestamp: TimestampSchema.optional()
    })
    .passthrough();
const LegacyConversationSchema = z.object({ messages: z.array(z.unknown()) });
const LegacyProjectRegistrySchema = z.object({
    projects: z.record(z.string(), z.string())
});

interface ResumedSessionData {
    conversation: unknown;
    filePath: string;
}

type BuiltInProvider = Extract<KnownProvider, 'google' | 'openai' | 'anthropic'>;

function isBuiltInProvider(provider: string): provider is BuiltInProvider {
    return provider === 'google' || provider === 'openai' || provider === 'anthropic';
}

export function parseAgentHistory(value: unknown): AgentMessage[] {
    return AgentHistorySchema.parse(value);
}

export function resolveSessionHistoryPath(chatsDir: string, sessionId: string): string {
    const safeSessionId = SessionIdSchema.parse(sessionId);
    const resolvedChatsDir = path.resolve(chatsDir);
    const candidate = path.resolve(resolvedChatsDir, `${safeSessionId}.json`);
    if (path.dirname(candidate) !== resolvedChatsDir) {
        throw new Error('Session history path escapes the chats directory');
    }
    return candidate;
}

/**
 * TarsEngine - Wraps the Pi Agent SDK as a drop-in replacement.
 *
 * Interacts with configured providers (Google, OpenAI, Anthropic, or Custom).
 * Operates within the ~/.tars isolated environment.
 */
export class TarsEngine extends EventEmitter {
    private initialized = false;
    private currentSessionId: string | null = null;
    private channelManager?: NotificationChannel;
    private sessionManager?: SessionManager;
    private rateLimiter: LocalRateLimiter;
    private mcpBridge!: McpBridge;
    private allTools: RuntimeTool[] = [];
    public activeTools: ToolStatus[] = [];

    constructor(
        private readonly tarsConfig: TarsConfig,
        private readonly agentFactory: AgentFactory = (options) => new Agent(options)
    ) {
        super();
        this.rateLimiter = new LocalRateLimiter(
            tarsConfig.maxRPM || 14,
            tarsConfig.maxTPM || 900000
        );
    }

    /**
     * Provide the ChannelManager instance to the engine so it can build proactive notification tools
     */
    public setChannelManager(channelManager: NotificationChannel): void {
        this.channelManager = channelManager;
    }

    /**
     * Provide the SessionManager instance to the engine for session-aware tools
     */
    public setSessionManager(sessionManager: SessionManager): void {
        this.sessionManager = sessionManager;
    }

    /**
     * Initializes the Tars Engine and discovers MCP extensions.
     */
    public async initialize(initialSessionId?: string): Promise<void> {
        if (this.initialized) return;

        logger.info('🚀 Initializing Tars Engine...');

        if (!fs.existsSync(this.tarsConfig.homeDir)) {
            fs.mkdirSync(this.tarsConfig.homeDir, { recursive: true });
        }

        // Initialize MCP bridge
        this.mcpBridge = new McpBridge(this.tarsConfig.homeDir);
        let mcpTools: RuntimeTool[] = [];
        try {
            mcpTools = await this.mcpBridge.initialize();
            logger.info(`🔌 Loaded ${mcpTools.length} MCP tools.`);
        } catch (error: unknown) {
            logger.error(`⚠️ Failed to initialize MCP bridge: ${getErrorMessage(error)}`);
        }

        // Gather native tools
        const routedMcpTools = routeMcpTools(mcpTools);
        const nativeTools: RuntimeTool[] = [
            new ManageTarsTool(this.tarsConfig) as RuntimeTool,
            ...(routedMcpTools.routerTools as RuntimeTool[])
        ];
        if (routedMcpTools.routerTools.length > 0) {
            logger.info(
                `🔌 Exposed ${routedMcpTools.directTools.length} core MCP tools directly and ${mcpTools.length - routedMcpTools.directTools.length} through the extension catalog.`
            );
        }
        if (this.channelManager) {
            nativeTools.push(new SendNotificationTool(this.channelManager) as RuntimeTool);
            logger.info('🔌 Registered native tool: send_notification');
        }

        // Gather coding tools
        let codingTools: RuntimeTool[] = [];
        try {
            codingTools = createCodingTools(this.tarsConfig.homeDir);
            logger.info(`🔌 Loaded ${codingTools.length} standard coding tools.`);
        } catch (error: unknown) {
            logger.error(`⚠️ Failed to initialize coding tools: ${getErrorMessage(error)}`);
        }

        this.allTools = [
            ...(routedMcpTools.directTools as RuntimeTool[]),
            ...nativeTools,
            ...codingTools
        ];
        this.initialized = true;
        this.currentSessionId = initialSessionId || uuidv4();
        logger.info('✨ Tars Engine initialized successfully.');
    }

    /**
     * Resets the active session ID to null so a new one is generated on the next run.
     */
    public resetSession(): void {
        this.currentSessionId = null;
    }

    /**
     * Returns the API key mapped to the provider name from process.env.
     */
    private getApiKeyForProvider(providerName: string): string | undefined {
        if (providerName === 'google')
            return process.env.TARS_API_KEY || process.env.GEMINI_API_KEY;
        if (providerName === 'openai') return process.env.OPENAI_API_KEY;
        if (providerName === 'anthropic') return process.env.ANTHROPIC_API_KEY;
        if (providerName === 'local' || providerName === 'local-stark')
            return process.env.LOCAL_API_KEY || process.env.STARK_API_KEY || 'none';
        if (providerName === 'custom') return process.env.CUSTOM_API_KEY || 'none';
        if (providerName === this.tarsConfig.piProvider) {
            if (this.tarsConfig.piProvider === 'google')
                return process.env.TARS_API_KEY || process.env.GEMINI_API_KEY;
            if (this.tarsConfig.piProvider === 'openai') return process.env.OPENAI_API_KEY;
            if (this.tarsConfig.piProvider === 'anthropic') return process.env.ANTHROPIC_API_KEY;
            if (
                this.tarsConfig.piProvider === 'local' ||
                this.tarsConfig.piProvider === 'local-stark'
            )
                return process.env.LOCAL_API_KEY || process.env.STARK_API_KEY || 'none';
            if (this.tarsConfig.piProvider === 'custom')
                return process.env.CUSTOM_API_KEY || 'none';
        }
        return undefined;
    }

    private createModel(): Model<Api> {
        const provider = this.tarsConfig.piProvider;
        if (isBuiltInProvider(provider) && !this.tarsConfig.piBaseUrl) {
            const model = getModels(provider).find(({ id }) => id === this.tarsConfig.piModel);
            if (!model) {
                throw new Error(`Unknown ${provider} model: ${this.tarsConfig.piModel}`);
            }
            return model;
        }

        return {
            id: this.tarsConfig.piModel,
            name: this.tarsConfig.piModel,
            api: provider === 'google' ? 'google-generative-ai' : 'openai-completions',
            provider: provider || 'custom',
            baseUrl:
                this.tarsConfig.piBaseUrl ||
                (provider === 'google'
                    ? 'https://generativelanguage.googleapis.com'
                    : 'https://api.openai.com/v1'),
            reasoning: false,
            input: ['text'],
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            contextWindow: this.tarsConfig.contextWindowTokens || 128000,
            maxTokens: 32000
        };
    }

    /**
     * Resolves the full system prompt by reading the base system prompt file
     * and appending the formatted available skills prompt block.
     */
    private getSystemPrompt(): string {
        const systemPromptPath = this.tarsConfig.systemPromptPath;
        let systemPrompt = '';
        if (fs.existsSync(systemPromptPath)) {
            systemPrompt = fs.readFileSync(systemPromptPath, 'utf-8');
        }

        try {
            const { skills } = loadSkills({
                cwd: process.cwd(),
                agentDir: this.tarsConfig.homeDir,
                skillPaths: [],
                includeDefaults: true
            });
            if (skills.length > 0) {
                const skillsPrompt = formatSkillsForPrompt(skills);
                systemPrompt += skillsPrompt;
            }
        } catch (error: unknown) {
            logger.warn(`⚠️ Failed to load skills: ${getErrorMessage(error)}`);
        }

        return systemPrompt;
    }

    /**
     * Executes the conversational agent loop using the Pi Agent SDK.
     */
    public async run(
        prompt: string,
        onEvent: TarsEngineOutputHandler,
        sessionId?: string,
        attachments?: AttachmentContext[],
        onStatus?: StatusUpdateHandler,
        options: EngineRunOptions = {}
    ): Promise<void> {
        if (!this.initialized) {
            await this.initialize(sessionId);
        }

        const sid = SessionIdSchema.parse(sessionId || this.currentSessionId || uuidv4());
        if (!options.ephemeral) this.currentSessionId = sid;

        // Load history messages
        const history = options.ephemeral ? [] : await this.loadHistory(sid);

        // Get system prompt (with skills protocol appended if available)
        const systemPrompt = this.getSystemPrompt();

        const model = this.createModel();

        // Build target Agent
        const tools =
            options.allowNotifications === false
                ? this.allTools.filter(({ name }) => name !== 'send_notification')
                : this.allTools;
        const agent = this.agentFactory({
            sessionId: sid,
            initialState: {
                systemPrompt,
                model,
                tools,
                messages: history
            },
            getApiKey: (providerName) => this.getApiKeyForProvider(providerName)
        });

        // Track tool executions for status reporting
        this.activeTools = [];
        let turnCount = 0;

        // Subscribe to agent event stream
        agent.subscribe(async (event: AgentEvent) => {
            try {
                if (event.type === 'message_update') {
                    const ame = event.assistantMessageEvent;
                    if (ame.type === 'text_delta') {
                        await onEvent({
                            type: 'text',
                            role: 'assistant',
                            content: ame.delta,
                            sessionId: sid
                        });
                    } else if (ame.type === 'thinking_delta') {
                        await onEvent({
                            type: 'thought',
                            content: ame.delta,
                            sessionId: sid
                        });
                    }
                } else if (event.type === 'tool_execution_start') {
                    await onEvent({
                        type: 'tool_call',
                        toolName: event.toolName,
                        toolArgs: event.args,
                        callId: event.toolCallId,
                        sessionId: sid
                    });

                    this.activeTools.push({
                        id: event.toolCallId,
                        name: event.toolName,
                        status: 'running'
                    });

                    if (onStatus) {
                        await onStatus(
                            turnCount,
                            this.activeTools.slice(-10),
                            turnCount % 20 === 0
                        );
                    }
                } else if (event.type === 'tool_execution_end') {
                    const responseStr =
                        typeof event.result === 'string'
                            ? event.result
                            : typeof event.result === 'object'
                              ? JSON.stringify(event.result)
                              : String(event.result || '');

                    await onEvent({
                        type: 'tool_response',
                        toolName: event.toolCallId,
                        content: responseStr,
                        sessionId: sid
                    });

                    let cleanPreview = responseStr;
                    try {
                        const parsed: unknown = JSON.parse(responseStr);
                        if (
                            typeof parsed === 'object' &&
                            parsed !== null &&
                            'content' in parsed &&
                            Array.isArray(parsed.content)
                        ) {
                            cleanPreview = parsed.content
                                .filter(
                                    (contentPart: unknown): contentPart is { text: string } =>
                                        typeof contentPart === 'object' &&
                                        contentPart !== null &&
                                        Reflect.get(contentPart, 'type') === 'text' &&
                                        typeof Reflect.get(contentPart, 'text') === 'string'
                                )
                                .map((contentPart) => contentPart.text)
                                .join(' ');
                        } else if (
                            typeof parsed === 'object' &&
                            parsed !== null &&
                            typeof Reflect.get(parsed, 'text') === 'string'
                        ) {
                            cleanPreview = String(Reflect.get(parsed, 'text'));
                        }
                    } catch {
                        // Plain-text tool results are already suitable for status previews.
                    }

                    cleanPreview = DLPService.scrubTextOrJson(cleanPreview);
                    const runningTool = this.activeTools.find((t) => t.id === event.toolCallId);
                    if (runningTool) {
                        runningTool.status = 'completed';
                        runningTool.responsePreview = cleanPreview.substring(0, 500);
                        runningTool.responseSize = responseStr.length;
                    } else {
                        this.activeTools.push({
                            id: event.toolCallId,
                            name: event.toolName,
                            status: 'completed',
                            responsePreview: cleanPreview.substring(0, 500),
                            responseSize: responseStr.length
                        });
                    }
                    turnCount++;

                    if (onStatus) {
                        await onStatus(
                            turnCount,
                            this.activeTools.slice(-10),
                            turnCount % 20 === 0
                        );
                    }
                }
            } catch (error: unknown) {
                const message = error instanceof Error ? error.message : String(error);
                logger.error(`Error in event stream mapping: ${message}`);
                throw error;
            }
        });

        // Prepare prompt with attachments. Image data is passed through the Pi
        // image channel; other files remain available to the coding tools by path.
        let promptText = prompt;
        const promptImages: ImageContent[] = [];
        if (attachments && attachments.length > 0) {
            for (const attachment of attachments) {
                try {
                    if (attachment.mimeType.startsWith('image/')) {
                        const data = await fs.promises.readFile(attachment.path, {
                            encoding: 'base64'
                        });
                        promptImages.push({ type: 'image', data, mimeType: attachment.mimeType });
                        logger.debug(`📎 Attached image to prompt: ${attachment.path}`);
                    } else {
                        promptText += `\n\n[Attached file: ${attachment.path} (${attachment.mimeType})]`;
                    }
                } catch (error: unknown) {
                    const message = error instanceof Error ? error.message : String(error);
                    logger.error(`Failed to read attachment ${attachment.path}: ${message}`);
                }
            }
        }

        let startIndex = history.length;

        try {
            // Pre-flight context size estimation to prevent context overflow errors
            let estimatedContextSize = this.estimateContextSize(history, systemPrompt);
            const maxContext = this.tarsConfig.contextWindowTokens || 128000;

            // Use centralized pre-flight threshold to leave adequate buffer for model responses
            if (
                !options.ephemeral &&
                estimatedContextSize > maxContext * this.tarsConfig.preflightCompressionThreshold
            ) {
                logger.info(
                    `🗜️ Pre-flight check: Context size (${estimatedContextSize.toLocaleString()} tokens) at ${((estimatedContextSize / maxContext) * 100).toFixed(1)}% of window. Triggering compression before execution.`
                );
                const compressed = await this.compressSession(true, sid);
                if (compressed) {
                    // Reload history after compression
                    const newHistory = await this.loadHistory(sid);
                    const newSystemPrompt = this.getSystemPrompt();
                    const newEstimatedSize = this.estimateContextSize(newHistory, newSystemPrompt);
                    logger.info(
                        `🗜️ Post-compression context size: ${newEstimatedSize.toLocaleString()} tokens`
                    );

                    // Update agent with compressed history
                    agent.state.messages = newHistory;
                    startIndex = newHistory.length;
                    estimatedContextSize = newEstimatedSize;
                }
            }

            const estimatedRequestTokens = Math.min(
                this.tarsConfig.maxTPM,
                estimatedContextSize + Math.ceil(promptText.length / 3.8)
            );
            await this.rateLimiter.acquire(estimatedRequestTokens, (waitMs) => {
                logger.info(
                    `⏳ Local provider limit reached; waiting ${Math.ceil(waitMs / 1000)}s`
                );
            });
            await agent.prompt(promptText, promptImages);

            const agentError = agent.state.errorMessage?.trim();
            if (agentError) {
                throw new Error(DLPService.scrub(agentError));
            }

            // Save history
            if (!options.ephemeral) await this.saveHistory(sid, agent.state.messages);

            // Sum usage stats from all newly added assistant messages in this turn
            let totalInput = 0;
            let totalOutput = 0;
            let totalCacheRead = 0;
            let lastInputTokens = 0;
            let lastOutputTokens = 0;

            const newMessages = agent.state.messages.slice(startIndex);
            for (const msg of newMessages) {
                if (msg.role === 'assistant' && msg.usage) {
                    const u = msg.usage;
                    totalInput += u.input || 0;
                    totalOutput += u.output || 0;
                    totalCacheRead += u.cacheRead || 0;

                    // The last assistant message represents the final active context size sent to the model
                    lastInputTokens = (u.input || 0) + (u.cacheRead || 0);
                    lastOutputTokens = u.output || 0;
                }
            }

            // Fallback if no usage was recorded or no new assistant messages
            const finalMessage = agent.state.messages[agent.state.messages.length - 1];
            if (
                totalInput === 0 &&
                finalMessage &&
                finalMessage.role === 'assistant' &&
                finalMessage.usage
            ) {
                const u = finalMessage.usage;
                totalInput = u.input || 0;
                totalOutput = u.output || 0;
                totalCacheRead = u.cacheRead || 0;
                lastInputTokens = (u.input || 0) + (u.cacheRead || 0);
                lastOutputTokens = u.output || 0;
            }

            const usageStats = {
                inputTokens: totalInput + totalCacheRead,
                outputTokens: totalOutput,
                cachedTokens: totalCacheRead,
                lastInputTokens,
                lastOutputTokens
            };

            await onEvent({
                type: 'done',
                usageStats,
                sessionId: sid
            });
        } catch (error: unknown) {
            const errorMessage = DLPService.scrub(getErrorMessage(error));
            logger.error(`❌ Pi Agent execution error: ${errorMessage}`);

            // Extract context size from error message if available
            const contextSizeMatch = errorMessage.match(/request \((\d{1,}) tokens\)/);
            const reportedTokens = contextSizeMatch ? parseInt(contextSizeMatch[1], 10) : 0;

            // Estimate current context size for session tracking even on error
            const estimatedContextSize = this.estimateContextSize(
                agent.state.messages,
                this.getSystemPrompt()
            );
            const contextSize = reportedTokens || estimatedContextSize;

            // Keep the context estimate current without recording rejected work as usage.
            if (!options.ephemeral && this.sessionManager && contextSize > 0) {
                try {
                    await this.sessionManager.updateContextEstimate(contextSize);
                    logger.info(
                        `📊 Updated context estimate after error: ${contextSize.toLocaleString()} tokens`
                    );
                } catch (updateErr) {
                    logger.warn(`⚠️ Failed to update context estimate after error: ${updateErr}`);
                }
            }

            throw error;
        }
    }

    /**
     * Executes a prompt synchronously and returns the model response.
     */
    public async runSync(
        prompt: string,
        sessionId?: string,
        options: EngineRunOptions = {}
    ): Promise<string> {
        let fullContent = '';
        await this.run(
            prompt,
            (event) => {
                if (event.content && event.role === 'assistant') {
                    fullContent += event.content;
                }
            },
            sessionId,
            undefined,
            undefined,
            options
        );
        return fullContent;
    }

    /**
     * Proactively compress the session history to reclaim context window space.
     * Summarizes older messages into a <state_snapshot> block.
     */
    public async compressSession(force: boolean = false, sessionId?: string): Promise<boolean> {
        const sid = sessionId || this.currentSessionId;
        if (!sid) return false;
        logger.info(`🗜️ Triggering session compression (force=${force})...`);
        try {
            const history = await this.loadHistory(sid);
            const estimatedTokens = this.estimateContextSize(history, this.getSystemPrompt());
            const shouldCompress =
                force ||
                estimatedTokens >=
                    this.tarsConfig.contextWindowTokens * this.tarsConfig.compressionThreshold;

            if (shouldCompress && history.length >= 4) {
                const keepCount = Math.max(2, Math.ceil(history.length * 0.6));
                let cutIndex = history.length - keepCount;

                // Walk forward to find a 'user' role entry for clean boundary
                while (cutIndex < history.length && history[cutIndex]?.role !== 'user') {
                    cutIndex++;
                }

                if (cutIndex >= history.length) {
                    cutIndex = history.length - keepCount;
                }

                if (cutIndex > 0 && cutIndex < history.length) {
                    const historyToCompress = history.slice(0, cutIndex);
                    const tail = history.slice(cutIndex);

                    logger.info(`🗜️ Summarizing oldest ${historyToCompress.length} turns...`);

                    const hasPreviousSnapshot = historyToCompress.some((message) =>
                        extractTextContent(Reflect.get(message, 'content')).includes(
                            '<state_snapshot>'
                        )
                    );

                    const anchorInstruction = hasPreviousSnapshot
                        ? 'A previous <state_snapshot> exists in the history. You MUST integrate all still-relevant information from that snapshot into the new one, updating it with the more recent events.'
                        : 'Generate a new <state_snapshot> based on the provided history.';

                    const summaryPrompt = `${anchorInstruction}\nExtract all important constraints, configs, details and tool results from this chunk of history. Format your response cleanly.`;

                    const model = this.createModel();

                    // Convert historyToCompress to Message[] for streamSimple
                    const llmMessages = historyToCompress.filter((m) =>
                        ['user', 'assistant', 'toolResult'].includes(m.role)
                    ) as Message[];
                    llmMessages.push({
                        role: 'user',
                        content: summaryPrompt,
                        timestamp: Date.now()
                    });

                    const { streamSimple } = await import('@earendil-works/pi-ai/base');
                    const apiKey = this.getApiKeyForProvider(model.provider);
                    const stream = streamSimple(model, { messages: llmMessages }, { apiKey });

                    let summaryContent = '';
                    for await (const event of stream) {
                        if (event.type === 'text_delta') {
                            summaryContent += event.delta;
                        }
                    }

                    if (!summaryContent.trim()) {
                        logger.warn(
                            '⚠️ Compression produced no summary; preserving original history'
                        );
                        return false;
                    }

                    const newHistory: AgentMessage[] = [
                        {
                            role: 'user',
                            content: `<state_snapshot>\n${summaryContent.trim()}\n</state_snapshot>`,
                            timestamp: Date.now()
                        },
                        {
                            role: 'assistant',
                            content: [
                                {
                                    type: 'text',
                                    text: 'Got it. I will keep this historical context in mind.'
                                }
                            ],
                            api: model.api,
                            provider: model.provider,
                            model: model.id,
                            usage: {
                                input: 0,
                                output: 0,
                                cacheRead: 0,
                                cacheWrite: 0,
                                totalTokens: 0,
                                cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
                            },
                            stopReason: 'stop',
                            timestamp: Date.now()
                        },
                        ...tail
                    ];

                    await this.saveHistory(sid, newHistory);
                    logger.info(
                        `🗜️ Context compacted: retained tail of ${tail.length} turns + snapshot.`
                    );

                    const estimatedTokens = this.estimateContextSize(
                        newHistory,
                        this.getSystemPrompt()
                    );
                    if (this.sessionManager) {
                        await this.sessionManager.updateTokensAfterCompression(estimatedTokens);
                    }

                    return true;
                }
            }
            return false;
        } catch (error: unknown) {
            logger.warn(`⚠️ Compression failed: ${getErrorMessage(error)}`);
            return false;
        }
    }

    /**
     * Refreshes the system instruction in-place.
     */
    public refreshSystemInstruction(): void {
        logger.debug(
            '🔄 System instruction refreshed in-place (Pi SDK will load fresh content on next run)'
        );
    }

    /**
     * Attempts to find and load session history from either the Pi chats directory
     * or the legacy Core history directory.
     */
    private async loadHistory(sessionId: string): Promise<AgentMessage[]> {
        const chatsDir = path.join(this.tarsConfig.homeDir, 'chats');
        const newChatPath = resolveSessionHistoryPath(chatsDir, sessionId);

        if (fs.existsSync(newChatPath)) {
            try {
                logger.info(`📂 Loading session history from Pi format: ${newChatPath}`);
                const data = await fs.promises.readFile(newChatPath, 'utf-8');
                const parsed: unknown = JSON.parse(data);
                return parseAgentHistory(parsed);
            } catch (error: unknown) {
                const message = DLPService.scrub(getErrorMessage(error));
                throw new Error(
                    `Session history is invalid and was preserved unchanged (${newChatPath}): ${message}`
                );
            }
        }

        // Fallback: load and migrate from legacy format
        const resumedData = await this.loadResumedSessionData(sessionId);
        if (resumedData && resumedData.conversation) {
            logger.info(`📂 Migrating legacy session to Pi format...`);
            const migrated = this.migrateLegacyConversation(resumedData.conversation);
            await this.saveHistory(sessionId, migrated);
            return migrated;
        }

        return [];
    }

    /**
     * Saves session history to the Pi chats directory.
     */
    private async saveHistory(sessionId: string, messages: AgentMessage[]): Promise<void> {
        const chatsDir = path.join(this.tarsConfig.homeDir, 'chats');
        if (!fs.existsSync(chatsDir)) {
            await fs.promises.mkdir(chatsDir, { recursive: true });
        }
        const filePath = resolveSessionHistoryPath(chatsDir, sessionId);
        const tempPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
        try {
            await fs.promises.writeFile(tempPath, JSON.stringify(messages, null, 2), {
                encoding: 'utf-8',
                mode: 0o600
            });
            await fs.promises.rename(tempPath, filePath);
        } catch (err) {
            await fs.promises.unlink(tempPath).catch(() => undefined);
            logger.error(`Failed to save session history: ${err}`);
            throw err;
        }
    }

    /**
     * Helper to load legacy conversation records.
     */
    private async loadConversationRecord(filePath: string): Promise<unknown> {
        const content = await fs.promises.readFile(filePath, 'utf-8');
        try {
            return JSON.parse(content);
        } catch {
            const lines = content.split('\n').filter(Boolean);
            const messages = lines.map((line) => JSON.parse(line));
            return { messages };
        }
    }

    /**
     * Converts a legacy ConversationRecord to Pi SDK AgentMessage[] format.
     */
    private migrateLegacyConversation(conversation: unknown): AgentMessage[] {
        const parsed = LegacyConversationSchema.safeParse(conversation);
        if (!parsed.success) return [];

        const messages: unknown[] = [];

        for (const value of parsed.data.messages) {
            const legacyMessage = LegacyMessageSchema.safeParse(value);
            if (!legacyMessage.success) continue;
            const msg = legacyMessage.data;
            if (msg.type === 'user') {
                let content: string | Array<{ type: 'text'; text: string }> = '';
                if (typeof msg.content === 'string') {
                    content = msg.content;
                } else if (Array.isArray(msg.content)) {
                    content = msg.content.map((part) => ({
                        type: 'text',
                        text: part.text ?? ''
                    }));
                }
                messages.push({
                    role: 'user',
                    content,
                    timestamp: msg.timestamp ?? Date.now()
                });
            } else if (msg.type === 'gemini') {
                const contentParts: unknown[] = [];
                const toolResultMessages: unknown[] = [];
                if (typeof msg.content === 'string' && msg.content !== '') {
                    contentParts.push({ type: 'text', text: msg.content });
                } else if (Array.isArray(msg.content)) {
                    for (const part of msg.content) {
                        if (part.text) {
                            contentParts.push({ type: 'text', text: part.text });
                        }
                    }
                }

                if (msg.toolCalls) {
                    for (const tc of msg.toolCalls) {
                        const callId = tc.id || tc.callId || `call-${randomUUID()}`;
                        contentParts.push({
                            type: 'toolCall',
                            id: callId,
                            name: tc.name,
                            arguments: tc.args || {}
                        });

                        if (tc.status === 'done' || tc.result) {
                            let responseObj = tc.result;
                            if (typeof responseObj === 'string') {
                                try {
                                    responseObj = JSON.parse(responseObj);
                                } catch {
                                    responseObj = { result: responseObj };
                                }
                            }
                            const responseContent =
                                typeof responseObj === 'object'
                                    ? JSON.stringify(responseObj)
                                    : String(responseObj);

                            toolResultMessages.push({
                                role: 'toolResult',
                                toolCallId: callId,
                                toolName: tc.name,
                                content: [{ type: 'text', text: responseContent }],
                                details: responseObj,
                                isError: tc.isError || false,
                                timestamp: msg.timestamp ?? Date.now()
                            });
                        }
                    }
                }

                messages.push({
                    role: 'assistant',
                    content: contentParts,
                    api: 'openai-completions',
                    provider: this.tarsConfig.piProvider || 'custom',
                    model: this.tarsConfig.piModel,
                    usage: {
                        input: 0,
                        output: 0,
                        cacheRead: 0,
                        cacheWrite: 0,
                        totalTokens: 0,
                        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
                    },
                    stopReason: 'stop',
                    timestamp: msg.timestamp ?? Date.now()
                });

                if (toolResultMessages.length > 0) {
                    messages.push(...toolResultMessages);
                }
            }
        }
        return parseAgentHistory(messages);
    }

    /**
     * Attempts to find and load legacy session history.
     */
    private async loadResumedSessionData(sessionId: string): Promise<ResumedSessionData | null> {
        try {
            const geminiDir = path.join(this.tarsConfig.homeDir, '.gemini');
            const tmpDir = path.join(geminiDir, 'tmp');

            if (!fs.existsSync(tmpDir)) return null;

            let projectIdentifier: string | null = null;
            const registryPath = path.join(geminiDir, 'projects.json');
            if (fs.existsSync(registryPath)) {
                try {
                    const registry = LegacyProjectRegistrySchema.parse(
                        JSON.parse(fs.readFileSync(registryPath, 'utf-8'))
                    );
                    projectIdentifier = registry.projects[this.tarsConfig.homeDir] || null;
                } catch (e) {
                    logger.warn(`⚠️ Failed to read projects.json: ${e}`);
                }
            }

            if (!projectIdentifier) {
                const crypto = await import('node:crypto');
                projectIdentifier = crypto
                    .createHash('md5')
                    .update(this.tarsConfig.homeDir)
                    .digest('hex');
            }

            const shortId = sessionId.slice(0, 8);
            if (projectIdentifier) {
                const chatsDir = path.join(tmpDir, projectIdentifier, 'chats');
                if (!fs.existsSync(chatsDir)) return null;
                const files = fs.readdirSync(chatsDir);
                const sessionFile = files.find((f) => f.includes(`-${shortId}.json`));

                if (sessionFile) {
                    const filePath = path.join(chatsDir, sessionFile);
                    const content = await this.loadConversationRecord(filePath);
                    logger.info(`📂 Resumed session from exact match: ${sessionFile}`);
                    return {
                        conversation: content,
                        filePath
                    };
                }
            }

            return null;
        } catch (e) {
            logger.warn(`⚠️ Failed to load resumed session data: ${e}`);
            return null;
        }
    }

    /**
     * Estimates the token count of the current context (system prompt + history).
     * Uses a character-based approximation (1 token ≈ 3.8 chars for Qwen/Gemini).
     */
    private estimateContextSize(messages: AgentMessage[], systemPrompt: string): number {
        let totalChars = systemPrompt.length + this.estimateToolDefinitionCharacters();

        for (const msg of messages) {
            totalChars += estimateSerializedCharacters(msg);
        }

        // Qwen/Gemini tokenization: ~3.8 chars per token
        return Math.ceil(totalChars / 3.8);
    }

    private estimateToolDefinitionCharacters(): number {
        return this.allTools.reduce((total, tool) => {
            return (
                total +
                estimateSerializedCharacters({
                    description: tool.description,
                    name: tool.name,
                    parameters: tool.parameters
                })
            );
        }, 0);
    }

    /**
     * Closes the MCP client bridge connections.
     */
    public async shutdown(): Promise<void> {
        if (this.mcpBridge) {
            await this.mcpBridge.shutdown();
        }
    }
}
