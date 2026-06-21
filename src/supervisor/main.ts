import { Config } from '../config/config.js';
import { GeminiEngine } from './gemini-engine.js';
import { SessionManager } from './session-manager.js';
import { Supervisor } from './supervisor.js';
import { HeartbeatService } from './heartbeat-service.js';
import { CronService } from './cron-service.js';
import { DashboardService } from './dashboard-service.js';
import { ChannelManager } from '../channels/channel-manager.js';
import logger from '../utils/logger.js';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { BrainAuditor } from '../utils/brain-audit.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Install the fixed system prompt into the Tars home directory.
 * This ensures Gemini CLI uses Tars' custom persona instead of the default coding-centric prompt.
 */
function installSystemPrompt(config: Config): void {
    // Walk up from dist/supervisor/ or src/supervisor/ to find prompts/system.md
    let searchDir = __dirname;
    let srcPrompt = '';

    // Try to find the prompt relative to the package root
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

    // Ensure target directory exists
    const targetDir = path.dirname(config.systemPromptPath);
    fs.mkdirSync(targetDir, { recursive: true });

    // Read the template and process placeholders
    let promptContent = fs.readFileSync(srcPrompt, 'utf-8');
    promptContent = promptContent.replace(/{{ASSISTANT_NAME}}/g, config.assistantName);
    promptContent = promptContent.replace(/{{INSTANCE_NAME}}/g, config.instanceName);
    promptContent = promptContent.replace(/{{PROVIDER}}/g, config.piProvider);
    promptContent = promptContent.replace(/{{MODEL_NAME}}/g, config.piModel);
    promptContent = promptContent.replace(
        /{{CONTEXT_WINDOW}}/g,
        config.contextWindowTokens.toLocaleString()
    );

    // Always overwrite to ensure latest prompt is deployed
    fs.writeFileSync(config.systemPromptPath, promptContent);
    logger.info(`📝 System prompt installed: ${config.systemPromptPath}`);
}

/**
 * Install and sync built-in skills into the Tars runtime directory.
 * Safely updates built-in skills while preserving user-created ones.
 */
function installSkills(config: Config): void {
    // 1. Locate context/skills/ in the repo
    let searchDir = __dirname;
    let skillsSrc = '';

    for (let i = 0; i < 5; i++) {
        const candidate = path.join(searchDir, 'context', 'skills');
        const srcCandidate = path.join(searchDir, '..', 'context', 'skills'); // If in dist/supervisor/

        if (fs.existsSync(candidate)) {
            skillsSrc = candidate;
            break;
        } else if (fs.existsSync(srcCandidate)) {
            skillsSrc = srcCandidate;
            break;
        }
        // Try finding context in root if running from src
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

    // 2. Define target directory (~/.tars/skills)
    const skillsDest = path.join(config.homeDir, 'skills');

    try {
        if (!fs.existsSync(skillsDest)) {
            fs.mkdirSync(skillsDest, { recursive: true });
        }

        // 3. Selective Sync: Copy each built-in skill individually
        const builtInSkills = fs.readdirSync(skillsSrc);

        for (const skillName of builtInSkills) {
            const srcSkillPath = path.join(skillsSrc, skillName);
            const destSkillPath = path.join(skillsDest, skillName);

            // Only copy directories
            if (!fs.statSync(srcSkillPath).isDirectory()) continue;

            // Remove existing destination (to ensure clean update - e.g. deleting old files)
            if (fs.existsSync(destSkillPath)) {
                fs.rmSync(destSkillPath, { recursive: true, force: true });
            }

            // Copy fresh from repo
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

    // Load Enablement
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
            extName === 'tasks' ? 'tars-tasks' : extName === 'memory' ? 'tars-memory' : extName;
        const finalDestPath = path.join(targetExtensionsDir, finalExtName);

        // Check if symlink exists and is valid
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

        // Hydration check
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

    // Update enablement
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
 * Safely copies the dashboard and hydrates it (npm install + npm build).
 */
function installDashboard(config: Config): void {
    const repoDashSrc = path.join(__dirname, '..', '..', 'dash');
    const targetDashDir = path.join(config.homeDir, 'apps', 'dashboard');

    if (!fs.existsSync(repoDashSrc)) {
        logger.warn('⚠️ Could not locate stock dashboard directory');
        return;
    }

    // 1. Initial Copy if missing
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

    // 2. Setup Default .env if missing
    const targetEnv = path.join(targetDashDir, '.env');
    const templateEnv = path.join(targetDashDir, '.env.template');
    if (!fs.existsSync(targetEnv) && fs.existsSync(templateEnv)) {
        try {
            fs.copyFileSync(templateEnv, targetEnv);
            logger.info('⚙️ Created default dashboard .env');
        } catch (e) {}
    }

    // 3. Hydration (npm install + build) if node_modules or .next missing
    const nmPath = path.join(targetDashDir, 'node_modules');
    const nextPath = path.join(targetDashDir, '.next');

    if (!fs.existsSync(nmPath) || !fs.existsSync(nextPath)) {
        logger.info('💧 Hydrating dashboard (this may take a minute)...');
        try {
            // Unset NODE_ENV temporarily to ensure devDependencies (like tailwind) are installed for build
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
 * Tars Main Entry Point
 */
async function main() {
    try {
        logger.info('🚀 Tars Starting...');

        // 1. Load Configuration & Audit Brain
        const config = Config.getInstance();
        const auditor = new BrainAuditor(config.homeDir);
        await auditor.audit({ silent: true });

        // 2. Install components
        installSystemPrompt(config);
        installSkills(config);
        installExtensions(config);
        installDashboard(config);
        installDefaultSettings(config);
        patchSettings(config);

        // 3. Initialize Core Services
        const gemini = new GeminiEngine(config);
        const sessionManager = new SessionManager(config.sessionFilePath);
        const supervisor = new Supervisor(gemini, sessionManager);

        // 4. Initialize Multi-Channel Interface
        const channelManager = new ChannelManager();

        // 5. Inject Interface into Engine
        gemini.setChannelManager(channelManager);
        gemini.setSessionManager(sessionManager);
        await gemini.initialize();

        // 6. Connect Routing
        channelManager.onMessage(async (message) => {
            let responseBuffer = '';
            let replyCount = 0;

            // --- Live status tracking for in-place message editing ---
            let statusInitialized = false;

            const formatSize = (chars: number): string => {
                if (chars < 1024) return `${chars}B`;
                if (chars < 1024 * 1024) return `${(chars / 1024).toFixed(1)}KB`;
                return `${(chars / (1024 * 1024)).toFixed(1)}MB`;
            };

            const formatStatusContent = (
                turnCount: number,
                recentTools: Array<{ name: string; responsePreview: string; responseSize: number }>,
                isMilestone: boolean
            ): string => {
                const lines: string[] = [];

                if (isMilestone) {
                    lines.push(`⚡ **Milestone ${turnCount}** — still going strong...`);
                    lines.push('');
                }

                lines.push(
                    `⏳ **Working...** (Turn ${turnCount}, ${recentTools.length} tools executed)`
                );
                lines.push('');

                // Show last ~8 tool calls
                const toolsToShow = recentTools.slice(-8);
                for (const tool of toolsToShow) {
                    const preview = tool.responsePreview
                        .replace(/\n/g, ' ')
                        .replace(/\*\*/g, '')
                        .substring(0, 80);
                    const size = formatSize(tool.responseSize);
                    lines.push(`🛠️ **${tool.name}** — \`${preview}\` (${size})`);
                }

                lines.push('');
                lines.push(`_Last update: ${new Date().toLocaleTimeString()}_`);

                return lines.join('\n');
            };

            const updateStatus = async (
                turnCount: number,
                recentTools: Array<{ name: string; responsePreview: string; responseSize: number }>,
                isMilestone: boolean
            ): Promise<void> => {
                const content = formatStatusContent(turnCount, recentTools, isMilestone);

                if (!statusInitialized) {
                    // First status: send a new notification (tracks the message for editing)
                    await channelManager.notify(content);
                    statusInitialized = true;
                } else {
                    // Subsequent: edit the tracked message in-place
                    const edited = await channelManager.editStatus(content);
                    if (!edited) {
                        // Edit failed (rate-limited or message lost) — send fresh and re-track
                        logger.warn('[Main] Status edit failed, sending new notification.');
                        statusInitialized = false;
                        await channelManager.notify(content);
                        statusInitialized = true;
                    }
                }
            };

            const flush = async () => {
                const text = responseBuffer.trim();
                if (!text) return;

                let finalContent = text;
                // Prepend the binding alert to the first message if we just auto-bound
                if (replyCount === 0 && message.metadata?.wasAutoBound) {
                    finalContent = `🔒 **System Alert:** I have permanently bound my background notification channel to your Discord account.\n\n${finalContent}`;
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
                            responseBuffer += event.content;
                        } else if (event.type === 'tool_call') {
                            // Local models emit reasoning before a tool call. By clearing the buffer, we suppress it.
                            responseBuffer = '';
                        } else if (event.type === 'error') {
                            await flush();
                            await message.reply(`❌ **Error:** ${event.error}`);
                        } else if (event.type === 'done') {
                            await flush();
                        }
                    },
                    undefined,
                    message.attachments,
                    statusEnabled ? updateStatus : undefined // gated by feature flag
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

        // 7. Initialize Background Services
        const heartbeat = new HeartbeatService(supervisor, config, sessionManager);
        const cron = new CronService(supervisor, config, channelManager);
        const dashboard = new DashboardService(config);

        // Start everything
        await channelManager.start();
        await heartbeat.start();
        await cron.start();
        await dashboard.start();

        logger.info('✨ Tars successfully initialized and running.');

        // Graceful shutdown
        process.on('SIGINT', async () => {
            logger.info('🛑 Shutting down...');
            await channelManager.stop();
            heartbeat.stop();
            cron.stop();
            dashboard.stop();
            process.exit(0);
        });
    } catch (error: any) {
        const errorMsg =
            error.message || (typeof error === 'object' ? JSON.stringify(error) : String(error));
        logger.error(`💥 Fatal error during startup: ${errorMsg}`);
        process.exit(1);
    }
}

if (process.env.TARS_SUPERVISOR_MODE !== 'true') {
    logger.error('❌ TARS_SUPERVISOR_MODE=true is required to start the supervisor.');
    process.exit(1);
}

main();
