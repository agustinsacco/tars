import net from 'node:net';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { Response, type WorkerOperation } from './protocol.js';

export class BrokerClient extends EventEmitter {
    private socket?: net.Socket;
    private readonly pending = new Map<
        string,
        { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }
    >();
    constructor(readonly socketPath: string) {
        super();
    }
    async connect(subscribe = false): Promise<void> {
        if (this.socket) throw new Error('Broker client already connected');
        const socket = net.createConnection(this.socketPath);
        this.socket = socket;
        let buffer = Buffer.alloc(0);
        let closed = false;
        socket.on('error', () => undefined);
        socket.on('close', () => {
            closed = true;
            if (this.socket === socket) this.socket = undefined;
            for (const { reject, timer } of this.pending.values()) {
                clearTimeout(timer);
                reject(new Error('Broker disconnected; reconcile mutating request before retry'));
            }
            this.pending.clear();
            this.emit('disconnected');
        });
        socket.on('data', (chunk: Buffer) => {
            buffer = Buffer.concat([buffer, chunk]);
            while (true) {
                const index = buffer.indexOf(10);
                if (index === -1) break;
                if (index > 256 * 1024) {
                    socket.destroy();
                    return;
                }
                const frame = buffer.subarray(0, index);
                buffer = buffer.subarray(index + 1);
                try {
                    const value: unknown = JSON.parse(frame.toString('utf8'));
                    if (
                        typeof value === 'object' &&
                        value !== null &&
                        Reflect.get(value, 'type') === 'changed'
                    ) {
                        this.emit('changed');
                        continue;
                    }
                    const response = Response.parse(value),
                        handler = this.pending.get(response.id);
                    if (!handler) continue;
                    this.pending.delete(response.id);
                    clearTimeout(handler.timer);
                    if (response.ok) handler.resolve(response.data);
                    else handler.reject(new Error(response.error ?? 'Broker rejected request'));
                } catch {
                    socket.destroy();
                    return;
                }
            }
            if (buffer.length > 256 * 1024) socket.destroy();
        });
        try {
            await new Promise<void>((resolve, reject) => {
                socket.once('error', reject);
                socket.once('connect', () => {
                    socket.off('error', reject);
                    resolve();
                });
            });
        } catch (error) {
            // Wait for this socket's close handler before a caller may reconnect.
            // Otherwise the old close can reject requests on the replacement socket.
            if (!closed)
                await new Promise<void>((resolve) => {
                    socket.once('close', () => resolve());
                    socket.destroy();
                });
            throw error;
        }
        if (subscribe) socket.write('{"type":"subscribe"}\n');
    }
    request(operation: WorkerOperation): Promise<unknown> {
        const socket = this.socket;
        if (!socket || socket.destroyed)
            return Promise.reject(new Error('Worker broker unavailable'));
        if (this.pending.size >= 32 || socket.writableLength > 128 * 1024)
            return Promise.reject(new Error('Worker broker backpressure'));
        const id = randomUUID(),
            frame = JSON.stringify({ id, operation }) + '\n';
        if (Buffer.byteLength(frame) > 32 * 1024)
            return Promise.reject(new Error('Worker request too large'));
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(id);
                reject(new Error('Broker receipt timed out; reconcile before retry'));
            }, 15_000);
            this.pending.set(id, { resolve, reject, timer });
            socket.write(frame);
        });
    }
    close(): void {
        this.socket?.destroy();
    }
}
