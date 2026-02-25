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
    MCPServerConfig
} from '@google/gemini-cli-core';
import { EventEmitter } from 'events';
import { Config as TarsConfig } from '../config/config.js';
import logger from '../utils/logger.js';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import path from 'path';

import { AttachmentContext } from '../types/index.js';

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

export type GeminiEngineOutputHandler = (event: GeminiEngineEvent) => void;

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
                enableAgents: true, // Enable agents support
                skillsSupport: true,
                adminSkillsEnabled: true,
                noBrowser: true,
                folderTrust: true,
                trustedFolder: true,
                extensionLoader
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
                                    resolvedEnv[key] = resolvedEnv[key].replace(/\${extensionPath}/g, extPath);
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
            const maxTurns = 50; // Increased to handle complex autonomous tasks
            const abortController = new AbortController();
            let finalUsageStats: any = undefined;

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
                    break;
                }

                if (turnCount >= maxTurns) {
                    logger.warn(
                        `⚠️ Hit maxTurns (${maxTurns}) limit. Force terminating interaction.`
                    );
                    onEvent({
                        type: 'text',
                        role: 'assistant',
                        content:
                            '\n\n⚠️ *Task was complex and reached the maximum turn limit. I have executed as much as I could.*',
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

            // Always emit final done event when exiting the loop
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
            } catch (e) { }

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
}
