import { bootstrap, wireMessageRouting } from './bootstrap.js';
import logger from '../utils/logger.js';

/**
 * Tars Main Entry Point (PM2 Background Mode)
 */
async function main() {
    try {
        const {
            config,
            tarsEngine,
            sessionManager,
            supervisor,
            channelManager,
            heartbeat,
            cron,
            dashboard
        } = await bootstrap();

        // Wire message routing (shared slash commands + event handling)
        wireMessageRouting(channelManager, supervisor, sessionManager, tarsEngine, config);

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
            await dashboard.stop();
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
