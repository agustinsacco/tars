import { AttachmentContext } from '../types/index.js';

/**
 * Common message structure across all channels
 */
export interface ChannelMessage {
    content: string;
    senderId: string;
    senderName: string;
    channelId: string;
    attachments?: AttachmentContext[];
    metadata?: Record<string, any>;
    reply: (content: string, attachments?: string[]) => Promise<void>;
    startTyping: () => void;
    stopTyping: () => void;
}

/**
 * Interface for communication platforms (Discord, etc.)
 */
export interface CommunicationChannel {
    readonly id: string;
    readonly isEnabled: boolean;

    /**
     * Initialize and connect to the platform
     */
    start(): Promise<void>;

    /**
     * Disconnect from the platform
     */
    stop(): Promise<void>;

    /**
     * Send a proactive notification to the user
     */
    notify(content: string, attachments?: string[]): Promise<void>;

    /**
     * Register a callback for incoming messages
     */
    onMessage(handler: (message: ChannelMessage) => Promise<void>): void;
}
