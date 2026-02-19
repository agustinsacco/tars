import { Config } from '../config/config.js';
import { GeminiCli } from './gemini-cli.js';
import { SessionManager } from './session-manager.js';
import { Supervisor } from './supervisor.js';
import { HeartbeatService } from './heartbeat-service.js';
import { DiscordBot } from '../discord/discord-bot.js';
import logger from '../utils/logger.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

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

    // Always overwrite to ensure latest prompt is deployed
    fs.copyFileSync(srcPrompt, config.systemPromptPath);
    logger.info(`📝 System prompt installed: ${config.systemPromptPath}`);
}

/**
 * Install built-in skills into the Tars runtime directory.
 */
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
            // This assumes built-in skills are managed entirely by the repo
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
 * Automatically install/link extensions and enable them.
 * Verifies symlinks are valid and re-links if broken.
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

        const finalExtName = extName === 'tasks' ? 'tars-tasks' : extName;
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
        } catch (e) { }

        if (needsLink) {
            try {
                if (fs.existsSync(finalDestPath) || (fs.existsSync(finalDestPath) && fs.lstatSync(finalDestPath).isSymbolicLink())) {
                    fs.rmSync(finalDestPath, { recursive: true, force: true });
                }
                fs.symlinkSync(srcPath, finalDestPath, 'dir');
                logger.info(`🔌 Linked extension: ${finalExtName} -> ${srcPath}`);
            } catch (error) {
                logger.error(`❌ Failed to link extension ${finalExtName}: ${error}`);
            }
        }
    }

    // 3. Scan installation directory for ALL extensions (including manually added ones)
    const allInstalledExtensions = fs.readdirSync(targetExtensionsDir);
    for (const extName of allInstalledExtensions) {
        const extPath = path.join(targetExtensionsDir, extName);
        if (extName === 'extension-enablement.json') continue;
        if (!fs.statSync(extPath).isDirectory()) continue;

        // Resolve real path (critical for symlinks to satisfy Gemini workspace safety)
        const realPath = fs.realpathSync(extPath);

        // Ensure enabled with permissive overrides
        if (!enablement[extName]) {
            enablement[extName] = { overrides: [] };
        }

        const overrides = new Set(enablement[extName].overrides || []);
        overrides.add(path.join(config.homeDir, '*'));
        overrides.add(path.join(realPath, '*'));

        enablement[extName].overrides = Array.from(overrides);
        logger.debug(`🔧 Configured safety overrides for ${extName}: ${enablement[extName].overrides.join(', ')}`);
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
    } else {
        logger.warn('⚠️ Could not locate settings.json-template');
    }
}

/**
 * Tars Main Entry Point
 */
async function main() {
    try {
        logger.info('🚀 Tars Starting...');

        // 1. Load Configuration
        const config = Config.getInstance();

        // 2. Install system prompt, skills, extensions and settings
        installSystemPrompt(config);
        installSkills(config);
        installExtensions(config);
        installDefaultSettings(config);

        // 3. Initialize Core Services
        const gemini = new GeminiCli(config);
        const sessionManager = new SessionManager(config.sessionFilePath);
        const supervisor = new Supervisor(gemini, sessionManager);

        // 4. Initialize Heartbeat (Background Tasks)
        const heartbeat = new HeartbeatService(supervisor, config);

        // 5. Initialize Interface (Discord)
        const discordBot = new DiscordBot(supervisor, config);

        // Start Services
        await discordBot.start();
        await heartbeat.start();

        logger.info('✨ Tars successfully initialized and running.');

        // Graceful shutdown
        process.on('SIGINT', async () => {
            logger.info('🛑 Shutting down...');
            heartbeat.stop();
            process.exit(0);
        });
    } catch (error: any) {
        logger.error(`💥 Fatal error during startup: ${error.message}`);
        process.exit(1);
    }
}

// 6. Run Main
// Strict Safety Check: The supervisor must be explicitly activated via environment variable.
// This prevents accidental execution via "node dist/supervisor/main.js" which can spawn zombie processes.
if (process.env.TARS_SUPERVISOR_MODE !== 'true') {
    logger.error('❌ TARS_SUPERVISOR_MODE=true is required to start the supervisor.');
    logger.error('   This safety check prevents accidental multiple instances.');
    logger.error('👉 Use "tars start" or "npm run dev" instead.');
    process.exit(1);
}

main();
