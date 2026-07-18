import chalk from 'chalk';
import { bootstrap, wireMessageRouting } from '../../supervisor/bootstrap.js';
import { TuiChannel } from '../../channels/tui/tui-channel.js';
import logger from '../../utils/logger.js';
import { assertTarsHomeInactive } from '../../utils/pm2-processes.js';
import { getTarsHome } from '../../utils/paths.js';
import { withTarsStartupLock } from '../../utils/startup-lock.js';
import { acquireForegroundChatLease, type TarsHomeLease } from '../../utils/tars-home-lease.js';

/**
 * `tars chat` — Start an interactive terminal chat session.
 *
 * Runs an interactive foreground client with the TUI channel attached.
 * The PM2 instance must be stopped to prevent concurrent transcript writes.
 */
export async function chat(options: { discord?: boolean } = {}): Promise<void> {
    // Set supervisor mode so the bootstrap runs correctly
    process.env.TARS_SUPERVISOR_MODE = 'true';
    process.env.TARS_CHAT_MODE = 'true';

    let lease: TarsHomeLease | undefined;
    let removeShutdownListeners = (): void => undefined;
    try {
        const tarsHome = getTarsHome();
        lease = await withTarsStartupLock(tarsHome, async () => {
            await assertTarsHomeInactive(tarsHome, 'start foreground chat');
            return acquireForegroundChatLease(tarsHome);
        });
        const skipDiscord = options.discord === false;

        const { config, tarsEngine, sessionManager, supervisor, channelManager } = await bootstrap({
            skipDashboard: true,
            skipDiscord
        });

        let shutdownPromise: Promise<void> | undefined;
        const shutdown = (): Promise<void> => {
            if (shutdownPromise) return shutdownPromise;
            shutdownPromise = (async (): Promise<void> => {
                removeShutdownListeners();
                try {
                    await channelManager.stop();
                } finally {
                    try {
                        await tarsEngine.shutdown();
                    } finally {
                        await lease?.release();
                    }
                }
            })();
            return shutdownPromise;
        };

        // Create the TUI channel
        const tuiChannel = new TuiChannel({
            onExit: async () => {
                logger.info('🛑 Shutting down from TUI...');
                await shutdown();
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

        // The foreground client owns channels only. Heartbeat and Cron remain
        // single-owner services in the PM2 daemon.
        await channelManager.start();

        const handleSignal = async (): Promise<void> => {
            console.log(chalk.dim('\n\n👋 Goodbye.\n'));
            await shutdown();
            process.exit(0);
        };
        process.once('SIGINT', handleSignal);
        process.once('SIGTERM', handleSignal);
        removeShutdownListeners = (): void => {
            process.off('SIGINT', handleSignal);
            process.off('SIGTERM', handleSignal);
        };
    } catch (error: unknown) {
        removeShutdownListeners();
        await lease?.release().catch(() => undefined);
        const message = error instanceof Error ? error.message : String(error);
        console.error(chalk.red(`💥 Failed to start chat: ${message}`));
        process.exit(1);
    }
}
