import {
    Client,
    GatewayIntentBits,
    Message,
    ChannelType,
    Partials,
    EmbedBuilder,
    ButtonBuilder,
    ButtonStyle,
    ActionRowBuilder,
    ComponentType
} from 'discord.js';
import { v4 as uuidv4 } from 'uuid';
import { Config } from '../config/config.js';
import logger from '../utils/logger.js';
import { Supervisor } from '../supervisor/supervisor.js';
import { MessageFormatter } from './message-formatter.js';
import { GeminiEvent, AttachmentContext } from '../types/index.js';
import { AttachmentProcessor } from '../utils/attachment-processor.js';

/**
 * Discord bot wrapper for Tars
 */
export class DiscordBot {
    private readonly config: Config;
    private readonly client: Client;
    private readonly supervisor: Supervisor;
    private readonly processor: AttachmentProcessor;

    private lastChannelId: string | null = null;

    constructor(supervisor: Supervisor, config: Config) {
        this.config = config;
        this.supervisor = supervisor;
        this.processor = new AttachmentProcessor(config);

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

    /**
     * Start the Discord bot
     */
    async start(): Promise<void> {
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
    public async notify(content: string): Promise<void> {
        if (!this.config.discordOwnerId || !content.trim()) return;
        try {
            const user = await this.client.users.fetch(this.config.discordOwnerId);
            if (user) {
                const formatted = MessageFormatter.format(content);
                if (formatted.length > 8000) {
                    const filePath = this.processor.saveResponse(content, 'md');
                    await user.send({
                        content: `🔔 **Task Notification** (Response too long, see attached):`,
                        files: [filePath]
                    });
                } else {
                    const chunks = MessageFormatter.split(formatted);
                    for (let i = 0; i < chunks.length; i++) {
                        const prefix = i === 0 ? `🔔 **Task Notification:**\n` : ``;
                        await user.send(prefix + chunks[i]);
                    }
                }
            }
        } catch (e: any) {
            logger.error(`Failed to send proactive notification: ${e.message}`);
        }
    }

    /**
     * Setup event handlers
     */
    private setupEventHandlers(): void {
        this.client.once('clientReady', (c) => {
            logger.info(`🚀 Tars online as ${c.user.tag}`);
            logger.info(`🧠 Gemini Model: ${this.config.geminiModel}`);
            if (this.config.discordOwnerId) {
                logger.info(`👤 Primary Contact ID: ${this.config.discordOwnerId}`);
            } else {
                logger.warn(`⚠️ No Primary Contact ID set. Will bind to the first user who sends a message.`);
            }
        });

        this.client.on('messageCreate', this.handleMessage.bind(this));
    }

    /**
     * Handle incoming messages
     */
    private async handleMessage(message: Message): Promise<void> {
        if (message.author.bot) return;

        const userPrompt = this.extractPrompt(message);
        // If null, message wasn't for us. If empty string, check for attachments.
        if (userPrompt === null) return;

        // Auto-Bind on first interaction if not set
        if (!this.config.discordOwnerId) {
            this.config.discordOwnerId = message.author.id;
            this.config.saveSettings();
            logger.info(`🔒 Automatically bound Primary Contact to user: ${message.author.id}`);
            await message.reply(`🔒 **System Alert:** I have permanently bound my background notification channel to your account. I will send proactive alerts here.`);
        }

        if (!userPrompt && message.attachments.size === 0) return;

        logger.info(
            `Received request from ${message.author.tag}: "${userPrompt || '[Attachment Only]'}"`
        );

        // Handle Attachments
        const attachments: AttachmentContext[] = [];
        let attachmentContextText = '';
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
                    attachmentContextText += `\n[User attached file (${attachment.contentType}): ${filePath}]`;
                } catch (err: any) {
                    logger.error(`Failed to download attachment: ${err.message}`);
                    await message.reply(`⚠️ Failed to download ${attachment.name}: ${err.message}`);
                }
            }
        }

        const fullPrompt = `${userPrompt}${attachmentContextText}`.trim();
        if (!fullPrompt && attachments.length === 0) return;

        let typingInterval: NodeJS.Timeout | null = null;

        // Start typing indicator loop (Discord typing status lasts 10s)
        if ('sendTyping' in message.channel) {
            // Initial typing
            await message.channel.sendTyping().catch(() => { });

            // Loop every 9s to keep it active
            typingInterval = setInterval(() => {
                if ('sendTyping' in message.channel) {
                    (message.channel as any).sendTyping().catch(() => { });
                }
            }, 9000);
        }

        try {
            let fullResponse = '';

            await this.supervisor.run(
                fullPrompt,
                async (event: GeminiEvent | any) => {
                    if (
                        (event.type === 'text' || event.type === 'message') &&
                        event.content &&
                        event.role !== 'user'
                    ) {
                        fullResponse += event.content;
                    } else if (event.type === 'error') {
                        await message.reply(`❌ **Error:** ${event.error}`);
                    } else if (event.type === 'done') {
                        if (fullResponse.trim()) {
                            const formatted = MessageFormatter.format(fullResponse);

                            if (formatted.length > 8000) {
                                const filePath = this.processor.saveResponse(fullResponse, 'md');
                                await message.reply({
                                    content: `📄 **Response too long** (${formatted.length} chars). See attached file:`,
                                    files: [filePath]
                                });
                            } else {
                                const chunks = MessageFormatter.split(formatted);
                                for (const chunk of chunks) {
                                    await message.reply(chunk);
                                }
                            }
                        } else {
                            logger.warn('Gemini returned an empty response.');
                        }
                    }
                },
                undefined,
                attachments
            );
        } catch (error: any) {
            logger.error(`Discord handling error: ${error.message}`);
            await message.reply(`❌ **Supervisor Error:** ${error.message}`);
        } finally {
            if (typingInterval) clearInterval(typingInterval);
        }
    }

    /**
     * Extract prompt and handle prefix !tars
     */
    private extractPrompt(message: Message): string | null {
        const isDM = message.channel.type === ChannelType.DM;
        const isMentioned = this.client.user && message.mentions.has(this.client.user);
        const hasCommand = message.content.startsWith('!tars');

        if (!isDM && !isMentioned && !hasCommand) return null;

        let prompt = message.content;
        if (hasCommand) {
            prompt = prompt.replace('!tars', '');
        }
        if (isMentioned && this.client.user) {
            prompt = prompt.replace(new RegExp(`<@!?${this.client.user.id}>`, 'g'), '');
        }

        return prompt.trim();
    }
}
