import { Config } from '../config/config.js';
import { TarsEngine, ToolStatus } from './tars-engine.js';
import { SessionManager } from './session-manager.js';
import { GetQuotaTool } from '../tools/get-quota.js';
import { Supervisor } from './supervisor.js';
import { HeartbeatService } from './heartbeat-service.js';
import { CronService } from './cron-service.js';
import { DashboardService } from './dashboard-service.js';
import { ChannelManager } from '../channels/channel-manager.js';
import { ChannelMessage } from '../channels/types.js';
import { TuiChannel } from '../channels/tui/tui-channel.js';
import logger from '../utils/logger.js';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { BrainAuditor } from '../utils/brain-audit.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Result of the bootstrap process. Contains all initialized services.
 */
export interface BootstrapResult {
    config: Config;
    tarsEngine: TarsEngine;
    sessionManager: SessionManager;
    supervisor: Supervisor;
    channelManager: ChannelManager;
    heartbeat: HeartbeatService;
    cron: CronService;
    dashboard: DashboardService;
}

/**
 * Install the fixed system prompt into the Tars home directory.
 */
function installSystemPrompt(config: Config): void {
    let searchDir = __dirname;
    let srcPrompt = '';

    for (let i = 0; i < 5; i++) {
        const candidate = path.join(searchDir, 'prompts', 'system.md');
        const srcCandidate = path.join(searchDir, 'src', 'prompts', 'system.md');

        if (fs.existsSync(candidate)) {
            srcPrompt = candidate;
            break;
        } else if (fs.existsSync(srcCandidate)) {
            srcPrompt = srcCandidate;
            break;
        }
        searchDir = path.dirname(searchDir);
    }

    if (!srcPrompt) {
        logger.warn('⚠️ Could not locate system.md prompt file');
        return;
    }

    const targetDir = path.dirname(config.systemPromptPath);
    fs.mkdirSync(targetDir, { recursive: true });

    let promptContent = fs.readFileSync(srcPrompt, 'utf-8');
    promptContent = promptContent.replace(/{{ASSISTANT_NAME}}/g, config.assistantName);
    promptContent = promptContent.replace(/{{INSTANCE_NAME}}/g, config.instanceName);
    promptContent = promptContent.replace(/{{PROVIDER}}/g, config.piProvider);
    promptContent = promptContent.replace(/{{MODEL_NAME}}/g, config.piModel);
    promptContent = promptContent.replace(
        /{{CONTEXT_WINDOW}}/g,
        config.contextWindowTokens.toLocaleString()
    );

    fs.writeFileSync(config.systemPromptPath, promptContent);
    logger.info(`📝 System prompt installed: ${config.systemPromptPath}`);
}

/**
 * Install and sync built-in skills into the Tars runtime directory.
 */
function installSkills(config: Config): void {
    let searchDir = __dirname;
    let skillsSrc = '';

    for (let i = 0; i < 5; i++) {
        const candidate = path.join(searchDir, 'context', 'skills');
        const srcCandidate = path.join(searchDir, '..', 'context', 'skills');

        if (fs.existsSync(candidate)) {
            skillsSrc = candidate;
            break;
        } else if (fs.existsSync(srcCandidate)) {
            skillsSrc = srcCandidate;
            break;
        }
        const rootCandidate = path.join(searchDir, '..', '..', 'context', 'skills');
        if (fs.existsSync(rootCandidate)) {
            skillsSrc = rootCandidate;
            break;
        }

        searchDir = path.dirname(searchDir);
    }

    if (!skillsSrc) {
        logger.warn('⚠️ Could not locate built-in skills directory');
        return;
    }

    const skillsDest = path.join(config.homeDir, 'skills');

    try {
        if (!fs.existsSync(skillsDest)) {
            fs.mkdirSync(skillsDest, { recursive: true });
        }

        const builtInSkills = fs.readdirSync(skillsSrc);

        for (const skillName of builtInSkills) {
            const srcSkillPath = path.join(skillsSrc, skillName);
            const destSkillPath = path.join(skillsDest, skillName);

            if (!fs.statSync(srcSkillPath).isDirectory()) continue;

            if (fs.existsSync(destSkillPath)) {
                fs.rmSync(destSkillPath, { recursive: true, force: true });
            }

            fs.cpSync(srcSkillPath, destSkillPath, { recursive: true });
        }
    } catch (error) {
        logger.error(`❌ Failed to sync skills: ${error}`);
    }
}

/**
 * Automatically install/link extensions and enable them.
 */
function installExtensions(config: Config): void {
    const repoExtensionsDir = path.join(__dirname, '..', '..', 'extensions');
    const targetExtensionsDir = path.join(config.homeDir, 'extensions');
    const enablementFile = path.join(targetExtensionsDir, 'extension-enablement.json');

    if (!fs.existsSync(repoExtensionsDir)) {
        logger.warn('⚠️ Could not locate extensions directory');
        return;
    }

    if (!fs.existsSync(targetExtensionsDir)) {
        fs.mkdirSync(targetExtensionsDir, { recursive: true });
    }

    let enablement: Record<string, any> = {};
    if (fs.existsSync(enablementFile)) {
        try {
            enablement = JSON.parse(fs.readFileSync(enablementFile, 'utf-8'));
        } catch (e) {
            logger.warn('⚠️ Could not parse extension-enablement.json, starting fresh');
        }
    }

    const builtInExtensions = fs.readdirSync(repoExtensionsDir);
    for (const extName of builtInExtensions) {
        const srcPath = path.resolve(repoExtensionsDir, extName);
        if (!fs.statSync(srcPath).isDirectory()) continue;

        const finalExtName =
            extName === 'tasks'
                ? 'tars-tasks'
                : extName === 'memory'
                  ? 'tars-memory'
                  : extName === 'search'
                    ? 'tars-search'
                    : extName;
        const finalDestPath = path.join(targetExtensionsDir, finalExtName);

        let needsLink = true;
        try {
            if (fs.existsSync(finalDestPath)) {
                const stats = fs.lstatSync(finalDestPath);
                if (stats.isSymbolicLink()) {
                    const realPath = fs.realpathSync(finalDestPath);
                    if (realPath === srcPath) {
                        needsLink = false;
                    }
                }
            }
        } catch (e) {}

        if (needsLink) {
            try {
                if (
                    fs.existsSync(finalDestPath) ||
                    (fs.existsSync(finalDestPath) && fs.lstatSync(finalDestPath).isSymbolicLink())
                ) {
                    fs.rmSync(finalDestPath, { recursive: true, force: true });
                }
                fs.symlinkSync(srcPath, finalDestPath);
                logger.info(`🔌 Integrated extension: ${finalExtName}`);
            } catch (error) {
                logger.error(`❌ Failed to integrate extension ${finalExtName}: ${error}`);
            }
        }

        const nmPath = path.join(finalDestPath, 'node_modules');
        if (!fs.existsSync(nmPath)) {
            logger.info(`💧 Hydrating extension: ${finalExtName}...`);
            try {
                execSync('npm install --production', {
                    cwd: finalDestPath,
                    stdio: 'pipe'
                });

                const pkgPath = path.join(finalDestPath, 'package.json');
                if (fs.existsSync(pkgPath)) {
                    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
                    if (pkg.scripts?.build) {
                        logger.info(`🏗️ Building extension: ${finalExtName}...`);
                        execSync('npm run build', {
                            cwd: finalDestPath,
                            stdio: 'pipe'
                        });
                    }
                }
                logger.info(`✅ Extension ${finalExtName} hydrated successfully.`);
            } catch (e: any) {
                const stdout = e.stdout?.toString();
                const stderr = e.stderr?.toString();
                const out = stderr || stdout || e.message;
                logger.error(`❌ Failed to hydrate extension ${finalExtName}: ${out}`);
            }
        }
    }

    const allInstalledExtensions = fs.readdirSync(targetExtensionsDir);
    for (const extName of allInstalledExtensions) {
        const extPath = path.join(targetExtensionsDir, extName);
        if (extName === 'extension-enablement.json') continue;
        if (!fs.statSync(extPath).isDirectory()) continue;

        const realPath = fs.realpathSync(extPath);

        if (!enablement[extName]) {
            enablement[extName] = { overrides: [] };
        }

        const overrides = new Set(enablement[extName].overrides || []);
        overrides.add(path.join(config.homeDir, '*'));
        overrides.add(path.join(realPath, '*'));

        enablement[extName].overrides = Array.from(overrides);
    }

    fs.writeFileSync(enablementFile, JSON.stringify(enablement, null, 2));
}

/**
 * Install default settings if none exist.
 */
function installDefaultSettings(config: Config): void {
    const settingsTemplate = path.join(
        __dirname,
        '..',
        '..',
        'context',
        'config',
        'settings.json-template'
    );
    const targetSettings = path.join(config.homeDir, 'settings.json');

    if (fs.existsSync(targetSettings)) return;

    if (fs.existsSync(settingsTemplate)) {
        fs.mkdirSync(path.dirname(targetSettings), { recursive: true });
        fs.copyFileSync(settingsTemplate, targetSettings);
        logger.info(`⚙️ Default settings installed: ${targetSettings}`);
    }
}

/**
 * Ensure existing settings.json has required settings
 */
function patchSettings(config: Config): void {
    const targetSettings = path.join(config.homeDir, 'settings.json');
    if (!fs.existsSync(targetSettings)) return;

    const settingsTemplate = path.join(
        __dirname,
        '..',
        '..',
        'context',
        'config',
        'settings.json-template'
    );

    try {
        const raw = fs.readFileSync(targetSettings, 'utf-8');
        const settings = JSON.parse(raw);
        let modified = false;

        if (fs.existsSync(settingsTemplate)) {
            const template = JSON.parse(fs.readFileSync(settingsTemplate, 'utf-8'));
            const sections = ['experimental', 'agents', 'model', 'general'];
            for (const section of sections) {
                if (template[section] && !settings[section]) {
                    settings[section] = template[section];
                    modified = true;
                }
            }
        }

        if (modified) {
            fs.writeFileSync(targetSettings, JSON.stringify(settings, null, 2));
            logger.info('⚙️ Patched settings.json from template.');
        }
    } catch (e: any) {
        logger.warn(`⚠️ Failed to patch settings.json: ${e.message}`);
    }
}

/**
 * Install the built-in dashboard into the Tars home directory.
 */
function installDashboard(config: Config): void {
    const repoDashSrc = path.join(__dirname, '..', '..', 'dash');
    const targetDashDir = path.join(config.homeDir, 'apps', 'dashboard');

    if (!fs.existsSync(repoDashSrc)) {
        logger.warn('⚠️ Could not locate stock dashboard directory');
        return;
    }

    if (!fs.existsSync(targetDashDir)) {
        try {
            fs.mkdirSync(path.dirname(targetDashDir), { recursive: true });
            fs.cpSync(repoDashSrc, targetDashDir, { recursive: true });
            logger.info(`🚚 Installed stock dashboard to ${targetDashDir}`);
        } catch (error) {
            logger.error(`❌ Failed to install stock dashboard: ${error}`);
            return;
        }
    }

    const targetEnv = path.join(targetDashDir, '.env');
    const templateEnv = path.join(targetDashDir, '.env.template');
    if (!fs.existsSync(targetEnv) && fs.existsSync(templateEnv)) {
        try {
            fs.copyFileSync(templateEnv, targetEnv);
            logger.info('⚙️ Created default dashboard .env');
        } catch (e) {}
    }

    const nmPath = path.join(targetDashDir, 'node_modules');
    const nextPath = path.join(targetDashDir, '.next');

    if (!fs.existsSync(nmPath) || !fs.existsSync(nextPath)) {
        logger.info('💧 Hydrating dashboard (this may take a minute)...');
        try {
            const env = { ...process.env };
            delete env.NODE_ENV;

            execSync('npm install', {
                cwd: targetDashDir,
                stdio: 'pipe',
                env
            });

            logger.info('🏗️ Building dashboard...');
            execSync('npm run build', {
                cwd: targetDashDir,
                stdio: 'pipe',
                env
            });

            logger.info('✅ Dashboard hydrated successfully.');
        } catch (e: any) {
            const out = e.stdout?.toString() || e.stderr?.toString() || e.message;
            logger.error(`❌ Failed to hydrate dashboard: ${out}`);
        }
    }
}

/**
 * Format byte size to human-readable string.
 */
function formatSize(chars: number): string {
    if (chars < 1024) return `${chars}B`;
    if (chars < 1024 * 1024) return `${(chars / 1024).toFixed(1)}KB`;
    return `${(chars / (1024 * 1024)).toFixed(1)}MB`;
}

/**
 * Build the status content string for live tool execution updates.
 */
function formatStatusContent(
    turnCount: number,
    recentTools: ToolStatus[],
    sessionManager: SessionManager,
    config: Config
): string {
    const lines: string[] = [];

    // Get current context window stats
    const stats = sessionManager.getStats();
    let contextStr = '';
    if (stats && stats.lastInputTokens > 0) {
        const limit = config.contextWindowTokens;
        const active = stats.lastInputTokens;
        const pct = ((active / limit) * 100).toFixed(1);
        contextStr = ` | ${active.toLocaleString()}/${limit.toLocaleString()} (${pct}%)`;
    }

    const executedCount = recentTools.filter((t) => t.status === 'completed').length;
    const timeStr = new Date().toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });

    lines.push(
        `⏳ **Working...** | Turn ${turnCount} (${executedCount} tools)${contextStr} | ${timeStr}`
    );

    // Show last 5 tool calls (moving window)
    const toolsToShow = recentTools.slice(-5);
    if (toolsToShow.length > 0) {
        lines.push('');
        for (const tool of toolsToShow) {
            if (tool.status === 'running') {
                lines.push(`⚙️ **${tool.name}** — *Executing...*`);
            } else {
                let preview = (tool.responsePreview || '')
                    .replace(/\s+/g, ' ')
                    .replace(/[`*#_\[\]]/g, '')
                    .trim();

                if (preview.length > 80) {
                    preview = preview.substring(0, 77) + '...';
                }
                const size = formatSize(tool.responseSize || 0);
                lines.push(`🛠️ **${tool.name}** — "${preview}" (${size})`);
            }
        }
    }

    return lines.join('\n');
}

/**
 * Options to customize the bootstrap process.
 */
export interface BootstrapOptions {
    /** Skip Discord channel initialization */
    skipDiscord?: boolean;
    /** Skip dashboard installation/hydration */
    skipDashboard?: boolean;
}

/**
 * Shared supervisor bootstrap logic.
 * Used by both main.ts (PM2 background) and chat.ts (foreground TUI).
 *
 * Returns all initialized services but does NOT start them.
 * The caller is responsible for starting channels, heartbeat, cron, etc.
 */
export async function bootstrap(options: BootstrapOptions = {}): Promise<BootstrapResult> {
    // 1. Load Configuration & Audit Brain
    const config = Config.getInstance();

    if (process.env.TARS_CHAT_MODE === 'true') {
        const { configureChatLogging } = await import('../utils/logger.js');
        configureChatLogging(config.homeDir);
    }

    logger.info('🚀 Tars Starting...');

    const auditor = new BrainAuditor(config.homeDir);
    await auditor.audit({ silent: true });

    // 2. Install components
    installSystemPrompt(config);
    installSkills(config);
    installExtensions(config);
    if (!options.skipDashboard) {
        installDashboard(config);
    }
    installDefaultSettings(config);
    patchSettings(config);

    // 3. Initialize Core Services
    const tarsEngine = new TarsEngine(config);
    const sessionManager = new SessionManager(config.sessionFilePath);
    const supervisor = new Supervisor(tarsEngine, sessionManager);

    // 4. Initialize Multi-Channel Interface
    const channelManager = new ChannelManager();

    // 5. Inject Interface into Engine
    tarsEngine.setChannelManager(channelManager);
    supervisor.setChannelManager(channelManager);
    tarsEngine.setSessionManager(sessionManager);
    await tarsEngine.initialize();

    // 6. Initialize Background Services
    const heartbeat = new HeartbeatService(supervisor, config, sessionManager);
    const cron = new CronService(supervisor, config, channelManager);
    const dashboard = new DashboardService(config);

    return {
        config,
        tarsEngine,
        sessionManager,
        supervisor,
        channelManager,
        heartbeat,
        cron,
        dashboard
    };
}

/**
 * Wire the shared message routing logic onto a channel manager.
 * Handles slash commands (/reset, /clear, /quota, /stats, /help) and
 * forwards all other messages to the supervisor for AI processing.
 *
 * The optional `tuiChannel` parameter enables real-time token streaming
 * when the active channel is a TUI (instead of Discord-style buffering).
 */
export function wireMessageRouting(
    channelManager: ChannelManager,
    supervisor: Supervisor,
    sessionManager: SessionManager,
    tarsEngine: TarsEngine,
    config: Config,
    tuiChannel?: TuiChannel
): void {
    channelManager.onMessage(async (message: ChannelMessage) => {
        const rawPrompt = message.content.trim();

        // Intercept Tavily Search API key if pasted or provided by the user
        const tavilyKeyMatch = rawPrompt.match(/\b(tvly-[a-zA-Z0-9]{20,})\b/i);
        if (tavilyKeyMatch) {
            const key = tavilyKeyMatch[1];
            try {
                const { SecretsManager } = await import('../utils/secrets-manager.js');
                const secretsManager = new SecretsManager(config.homeDir);
                secretsManager.set('TAVILY_API_KEY', key);
                process.env.TAVILY_API_KEY = key;

                // Reset the active session and start a new clean conversation.
                try {
                    const stats = sessionManager.getStats();
                    if (stats) {
                        const chatFile = path.join(
                            config.homeDir,
                            'chats',
                            `${stats.sessionId}.json`
                        );
                        if (fs.existsSync(chatFile)) {
                            await fs.promises.unlink(chatFile).catch(() => {});
                        }
                    }
                    await sessionManager.clear();
                    tarsEngine.resetSession();
                } catch (e: any) {
                    logger.error(`Error resetting session: ${e.message}`);
                }

                await message.reply(
                    '🔑 **Tavily API Key Configured!**\n' +
                        'I have successfully saved your Tavily API key and restarted the session. ' +
                        'You can now try your web search again!'
                );
            } catch (err: any) {
                logger.error(`Failed to configure Tavily API Key: ${err.message}`);
                await message.reply(`❌ **Failed to configure Tavily API Key:** ${err.message}`);
            }
            message.stopTyping();
            return;
        }

        if (rawPrompt.startsWith('/')) {
            const parts = rawPrompt.split(' ');
            const command = parts[0].toLowerCase();

            if (command === '/reset' || command === '/clear') {
                try {
                    const stats = sessionManager.getStats();
                    if (stats) {
                        const chatFile = path.join(
                            config.homeDir,
                            'chats',
                            `${stats.sessionId}.json`
                        );
                        if (fs.existsSync(chatFile)) {
                            await fs.promises.unlink(chatFile).catch(() => {});
                        }
                    }
                    await sessionManager.clear();
                    tarsEngine.resetSession();
                    await message.reply(
                        '✨ **Session Reset:** I have cleared the current session context and started a new, clean conversation.'
                    );
                } catch (e: any) {
                    await message.reply(`❌ **Error resetting session:** ${e.message}`);
                }
                message.stopTyping();
                return;
            }

            if (command === '/quota' || command === '/stats') {
                const stats = sessionManager.getStats();
                if (!stats) {
                    await message.reply('📊 **No active session stats found.**');
                    message.stopTyping();
                    return;
                }

                const quotaTool = new GetQuotaTool(sessionManager, {
                    piProvider: config.piProvider,
                    contextWindowTokens: config.contextWindowTokens,
                    piModel: config.piModel,
                    piBaseUrl: config.piBaseUrl
                });

                const usageText = quotaTool.getLocalUsage();
                await message.reply(usageText);
                message.stopTyping();
                return;
            }

            if (command === '/help') {
                const helpText = [
                    `🤖 **Tars Deterministic Commands**`,
                    `• \`/reset\` or \`/clear\` - Reset active session and start a new clean conversation.`,
                    `• \`/quota\` or \`/stats\` - View token consumption, active context size, and session statistics.`,
                    `• \`/help\` - Show this help menu.`
                ].join('\n');
                await message.reply(helpText);
                message.stopTyping();
                return;
            }
        }

        // Determine if the message came from the TUI channel
        const isTui = message.channelId === 'tui' && tuiChannel;

        let responseBuffer = '';
        let replyCount = 0;

        // --- Live status tracking for in-place message editing ---
        let statusInitialized = false;

        const updateStatus = async (
            turnCount: number,
            recentTools: ToolStatus[],
            isMilestone: boolean
        ): Promise<void> => {
            const content = formatStatusContent(turnCount, recentTools, sessionManager, config);

            if (!statusInitialized) {
                await channelManager.notify(content);
                statusInitialized = true;
            } else {
                const edited = await channelManager.editStatus(content);
                if (!edited) {
                    logger.warn('[Main] Status edit failed, sending new notification.');
                    statusInitialized = false;
                    await channelManager.notify(content);
                    statusInitialized = true;
                }
            }
        };

        const flush = async (isDone = false) => {
            const text = responseBuffer.trim();
            if (!text) return;

            let finalContent = text;
            // Prepend the binding alert to the first message if we just auto-bound
            if (replyCount === 0 && message.metadata?.wasAutoBound) {
                finalContent = `🔒 **System Alert:** I have permanently bound my background notification channel to your Discord account.\n\n${finalContent}`;
            }

            if (isDone) {
                const stats = sessionManager.getStats();
                if (stats && stats.lastInputTokens > 0) {
                    const limit = config.contextWindowTokens;
                    const active = stats.lastInputTokens;
                    const pct = ((active / limit) * 100).toFixed(1);
                    const thresholdPct = (config.compressionThreshold * 100).toFixed(1);
                    finalContent += `\n\n*${active.toLocaleString()}/${limit.toLocaleString()} (${pct}%, compaction at ${thresholdPct}%)*`;
                }
            }

            await message.reply(finalContent);
            responseBuffer = '';
            replyCount++;
        };

        // Clear any previous status message for a fresh start
        channelManager.clearStatus();
        statusInitialized = false;

        // Feature flag: status updates are per-backend
        const statusEnabled = config.isStatusUpdatesEnabled();
        if (!statusEnabled) {
            logger.debug(
                `[Main] Status updates disabled for backend "${config.inferenceBackend}".`
            );
        }

        try {
            message.startTyping();
            await supervisor.run(
                message.content,
                async (event) => {
                    if (event.type === 'text' && event.content && event.role !== 'user') {
                        if (isTui) {
                            // TUI: stream tokens directly to terminal
                            // Clear status lines before first streamed text
                            if (!responseBuffer) {
                                channelManager.clearStatus();
                                statusInitialized = false;
                            }
                            tuiChannel!.streamText(event.content);
                            responseBuffer += event.content; // Track for length, not for flushing
                        } else {
                            // Discord: buffer text for batch reply
                            responseBuffer += event.content;
                        }
                    } else if (event.type === 'tool_call') {
                        // Local models emit reasoning before a tool call. By clearing the buffer, we suppress it.
                        if (isTui && responseBuffer) {
                            // If we streamed partial text, add a newline before status
                            tuiChannel!.streamText('\n');
                        }
                        responseBuffer = '';
                    } else if (event.type === 'error') {
                        if (isTui) {
                            channelManager.clearStatus();
                            statusInitialized = false;
                        }
                        await flush();
                        await message.reply(`❌ **Error:** ${event.error}`);
                    } else if (event.type === 'done') {
                        if (isTui) {
                            // TUI: text was already streamed, just print footer
                            channelManager.clearStatus();
                            statusInitialized = false;

                            const stats = sessionManager.getStats();
                            if (stats && stats.lastInputTokens > 0) {
                                const { TuiRenderer } =
                                    await import('../channels/tui/tui-renderer.js');
                                const footer = TuiRenderer.renderFooter(
                                    stats.lastInputTokens,
                                    config.contextWindowTokens,
                                    config.compressionThreshold
                                );
                                tuiChannel!.streamText('\n\n' + footer + '\n');
                            } else {
                                tuiChannel!.streamText('\n\n');
                            }
                            responseBuffer = '';
                            replyCount++;
                        } else {
                            await flush(true);
                        }
                    }
                },
                undefined,
                message.attachments,
                statusEnabled ? updateStatus : undefined
            );
        } catch (error: any) {
            const errorMsg =
                error.message ||
                (typeof error === 'object' ? JSON.stringify(error) : String(error));
            logger.error(`Routing error: ${errorMsg}`);
            await message.reply(`❌ **Supervisor Error:** ${errorMsg}`);
        } finally {
            message.stopTyping();
        }
    });
}
