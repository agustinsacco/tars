import { Agent, AgentEvent, AgentMessage, AgentTool } from '@earendil-works/pi-agent-core';
import { getModel, Model, Message, Usage } from '@earendil-works/pi-ai';
import { createCodingTools } from '@earendil-works/pi-coding-agent';
import { EventEmitter } from 'events';
import { Config as TarsConfig } from '../config/config.js';
import logger from '../utils/logger.js';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import path from 'path';

import { AttachmentContext } from '../types/index.js';

import { ChannelManager } from '../channels/channel-manager.js';
import { SendNotificationTool } from '../tools/send-notification.js';

import { SessionManager } from './session-manager.js';
import { LocalRateLimiter } from './rate-limiter.js';
import { McpBridge } from './mcp-bridge.js';

export interface TarsEngineEvent {
    type: string;
    role?: 'user' | 'assistant' | 'system';
    content?: string;
    toolName?: string;
    toolArgs?: any;
    callId?: string;
    usageStats?: {
        inputTokens: number;
        outputTokens: number;
        cachedTokens: number;
    };
    sessionId?: string;
    error?: string;
}

export type TarsEngineOutputHandler = (event: TarsEngineEvent) => void | Promise<void>;

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

/**
 * TarsEngine - Wraps the Pi Agent SDK as a drop-in replacement.
 *
 * Interacts with configured providers (Google, OpenAI, Anthropic, or Custom).
 * Operates within the ~/.tars isolated environment.
 */
export class TarsEngine extends EventEmitter {
    private initialized = false;
    private currentSessionId: string | null = null;
    private channelManager?: ChannelManager;
    private sessionManager?: SessionManager;
    private rateLimiter: LocalRateLimiter;
    private mcpBridge!: McpBridge;
    private allTools: AgentTool<any>[] = [];
    public activeTools: ToolStatus[] = [];

    constructor(private readonly tarsConfig: TarsConfig) {
        super();
        this.rateLimiter = new LocalRateLimiter(
            tarsConfig.maxRPM || 14,
            tarsConfig.maxTPM || 900000
        );
    }

    /**
     * Provide the ChannelManager instance to the engine so it can build proactive notification tools
     */
    public setChannelManager(channelManager: ChannelManager): void {
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
        let mcpTools: AgentTool<any>[] = [];
        try {
            mcpTools = await this.mcpBridge.initialize();
            logger.info(`🔌 Loaded ${mcpTools.length} MCP tools.`);
        } catch (err: any) {
            logger.error(`⚠️ Failed to initialize MCP bridge: ${err.message}`);
        }

        // Gather native tools
        const nativeTools: AgentTool<any>[] = [];
        if (this.channelManager) {
            nativeTools.push(new SendNotificationTool(this.channelManager) as any);
            logger.info('🔌 Registered native tool: send_notification');
        }

        // Gather coding tools
        let codingTools: AgentTool<any>[] = [];
        try {
            codingTools = createCodingTools(this.tarsConfig.homeDir) as any[];
            logger.info(`🔌 Loaded ${codingTools.length} standard coding tools.`);
        } catch (err: any) {
            logger.error(`⚠️ Failed to initialize coding tools: ${err.message}`);
        }

        this.allTools = [...mcpTools, ...nativeTools, ...codingTools];
        this.initialized = true;
        this.currentSessionId = initialSessionId || uuidv4();
        logger.info('✨ Tars Engine initialized successfully.');
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

    /**
     * Executes the conversational agent loop using the Pi Agent SDK.
     */
    public async run(
        prompt: string,
        onEvent: TarsEngineOutputHandler,
        sessionId?: string,
        attachments?: AttachmentContext[],
        onStatus?: StatusUpdateHandler
    ): Promise<void> {
        if (!this.initialized) {
            await this.initialize(sessionId);
        }

        const sid = sessionId || this.currentSessionId || uuidv4();
        this.currentSessionId = sid;

        // Load history messages
        const history = await this.loadHistory(sid);

        // Get system prompt
        const systemPromptPath = this.tarsConfig.systemPromptPath;
        let systemPrompt = '';
        if (fs.existsSync(systemPromptPath)) {
            systemPrompt = fs.readFileSync(systemPromptPath, 'utf-8');
        }

        // Construct model config
        let model: Model<any>;
        const isBuiltIn = ['google', 'openai', 'anthropic'].includes(this.tarsConfig.piProvider);
        if (isBuiltIn && !this.tarsConfig.piBaseUrl) {
            model = getModel(this.tarsConfig.piProvider as any, this.tarsConfig.piModel as any);
        } else {
            model = {
                id: this.tarsConfig.piModel,
                name: this.tarsConfig.piModel,
                api:
                    this.tarsConfig.piProvider === 'google'
                        ? 'google-generative-ai'
                        : 'openai-completions',
                provider: this.tarsConfig.piProvider || 'custom',
                baseUrl:
                    this.tarsConfig.piBaseUrl ||
                    (this.tarsConfig.piProvider === 'google'
                        ? 'https://generativelanguage.googleapis.com'
                        : 'https://api.openai.com/v1'),
                reasoning: false,
                input: ['text'],
                cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
                contextWindow: this.tarsConfig.contextWindowTokens || 128000,
                maxTokens: 32000
            };
        }

        // Build target Agent
        const agent = new Agent({
            initialState: {
                systemPrompt,
                model,
                tools: this.allTools,
                messages: history
            },
            getApiKey: (providerName) => this.getApiKeyForProvider(providerName)
        });

        // Track tool executions for status reporting
        this.activeTools = [];
        let turnCount = 0;

        // Subscribe to agent event stream
        agent.subscribe((event) => {
            try {
                if (event.type === 'message_update') {
                    const ame = event.assistantMessageEvent;
                    if (ame.type === 'text_delta') {
                        onEvent({
                            type: 'text',
                            role: 'assistant',
                            content: ame.delta,
                            sessionId: sid
                        });
                    } else if (ame.type === 'thinking_delta') {
                        onEvent({
                            type: 'thought',
                            content: ame.delta,
                            sessionId: sid
                        });
                    }
                } else if (event.type === 'tool_execution_start') {
                    onEvent({
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
                        onStatus(turnCount, this.activeTools.slice(-10), turnCount % 20 === 0);
                    }
                } else if (event.type === 'tool_execution_end') {
                    const responseStr =
                        typeof event.result === 'string'
                            ? event.result
                            : typeof event.result === 'object'
                              ? JSON.stringify(event.result)
                              : String(event.result || '');

                    onEvent({
                        type: 'tool_response',
                        toolName: event.toolCallId,
                        content: responseStr,
                        sessionId: sid
                    });

                    let cleanPreview = responseStr;
                    try {
                        const parsed = JSON.parse(responseStr);
                        if (parsed && Array.isArray(parsed.content)) {
                            cleanPreview = parsed.content
                                .filter((c: any) => c.type === 'text' && typeof c.text === 'string')
                                .map((c: any) => c.text)
                                .join(' ');
                        } else if (parsed && typeof parsed.text === 'string') {
                            cleanPreview = parsed.text;
                        }
                    } catch (e) {}

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
                        onStatus(turnCount, this.activeTools.slice(-10), turnCount % 20 === 0);
                    }
                }
            } catch (err: any) {
                logger.error(`Error in event stream mapping: ${err.message}`);
            }
        });

        // Prepare prompt with attachments if any
        let promptContent: string | any[] = prompt;
        if (attachments && attachments.length > 0) {
            const parts: any[] = [{ type: 'text', text: prompt }];
            for (const attachment of attachments) {
                try {
                    const data = fs.readFileSync(attachment.path).toString('base64');
                    parts.push({
                        type: 'image',
                        data,
                        mimeType: attachment.mimeType
                    });
                    logger.debug(`📎 Attached image to prompt: ${attachment.path}`);
                } catch (err: any) {
                    logger.error(`Failed to read attachment ${attachment.path}: ${err.message}`);
                }
            }
            promptContent = parts;
        }

        const startIndex = history.length;

        try {
            if (typeof promptContent === 'string') {
                await agent.prompt(promptContent);
            } else {
                await agent.prompt(promptContent as any);
            }

            // Save history
            await this.saveHistory(sid, agent.state.messages);

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
                    lastInputTokens = u.input || 0;
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
                lastInputTokens = u.input || 0;
                lastOutputTokens = u.output || 0;
            }

            const usageStats = {
                inputTokens: totalInput,
                outputTokens: totalOutput,
                cachedTokens: totalCacheRead,
                lastInputTokens,
                lastOutputTokens
            };

            onEvent({
                type: 'done',
                usageStats,
                sessionId: sid
            });
        } catch (err: any) {
            logger.error(`❌ Pi Agent execution error: ${err.message}`);
            onEvent({
                type: 'error',
                error: err.message,
                sessionId: sid
            });
            throw err;
        }
    }

    /**
     * Executes a prompt synchronously and returns the model response.
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
     * Proactively compress the session history to reclaim context window space.
     * Summarizes older messages into a <state_snapshot> block.
     */
    public async compressSession(force: boolean = false): Promise<boolean> {
        const sid = this.currentSessionId || 'unknown';
        logger.info(`🗜️ Triggering session compression (force=${force})...`);
        try {
            const history = await this.loadHistory(sid);
            if (history && history.length > 20) {
                const keepCount = Math.ceil(history.length * 0.6);
                let cutIndex = history.length - keepCount;

                // Walk forward to find a 'user' role entry for clean boundary
                while (cutIndex < history.length && history[cutIndex]?.role !== 'user') {
                    cutIndex++;
                }

                if (cutIndex < history.length) {
                    const historyToCompress = history.slice(0, cutIndex);
                    const tail = history.slice(cutIndex);

                    logger.info(`🗜️ Summarizing oldest ${historyToCompress.length} turns...`);

                    const hasPreviousSnapshot = historyToCompress.some((c: any) => {
                        if (typeof c.content === 'string') {
                            return c.content.includes('<state_snapshot>');
                        } else if (Array.isArray(c.content)) {
                            return c.content.some((part: any) =>
                                part.text?.includes('<state_snapshot>')
                            );
                        }
                        return false;
                    });

                    const anchorInstruction = hasPreviousSnapshot
                        ? 'A previous <state_snapshot> exists in the history. You MUST integrate all still-relevant information from that snapshot into the new one, updating it with the more recent events.'
                        : 'Generate a new <state_snapshot> based on the provided history.';

                    const summaryPrompt = `${anchorInstruction}\nExtract all important constraints, configs, details and tool results from this chunk of history. Format your response cleanly.`;

                    // Construct model config
                    let model: Model<any>;
                    const isBuiltIn = ['google', 'openai', 'anthropic'].includes(
                        this.tarsConfig.piProvider
                    );
                    if (isBuiltIn && !this.tarsConfig.piBaseUrl) {
                        model = getModel(
                            this.tarsConfig.piProvider as any,
                            this.tarsConfig.piModel as any
                        );
                    } else {
                        model = {
                            id: this.tarsConfig.piModel,
                            name: this.tarsConfig.piModel,
                            api:
                                this.tarsConfig.piProvider === 'google'
                                    ? 'google-generative-ai'
                                    : 'openai-completions',
                            provider: this.tarsConfig.piProvider || 'custom',
                            baseUrl:
                                this.tarsConfig.piBaseUrl ||
                                (this.tarsConfig.piProvider === 'google'
                                    ? 'https://generativelanguage.googleapis.com'
                                    : 'https://api.openai.com/v1'),
                            reasoning: false,
                            input: ['text'],
                            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
                            contextWindow: this.tarsConfig.contextWindowTokens || 128000,
                            maxTokens: 32000
                        };
                    }

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

                    if (!summaryContent) {
                        summaryContent =
                            '*(Summary generation failed, falling back to raw truncation)*';
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

                    // Load system prompt for estimation
                    const systemPromptPath = this.tarsConfig.systemPromptPath;
                    let systemPrompt = '';
                    if (fs.existsSync(systemPromptPath)) {
                        systemPrompt = fs.readFileSync(systemPromptPath, 'utf-8');
                    }

                    // Estimate new history token count
                    let totalChars = systemPrompt.length;
                    for (const msg of newHistory) {
                        const m = msg as any;
                        if (typeof m.content === 'string') {
                            totalChars += m.content.length;
                        } else if (Array.isArray(m.content)) {
                            for (const part of m.content) {
                                if (part.type === 'text' && typeof part.text === 'string') {
                                    totalChars += part.text.length;
                                }
                            }
                        }
                    }
                    const estimatedTokens = Math.ceil(totalChars / 3.8);
                    if (this.sessionManager) {
                        await this.sessionManager.updateTokensAfterCompression(estimatedTokens);
                    }

                    return true;
                }
            }
            return false;
        } catch (e: any) {
            logger.warn(`⚠️ Compression failed: ${e.message}`);
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
        const newChatPath = path.join(chatsDir, `${sessionId}.json`);

        if (fs.existsSync(newChatPath)) {
            try {
                logger.info(`📂 Loading session history from Pi format: ${newChatPath}`);
                const data = await fs.promises.readFile(newChatPath, 'utf-8');
                return JSON.parse(data);
            } catch (err) {
                logger.error(`Failed to load Pi session chat: ${err}`);
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
        const filePath = path.join(chatsDir, `${sessionId}.json`);
        try {
            await fs.promises.writeFile(filePath, JSON.stringify(messages, null, 2), 'utf-8');
        } catch (err) {
            logger.error(`Failed to save session history: ${err}`);
        }
    }

    /**
     * Helper to load legacy conversation records.
     */
    private async loadConversationRecord(filePath: string): Promise<any> {
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
    private migrateLegacyConversation(conversation: any): AgentMessage[] {
        const messages: AgentMessage[] = [];
        if (!conversation || !conversation.messages) return messages;

        for (const msg of conversation.messages) {
            if (msg.type === 'user') {
                let content: string | any[] = '';
                if (typeof msg.content === 'string') {
                    content = msg.content;
                } else if (Array.isArray(msg.content)) {
                    content = msg.content.map((p: any) => ({
                        type: 'text',
                        text: p.text || ''
                    }));
                }
                messages.push({
                    role: 'user',
                    content,
                    timestamp: msg.timestamp || Date.now()
                } as any);
            } else if (msg.type === 'gemini') {
                const contentParts: any[] = [];
                const toolResultMessages: any[] = [];
                if (typeof msg.content === 'string' && msg.content !== '') {
                    contentParts.push({ type: 'text', text: msg.content });
                } else if (Array.isArray(msg.content)) {
                    for (const p of msg.content) {
                        if (p.text) {
                            contentParts.push({ type: 'text', text: p.text });
                        }
                    }
                }

                if (msg.toolCalls) {
                    for (const tc of msg.toolCalls) {
                        const callId =
                            tc.id ||
                            tc.callId ||
                            `call-${Math.random().toString(36).substring(2, 9)}`;
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
                                timestamp: msg.timestamp || Date.now()
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
                    timestamp: msg.timestamp || Date.now()
                } as any);

                if (toolResultMessages.length > 0) {
                    messages.push(...toolResultMessages);
                }
            }
        }
        return messages;
    }

    /**
     * Attempts to find and load legacy session history.
     */
    private async loadResumedSessionData(sessionId: string): Promise<any | null> {
        try {
            const geminiDir = path.join(this.tarsConfig.homeDir, '.gemini');
            const tmpDir = path.join(geminiDir, 'tmp');

            if (!fs.existsSync(tmpDir)) return null;

            let projectIdentifier: string | null = null;
            const registryPath = path.join(geminiDir, 'projects.json');
            if (fs.existsSync(registryPath)) {
                try {
                    const registry = JSON.parse(fs.readFileSync(registryPath, 'utf-8'));
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

            const searchDirs = [projectIdentifier];
            try {
                const allDirs = fs.readdirSync(tmpDir);
                for (const d of allDirs) {
                    if (d !== projectIdentifier) searchDirs.push(d);
                }
            } catch (e) {}

            const shortId = sessionId.slice(0, 8);
            for (const dir of searchDirs) {
                if (!dir) continue;
                const chatsDir = path.join(tmpDir, dir, 'chats');
                if (!fs.existsSync(chatsDir)) continue;

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

                const jsonFiles = files.filter((f) => f.endsWith('.json') || f.endsWith('.jsonl'));
                if (jsonFiles.length > 0) {
                    const sorted = jsonFiles
                        .map((f) => ({
                            name: f,
                            mtime: fs.statSync(path.join(chatsDir, f)).mtimeMs
                        }))
                        .sort((a, b) => b.mtime - a.mtime);

                    const latestFile = sorted[0].name;
                    logger.warn(
                        `⚠️ No exact session match for ${shortId}. Falling back to latest: ${latestFile}`
                    );
                    const filePath = path.join(chatsDir, latestFile);
                    const content = await this.loadConversationRecord(filePath);
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
     * Closes the MCP client bridge connections.
     */
    public async shutdown(): Promise<void> {
        if (this.mcpBridge) {
            await this.mcpBridge.shutdown();
        }
    }
}
