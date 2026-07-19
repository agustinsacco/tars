import { type AgentTool } from '@earendil-works/pi-agent-core';
import { Type, type Static } from 'typebox';

export interface NotificationChannel {
    notify(content: string, attachments?: string[]): Promise<void>;
}

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

    constructor(private readonly channelManager: NotificationChannel) {}

    async execute(_toolCallId: string, params: NotifyParams) {
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
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            return {
                content: [
                    {
                        type: 'text' as const,
                        text: `❌ Failed to send notification: ${message}`
                    }
                ],
                details: { status: 'error', error: message }
            };
        }
    }
}
