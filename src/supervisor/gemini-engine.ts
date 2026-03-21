import {
    Config as CoreConfig,
    GeminiClient,
    GeminiEventType,
    AuthType,
    promptIdContext,
    Scheduler,
    type ServerGeminiStreamEvent,
    ApprovalMode,
    PolicyDecision,
    SimpleExtensionLoader,
    MCPServerConfig,
    BaseLlmClient
} from '@google/gemini-cli-core';
import { EventEmitter } from 'events';
import { Config as TarsConfig } from '../config/config.js';
import logger from '../utils/logger.js';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import path from 'path';

import { AttachmentContext } from '../types/index.js';

import { ChannelManager } from '../channels/channel-manager.js';
import { SendNotificationTool } from '../tools/send-notification.js';
import { GetQuotaTool } from '../tools/get-quota.js';
import { LlamaCppGenerator } from '../inference/LlamaCppGenerator.js';

export interface GeminiEngineEvent {
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

export type GeminiEngineOutputHandler = (event: GeminiEngineEvent) => void | Promise<void>;

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
    private initializedWithFallback = false;
    private currentSessionId: string | null = null;
    private channelManager?: ChannelManager;

    constructor(private readonly tarsConfig: TarsConfig) {
        super();
    }

    /**
     * Provide the ChannelManager instance to the engine so it can build proactive notification tools
     */
    public setChannelManager(channelManager: ChannelManager): void {
        this.channelManager = channelManager;
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
            const discoveredExtensions = await this.discoverExtensions();
            const extensionLoader = new SimpleExtensionLoader(discoveredExtensions);

            this.coreConfig = new CoreConfig({
                sessionId: uuidv4(),
                targetDir: this.tarsConfig.homeDir,
                cwd: this.tarsConfig.homeDir,
                model: this.tarsConfig.geminiModel,
                debugMode: false,
                approvalMode: ApprovalMode.YOLO,
                policyEngineConfig: {
                    defaultDecision: PolicyDecision.ALLOW
                },
                interactive: true,
                enableHooks: true,
                mcpEnabled: true,
                extensionsEnabled: true,
                enableAgents: true,
                skillsSupport: true,
                adminSkillsEnabled: true,
                noBrowser: true,
                folderTrust: true,
                trustedFolder: true,
                extensionLoader
            });

            await this.coreConfig.refreshAuth(authType);
            await this.coreConfig.initialize();

            // Handle Local Inference Override
            if (this.tarsConfig.inferenceBackend === 'llamacpp') {
                logger.info(
                    `🔌 Overriding Gemini Core with Local Inference: ${this.tarsConfig.localInferenceUrl}`
                );
                const localGenerator = new LlamaCppGenerator(this.tarsConfig.localInferenceUrl);
                // We must override the private properties at runtime to bypass the SDK's internal Gemini calls
                (this.coreConfig as any).contentGenerator = localGenerator;
                (this.coreConfig as any).baseLlmClient = new BaseLlmClient(
                    localGenerator,
                    this.coreConfig
                );
            }

            // Register system prompt template for tars-request
            const promptProvider = (this.coreConfig as any).promptProvider;
            if (promptProvider) {
                promptProvider.registerPrompt('tars-request', {
                    template: fs.readFileSync(systemMdPath, 'utf-8'),
                    includeContext: true,
                    includeTools: true,
                    includeHistory: true
                });
            }

            // Inject native tools
            const toolRegistry = this.coreConfig.getToolRegistry();

            if (this.channelManager) {
                const notifyTool = new SendNotificationTool(this.channelManager);
                toolRegistry.registerTool(notifyTool);
                logger.info('🔌 Registered native tool: send_notification');
            }

            const getQuotaTool = new GetQuotaTool(this.coreConfig);
            toolRegistry.registerTool(getQuotaTool);
            logger.info('🔌 Registered native tool: get_model_quota');

            this.client = this.coreConfig.getGeminiClient();

            // Register model overrides for Gemini 3.1 features (Thinking/Chain-of-Thought)
            const modelConfigService = this.coreConfig.modelConfigService;

            // Gemini 3.1 Pro (Advanced Reasoning)
            modelConfigService.registerRuntimeModelOverride({
                match: { model: 'gemini-3.1-pro-preview' },
                modelConfig: {
                    generateContentConfig: {
                        thinkingConfig: {
                            includeThoughts: true,
                            thinkingLevel: 'HIGH' as any
                        }
                    }
                }
            });

            // Gemini 3.1 Flash-Lite (Fast, Cost-Effective Reasoning)
            modelConfigService.registerRuntimeModelOverride({
                match: { model: 'gemini-3.1-flash-lite-preview' },
                modelConfig: {
                    generateContentConfig: {
                        thinkingConfig: {
                            includeThoughts: true,
                            thinkingLevel: 'LOW' as any
                        }
                    }
                }
            });

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
     * Discovers extensions from the ~/.tars/.gemini/extensions directory.
     */
    private async discoverExtensions(): Promise<any[]> {
        const extensionsDir = path.join(this.tarsConfig.homeDir, '.gemini', 'extensions');
        if (!fs.existsSync(extensionsDir)) return [];

        const extensions: any[] = [];
        try {
            const entries = fs.readdirSync(extensionsDir, { withFileTypes: true });

            for (const entry of entries) {
                if (!entry.isDirectory()) continue;
                const extPath = path.resolve(extensionsDir, entry.name);
                const configPath = path.join(extPath, 'gemini-extension.json');

                if (fs.existsSync(configPath)) {
                    try {
                        const content = fs.readFileSync(configPath, 'utf-8');
                        const config = JSON.parse(content);

                        // Ensure mcpServers are converted to MCPServerConfig instances if they exist
                        const mcpServers: Record<string, any> = {};
                        if (config.mcpServers) {
                            for (const [name, srv] of Object.entries(config.mcpServers)) {
                                const s = srv as any;

                                // Manually resolve ${extensionPath} since we are constructing configs early
                                const resolvedArgs = s.args?.map((arg: string) =>
                                    arg.replace(/\${extensionPath}/g, extPath)
                                );
                                const resolvedEnv = s.env ? { ...s.env } : {};
                                for (const key in resolvedEnv) {
                                    resolvedEnv[key] = resolvedEnv[key].replace(
                                        /\${extensionPath}/g,
                                        extPath
                                    );
                                }

                                mcpServers[name] = new MCPServerConfig(
                                    s.command,
                                    resolvedArgs,
                                    resolvedEnv,
                                    s.cwd?.replace(/\${extensionPath}/g, extPath),
                                    s.url?.replace(/\${extensionPath}/g, extPath),
                                    s.httpUrl?.replace(/\${extensionPath}/g, extPath),
                                    s.headers,
                                    s.tcp,
                                    s.type,
                                    s.timeout,
                                    s.trust
                                );
                            }
                        }

                        extensions.push({
                            ...config,
                            id: config.name,
                            path: extPath,
                            isActive: true,
                            mcpServers,
                            contextFiles: config.contextFiles || []
                        });
                        logger.info(`🔌 Found extension: ${config.name}`);
                    } catch (e) {
                        logger.error(`Failed to parse extension at ${extPath}: ${e}`);
                    }
                }
            }
        } catch (error) {
            logger.error(`Error during extension discovery: ${error}`);
        }
        return extensions;
    }

    /**
     * Executes a prompt and streams events back.
     */
    public async run(
        prompt: string,
        onEvent: GeminiEngineOutputHandler,
        sessionId?: string,
        attachments?: AttachmentContext[]
    ): Promise<void> {
        if (!this.initialized) {
            await this.initialize();
        }

        const sid = sessionId || this.coreConfig.getSessionId();
        const savedHome = process.env.HOME;

        try {
            process.env.HOME = this.tarsConfig.homeDir;
            process.env.GEMINI_CLI_HOME = this.tarsConfig.homeDir;

            // Session Swapping Logic or First Run
            // We must call startChat at least once to initialize the GeminiChat session,
            // even if the sessionId matches the coreConfig's initial ID.
            if (this.currentSessionId !== sid || !this.client.isInitialized()) {
                logger.debug(`🔄 Initializing/Swapping Gemini session to: ${sid}`);
                const resumedData = await this.loadResumedSessionData(sid);
                // @ts-ignore - access private to swap session
                await this.client.startChat(undefined, resumedData || undefined);
                this.currentSessionId = sid;
            }

            let currentRequestParts: any[] = [{ text: prompt }];

            // Handle Multimodal Attachments
            if (attachments && attachments.length > 0) {
                for (const attachment of attachments) {
                    try {
                        const data = fs.readFileSync(attachment.path).toString('base64');
                        currentRequestParts.push({
                            inlineData: {
                                data,
                                mimeType: attachment.mimeType
                            }
                        });
                        logger.debug(
                            `📎 Attached file to prompt: ${attachment.path} (${attachment.mimeType})`
                        );
                    } catch (err: any) {
                        logger.error(
                            `Failed to read attachment ${attachment.path}: ${err.message}`
                        );
                    }
                }
            }

            let turnCount = 0;
            const maxTurns = 100; // Increased to handle complex autonomous tasks
            const abortController = new AbortController();
            let finalUsageStats: any = undefined;
            let loopDetected = false;
            let hasRealContent = false;

            while (turnCount < maxTurns) {
                turnCount++;
                const toolRequests: any[] = [];

                let stream: any;
                let retryCount = 0;
                const maxRetries = 8;
                let lastError: any = null;

                while (retryCount < maxRetries) {
                    try {
                        stream = await promptIdContext.run(sid, () => {
                            return this.client.sendMessageStream(
                                currentRequestParts,
                                abortController.signal,
                                'tars-request' // Proper promptId
                            );
                        });
                        break; // Success
                    } catch (error: any) {
                        retryCount++;
                        lastError = error;
                        const isTransient =
                            error.message?.includes('429') ||
                            error.message?.includes('503') ||
                            error.message?.toLowerCase().includes('rate limit') ||
                            error.message?.toLowerCase().includes('capacity') ||
                            error.message?.toLowerCase().includes('quota') ||
                            error.message?.toLowerCase().includes('overloaded');

                        if (isTransient && retryCount < maxRetries) {
                            const delay = Math.pow(2, retryCount) * 1000 + Math.random() * 1000;
                            logger.warn(
                                `⚠️ Gemini API transient error (attempt ${retryCount}/${maxRetries}): ${error.message}. Retrying in ${Math.round(delay)}ms...`
                            );
                            await new Promise((resolve) => setTimeout(resolve, delay));
                            continue;
                        }

                        // Fallback logic for 'auto' model on permanent error or final retry
                        if (
                            this.tarsConfig.geminiModel === 'auto' &&
                            !this.initializedWithFallback
                        ) {
                            const fallbackModel = 'gemini-3.1-flash-lite-preview';
                            logger.warn(
                                `🔄 'auto' model failed with error: ${error.message}. Attempting fallback to ${fallbackModel}...`
                            );
                            this.initializedWithFallback = true;
                            // @ts-ignore - modifying private config for fallback
                            this.coreConfig.model = fallbackModel;
                            // Re-initialize client with new model
                            this.client = this.coreConfig.getGeminiClient();
                            await this.client.initialize();
                            retryCount = 0; // Reset retries for the fallback model
                            continue;
                        }

                        throw error;
                    }
                }

                for await (const event of stream) {
                    logger.debug(
                        `📨 Raw Gemini Event [Turn ${turnCount}]: ${JSON.stringify(event).substring(0, 200)}...`
                    );

                    if (event.type === GeminiEventType.ToolCallRequest) {
                        toolRequests.push(event.value);
                    }

                    if (event.type === GeminiEventType.LoopDetected) {
                        loopDetected = true;
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
                        await onEvent(normalized);
                    }
                }

                if (loopDetected) {
                    logger.warn(`⚠️ Loop detected in Gemini Engine at turn ${turnCount}.`);
                    break;
                }

                if (toolRequests.length === 0) {
                    logger.debug(`✅ Interaction complete after ${turnCount} turns.`);
                    break;
                }
                // ... (rest of the loop)

                if (turnCount >= maxTurns) {
                    logger.warn(
                        `⚠️ Hit maxTurns (${maxTurns}) limit. Force terminating interaction.`
                    );
                    await onEvent({
                        type: 'text',
                        role: 'assistant',
                        content:
                            '\n\n⚠️ *Task was complex and reached the maximum turn limit. I have executed as much as I could.*',
                        sessionId: sid
                    });
                    break;
                }

                // Runtime Safety Filter: Prevent self-destructive commands
                const filteredToolRequests: any[] = [];
                for (const req of toolRequests) {
                    const toolName = req.name;
                    const commandLine = req.args?.CommandLine || req.args?.command || '';

                    if (
                        (toolName.includes('run_command') ||
                            toolName.includes('run_shell_command')) &&
                        (commandLine.includes('tars stop') ||
                            /\bpm2\s+(stop|kill|delete)\b/.test(commandLine))
                    ) {
                        logger.warn(`🛑 INTERCEPTED self-destructive command: ${commandLine}`);
                        await onEvent({
                            type: 'text',
                            role: 'assistant',
                            content: `\n\n⚠️ **Safety Interruption**: I attempted to run a command that would stop my own supervisor process (${commandLine}). To prevent a loss of connection or state, I have blocked this action. If you really want me to stop, please run \`tars stop\` manually in your terminal.`,
                            sessionId: sid
                        });
                        continue;
                    }
                    filteredToolRequests.push(req);
                }

                if (filteredToolRequests.length === 0 && toolRequests.length > 0) {
                    // All tools were blocked by safety filter, break the loop
                    break;
                }

                logger.debug(`🛠️ Executing ${filteredToolRequests.length} tool calls...`);

                // Execute tools using Scheduler
                const scheduler = new Scheduler({
                    config: this.coreConfig,
                    messageBus: this.coreConfig.getMessageBus(),
                    getPreferredEditor: () => undefined,
                    schedulerId: sid
                });

                const completedCalls = await scheduler.schedule(
                    filteredToolRequests,
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
                    if (normalized) await onEvent(normalized);
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

            // If the loop finished without producing any content, notify the user
            if (!hasRealContent) {
                let fallbackMsg =
                    '\n\n⚠️ **Model Interaction Issue**: The Gemini model failed to produce a valid text response.';
                if (loopDetected) {
                    fallbackMsg +=
                        ' A repetitive output loop was detected and terminated. This can sometimes happen with complex prompts or transient API glitches.';
                }
                fallbackMsg += '\n\nPlease try rephrasing your request or starting a new session.';

                await onEvent({
                    type: 'text',
                    role: 'assistant',
                    content: fallbackMsg,
                    sessionId: sid
                });
            }

            // Always emit final done event when exiting the loop
            await onEvent({
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
        } catch (error: any) {
            const errorMsg =
                error.message ||
                (typeof error === 'object' ? JSON.stringify(error) : String(error));
            logger.error(`❌ Gemini Engine run error: ${errorMsg}`);
            await onEvent({ type: 'error', error: errorMsg });
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

            case GeminiEventType.ChatCompressed:
                const compressed = event.value as any;
                return {
                    type: 'text',
                    role: 'system',
                    content: `📦 **Context Management**: Chat history was automatically compressed by Gemini Core to maintain performance. (Previous: ${compressed.originalTokenCount} tokens, New: ${compressed.newTokenCount} tokens)`,
                    sessionId
                };

            case GeminiEventType.ToolCallRequest:
                return {
                    type: 'tool_call',
                    toolName: event.value.name,
                    toolArgs: event.value.args,
                    callId: event.value.callId,
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
                let errorDetails = '';
                if (event.value instanceof Error) {
                    errorDetails = event.value.message;
                } else if (typeof event.value === 'object' && event.value !== null) {
                    // Try to extract nested error message if it exists (common in Google API errors)
                    const val = event.value as any;
                    errorDetails = val.message || val.error?.message || JSON.stringify(event.value);
                } else {
                    errorDetails = String(event.value);
                }

                return {
                    type: 'error',
                    error: errorDetails,
                    sessionId
                };

            case GeminiEventType.LoopDetected:
                return {
                    type: 'loop_detected',
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
            const geminiDir = path.join(this.tarsConfig.homeDir, '.gemini');
            const tmpDir = path.join(geminiDir, 'tmp');

            if (!fs.existsSync(tmpDir)) return null;

            // 1. Try to find the exact project identifier from projects.json
            let projectIdentifier: string | null = null;
            const registryPath = path.join(geminiDir, 'projects.json');
            if (fs.existsSync(registryPath)) {
                try {
                    const registry = JSON.parse(fs.readFileSync(registryPath, 'utf-8'));
                    projectIdentifier = registry.projects[projectRoot] || null;
                } catch (e) {
                    logger.warn(`⚠️ Failed to read projects.json: ${e}`);
                }
            }

            // 2. Fallback: MD5 hash (used in some versions)
            if (!projectIdentifier) {
                const crypto = await import('node:crypto');
                projectIdentifier = crypto.createHash('md5').update(projectRoot).digest('hex');
            }

            // 3. Search for the session file in candidate directories
            // We search projectIdentifier first, then scan all if not found
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
                    const content = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
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
     * Injects a synthetic conversational turn into the core CLI history file.
     * Used to append background/cron task summaries so the engine "remembers" them
     * in the next interactive session.
     */
    public async injectBackgroundHistory(
        sessionId: string,
        taskPrompt: string,
        taskResult: string
    ): Promise<void> {
        try {
            const sessionData = await this.loadResumedSessionData(sessionId);
            if (!sessionData || !sessionData.filePath || !sessionData.conversation) {
                logger.warn(
                    `⚠️ Could not find session file to inject background history for: ${sessionId}`
                );
                return;
            }

            const history = sessionData.conversation;

            // Core CLI history format relies on 'User ' and 'Model ' tags,
            // or raw parts. We adhere to the standard format.
            const userTurn = {
                role: 'user',
                parts: [{ text: `[BACKGROUND TASK TRIGGERED]\n${taskPrompt}` }]
            };

            const modelTurn = {
                role: 'model',
                parts: [{ text: `[BACKGROUND TASK COMPLETED autonomously]\n${taskResult}` }]
            };

            // Assuming history is an array of messages
            if (Array.isArray(history)) {
                history.push(userTurn);
                history.push(modelTurn);
            }

            // Write back to disk
            fs.writeFileSync(sessionData.filePath, JSON.stringify(history, null, 2));
            logger.info(
                `💾 Injected background execution summary into session history: ${sessionId}`
            );
        } catch (e: any) {
            logger.error(`❌ Failed to inject background history: ${e.message}`);
        }
    }
}
