import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import type { Server } from 'node:http';
import type { ChannelMessage, CommunicationChannel } from '../types.js';
import { Config } from '../../config/config.js';

const MAX_BODY_BYTES = 16 * 1024;

type VoiceRelayConfig = {
    enabled?: boolean;
    token?: string;
    ownerId?: string;
    host?: string;
    port?: number;
};

type VoiceTurnRequest = { text?: unknown; sessionId?: unknown };

type VoiceRelayEvent = { type: string; text?: string; safeLabel?: string };

/**
 * Loopback-only JSON-lines relay for a realtime voice gateway. It intentionally
 * has no speech, tool, or browser responsibilities: inbound turns enter the
 * ordinary Tars channel pipeline and replies/status are written as safe events.
 */
export class VoiceRelayChannel implements CommunicationChannel {
    public readonly id = 'voice-relay';
    private handler?: (message: ChannelMessage) => Promise<void>;
    private server?: Server;
    private activeResponse?: ServerResponse;
    private readonly config: VoiceRelayConfig;

    constructor(
        config: VoiceRelayConfig = (Config.getInstance().channels['voiceRelay'] ??
            {}) as VoiceRelayConfig
    ) {
        this.config = config;
    }

    public get isEnabled(): boolean {
        return (
            this.config.enabled === true &&
            typeof this.config.token === 'string' &&
            this.config.token.length >= 24
        );
    }

    public async start(): Promise<void> {
        if (!this.isEnabled) return;
        this.server = createServer(
            (request, response) => void this.handleRequest(request, response)
        );
        await new Promise<void>((resolve, reject) => {
            this.server!.once('error', reject);
            this.server!.listen(this.config.port ?? 8789, this.config.host ?? '127.0.0.1', () => {
                this.server!.off('error', reject);
                resolve();
            });
        });
    }

    public async stop(): Promise<void> {
        if (!this.server) return;
        await new Promise<void>((resolve, reject) =>
            this.server!.close((error) => (error ? reject(error) : resolve()))
        );
        this.server = undefined;
    }

    public onMessage(handler: (message: ChannelMessage) => Promise<void>): void {
        this.handler = handler;
    }
    public async notify(content: string): Promise<void> {
        this.write({ type: 'notification', text: content });
    }
    public async sendStatus(content: string): Promise<void> {
        this.write({ type: 'status', safeLabel: content });
    }
    public async editStatus(content: string): Promise<boolean> {
        this.write({ type: 'status', safeLabel: content });
        return true;
    }
    public clearStatus(): void {
        /* Status is transient in the voice gateway. */
    }

    private async handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
        if (request.method !== 'POST' || request.url !== '/v1/turn')
            return this.fail(response, 404, 'not found');
        if (!this.authorized(request)) return this.fail(response, 401, 'unauthorized');
        const body = await this.readBody(request).catch(() => undefined);
        const parsed = body ? this.parse(body) : undefined;
        const text = typeof parsed?.text === 'string' ? parsed.text.trim() : '';
        if (!text || text.length > 8000 || !this.handler)
            return this.fail(response, 400, 'invalid turn');
        response.writeHead(200, {
            'content-type': 'application/x-ndjson',
            'cache-control': 'no-store',
            connection: 'keep-alive'
        });
        this.activeResponse = response;
        this.write({ type: 'accepted' });
        const message: ChannelMessage = {
            content: text,
            senderId: this.config.ownerId ?? 'voice-owner',
            senderName: 'Voice owner',
            channelId: this.id,
            metadata: {
                voice: true,
                sessionId:
                    typeof parsed?.sessionId === 'string'
                        ? parsed.sessionId.slice(0, 128)
                        : undefined
            },
            reply: async (content) => this.write({ type: 'answer', text: content }),
            startTyping: () => this.write({ type: 'thinking' }),
            stopTyping: () => {
                this.write({ type: 'done' });
                response.end();
                if (this.activeResponse === response) this.activeResponse = undefined;
            }
        };
        try {
            await this.handler(message);
        } catch {
            this.write({ type: 'error', safeLabel: 'Tars could not complete that request.' });
            message.stopTyping();
        }
    }

    private authorized(request: IncomingMessage): boolean {
        const given = request.headers.authorization?.replace(/^Bearer\s+/i, '') ?? '';
        const expected = this.config.token ?? '';
        const a = Buffer.from(given),
            b = Buffer.from(expected);
        return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
    }
    private readBody(request: IncomingMessage): Promise<string> {
        return new Promise((resolve, reject) => {
            let body = '';
            request.setEncoding('utf8');
            request.on('data', (chunk: string) => {
                body += chunk;
                if (body.length > MAX_BODY_BYTES) reject(new Error('too large'));
            });
            request.on('end', () => resolve(body));
            request.on('error', reject);
        });
    }
    private parse(body: string): VoiceTurnRequest | undefined {
        try {
            return JSON.parse(body) as VoiceTurnRequest;
        } catch {
            return undefined;
        }
    }
    private write(event: VoiceRelayEvent): void {
        this.activeResponse?.write(`${JSON.stringify(event)}\n`);
    }
    private fail(response: ServerResponse, code: number, message: string): void {
        response.writeHead(code, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ error: message }));
    }
}
