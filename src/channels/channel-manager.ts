import { CommunicationChannel, ChannelMessage } from './types.js';
import { DiscordChannel } from './discord/discord-channel.js';
import { WhatsAppChannel } from './whatsapp/whatsapp-channel.js';
import logger from '../utils/logger.js';
import { Config } from '../config/config.js';

/**
 * Orchestrates all communication channels (Discord, WhatsApp, etc.)
 */
export class ChannelManager {
    private readonly channels: Map<string, CommunicationChannel> = new Map();
    private readonly config: Config;
    private messageHandler?: (message: ChannelMessage) => Promise<void>;
    private lastActiveChannelId?: string;

    constructor() {
        this.config = Config.getInstance();
        this.initializeChannels();
    }

    /**
     * Initialize enabled channels based on configuration
     */
    private initializeChannels(): void {
        // 1. Initialize Discord
        const discord = new DiscordChannel();
        if (discord.isEnabled) {
            this.channels.set(discord.id, discord);
        }

        // 2. Initialize WhatsApp
        const whatsapp = new WhatsAppChannel();
        if (whatsapp.isEnabled) {
            this.channels.set(whatsapp.id, whatsapp);
        }
    }

    /**
     * Start all enabled channels
     */
    public async start(): Promise<void> {
        if (this.channels.size === 0) {
            logger.warn('⚠️ No communication channels enabled. Tars will be unreachable.');
            return;
        }

        logger.info(`🚀 Starting ${this.channels.size} communication channel(s)...`);

        for (const channel of this.channels.values()) {
            try {
                channel.onMessage(async (message) => {
                    this.lastActiveChannelId = channel.id;
                    if (this.messageHandler) {
                        await this.messageHandler(message);
                    }
                });

                await channel.start();
            } catch (error: any) {
                logger.error(`Failed to start channel ${channel.id}: ${error.message}`);
            }
        }
    }

    /**
     * Stop all channels
     */
    public async stop(): Promise<void> {
        logger.info('Stopping all communication channels...');
        for (const channel of this.channels.values()) {
            await channel
                .stop()
                .catch((e) => logger.error(`Error stopping ${channel.id}: ${e.message}`));
        }
    }

    /**
     * Register a global handler for messages from any channel
     */
    public onMessage(handler: (message: ChannelMessage) => Promise<void>): void {
        this.messageHandler = handler;
    }

    /**
     * Send a proactive notification
     */
    public async notify(content: string, attachments?: string[]): Promise<void> {
        const primaryChannelId =
            this.lastActiveChannelId || this.config.primaryChannel || 'discord';
        const channel = this.channels.get(primaryChannelId);

        if (channel) {
            await channel.notify(content, attachments);
        } else {
            // Fallback to the first available channel if primary is not found
            const fallback = Array.from(this.channels.values())[0];
            if (fallback) {
                await fallback.notify(content, attachments);
            } else {
                logger.warn(`No active channels available for notification.`);
            }
        }
    }

    /**
     * Get a specific channel by ID
     */
    public getChannel(id: string): CommunicationChannel | undefined {
        return this.channels.get(id);
    }
}
