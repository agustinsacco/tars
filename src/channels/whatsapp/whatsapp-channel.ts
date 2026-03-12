import makeWASocket, {
    useMultiFileAuthState,
    DisconnectReason,
    downloadMediaMessage,
    WAMessage,
    proto
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import qrcode from 'qrcode-terminal';
import path from 'path';
import fs from 'fs';
import { Config } from '../../config/config.js';
import logger from '../../utils/logger.js';
import { CommunicationChannel, ChannelMessage } from '../types.js';
import { AttachmentContext } from '../../types/index.js';
import { AttachmentProcessor } from '../../utils/attachment-processor.js';

/**
 * WhatsApp Channel Implementation using Baileys
 */
export class WhatsAppChannel implements CommunicationChannel {
    public readonly id = 'whatsapp';
    private readonly config: Config;
    private readonly processor: AttachmentProcessor;
    private sock: any;
    private messageHandler?: (message: ChannelMessage) => Promise<void>;
    private isConnected = false;

    constructor() {
        this.config = Config.getInstance();
        this.processor = new AttachmentProcessor(this.config);
    }

    get isEnabled(): boolean {
        const whatsappConfig = this.config.channels.whatsapp;
        return !!(whatsappConfig && whatsappConfig.enabled);
    }

    /**
     * Start the WhatsApp connection
     */
    async start(): Promise<void> {
        if (!this.isEnabled) {
            logger.info('WhatsApp channel is disabled.');
            return;
        }

        const sessionDir = path.join(this.config.homeDir, 'data', 'whatsapp-session');
        if (!fs.existsSync(sessionDir)) {
            fs.mkdirSync(sessionDir, { recursive: true });
        }

        const { state, saveCreds } = await useMultiFileAuthState(sessionDir);

        this.sock = makeWASocket({
            auth: state,
            printQRInTerminal: true,
            browser: ['Tars', 'Chrome', '1.0.0']
        });

        this.sock.ev.on('creds.update', saveCreds);

        this.sock.ev.on('connection.update', (update: any) => {
            const { connection, lastDisconnect, qr } = update;

            if (qr) {
                logger.info('📱 Scan the QR code below to link WhatsApp:');
                if (process.env.name === 'tars-supervisor') {
                    logger.warn(
                        '⚠️ Tars is running in the background. Please use "tars logs" to view the full QR code in your terminal.'
                    );
                }
                qrcode.generate(qr, { small: true });
            }

            if (connection === 'close') {
                const shouldReconnect =
                    (lastDisconnect?.error as Boom)?.output?.statusCode !==
                    DisconnectReason.loggedOut;
                logger.warn(`WhatsApp connection closed. Reconnecting: ${shouldReconnect}`);
                this.isConnected = false;
                if (shouldReconnect) {
                    this.start();
                }
            } else if (connection === 'open') {
                logger.info('✅ WhatsApp channel connected and ready.');
                this.isConnected = true;
            }
        });

        this.sock.ev.on('messages.upsert', async (m: { messages: WAMessage[]; type: string }) => {
            if (m.type === 'notify') {
                for (const msg of m.messages) {
                    if (!msg.key.fromMe && msg.message) {
                        await this.handleIncomingMessage(msg);
                    }
                }
            }
        });
    }

    /**
     * Stop the WhatsApp connection
     */
    async stop(): Promise<void> {
        if (this.sock) {
            await this.sock.logout();
            this.sock = null;
            this.isConnected = false;
        }
    }

    /**
     * Send a proactive notification
     */
    async notify(content: string, attachments?: string[]): Promise<void> {
        const ownerNumber = this.config.channels.whatsapp?.ownerNumber;
        if (!ownerNumber || !this.isConnected) return;

        const jid = `${ownerNumber}@s.whatsapp.net`;
        await this.sendMessageWithAttachments(jid, content, attachments);
    }

    /**
     * Register message handler
     */
    onMessage(handler: (message: ChannelMessage) => Promise<void>): void {
        this.messageHandler = handler;
    }

    /**
     * Internal handler for incoming WhatsApp messages
     */
    private async handleIncomingMessage(msg: WAMessage): Promise<void> {
        if (!this.messageHandler) return;

        const jid = msg.key.remoteJid!;
        const ownerNumber = this.config.channels.whatsapp?.ownerNumber;

        // Security: Only respond to the owner if configured
        if (ownerNumber && !jid.startsWith(ownerNumber)) {
            logger.warn(`WhatsApp: Ignored message from unauthorized sender: ${jid}`);
            return;
        }

        const text =
            msg.message?.conversation ||
            msg.message?.extendedTextMessage?.text ||
            msg.message?.imageMessage?.caption ||
            msg.message?.videoMessage?.caption ||
            '';

        const attachments: AttachmentContext[] = [];
        const messageType = Object.keys(msg.message!)[0];

        // Handle Media Attachments
        if (
            ['imageMessage', 'videoMessage', 'documentMessage', 'audioMessage'].includes(
                messageType
            )
        ) {
            try {
                const buffer = await downloadMediaMessage(msg, 'buffer', {});
                const mimeType = (msg.message as any)[messageType].mimetype;
                const fileName =
                    (msg.message as any)[messageType].fileName || `wa_media_${Date.now()}`;

                // Save to temporary file
                const filePath = path.join(this.config.homeDir, 'data', 'uploads', fileName);
                fs.writeFileSync(filePath, buffer);

                attachments.push({
                    path: filePath,
                    mimeType: mimeType
                });
            } catch (err: any) {
                logger.error(`Failed to download WhatsApp media: ${err.message}`);
            }
        }

        if (!text && attachments.length === 0) return;

        const channelMessage: ChannelMessage = {
            content: text,
            senderId: jid,
            senderName: msg.pushName || 'WhatsApp User',
            channelId: jid,
            attachments,
            reply: async (response: string, outAttachments?: string[]) => {
                await this.sendMessageWithAttachments(jid, response, outAttachments);
            }
        };

        await this.messageHandler(channelMessage);
    }

    /**
     * Helper to send message with optional attachments
     */
    private async sendMessageWithAttachments(
        jid: string,
        content: string,
        attachments?: string[]
    ): Promise<void> {
        if (!this.sock) return;

        // Send text message first
        await this.sock.sendMessage(jid, { text: content });

        // Send attachments if any
        if (attachments && attachments.length > 0) {
            for (const filePath of attachments) {
                const mimeType = this.getMimeType(filePath);
                if (mimeType.startsWith('image/')) {
                    await this.sock.sendMessage(jid, { image: { url: filePath } });
                } else if (mimeType.startsWith('video/')) {
                    await this.sock.sendMessage(jid, { video: { url: filePath } });
                } else {
                    await this.sock.sendMessage(jid, {
                        document: { url: filePath },
                        fileName: path.basename(filePath),
                        mimetype: mimeType
                    });
                }
            }
        }
    }

    private getMimeType(filePath: string): string {
        const ext = path.extname(filePath).toLowerCase();
        const map: Record<string, string> = {
            '.png': 'image/png',
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.gif': 'image/gif',
            '.mp4': 'video/mp4',
            '.pdf': 'application/pdf',
            '.txt': 'text/plain'
        };
        return map[ext] || 'application/octet-stream';
    }
}
