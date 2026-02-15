import {
    Client,
    GatewayIntentBits,
    Message,
    ChannelType,
    Partials,
    EmbedBuilder
} from 'discord.js';
import { Config } from '../config/config.js';
import logger from '../utils/logger.js';
import { Supervisor } from '../supervisor/supervisor.js';
import { MessageFormatter } from './message-formatter.js';
import { GeminiEvent } from '../types/index.js';

/**
 * Discord bot wrapper for Tars
 */
export class DiscordBot {
    private readonly config: Config;
    private readonly client: Client;
    private readonly supervisor: Supervisor;

    constructor(supervisor: Supervisor, config: Config) {
        this.config = config;
        this.supervisor = supervisor;

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
    }

    /**
     * Handle incoming messages
     */
    private async handleMessage(message: Message): Promise<void> {
        if (message.author.bot) return;

        const userPrompt = this.extractPrompt(message);
        if (!userPrompt) return;

        logger.info(`Received request from ${message.author.tag}: "${userPrompt}"`);

        try {
            await this.client.channels.cache.get(message.channelId);
            if ('sendTyping' in message.channel) {
                await message.channel.sendTyping();
            }

            let fullResponse = '';

            await this.supervisor.run(userPrompt, async (event: GeminiEvent) => {
                if (event.type === 'text' && event.content) {
                    fullResponse += event.content;
                } else if (event.type === 'error') {
                    await message.reply(`❌ **Error:** ${event.error}`);
                } else if (event.type === 'done') {
                    if (fullResponse.trim()) {
                        const formatted = MessageFormatter.format(fullResponse);
                        const chunks = MessageFormatter.split(formatted);
                        for (const chunk of chunks) {
                            await message.reply(chunk);
                        }
                    }
                }
            });
        } catch (error: any) {
            logger.error(`Discord handling error: ${error.message}`);
            await message.reply(`❌ **Supervisor Error:** ${error.message}`);
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

        return prompt.trim() || null;
    }
}
