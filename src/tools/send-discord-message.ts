import {
    BaseDeclarativeTool,
    ToolInvocation,
    BaseToolInvocation,
    ToolResult,
    Kind
} from '@google/gemini-cli-core';
import type { MessageBus } from '@google/gemini-cli-core/dist/src/confirmation-bus/message-bus.js';
import { ChannelManager } from '../channels/channel-manager.js';

interface NotifyParams {
    message: string;
}

class SendDiscordMessageInvocation extends BaseToolInvocation<NotifyParams, ToolResult> {
    constructor(
        params: NotifyParams,
        private channelManager: ChannelManager
    ) {
        super(
            params,
            null as unknown as MessageBus,
            'send_discord_message',
            'Send Discord Message'
        );
    }

    getDescription(): string {
        return `Sending Discord notification (Deprecated): ${this.params.message.substring(0, 50)}${this.params.message.length > 50 ? '...' : ''}`;
    }

    async execute(signal: AbortSignal): Promise<ToolResult> {
        try {
            await this.channelManager.notify(this.params.message);
            return {
                llmContent: [{ text: '✅ Message successfully queued for delivery to the user.' }],
                returnDisplay: 'Notification sent successfully.'
            };
        } catch (error: any) {
            return {
                llmContent: [{ text: `❌ Failed to send notification: ${error.message}` }],
                returnDisplay: `Error: ${error.message}`
            };
        }
    }
}

/**
 * Tool to send proactive messages back to the user on Discord (Deprecated: use send_notification)
 */
export class SendDiscordMessageTool extends BaseDeclarativeTool<NotifyParams, ToolResult> {
    constructor(private readonly channelManager: ChannelManager) {
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
        params: NotifyParams,
        _messageBus: MessageBus
    ): ToolInvocation<NotifyParams, ToolResult> {
        return new SendDiscordMessageInvocation(params, this.channelManager);
    }
}
