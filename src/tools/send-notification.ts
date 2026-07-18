import { AgentTool } from '@earendil-works/pi-agent-core';
import { ChannelManager } from '../channels/channel-manager.js';
import { Type, Static } from 'typebox';

const NotifyParamsSchema = Type.Object({
    message: Type.String({
        description: 'The text content of the message to send to the user.'
    })
});

type NotifyParams = Static<typeof NotifyParamsSchema>;

/**
 * Tool to send proactive notifications to the user via enabled channels
 */
export class SendNotificationTool implements AgentTool<typeof NotifyParamsSchema> {
    public readonly name = 'send_notification';
    public readonly label = 'Send Notification';
    public readonly description =
        'Send a proactive message back to the configured owner during an interactive workflow.';
    public readonly parameters = NotifyParamsSchema;

    constructor(private readonly channelManager: ChannelManager) {}

    async execute(toolCallId: string, params: NotifyParams) {
        try {
            await this.channelManager.notify(params.message);
            return {
                content: [
                    {
                        type: 'text' as const,
                        text: '✅ Message successfully queued for delivery to the user.'
                    }
                ],
                details: { status: 'success' }
            };
        } catch (error: any) {
            return {
                content: [
                    {
                        type: 'text' as const,
                        text: `❌ Failed to send notification: ${error.message}`
                    }
                ],
                details: { status: 'error', error: error.message }
            };
        }
    }
}
