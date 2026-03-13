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
            partials: [Partials.Channel, Partials.Message]
        });

        this.setupEventHandlers();
    }

    get isEnabled(): boolean {
        // For backward compatibility, if no explicit channels are configured but discordToken exists, it's enabled.
        // Once WhatsApp is added, we'll use structured config.
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
     * Send a proactive notification to the primary contact
     */
    public async notify(content: string, attachments?: string[]): Promise<void> {
        if (!this.config.discordOwnerId || !content.trim()) return;
        try {
            const user = await this.client.users.fetch(this.config.discordOwnerId);
            if (user) {
                const formatted = MessageFormatter.format(content);
                const files = attachments || [];

                if (formatted.length > 8000) {
                    const filePath = this.processor.saveResponse(content, 'md');
                    await user.send({
                        content: `🔔 **Task Notification** (Response too long, see attached):`,
                        files: [filePath, ...files]
                    });
                } else {
                    const chunks = MessageFormatter.split(formatted);
                    for (let i = 0; i < chunks.length; i++) {
                        const prefix = i === 0 ? `🔔 **Task Notification:**\n` : ``;
                        await user.send({
                            content: prefix + chunks[i],
                            files: i === chunks.length - 1 ? files : []
                        });
                    }
                }
            }
        } catch (e: any) {
            logger.error(`Failed to send proactive notification via Discord: ${e.message}`);
        }
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
    }

    /**
     * Internal handler for Discord-specific messages
     */
    private async handleIncomingMessage(message: Message): Promise<void> {
        if (message.author.bot || !this.messageHandler) return;

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
            }
        };

        // Show typing indicator
        if ('sendTyping' in message.channel) {
            await message.channel.sendTyping().catch(() => {});
        }

        // Forward to the registered handler (Supervisor via ChannelManager)
        await this.messageHandler(channelMessage);
    }

    /**
     * Extract prompt and handle prefix
     */
    private extractPrompt(message: Message): string | null {
        const isDM = message.channel.type === ChannelType.DM;
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
