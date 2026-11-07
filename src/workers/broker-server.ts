import net from 'node:net';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Request, type WorkerOperation } from './protocol.js';
import { type WorkerStore } from './worker-store.js';

const MAX_FRAME = 32 * 1024;
/** Private same-user transport, not an OS sandbox or an owner-message ingress. */
export class BrokerServer {
    private readonly server: net.Server;
    private readonly peers = new Set<net.Socket>();
    private readonly dispatchers = new Set<net.Socket>();
    constructor(
        private readonly socketPath: string,
        private readonly store: WorkerStore
    ) {
        this.server = net.createServer((peer) => this.accept(peer));
    }
    async start(): Promise<void> {
        await fs.mkdir(path.dirname(this.socketPath), { recursive: true, mode: 0o700 });
        const directory = await fs.lstat(path.dirname(this.socketPath));
        if (!directory.isDirectory() || directory.isSymbolicLink())
            throw new Error('Unsafe broker directory');
        await fs.chmod(path.dirname(this.socketPath), 0o700);
        await new Promise<void>((resolve, reject) => {
            this.server.once('error', reject);
            this.server.listen(this.socketPath, () => {
                this.server.off('error', reject);
                resolve();
            });
        });
        await fs.chmod(this.socketPath, 0o600);
    }
    async stop(): Promise<void> {
        for (const peer of this.peers) peer.destroy();
        if (this.server.listening)
            await new Promise<void>((resolve, reject) =>
                this.server.close((e) => (e ? reject(e) : resolve()))
            );
        this.store.close();
    }
    private changed(): void {
        for (const peer of this.dispatchers) this.write(peer, { type: 'changed' });
    }
    private write(peer: net.Socket, value: unknown): void {
        if (peer.writableLength > 128 * 1024) {
            peer.destroy();
            return;
        }
        peer.write(JSON.stringify(value) + '\n');
    }
    private accept(peer: net.Socket): void {
        this.peers.add(peer);
        let buffer = Buffer.alloc(0);
        peer.on('error', () => undefined);
        peer.on('close', () => {
            this.peers.delete(peer);
            this.dispatchers.delete(peer);
        });
        peer.on('data', (chunk: Buffer) => {
            buffer = Buffer.concat([buffer, chunk]);
            while (true) {
                const index = buffer.indexOf(10);
                if (index === -1) break;
                if (index > MAX_FRAME) {
                    peer.destroy();
                    return;
                }
                const frame = buffer.subarray(0, index);
                buffer = buffer.subarray(index + 1);
                let parsed: unknown;
                try {
                    parsed = JSON.parse(frame.toString('utf8'));
                } catch {
                    peer.destroy();
                    return;
                }
                if (
                    typeof parsed === 'object' &&
                    parsed !== null &&
                    Reflect.get(parsed, 'type') === 'subscribe'
                ) {
                    // One inference consumer per broker. Other clients may issue commands.
                    if (this.dispatchers.size && !this.dispatchers.has(peer)) {
                        peer.destroy();
                        return;
                    }
                    this.dispatchers.add(peer);
                    this.write(peer, { type: 'changed' });
                    continue;
                }
                const request = Request.safeParse(parsed);
                if (!request.success) {
                    peer.destroy();
                    return;
                }
                try {
                    const data = this.execute(request.data.operation);
                    this.write(peer, { id: request.data.id, ok: true, data });
                    if (
                        ![
                            'list',
                            'get',
                            'messages',
                            'next',
                            'deliveries',
                            'commands',
                            'trace'
                        ].includes(request.data.operation.op)
                    )
                        this.changed();
                } catch (error) {
                    this.write(peer, {
                        id: request.data.id,
                        ok: false,
                        error: error instanceof Error ? error.message : 'Worker operation failed'
                    });
                }
            }
            if (buffer.length > MAX_FRAME) peer.destroy();
        });
    }
    private execute(operation: WorkerOperation): unknown {
        switch (operation.op) {
            case 'import_legacy':
                return this.store.importLegacy(operation.input, operation.legacy, operation.dryRun);
            case 'register':
                return this.store.register(operation.input);
            case 'list':
                return this.store.list();
            case 'get':
                return this.store.get(operation.workerId);
            case 'process_stopped':
                return this.store.processStopped(operation.workerId);
            case 'remove':
                return this.store.remove(operation.workerId);
            case 'send':
                return this.store.send(
                    operation.commandId,
                    operation.workerId,
                    operation.mode,
                    operation.text
                );
            case 'reconcile_command':
                return this.store.reconcileCommand(
                    operation.id,
                    operation.state,
                    operation.evidence
                );
            case 'trace':
                return this.store.trace(operation.workerId);
            case 'messages':
                return this.store.messages(operation.workerId);
            case 'begin_run':
                return this.store.beginRun(operation.workerId, operation.runId, operation.taskId);
            case 'publish':
                return this.store.publish(operation.event);
            case 'next':
                return this.store.next();
            case 'defer_inference':
                return this.store.deferInference(operation.eventId);
            case 'begin_inference':
                return this.store.beginInference(operation.eventId);
            case 'decide':
                return this.store.decide(operation.eventId, operation.decision);
            case 'deliveries':
                return this.store.deliveries();
            case 'delivered':
                return this.store.delivered(operation.id);
            case 'commands':
                return this.store.commands(operation.workerId);
            case 'command_state':
                return this.store.setCommandState(operation.id, operation.state);
        }
    }
}
