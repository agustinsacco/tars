import { CommunicationChannel, ChannelMessage } from './types.js';
import { DiscordChannel } from './discord/discord-channel.js';
import logger from '../utils/logger.js';
import { Config } from '../config/config.js';

/**
 * Orchestrates all communication channels (Discord, etc.)
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
    }

    /**
     * Register an additional communication channel at runtime.
     * Used to add channels like the TUI that aren't config-driven.
     */
    public registerChannel(channel: CommunicationChannel): void {
        this.channels.set(channel.id, channel);
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
     * Edit the last proactive status notification in-place.
     * Returns true if the edit succeeded, false otherwise.
     */
    public async editStatus(content: string): Promise<boolean> {
        const primaryChannelId =
            this.lastActiveChannelId || this.config.primaryChannel || 'discord';
        const channel = this.channels.get(primaryChannelId);

        if (channel) {
            return channel.editStatus(content);
        }
        // Fallback to the first available channel
        const fallback = Array.from(this.channels.values())[0];
        if (fallback) {
            return fallback.editStatus(content);
        }
        logger.warn(`No active channels available for status edit.`);
        return false;
    }

    /**
     * Clear the tracked status message on the primary channel.
     */
    public clearStatus(): void {
        const primaryChannelId =
            this.lastActiveChannelId || this.config.primaryChannel || 'discord';
        const channel = this.channels.get(primaryChannelId);

        if (channel) {
            channel.clearStatus();
            return;
        }
        const fallback = Array.from(this.channels.values())[0];
        if (fallback) {
            fallback.clearStatus();
        }
    }

    /**
     * Get a specific channel by ID
     */
    public getChannel(id: string): CommunicationChannel | undefined {
        return this.channels.get(id);
    }
}
