import {
    BaseDeclarativeTool,
    ToolInvocation,
    BaseToolInvocation,
    ToolResult,
    Kind
} from '@google/gemini-cli-core';
import type { MessageBus } from '@google/gemini-cli-core/dist/src/confirmation-bus/message-bus.js';
import { DiscordBot } from '../discord/discord-bot.js';

interface SendDiscordMessageParams {
    message: string;
}

class SendDiscordMessageInvocation extends BaseToolInvocation<SendDiscordMessageParams, ToolResult> {
    constructor(
        params: SendDiscordMessageParams,
        private discordBot: DiscordBot
    ) {
        super(params, null as unknown as MessageBus, 'send_discord_message', 'Send Discord Message');
    }

    getDescription(): string {
        return `Sending a proactive Discord message to the user: "${this.params.message}"`;
    }

    async execute(signal: AbortSignal): Promise<ToolResult> {
        try {
            if (!(this.discordBot as any).config?.discordOwnerId) {
                return {
                    llmContent: [{ text: '❌ Soft Error: Could not reach Discord. Owner ID not yet captured. The user must send a direct message to the bot first before proactive notifications can be sent.' }],
                    returnDisplay: 'Failed: Owner ID not yet captured.'
                };
            }

            await this.discordBot.notify(this.params.message);
            return {
                llmContent: [{ text: '✅ Message successfully queued for delivery to the user.' }],
                returnDisplay: 'Success: Message sent.'
            };
        } catch (error: any) {
            return {
                llmContent: [{ text: `❌ Failed to send message: ${error.message}` }],
                returnDisplay: `Error: ${error.message}`
            };
        }
    }
}

export class SendDiscordMessageTool extends BaseDeclarativeTool<SendDiscordMessageParams, ToolResult> {
    constructor(private discordBot: DiscordBot) {
        super(
            'send_discord_message',
            'Send Discord Message',
            'Send a proactive message or notification back to the user on Discord. Use this tool during background tasks to report results, alert the user to issues, or ask questions that you want them to see when they return.',
            Kind.Communicate,
            {
                type: 'object',
                properties: {
                    message: {
                        type: 'string',
                        description: 'The text content of the message to send to the user.'
                    }
                },
                required: ['message']
            },
            null as unknown as MessageBus,
            true, // isOutputMarkdown
            false // canUpdateOutput
        );
    }

    protected createInvocation(
        params: SendDiscordMessageParams,
        _messageBus: MessageBus
    ): ToolInvocation<SendDiscordMessageParams, ToolResult> {
        return new SendDiscordMessageInvocation(params, this.discordBot);
    }
}
