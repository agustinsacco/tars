import { Config } from '../config/config.js';
import { GeminiEngine } from './gemini-engine.js';
import { SessionManager } from './session-manager.js';
import { Supervisor } from './supervisor.js';
import { HeartbeatService } from './heartbeat-service.js';
import { CronService } from './cron-service.js';
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
    promptContent = promptContent.replace(/{{INSTANCE_ROLE}}/g, config.instanceRole);

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

    // 2. Define target directory (~/.tars/.gemini/skills)
    const skillsDest = path.join(config.homeDir, '.gemini', 'skills');

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
            logger.info(`📚 Skill synced: ${skillName}`);
        }
    } catch (error) {
        logger.error(`❌ Failed to sync skills: ${error}`);
    }
}

/**
 * Install and sync built-in agents into the Tars runtime directory.
 */
function installAgents(config: Config): void {
    let searchDir = __dirname;
    let agentsSrc = '';

    for (let i = 0; i < 5; i++) {
        const candidate = path.join(searchDir, 'context', 'agents');
        const srcCandidate = path.join(searchDir, '..', 'context', 'agents');

        if (fs.existsSync(candidate)) {
            agentsSrc = candidate;
            break;
        } else if (fs.existsSync(srcCandidate)) {
            agentsSrc = srcCandidate;
            break;
        }
        const rootCandidate = path.join(searchDir, '..', '..', 'context', 'agents');
        if (fs.existsSync(rootCandidate)) {
            agentsSrc = rootCandidate;
            break;
        }

        searchDir = path.dirname(searchDir);
    }

    if (!agentsSrc) {
        logger.warn('⚠️ Could not locate built-in agents directory');
        return;
    }

    const agentsDest = path.join(config.homeDir, '.gemini', 'agents');

    try {
        if (!fs.existsSync(agentsDest)) {
            fs.mkdirSync(agentsDest, { recursive: true });
        }

        const builtInAgents = fs.readdirSync(agentsSrc);

        for (const agentName of builtInAgents) {
            const srcAgentPath = path.join(agentsSrc, agentName);
            const destAgentPath = path.join(agentsDest, agentName);

            if (!fs.statSync(srcAgentPath).isFile() || !agentName.endsWith('.md')) continue;

            fs.copyFileSync(srcAgentPath, destAgentPath);
            logger.info(`🤖 Agent synced: ${agentName}`);
        }
    } catch (error) {
        logger.error(`❌ Failed to sync agents: ${error}`);
    }
}

/**
 * Automatically install/link extensions and enable them.
 */
function installExtensions(config: Config): void {
    const repoExtensionsDir = path.join(__dirname, '..', '..', 'extensions');
    const targetExtensionsDir = path.join(config.homeDir, '.gemini', 'extensions');
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
                const out = e.stdout?.toString() || e.stderr?.toString() || e.message;
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
    const targetSettings = path.join(config.homeDir, '.gemini', 'settings.json');

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
    const targetSettings = path.join(config.homeDir, '.gemini', 'settings.json');
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
        installAgents(config);
        installExtensions(config);
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
        await gemini.initialize();

        // 6. Connect Routing
        channelManager.onMessage(async (message) => {
            let responseBuffer = '';
            let replyCount = 0;

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

            try {
                await supervisor.run(
                    message.content,
                    async (event) => {
                        if (event.type === 'text' && event.content && event.role !== 'user') {
                            responseBuffer += event.content;
                        } else if (event.type === 'tool_call') {
                            // If the model had something to say before calling a tool, send it now
                            // so the user knows what's happening.
                            await flush();
                        } else if (event.type === 'error') {
                            await flush();
                            await message.reply(`❌ **Error:** ${event.error}`);
                        } else if (event.type === 'done') {
                            await flush();
                        }
                    },
                    undefined,
                    message.attachments
                );
            } catch (error: any) {
                logger.error(`Routing error: ${error.message}`);
                await message.reply(`❌ **Supervisor Error:** ${error.message}`);
            }
        });

        // 7. Initialize Background Services
        const heartbeat = new HeartbeatService(supervisor, config, sessionManager);
        const cron = new CronService(supervisor, config, channelManager);

        // Start everything
        await channelManager.start();
        await heartbeat.start();
        await cron.start();

        logger.info('✨ Tars successfully initialized and running.');

        // Graceful shutdown
        process.on('SIGINT', async () => {
            logger.info('🛑 Shutting down...');
            await channelManager.stop();
            heartbeat.stop();
            cron.stop();
            process.exit(0);
        });
    } catch (error: any) {
        logger.error(`💥 Fatal error during startup: ${error.message}`);
        process.exit(1);
    }
}

if (process.env.TARS_SUPERVISOR_MODE !== 'true') {
    logger.error('❌ TARS_SUPERVISOR_MODE=true is required to start the supervisor.');
    process.exit(1);
}

main();
