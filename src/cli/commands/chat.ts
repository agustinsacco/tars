import chalk from 'chalk';
import { bootstrap, wireMessageRouting } from '../../supervisor/bootstrap.js';
import { TuiChannel } from '../../channels/tui/tui-channel.js';
import logger from '../../utils/logger.js';

/**
 * `tars chat` — Start an interactive terminal chat session.
 *
 * Runs the full supervisor in the foreground with the TUI channel attached.
 * Shares the same Pi session as the PM2 background supervisor.
 */
export async function chat(options: { discord?: boolean } = {}): Promise<void> {
    // Set supervisor mode so the bootstrap runs correctly
    process.env.TARS_SUPERVISOR_MODE = 'true';
    process.env.TARS_CHAT_MODE = 'true';

    try {
        const skipDiscord = options.discord === false;

        const {
            config,
            tarsEngine,
            sessionManager,
            supervisor,
            channelManager,
            heartbeat,
            cron,
            dashboard
        } = await bootstrap({
            skipDashboard: true // Don't install/hydrate dashboard in chat mode
        });

        // Create the TUI channel
        const tuiChannel = new TuiChannel({
            onExit: async () => {
                logger.info('🛑 Shutting down from TUI...');
                await channelManager.stop();
                heartbeat.stop();
                cron.stop();
            }
        });

        // Register the TUI channel
        channelManager.registerChannel(tuiChannel);

        // Wire message routing with TUI streaming support
        wireMessageRouting(
            channelManager,
            supervisor,
            sessionManager,
            tarsEngine,
            config,
            tuiChannel
        );

        // Start services
        await channelManager.start();
        await heartbeat.start();
        await cron.start();

        // Graceful shutdown on SIGINT (Ctrl+C)
        process.on('SIGINT', async () => {
            console.log(chalk.dim('\n\n👋 Goodbye.\n'));
            await channelManager.stop();
            heartbeat.stop();
            cron.stop();
            process.exit(0);
        });
    } catch (error: any) {
        console.error(chalk.red(`💥 Failed to start chat: ${error.message}`));
        process.exit(1);
    }
}
