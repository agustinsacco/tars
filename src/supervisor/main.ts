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
    // config.homeDir is ~/.tars. We assume .gemini structure.
    const skillsDest = path.join(config.homeDir, '.gemini', 'skills');

    try {
        if (!fs.existsSync(skillsDest)) {
            fs.mkdirSync(skillsDest, { recursive: true });
        }

        // 3. Recursive Copy (Node 16.7+)
        fs.cpSync(skillsSrc, skillsDest, { recursive: true, force: true });
        logger.info(`📚 Skills installed: ${skillsDest}`);
    } catch (error) {
        logger.error(`❌ Failed to install skills: ${error}`);
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

        // 2. Install system prompt and skills
        installSystemPrompt(config);
        installSkills(config);

        // 3. Initialize Core Services
        const gemini = new GeminiCli(config.geminiModel);
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

main();
