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
    CompressionStatus
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
import { SessionManager } from './session-manager.js';
import { LocalRateLimiter } from './rate-limiter.js';
import { LlamaCppGenerator } from '../inference/LlamaCppGenerator.js';
import { DLPService } from '../utils/dlp-service.js';

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
 * Snapshot of a completed tool call for status reporting.
 */
export interface ToolStatus {
    name: string;
    responsePreview: string;
    responseSize: number; // bytes/chars
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
    private sessionManager?: SessionManager;
    private rateLimiter: LocalRateLimiter;

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
     * Initializes the core Gemini client with proper auth and config.
     */
    public async initialize(initialSessionId?: string): Promise<void> {
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

            let authType = getAuthTypeFromEnv() || AuthType.LOGIN_WITH_GOOGLE;

            // Prevent interactive Google login prompt if using local inference
            if (this.tarsConfig.inferenceBackend === 'llamacpp') {
                authType = AuthType.USE_GEMINI;
                if (!process.env.GEMINI_API_KEY) {
                    process.env.GEMINI_API_KEY = 'dummy_llama_key_to_bypass_sdk_auth';
                }
            }
            const discoveredExtensions = await this.discoverExtensions();
            const extensionLoader = new SimpleExtensionLoader(discoveredExtensions);

            this.coreConfig = new CoreConfig({
                sessionId: initialSessionId || uuidv4(),
                targetDir: this.tarsConfig.homeDir,
                cwd: this.tarsConfig.homeDir,
                model: this.tarsConfig.geminiModel,
                debugMode: false,
                approvalMode: ApprovalMode.YOLO,
                disableModelRouterForAuth:
                    this.tarsConfig.inferenceBackend === 'llamacpp'
                        ? [AuthType.USE_GEMINI]
                        : undefined,
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
                // Override the content generator at runtime to bypass the SDK's internal Gemini calls
                (this.coreConfig as any).contentGenerator = localGenerator;

                // We'll apply more overrides after the client is created
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

            const getQuotaTool = new GetQuotaTool(this.coreConfig, this.sessionManager, {
                inferenceBackend: this.tarsConfig.inferenceBackend,
                contextWindowTokens: this.tarsConfig.contextWindowTokens,
                geminiModel: this.tarsConfig.geminiModel,
                localInferenceUrl: this.tarsConfig.localInferenceUrl
            });
            toolRegistry.registerTool(getQuotaTool);
            logger.info('🔌 Registered native tool: get_model_quota');

            this.client = this.coreConfig.getGeminiClient();
            this.applyClientOverrides(this.client);

            // Deregister plan-mode tools — they require interactive user confirmation
            // that Tars cannot provide (non-interactive agent). Without this, the model
            // calls enter_plan_mode which switches ApprovalMode to PLAN, but exit_plan_mode
            // silently fails ("Rejected (no feedback)"), leaving the agent permanently
            // stuck in PLAN mode. This forces all requests through the rate-limited
            // gemini-3.1-pro-preview model, exhausting quota instantly.
            try {
                toolRegistry.unregisterTool('enter_plan_mode');
                toolRegistry.unregisterTool('exit_plan_mode');
                logger.info('🔇 Deregistered plan-mode tools (non-interactive agent)');
            } catch (e: any) {
                logger.debug(`Plan-mode tool deregistration skipped: ${e.message}`);
            }

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
                if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
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
        attachments?: AttachmentContext[],
        onStatus?: StatusUpdateHandler
    ): Promise<void> {
        if (!this.initialized) {
            await this.initialize(sessionId);
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

                // Sync: Read back the actual session ID that Core assigned.
                // Core may create a new session ID internally (e.g. if the project hash
                // changed or the old session was not found). We must keep Tars's
                // SessionManager in sync to prevent ID mismatch on next restart.
                const recordingService = this.client.getChatRecordingService() as any;
                const actualCoreSessionId =
                    recordingService?.sessionId || this.coreConfig.getSessionId();
                if (actualCoreSessionId && actualCoreSessionId !== sid) {
                    logger.warn(
                        `⚠️ Session ID mismatch detected: Tars=${sid}, Core=${actualCoreSessionId}. Syncing to Core's ID.`
                    );
                    this.currentSessionId = actualCoreSessionId;
                    // Update SessionManager so the correct ID is persisted to disk
                    if (this.sessionManager) {
                        await this.sessionManager.save(actualCoreSessionId);
                    }
                } else {
                    this.currentSessionId = sid;
                }
            }

            let currentRequestParts: any[] = [{ text: prompt }];
            const reqPromptId = `req-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

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
            // Accumulate usage across multi-turn interactions.
            // For local models, each turn reports only its own tokens. For Gemini Cloud,
            // promptTokenCount is cumulative (total context). We keep the maximum
            // promptTokenCount seen (last turn = largest context) and sum outputTokens.
            let accumulatedInputTokens = 0;
            let accumulatedOutputTokens = 0;
            let accumulatedCachedTokens = 0;
            let loopDetected = false;
            let hasRealContent = false;

            // Track recent tool calls for live status updates
            const recentTools: ToolStatus[] = [];

            while (turnCount < maxTurns) {
                turnCount++;
                const toolRequests: any[] = [];

                let stream: any;
                let retryCount = 0;
                const maxRetries = 8;
                let lastError: any = null;

                while (retryCount < maxRetries) {
                    try {
                        const estimatedTokens = Math.max(100, accumulatedInputTokens);
                        const waitTime = this.rateLimiter.checkWaitTime(estimatedTokens);
                        if (waitTime > 0) {
                            logger.info(
                                `⏳ Pre-emptive throttling: waiting ${Math.round(waitTime / 1000)}s to avoid rate limits...`
                            );
                            await new Promise((resolve) => setTimeout(resolve, waitTime));
                        }

                        this.rateLimiter.recordRequest(estimatedTokens);

                        stream = await promptIdContext.run(sid, () => {
                            // Combine manual abort signal with a 5-minute timeout to prevent deadlock
                            const timeoutSignal = AbortSignal.timeout(5 * 60 * 1000);
                            const combinedSignal = abortController.signal.aborted
                                ? abortController.signal
                                : timeoutSignal;

                            // We listen for manual aborts to also abort the combined signal
                            // (AbortSignal.any is available in Node 20+, but we can just pass timeoutSignal
                            // and manual aborts are rare here, or use AbortSignal.any if supported)
                            const signalToUse =
                                typeof AbortSignal.any === 'function'
                                    ? AbortSignal.any([abortController.signal, timeoutSignal])
                                    : timeoutSignal;

                            return this.client.sendMessageStream(
                                currentRequestParts,
                                signalToUse,
                                reqPromptId
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
                            logger.warn(
                                `🔄 'auto' model failed with error: ${error.message}. Attempting fallback to gemini-2.0-flash...`
                            );
                            this.initializedWithFallback = true;
                            // @ts-ignore - modifying private config for fallback
                            this.coreConfig.model = 'gemini-2.0-flash';
                            // Re-initialize client with new model
                            this.client = this.coreConfig.getGeminiClient();
                            this.applyClientOverrides(this.client);
                            await this.client.initialize();
                            retryCount = 0; // Reset retries for the fallback model
                            continue;
                        }

                        throw error;
                    }
                }

                for await (const event of stream) {
                    if (event.type === GeminiEventType.ToolCallRequest) {
                        toolRequests.push(event.value);
                    }

                    if (event.type === GeminiEventType.LoopDetected) {
                        loopDetected = true;
                    }

                    if (event.type === GeminiEventType.Finished) {
                        const usage = event.value.usageMetadata;
                        if (usage) {
                            // promptTokenCount reflects total context size (cumulative)
                            // so we always take the latest (highest) value
                            if (usage.promptTokenCount) {
                                accumulatedInputTokens = Math.max(
                                    accumulatedInputTokens,
                                    usage.promptTokenCount
                                );
                            }
                            // candidatesTokenCount is per-turn, so we accumulate
                            if (usage.candidatesTokenCount) {
                                accumulatedOutputTokens += usage.candidatesTokenCount;
                            }
                            if (usage.cachedContentTokenCount) {
                                accumulatedCachedTokens = Math.max(
                                    accumulatedCachedTokens,
                                    usage.cachedContentTokenCount
                                );
                            }
                            finalUsageStats = usage;
                        }
                        continue; // Don't emit done yet
                    }

                    const normalized = this.normalizeEvent(event, sid);
                    if (normalized) {
                        if (normalized.type === 'text' && normalized.content?.trim()) {
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

                // Runtime Safety Filter: Prevent self-destructive commands and unauthorized path access
                const filteredToolRequests: any[] = [];
                const blockedResponses = new Map<string, string>();
                const sensitiveCalls = new Set<string>();

                for (const req of toolRequests) {
                    const toolName = req.name;
                    const args = req.args || {};
                    const commandLine = args.CommandLine || args.command || '';
                    const filePath = args.file_path || args.path || args.dir_path || '';

                    // 1. Block self-destructive commands
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
                        blockedResponses.set(
                            req.callId,
                            'Execution blocked: Self-destructive command detected.'
                        );
                        continue;
                    }

                    // 2. Block blacklisted path access
                    if (filePath && DLPService.isPathBlacklisted(filePath)) {
                        logger.warn(`🛑 INTERCEPTED unauthorized path access: ${filePath}`);
                        await onEvent({
                            type: 'text',
                            role: 'assistant',
                            content: `\n\n⚠️ **Security Interruption**: I attempted to access a protected file or directory (${filePath}). Access to this path is restricted by the Tars Data Loss Prevention (DLP) policy.`,
                            sessionId: sid
                        });
                        blockedResponses.set(
                            req.callId,
                            `Access to ${filePath} is restricted by DLP policy.`
                        );
                        continue;
                    }

                    // 3. Mark sensitive paths for aggressive scrubbing
                    if (
                        (filePath && DLPService.isSensitivePath(filePath)) ||
                        (commandLine && DLPService.isSensitivePath(commandLine))
                    ) {
                        sensitiveCalls.add(req.callId);
                    }

                    filteredToolRequests.push(req);
                }

                // Execute tools using Scheduler
                let completedCalls: any[] = [];
                if (filteredToolRequests.length > 0) {
                    logger.debug(`🛠️ Executing ${filteredToolRequests.length} tool calls...`);
                    const scheduler = new Scheduler({
                        config: this.coreConfig,
                        messageBus: this.coreConfig.getMessageBus(),
                        getPreferredEditor: () => undefined,
                        schedulerId: sid
                    });

                    completedCalls = await scheduler.schedule(
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
                }

                // Build tool status for live progress updates
                const turnToolStatuses: ToolStatus[] = [];
                for (const call of completedCalls) {
                    const req = toolRequests.find(
                        (r) => r.callId === call.request?.callId || r.callId === call.callId
                    );
                    if (!req) continue;

                    const part = call.response?.responseParts?.find(
                        (p: any) => 'functionResponse' in p
                    ) as any;
                    const response = part?.functionResponse?.response;
                    const responseStr =
                        typeof response === 'string'
                            ? response
                            : typeof response === 'object'
                              ? JSON.stringify(response)
                              : String(response || '');

                    turnToolStatuses.push({
                        name: req.name,
                        responsePreview: responseStr.substring(0, 120),
                        responseSize: responseStr.length
                    });
                }

                // Also include blocked tools
                for (const [callId, reason] of blockedResponses) {
                    const req = toolRequests.find((r) => r.callId === callId);
                    if (req) {
                        turnToolStatuses.push({
                            name: req.name,
                            responsePreview: `⛔ ${reason}`,
                            responseSize: reason.length
                        });
                    }
                }

                recentTools.push(...turnToolStatuses);

                const isMilestone = turnCount > 0 && turnCount % 20 === 0;

                // Fire status update after each tool batch or on a milestone
                if (onStatus && (turnToolStatuses.length > 0 || isMilestone)) {
                    if (isMilestone) {
                        logger.info(
                            `[GeminiEngine] Milestone ${turnCount} — firing status update...`
                        );
                    }
                    try {
                        await onStatus(turnCount, recentTools.slice(-10), isMilestone);
                    } catch (e: any) {
                        logger.warn(`[GeminiEngine] Status update failed: ${e.message}`);
                    }
                }

                // Prepare next request with tool results (Scrubbed via DLP and mapped back to 1:1)
                currentRequestParts = GeminiEngine.buildToolResponseParts(
                    toolRequests,
                    completedCalls,
                    blockedResponses,
                    sensitiveCalls,
                    this.tarsConfig.inferenceBackend === 'llamacpp'
                );

                if (currentRequestParts.length === 0) {
                    logger.warn('⚠️ No tool responses generated after execution.');
                    break;
                }

                // -------------------------------------------------------------------------
                // PROACTIVE COMPRESSION & USER CHECK-IN
                // -------------------------------------------------------------------------

                // 1. Check if we need to compress mid-loop to avoid context window crashes
                if (this.sessionManager && this.tarsConfig) {
                    const stats = this.sessionManager.getStats();
                    const threshold = this.tarsConfig.compressionThreshold || 0.8;
                    const limit = this.tarsConfig.contextWindowTokens || 128000;

                    if (stats && stats.lastInputTokens > limit * threshold) {
                        logger.info(
                            `[GeminiEngine] Mid-loop compression triggered (${stats.lastInputTokens}/${limit} tokens)`
                        );
                        try {
                            const didCompress = await this.compressSession();
                            if (didCompress) {
                                await onEvent({
                                    type: 'text',
                                    role: 'assistant',
                                    content:
                                        '\n\n✨ *Mid-task memory compacted to optimally save context space.*',
                                    sessionId: sid
                                } as any);
                            }
                        } catch (e: any) {
                            logger.warn(`[GeminiEngine] Mid-loop compression failed: ${e.message}`);
                        }
                    }
                }

                // 2. Max turns safety (handled by loop condition, but we break here if needed)
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
                usageStats:
                    accumulatedInputTokens > 0 || accumulatedOutputTokens > 0
                        ? {
                              inputTokens: accumulatedInputTokens,
                              outputTokens: accumulatedOutputTokens,
                              cachedTokens: accumulatedCachedTokens
                          }
                        : finalUsageStats
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
     * Rebuilds the response array for Gemini ensuring 1:1 parity with function calls.
     */
    public static buildToolResponseParts(
        toolRequests: any[],
        completedCalls: any[],
        blockedResponses: Map<string, string>,
        sensitiveCalls: Set<string>,
        isLocalInference: boolean = false
    ): any[] {
        return toolRequests
            .map((req) => {
                const callId = req.callId;

                if (blockedResponses.has(callId)) {
                    return {
                        functionResponse: {
                            name: req.name,
                            response: { error: blockedResponses.get(callId) }
                        }
                    };
                }

                const completedCall = completedCalls.find(
                    (c) => (c.request?.callId || c.callId) === callId
                );
                if (!completedCall) return null;

                const part = completedCall.response?.responseParts?.find(
                    (p: any) => 'functionResponse' in p
                ) as any;

                if (part?.functionResponse?.response) {
                    let scrubbedResponse = DLPService.scrubDeep(part.functionResponse.response);

                    if (
                        sensitiveCalls.has(callId) &&
                        typeof scrubbedResponse === 'object' &&
                        scrubbedResponse !== null
                    ) {
                        if (
                            scrubbedResponse.content &&
                            typeof scrubbedResponse.content === 'string'
                        ) {
                            scrubbedResponse.content = DLPService.scrubEnvContent(
                                scrubbedResponse.content
                            );
                        }
                        if (
                            scrubbedResponse.stdout &&
                            typeof scrubbedResponse.stdout === 'string'
                        ) {
                            scrubbedResponse.stdout = DLPService.scrubEnvContent(
                                scrubbedResponse.stdout
                            );
                        }
                    }

                    part.functionResponse.response = scrubbedResponse;
                }

                // Inject the original callId so LlamaCppGenerator can map it to tool_call_id.
                // We ONLY do this for local inference as the Cloud Gemini API rejects unknown fields.
                if (isLocalInference) {
                    part.id = callId;
                }
                return part;
            })
            .filter(Boolean);
    }

    /**
     * Proactively compress the session history to reclaim context window space.
     * Delegates to Gemini Core's built-in compression.
     */
    public async compressSession(force: boolean = false): Promise<boolean> {
        if (!this.initialized || !this.client) return false;
        const sid = this.currentSessionId || 'unknown';
        logger.info(`🗜️ Triggering session compression (force=${force})...`);
        try {
            if (this.tarsConfig.inferenceBackend === 'llamacpp') {
                const history = this.client.getHistory();
                // We keep the most recent ~60% and ensure the boundary lands on a 'user' role
                // to maintain proper turn alternation (no orphaned tool responses).
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

                        logger.info(
                            `🗜️ Local inference compaction: Summarizing oldest ${historyToCompress.length} turns...`
                        );

                        // Use the local generator non-streamed to summarize the truncated chunk
                        const generator = (this.coreConfig as any).contentGenerator;
                        const hasPreviousSnapshot = historyToCompress.some((c: any) =>
                            c.parts?.some((p: any) => p.text?.includes('<state_snapshot>'))
                        );

                        const anchorInstruction = hasPreviousSnapshot
                            ? 'A previous <state_snapshot> exists in the history. You MUST integrate all still-relevant information from that snapshot into the new one, updating it with the more recent events.'
                            : 'Generate a new <state_snapshot> based on the provided history.';

                        const summaryPrompt = `${anchorInstruction}\nExtract all important constraints, configs, details and tool results from this chunk of history. Format your response cleanly.`;

                        let summaryContent = '';
                        try {
                            const response = await generator.generateContent(
                                {
                                    model: this.tarsConfig.geminiModel,
                                    contents: [
                                        ...historyToCompress,
                                        { role: 'user', parts: [{ text: summaryPrompt }] }
                                    ]
                                },
                                sid
                            );

                            summaryContent =
                                response?.candidates?.[0]?.content?.parts?.[0]?.text || '';
                        } catch (err: any) {
                            logger.warn(`Semantic compression inference failed: ${err.message}`);
                        }

                        if (!summaryContent) {
                            summaryContent =
                                '*(Summary generation failed, falling back to raw truncation)*';
                        }

                        const newHistory = [
                            {
                                role: 'user',
                                parts: [
                                    {
                                        text: `<state_snapshot>\n${summaryContent.trim()}\n</state_snapshot>`
                                    }
                                ]
                            },
                            {
                                role: 'model',
                                parts: [
                                    { text: 'Got it. I will keep this historical context in mind.' }
                                ]
                            },
                            ...tail
                        ];

                        this.client.setHistory(newHistory as any);
                        logger.info(
                            `🗜️ Local inference context compacted: retained tail of ${tail.length} turns + snapshot.`
                        );
                        return true;
                    }
                }
                return false;
            }

            const result = await this.client.tryCompressChat(sid, force);
            logger.info(
                `🗜️ Compression result: status=${result.compressionStatus}, ` +
                    `${result.originalTokenCount} → ${result.newTokenCount} tokens`
            );
            return String(result.compressionStatus) === 'COMPRESSED';
        } catch (e: any) {
            logger.warn(`⚠️ Compression failed: ${e.message}`);
            return false;
        }
    }

    /**
     * Refreshes the system instruction in-place without destroying the session.
     * Used after memory mutations so the model sees updated facts.
     */
    public refreshSystemInstruction(): void {
        if (!this.initialized || !this.client) return;
        this.client.updateSystemInstruction();
        logger.debug('🔄 System instruction refreshed in-place');
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
                    content: DLPService.scrub(thoughtText),
                    sessionId
                };

            case GeminiEventType.ToolCallRequest:
                return {
                    type: 'tool_call',
                    toolName: event.value.name,
                    toolArgs: DLPService.scrubDeep(event.value.args),
                    callId: event.value.callId,
                    sessionId
                };

            case GeminiEventType.ToolCallResponse:
                // resultDisplay can be string | FileDiff | AnsiOutput | TodoList
                // Support both ToolCallResponseInfo and CompletedToolCall payloads
                const val = event.value as any;
                const callInfo = val.response ? val.response : val;

                const display = callInfo.resultDisplay;
                let content = '';

                if (typeof display === 'string') {
                    content = display;
                } else if (display) {
                    content = JSON.stringify(display);
                } else if (callInfo.error) {
                    content = callInfo.error.message;
                }

                return {
                    type: 'tool_response',
                    toolName: val.request?.callId || callInfo.callId,
                    content: DLPService.scrub(content),
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

            case GeminiEventType.ChatCompressed: {
                const info = event.value;
                if (info && info.compressionStatus === CompressionStatus.COMPRESSED) {
                    return {
                        type: 'compressed',
                        content: `🗜️ Session compressed: ${info.originalTokenCount.toLocaleString()} → ${info.newTokenCount.toLocaleString()} tokens`,
                        sessionId
                    };
                }
                return null;
            }

            case GeminiEventType.ContextWindowWillOverflow:
                logger.warn(
                    `⚠️ Context window near overflow: ${event.value.estimatedRequestTokenCount} tokens, ${event.value.remainingTokenCount} remaining`
                );
                return {
                    type: 'context_warning',
                    content: `⚠️ Context window near capacity (${event.value.remainingTokenCount.toLocaleString()} tokens remaining)`,
                    sessionId
                };

            case GeminiEventType.MaxSessionTurns:
                return {
                    type: 'max_turns',
                    content: '⚠️ Maximum session turns reached. Consider compressing the session.',
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
                    logger.info(`📂 Resumed session from exact match: ${sessionFile}`);
                    return {
                        conversation: content,
                        filePath
                    };
                }

                // Fallback: If no exact session ID match, use the most recently
                // modified chat file. This prevents a blank cold start when the
                // Tars session ID has drifted from Core's internal session ID.
                const jsonFiles = files.filter((f) => f.endsWith('.json'));
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
     * Applies runtime overrides to the Gemini client to ensure smooth operation
     * in specific environments (e.g., local inference).
     */
    private applyClientOverrides(client: any): void {
        if (this.tarsConfig.inferenceBackend === 'llamacpp') {
            // The loop detector runs concurrently in the background and causes 400 crashes
            // for local-only setups that don't have a valid Google API key.
            const loopService = client.getLoopDetectionService() as any;
            if (loopService) {
                logger.debug('🔇 Silencing LoopDetectionService for local inference...');
                loopService.queryLoopDetectionModel = async () => {
                    logger.debug('Background loop verification skipped (Local Mode).');
                    return null;
                };
            }
        }
    }
}
