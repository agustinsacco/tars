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
import { GeminiEvent } from '../types/index.js';
import { AttachmentProcessor } from '../utils/attachment-processor.js';

/**
 * Discord bot wrapper for Tars
 */
export class DiscordBot {
    private readonly config: Config;
    private readonly client: Client;
    private readonly supervisor: Supervisor;
    private readonly processor: AttachmentProcessor;
    private readonly activityLogs: Map<string, string[]> = new Map();
    private readonly logSubscribers: Map<string, Map<string, any>> = new Map(); // logId -> userId -> interaction

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
     * Setup event handlers
     */
    private setupEventHandlers(): void {
        this.client.once('clientReady', (c) => {
            logger.info(`🚀 Tars online as ${c.user.tag}`);
            logger.info(`🧠 Gemini Model: ${this.config.geminiModel}`);
        });

        this.client.on('messageCreate', this.handleMessage.bind(this));
        this.client.on('interactionCreate', this.handleInteraction.bind(this));
    }

    /**
     * Handle button interactions
     */
    private async handleInteraction(interaction: any): Promise<void> {
        if (!interaction.isButton()) return;

        if (interaction.customId.startsWith('show_log_')) {
            const logId = interaction.customId.replace('show_log_', '');
            const log = this.activityLogs.get(logId);

            if (!log) {
                await interaction.reply({
                    content: '❌ Log not found or session expired.',
                    ephemeral: true
                });
                return;
            }

            // Store this interaction as a subscriber for live updates
            if (!this.logSubscribers.has(logId)) {
                this.logSubscribers.set(logId, new Map());
            }
            this.logSubscribers.get(logId)!.set(interaction.user.id, interaction);

            const logText = log.join('\n');
            await interaction.reply({
                content: `📜 **Activity Log (Live)**\n\`\`\`\n${logText.substring(Math.max(0, logText.length - 1900))}\n\`\`\``,
                ephemeral: true
            });
        }
    }

    /**
     * Broadcast log updates to all subscribers
     */
    private async broadcastLogUpdate(logId: string): Promise<void> {
        const log = this.activityLogs.get(logId);
        const subscribers = this.logSubscribers.get(logId);
        if (!log || !subscribers) return;

        const logText = log.join('\n');
        const content = `📜 **Activity Log (Live)**\n\`\`\`\n${logText.substring(Math.max(0, logText.length - 1900))}\n\`\`\``;

        for (const [userId, interaction] of subscribers) {
            try {
                await interaction.editReply({ content }).catch(() => {
                    // If edit fails (e.g. interaction expired), remove subscriber
                    subscribers.delete(userId);
                });
            } catch (err) {
                subscribers.delete(userId);
            }
        }
    }

    /**
     * Handle incoming messages
     */
    private async handleMessage(message: Message): Promise<void> {
        if (message.author.bot) return;

        const userPrompt = this.extractPrompt(message);
        // If null, message wasn't for us. If empty string, check for attachments.
        if (userPrompt === null) return;
        if (!userPrompt && message.attachments.size === 0) return;

        logger.info(
            `Received request from ${message.author.tag}: "${userPrompt || '[Attachment Only]'}"`
        );

        // Handle Attachments
        let attachmentContext = '';
        if (message.attachments.size > 0) {
            await message.reply('⬇️ Downloading attachments...');

            for (const [id, attachment] of message.attachments) {
                try {
                    const filePath = await this.processor.download(attachment);
                    attachmentContext += `\n[User attached file (${attachment.contentType}): ${filePath}]`;
                } catch (err: any) {
                    logger.error(`Failed to download attachment: ${err.message}`);
                    await message.reply(`⚠️ Failed to download ${attachment.name}: ${err.message}`);
                }
            }
        }

        const fullPrompt = `${userPrompt}${attachmentContext}`.trim();
        if (!fullPrompt) return;

        let typingInterval: NodeJS.Timeout | null = null;

        // Start typing indicator loop (Discord typing status lasts 10s)
        if ('sendTyping' in message.channel) {
            // Initial typing
            await message.channel.sendTyping().catch(() => {});

            // Loop every 9s to keep it active
            typingInterval = setInterval(() => {
                if ('sendTyping' in message.channel) {
                    (message.channel as any).sendTyping().catch(() => {});
                }
            }, 9000);
        }

        try {
            await this.client.channels.cache.get(message.channelId);

            let fullResponse = '';
            const logId = uuidv4();
            const currentLog: string[] = [];
            this.activityLogs.set(logId, currentLog);

            const addLog = async (text: string) => {
                const timestamp = new Date().toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit'
                });
                currentLog.push(`[${timestamp}] ${text}`);
                await this.broadcastLogUpdate(logId);
            };

            await addLog('🧠 Tars started thinking...');

            // Create initial status message
            const logButton = new ButtonBuilder()
                .setCustomId(`show_log_${logId}`)
                .setLabel('Activity Log')
                .setStyle(ButtonStyle.Secondary);

            const row = new ActionRowBuilder<ButtonBuilder>().addComponents(logButton);

            const statusMsg = await message.reply({
                content: '🧠 **Tars is thinking...**',
                components: [row]
            });

            const updateStatus = async (status: string) => {
                await statusMsg
                    .edit({
                        content: status,
                        components: [row]
                    })
                    .catch(() => {});
            };

            await this.supervisor.run(fullPrompt, async (event: GeminiEvent) => {
                if (event.type === 'text' && event.content) {
                    fullResponse += event.content;
                } else if (event.type === 'tool_call') {
                    const toolInfo = `🛠️ Using tool: **${event.toolName}**`;
                    await addLog(
                        `🛠️ Tool Call: ${event.toolName}(${JSON.stringify(event.toolArgs)})`
                    );
                    await updateStatus(toolInfo);
                } else if (event.type === 'tool_response') {
                    await addLog(`📥 Tool Result: ${event.toolId}`);
                } else if (event.type === 'error') {
                    await addLog(`❌ Error: ${event.error}`);
                    await message.reply(`❌ **Error:** ${event.error}`);
                } else if (event.type === 'done') {
                    await addLog('✅ Task complete.');

                    // Cleanup status message
                    await statusMsg.delete().catch(() => {});

                    if (fullResponse.trim()) {
                        const formatted = MessageFormatter.format(fullResponse);

                        // If response is too long for Discord, send as file
                        if (formatted.length > 1900) {
                            const filePath = this.processor.saveResponse(fullResponse, 'md');
                            await message.reply({
                                content: `📄 **Response too long** (${formatted.length} chars). See attached file:`,
                                files: [filePath]
                            });
                        } else {
                            // Split normally
                            const chunks = MessageFormatter.split(formatted);
                            for (const chunk of chunks) {
                                await message.reply(chunk);
                            }
                        }
                    }

                    // Clean up logs and subscribers after a delay
                    setTimeout(() => {
                        this.activityLogs.delete(logId);
                        this.logSubscribers.delete(logId);
                    }, 600000); // 10 minutes
                }
            });
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
