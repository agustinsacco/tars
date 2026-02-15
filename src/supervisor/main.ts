import { Config } from '../config/Config.js';
import { GeminiCli } from './GeminiCli.js';
import { SessionManager } from './SessionManager.js';
import { Supervisor } from './Supervisor.js';
import { HeartbeatService } from './HeartbeatService.js';
import { DiscordBot } from '../discord/DiscordBot.js';
import logger from '../utils/Logger.js';

/**
 * Tars Main Entry Point
 */
async function main() {
    try {
        logger.info('🚀 Tars Starting...');

        // 1. Load Configuration
        const config = Config.getInstance();

        // 2. Initialize Core Services
        const gemini = new GeminiCli(config.geminiModel);
        const sessionManager = new SessionManager(config.sessionFilePath);
        const supervisor = new Supervisor(gemini, sessionManager);

        // 3. Initialize Heartbeat (Background Tasks)
        const heartbeat = new HeartbeatService(supervisor, config);

        // 4. Initialize Interface (Discord)
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
