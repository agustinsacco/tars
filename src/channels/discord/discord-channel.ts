import { Client, GatewayIntentBits, Message, ChannelType, Partials } from 'discord.js';
import { Config } from '../../config/config.js';
import logger from '../../utils/logger.js';
import { MessageFormatter } from './message-formatter.js';
import { AttachmentContext } from '../../types/index.js';
import { AttachmentProcessor } from '../../utils/attachment-processor.js';
import { CommunicationChannel, ChannelMessage } from '../types.js';

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
    private lastActiveUser: { userId: string; channelId: string } | null = null;
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
        // For backward compatibility, if no explicit channels are configured but discordToken exists, it's enabled.
        return !!this.config.discordToken;
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

    /**
     * Send a proactive notification to the primary contact.
     * Tracks the last sent message for in-place editing (status updates).
     */
    public async notify(content: string, attachments?: string[]): Promise<void> {
        if (!content.trim()) return;
        try {
            let target: any = null;
            if (this.lastActiveUser?.channelId) {
                try {
                    target = await this.client.channels.fetch(this.lastActiveUser.channelId);
                } catch (err: any) {
                    logger.debug(
                        `[Discord] Could not fetch target active channel ${this.lastActiveUser.channelId}: ${err.message}`
                    );
                }
            }

            // Fallback to DM user if no active channel, or if it is not text-based
            if (!target || !target.isTextBased()) {
                const targetId = this.lastActiveUser?.userId || this.config.discordOwnerId;
                if (targetId) {
                    target = await this.client.users.fetch(targetId);
                }
            }

            if (target) {
                const formatted = MessageFormatter.format(content);
                const files = attachments || [];

                if (formatted.length > 8000) {
                    const filePath = this.processor.saveResponse(content, 'md');
                    const sent = await target.send({
                        content: `🔔 **Notification** (Response too long, see attached):`,
                        files: [filePath, ...files]
                    });
                    this.trackStatusMessage(sent);
                } else {
                    const chunks = MessageFormatter.split(formatted);
                    for (let i = 0; i < chunks.length; i++) {
                        const sent = await target.send({
                            content: chunks[i],
                            files: i === chunks.length - 1 ? files : []
                        });
                        // Track the first chunk for editing
                        if (i === 0) {
                            this.trackStatusMessage(sent);
                        }
                    }
                }
            }
        } catch (e: any) {
            logger.error(`Failed to send proactive notification via Discord: ${e.message}`);
        }
    }

    /**
     * Track a sent message so it can be edited later (for status updates).
     */
    private trackStatusMessage(sent: any): void {
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
            const formatted = MessageFormatter.format(content);

            // If content grew too large for a single edit, truncate or send new
            if (formatted.length > 1990) {
                const truncated = formatted.substring(0, 1980) + '\n...';
                await message.edit(truncated);
            } else {
                await message.edit(formatted);
            }

            this.statusEditCount++;
            return true;
        } catch (e: any) {
            // Message may have been deleted or we lost access
            logger.warn(`[Discord] Failed to edit status message: ${e.message}`);
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
        } catch (e: any) {
            logger.warn(`[Discord] Failed to delete status message: ${e.message}`);
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
                    `⚠️ No Primary Discord Contact ID set. Will bind to the first user who sends a message.`
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
            } catch (err: any) {
                logger.error(`❌ [DM Rescue] Failed to hydrate dropped message: ${err.message}`);
            }
        });
    }

    /**
     * Internal handler for Discord-specific messages
     */
    private async handleIncomingMessage(message: Message): Promise<void> {
        try {
            // Deduplicate messages (prevent race conditions between 'messageCreate' and 'raw' DM rescue)
            if (this.processedMessages.has(message.id)) {
                logger.debug(`[Discord] Deduplicating message ${message.id}`);
                return;
            }
            this.processedMessages.add(message.id);
            // Cleanup cache after 60 seconds
            setTimeout(() => this.processedMessages.delete(message.id), 60000);

            logger.debug(
                `📥 Received Discord message: "${message.content.substring(0, 50)}${message.content.length > 50 ? '...' : ''}" from ${message.author?.tag || 'Unknown'} (Guild: ${message.guildId || 'DM'})`
            );

            // Guard against partial messages with missing author data
            if (!message.author || message.author.bot || !this.messageHandler) return;

            this.lastActiveUser = {
                userId: message.author.id,
                channelId: message.channelId
            };

            const userPrompt = this.extractPrompt(message);
            if (userPrompt === null) return;

            // Auto-Bind on first interaction if not set
            const wasAutoBound = !this.config.discordOwnerId;
            if (wasAutoBound) {
                this.config.discordOwnerId = message.author.id;
                if (this.config.channels.discord) {
                    this.config.channels.discord.ownerId = message.author.id;
                }
                this.config.saveSettings();
                logger.info(
                    `🔒 Automatically bound Primary Contact to Discord user: ${message.author.id} (Channel: ${message.channelId})`
                );
            }

            if (!userPrompt && message.attachments.size === 0) return;

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
                    } catch (err: any) {
                        logger.error(`Failed to download Discord attachment: ${err.message}`);
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
                metadata: { wasAutoBound },
                reply: async (response: string, outAttachments?: string[]) => {
                    const formatted = MessageFormatter.format(response);
                    if (formatted.length > 8000) {
                        const filePath = this.processor.saveResponse(response, 'md');
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
                    if ('sendTyping' in message.channel) {
                        message.channel.sendTyping().catch(() => {});
                        const interval = setInterval(() => {
                            (message.channel as any).sendTyping().catch(() => {
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
        } catch (error: any) {
            logger.error(`❌ Discord message handler error: ${error.message}`);
        }
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
