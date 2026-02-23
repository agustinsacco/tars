import {
    Config as CoreConfig,
    GeminiClient,
    GeminiEventType,
    AuthType,
    SimpleExtensionLoader,
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

            // Discover and load extensions (MCP servers like memory and tasks)
            const extensions = await this.discoverExtensions();
            if (extensions.length > 0) {
                logger.info(`🔌 Loaded ${extensions.length} extensions into Gemini Engine.`);
            }

            this.coreConfig = new CoreConfig({
                sessionId: uuidv4(),
                targetDir: this.tarsConfig.homeDir,
                cwd: this.tarsConfig.homeDir,
                model: this.tarsConfig.geminiModel,
                debugMode: false,
                approvalMode: 'yolo' as any, // Tars runs autonomously
                enableHooks: true,
                mcpEnabled: true,
                extensionsEnabled: true,
                enableAgents: true, // Enable agents support
                skillsSupport: true,
                adminSkillsEnabled: true,
                noBrowser: true,
                extensionLoader: new SimpleExtensionLoader(extensions)
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

            const stream = this.client.sendMessageStream(
                [{ text: prompt }],
                new AbortController().signal,
                'tars-request' // Proper promptId
            );

            for await (const event of stream) {
                const normalized = this.normalizeEvent(event, sid);
                if (normalized) {
                    onEvent(normalized);
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
    private normalizeEvent(event: ServerGeminiStreamEvent, sessionId: string): GeminiEngineEvent | null {
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
                    usageStats: event.value.usageMetadata ? {
                        inputTokens: event.value.usageMetadata.promptTokenCount || 0,
                        outputTokens: event.value.usageMetadata.candidatesTokenCount || 0,
                        cachedTokens: event.value.usageMetadata.cachedContentTokenCount || 0
                    } : undefined,
                    sessionId
                };

            default:
                return null;
        }
    }

    /**
     * Discovers and loads extensions from the ~/.tars/.gemini/extensions directory.
     * This brings in MCP servers, tools, and custom behaviors.
     */
    private async discoverExtensions(): Promise<any[]> {
        const extensionsDir = path.join(this.tarsConfig.homeDir, '.gemini', 'extensions');
        const enablementFile = path.join(extensionsDir, 'extension-enablement.json');

        if (!fs.existsSync(extensionsDir)) return [];

        let enablement: Record<string, any> = {};
        if (fs.existsSync(enablementFile)) {
            try {
                enablement = JSON.parse(fs.readFileSync(enablementFile, 'utf-8'));
            } catch (e) {
                logger.warn(`⚠️ Could not parse extension-enablement.json: ${e}`);
            }
        }

        const extensions: any[] = [];
        const subdirs = fs.readdirSync(extensionsDir);

        for (const subdir of subdirs) {
            const extPath = path.join(extensionsDir, subdir);
            if (!fs.statSync(extPath).isDirectory()) continue;

            const configPath = fs.existsSync(path.join(extPath, 'gemini-extension.json'))
                ? path.join(extPath, 'gemini-extension.json')
                : path.join(extPath, 'extension.json');

            if (!fs.existsSync(configPath)) continue;

            try {
                const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

                // Basic hydration (reimplements a small part of ExtensionManager logic)
                const hydrate = (obj: any): any => {
                    const str = JSON.stringify(obj);
                    const hydrated = str
                        .replace(/\${extensionPath}/g, extPath)
                        .replace(/\${workspacePath}/g, this.tarsConfig.homeDir);
                    return JSON.parse(hydrated);
                };

                const hydratedConfig = hydrate(config);

                // Build the GeminiCLIExtension object
                extensions.push({
                    name: hydratedConfig.name,
                    version: hydratedConfig.version || '1.0.0',
                    path: extPath,
                    isActive: enablement[hydratedConfig.name] !== undefined,
                    mcpServers: hydratedConfig.mcpServers || {},
                    excludeTools: hydratedConfig.excludeTools || [],
                    contextFiles: hydratedConfig.contextFiles || [],
                    skills: hydratedConfig.skills || [],
                    agents: hydratedConfig.agents || [],
                    id: hydratedConfig.name
                });
            } catch (e: any) {
                logger.warn(`⚠️ Failed to load extension from ${subdir}: ${e.message}`);
            }
        }

        return extensions;
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

            const chatsDir = path.join(this.tarsConfig.homeDir, '.gemini', 'tmp', projectHash, 'chats');
            if (!fs.existsSync(chatsDir)) return null;

            const files = fs.readdirSync(chatsDir);
            // File pattern: session-YYYY-MM-DDTHH-MM-8CHARS.json
            // We search for matches containing our session ID prefix
            const shortId = sessionId.slice(0, 8);
            const sessionFile = files.find(f => f.includes(`-${shortId}.json`));

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
