import { Client, GatewayIntentBits, Partials } from 'discord.js';
import type { Message, User } from 'discord.js';

import { Config } from '../../config/config.js';
import type { AttachmentContext } from '../../types/index.js';
import { AttachmentProcessor } from '../../utils/attachment-processor.js';
import { DLPService } from '../../utils/dlp-service.js';
import logger from '../../utils/logger.js';
import type { ChannelMessage, CommunicationChannel } from '../types.js';
import { MessageFormatter } from './message-formatter.js';

function getSafeErrorMessage(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    return DLPService.scrub(message);
}

/**
 * Discord Channel Implementation for Tars
 */
export class DiscordChannel implements CommunicationChannel {
    public readonly id = 'discord';
    private readonly config: Config;
    private readonly client: Client;
    private readonly processor: AttachmentProcessor;
    private messageHandler?: (message: ChannelMessage) => Promise<void>;
    private typingIntervals: Map<string, NodeJS.Timeout> = new Map();
    private processedMessages: Set<string> = new Set();

    // Tracked status message for in-place editing during long-running tasks
    private lastStatusMessage: { channelId: string; messageId: string } | null = null;
    private statusEditCount: number = 0;
    private statusEditResetAt: number = 0;
    // Discord allows ~20 edits per message per 5-minute window
    private static readonly MAX_EDITS_PER_WINDOW = 18;
    private static readonly EDIT_WINDOW_MS = 5 * 60 * 1000;

    constructor() {
        this.config = Config.getInstance();
        this.processor = new AttachmentProcessor(this.config);

        this.client = new Client({
            intents: [
                GatewayIntentBits.Guilds,
                GatewayIntentBits.GuildMessages,
                GatewayIntentBits.MessageContent,
                GatewayIntentBits.DirectMessages
            ],
            partials: [Partials.Channel, Partials.Message, Partials.User]
        });

        this.setupEventHandlers();
    }

    get isEnabled(): boolean {
        const discordConfig = this.config.channels.discord;
        return discordConfig
            ? discordConfig.enabled && !!this.config.discordToken
            : !!this.config.discordToken;
    }

    /**
     * Start the Discord bot
     */
    async start(): Promise<void> {
        if (!this.isEnabled) {
            logger.info('Discord channel is disabled.');
            return;
        }
        await this.client.login(this.config.discordToken);
    }

    /**
     * Stop the Discord bot
     */
    async stop(): Promise<void> {
        this.client.destroy();
    }

    /** Send a durable proactive notification to the primary contact. */
    public async notify(content: string, attachments?: string[]): Promise<void> {
        await this.sendNotification(content, attachments, false);
    }

    /** Send and track a transient notification for in-place status editing. */
    public async sendStatus(content: string): Promise<void> {
        await this.sendNotification(content, undefined, true);
    }

    private async sendNotification(
        content: string,
        attachments: string[] | undefined,
        trackStatus: boolean
    ): Promise<void> {
        const safeContent = DLPService.scrubTextOrJson(content);
        if (!safeContent.trim()) throw new Error('Cannot deliver an empty Discord notification.');
        try {
            const targetId =
                this.config.discordOwnerId || this.config.channels.discord?.ownerId || null;
            if (!targetId) throw new Error('Discord owner ID is not configured.');
            const target: User = await this.client.users.fetch(targetId);
            const formatted = MessageFormatter.format(safeContent);
            const files = attachments || [];

            if (formatted.length > 8000) {
                const filePath = this.processor.saveResponse(safeContent, 'md');
                const sent = await target.send({
                    content: `🔔 **Notification** (Response too long, see attached):`,
                    files: [filePath, ...files]
                });
                if (trackStatus) this.trackStatusMessage(sent);
            } else {
                const chunks = MessageFormatter.split(formatted);
                for (let i = 0; i < chunks.length; i++) {
                    const sent = await target.send({
                        content: chunks[i],
                        files: i === chunks.length - 1 ? files : []
                    });
                    // Track the first chunk for editing
                    if (trackStatus && i === 0) {
                        this.trackStatusMessage(sent);
                    }
                }
            }
        } catch (error: unknown) {
            const safeMessage = getSafeErrorMessage(error);
            logger.error(`Failed to send proactive notification via Discord: ${safeMessage}`);
            throw new Error(`Discord notification delivery failed: ${safeMessage}`);
        }
    }

    /**
     * Track a sent message so it can be edited later (for status updates).
     */
    private trackStatusMessage(sent: Pick<Message, 'channelId' | 'id'>): void {
        this.lastStatusMessage = {
            channelId: sent.channelId,
            messageId: sent.id
        };
        this.statusEditCount = 0;
        this.statusEditResetAt = Date.now() + DiscordChannel.EDIT_WINDOW_MS;
    }

    /**
     * Edit the last proactive status notification in-place.
     * Falls back to sending a new message if rate-limited.
     * Returns true if edit succeeded, false if fallback to new message was needed.
     */
    public async editStatus(content: string): Promise<boolean> {
        if (!this.lastStatusMessage) {
            logger.debug('[Discord] No tracked status message to edit.');
            return false;
        }

        // Check if we've exceeded the edit rate limit window
        const now = Date.now();
        if (now > this.statusEditResetAt) {
            this.statusEditCount = 0;
            this.statusEditResetAt = now + DiscordChannel.EDIT_WINDOW_MS;
        }

        if (this.statusEditCount >= DiscordChannel.MAX_EDITS_PER_WINDOW) {
            logger.warn(
                `[Discord] Status edit rate limit hit (${this.statusEditCount} edits). Falling back to new message.`
            );
            await this.deleteLastStatusMessage();
            this.clearStatus();
            return false;
        }

        try {
            const channel = await this.client.channels.fetch(this.lastStatusMessage.channelId);
            if (!channel || !channel.isTextBased()) {
                logger.warn('[Discord] Status channel no longer accessible.');
                this.clearStatus();
                return false;
            }

            const message = await channel.messages.fetch(this.lastStatusMessage.messageId);
            const formatted = MessageFormatter.format(DLPService.scrubTextOrJson(content));

            // If content grew too large for a single edit, truncate or send new
            if (formatted.length > 1990) {
                const truncated = formatted.substring(0, 1980) + '\n...';
                await message.edit(truncated);
            } else {
                await message.edit(formatted);
            }

            this.statusEditCount++;
            return true;
        } catch (error: unknown) {
            // Message may have been deleted or we lost access
            logger.warn(`[Discord] Failed to edit status message: ${getSafeErrorMessage(error)}`);
            await this.deleteLastStatusMessage();
            this.clearStatus();
            return false;
        }
    }

    /**
     * Delete the last tracked status message from Discord.
     */
    private async deleteLastStatusMessage(): Promise<void> {
        if (!this.lastStatusMessage) return;
        try {
            const channel = await this.client.channels.fetch(this.lastStatusMessage.channelId);
            if (channel && channel.isTextBased()) {
                const msg = await channel.messages.fetch(this.lastStatusMessage.messageId);
                await msg.delete().catch(() => {});
            }
        } catch (error: unknown) {
            logger.warn(`[Discord] Failed to delete status message: ${getSafeErrorMessage(error)}`);
        }
    }

    /**
     * Clear the tracked status message (e.g. on new user prompt).
     */
    public clearStatus(): void {
        this.lastStatusMessage = null;
        this.statusEditCount = 0;
        this.statusEditResetAt = 0;
    }

    /**
     * Register message handler
     */
    public onMessage(handler: (message: ChannelMessage) => Promise<void>): void {
        this.messageHandler = handler;
    }

    /**
     * Setup event handlers
     */
    private setupEventHandlers(): void {
        this.client.once('clientReady', (c) => {
            logger.info(`🚀 Discord channel online as ${c.user.tag}`);
            if (this.config.discordOwnerId) {
                logger.info(`👤 Primary Discord Contact ID: ${this.config.discordOwnerId}`);
            } else {
                logger.warn(
                    '⚠️ No Primary Discord Contact ID is configured. Discord messages will be ignored until you run `tars setup`.'
                );
            }
        });

        this.client.on('messageCreate', this.handleIncomingMessage.bind(this));

        // --- DM Rescue Fallback ---
        // discord.js v14 silently drops DMs if the user/channel has no prior cache history
        // on the current instance runtime. We intercept raw packets to rescue them.
        this.client.on('raw', async (packet) => {
            if (packet.t !== 'MESSAGE_CREATE') return;

            const data = packet.d;

            // Only rescue DMs (they lack a guild_id) from real users
            if (data.guild_id || data.author?.bot) return;

            // If the channel IS cached, discord.js will successfully emit the standard
            // 'messageCreate' event. We step entirely out of the way.
            const isCached = this.client.channels.cache.has(data.channel_id);
            if (isCached) return;

            // Channel is uncached. discord.js will drop this. Rescue it manually.
            try {
                logger.debug(
                    `[DM Rescue] Intercepted dropped payload from ${data.author.username}. Hydrating...`
                );
                const channel = await this.client.channels.fetch(data.channel_id);
                if (channel && channel.isTextBased()) {
                    const message = await channel.messages.fetch(data.id);
                    logger.info(
                        `[DM Rescue] Successfully hydrated message. Forwarding to bot logic.`
                    );
                    await this.handleIncomingMessage(message);
                }
            } catch (error: unknown) {
                logger.error(
                    `❌ [DM Rescue] Failed to hydrate dropped message: ${getSafeErrorMessage(error)}`
                );
            }
        });
    }

    /**
     * Internal handler for Discord-specific messages
     */
    private async handleIncomingMessage(message: Message): Promise<void> {
        try {
            // Guard against partial messages with missing author data
            if (!message.author || message.author.bot || !this.messageHandler) return;

            const userPrompt = this.extractPrompt(message);
            if (userPrompt === null || (!userPrompt && message.attachments.size === 0)) return;

            if (!this.isAuthorizedSender(message.author.id)) return;

            // Deduplicate messages (prevent race conditions between 'messageCreate' and 'raw' DM rescue)
            if (this.processedMessages.has(message.id)) {
                logger.debug(`[Discord] Deduplicating message ${message.id}`);
                return;
            }
            this.processedMessages.add(message.id);
            // Cleanup cache after 60 seconds
            setTimeout(() => this.processedMessages.delete(message.id), 60000);

            logger.debug(
                `📥 Received authorized Discord message ${message.id} (${message.content.length} characters, ${message.guildId ? 'guild' : 'DM'})`
            );

            // Handle Attachments
            const attachments: AttachmentContext[] = [];
            if (message.attachments.size > 0) {
                for (const [id, attachment] of message.attachments) {
                    try {
                        const filePath = await this.processor.download(attachment);
                        if (attachment.contentType) {
                            attachments.push({
                                path: filePath,
                                mimeType: attachment.contentType
                            });
                        }
                    } catch (error: unknown) {
                        logger.error(
                            `Failed to download Discord attachment: ${getSafeErrorMessage(error)}`
                        );
                    }
                }
            }

            // Map to common ChannelMessage
            const channelMessage: ChannelMessage = {
                content: userPrompt,
                senderId: message.author.id,
                senderName: message.author.username,
                channelId: message.channelId,
                attachments,
                reply: async (response: string, outAttachments?: string[]) => {
                    const safeResponse = DLPService.scrubTextOrJson(response);
                    const formatted = MessageFormatter.format(safeResponse);
                    if (formatted.length > 8000) {
                        const filePath = this.processor.saveResponse(safeResponse, 'md');
                        await message.reply({
                            content: `📄 **Response too long** (${formatted.length} chars). See attached file:`,
                            files: [filePath, ...(outAttachments || [])]
                        });
                    } else {
                        const chunks = MessageFormatter.split(formatted);
                        for (let i = 0; i < chunks.length; i++) {
                            await message.reply({
                                content: chunks[i],
                                files: i === chunks.length - 1 ? outAttachments || [] : []
                            });
                        }
                    }
                },
                startTyping: () => {
                    const channelId = message.channelId;
                    if (this.typingIntervals.has(channelId)) return;

                    // Send first one immediately
                    const typingChannel = message.channel;
                    if ('sendTyping' in typingChannel) {
                        typingChannel.sendTyping().catch(() => {});
                        const interval = setInterval(() => {
                            typingChannel.sendTyping().catch(() => {
                                this.stopTypingInternal(channelId);
                            });
                        }, 5000); // Discord typing state lasts ~10s, we refresh every 5s
                        this.typingIntervals.set(channelId, interval);
                    }
                },
                stopTyping: () => {
                    this.stopTypingInternal(message.channelId);
                }
            };

            // Forward to the registered handler (Supervisor via ChannelManager)
            await this.messageHandler(channelMessage);
        } catch (error: unknown) {
            logger.error(`❌ Discord message handler error: ${getSafeErrorMessage(error)}`);
        }
    }

    /**
     * Verify the sender before mutating message or routing state.
     * Ownership is configured locally; Discord messages never establish trust.
     */
    private isAuthorizedSender(userId: string): boolean {
        const configuredOwnerId =
            this.config.discordOwnerId || this.config.channels.discord?.ownerId;

        if (configuredOwnerId === userId) return true;
        logger.warn(
            configuredOwnerId
                ? `[Discord] Ignoring message from unauthorized user ${userId}.`
                : '[Discord] Ignoring message because no owner ID is configured.'
        );
        return false;
    }

    private stopTypingInternal(channelId: string): void {
        const interval = this.typingIntervals.get(channelId);
        if (interval) {
            clearInterval(interval);
            this.typingIntervals.delete(channelId);
        }
    }

    /**
     * Extract prompt and handle prefix
     */
    private extractPrompt(message: Message): string | null {
        const isDM = !message.guildId;
        const isMentioned = this.client.user && message.mentions.has(this.client.user);

        const customPrefix = `!${this.config.assistantName.toLowerCase()}`;
        const hasCustomCommand = message.content.toLowerCase().startsWith(customPrefix);
        const hasLegacyCommand = message.content.toLowerCase().startsWith('!tars');

        if (!isDM && !isMentioned && !hasCustomCommand && !hasLegacyCommand) return null;

        let prompt = message.content;
        if (hasCustomCommand) {
            prompt = prompt.substring(customPrefix.length);
        } else if (hasLegacyCommand) {
            prompt = prompt.substring(6); // length of '!tars'
        }

        if (isMentioned && this.client.user) {
            prompt = prompt.replace(new RegExp(`<@!?${this.client.user.id}>`, 'g'), '');
        }

        return prompt.trim();
    }
}
