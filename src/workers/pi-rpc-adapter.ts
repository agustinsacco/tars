import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Readable, Writable } from 'node:stream';
import { z } from 'zod';
import { type BrokerClient } from './broker-client.js';
import { Command, WorkerEvent, type WorkerEventRecord } from './protocol.js';

const RpcEvent = z
    .object({
        type: z.string(),
        id: z.string().optional(),
        success: z.boolean().optional(),
        data: z.unknown().optional(),
        message: z.unknown().optional()
    })
    .passthrough();
const Message = z
    .object({
        role: z.string(),
        stopReason: z.string().optional(),
        content: z.array(z.object({ type: z.string(), text: z.string().optional() }).passthrough())
    })
    .passthrough();

/** Attach only to streams from an already authorized/verified worker launch.
 * Owns neither process launch nor model choice. Identity never comes from worker text.
 */
export class PiRpcAdapter {
    private buffer = Buffer.alloc(0);
    private sequence = 0;
    private last?: z.infer<typeof Message>;
    private completed = false;
    private active = false;
    private sending = false;
    private sendAgain = false;
    private readonly pending = new Map<
        string,
        { resolve: (data: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }
    >();
    private publications: Promise<unknown> = Promise.resolve();
    private readonly wake = (): void => {
        void this.sendPending();
    };
    private readonly onData = (chunk: Buffer): void => this.consume(Buffer.from(chunk));
    private readonly onEnd = (): void => {
        if (!this.completed)
            this.publish('exited', 'Worker RPC stream closed without a validated completion.');
        this.detach();
    };
    constructor(
        private readonly client: BrokerClient,
        private readonly input: Writable,
        private readonly output: Readable,
        private readonly identity: { workerId: string; runId: string; taskId: string },
        private readonly onError: (error: Error) => void,
        private readonly journalPath: string
    ) {}
    async start(): Promise<void> {
        fs.mkdirSync(path.dirname(this.journalPath), { recursive: true, mode: 0o700 });
        if (
            fs.existsSync(this.journalPath) &&
            (fs.lstatSync(this.journalPath).isSymbolicLink() ||
                fs.statSync(this.journalPath).size > 1024 * 1024)
        )
            throw new Error('Unsafe or oversized worker journal');
        const file = fs.openSync(this.journalPath, 'a', 0o600);
        fs.closeSync(file);
        const content = fs.readFileSync(this.journalPath, 'utf8');
        if (content && !content.endsWith('\n'))
            throw new Error('Incomplete worker journal requires reconciliation');
        const entries = content
            .split('\n')
            .filter(Boolean)
            .map((line) => JSON.parse(line) as unknown);
        const acknowledged = new Set(
            entries.flatMap((entry) => {
                const ack = z.object({ ack: z.string().uuid() }).strict().safeParse(entry);
                return ack.success ? [ack.data.ack] : [];
            })
        );
        const events = entries.flatMap((entry) => {
            const e = WorkerEvent.safeParse(entry);
            return e.success ? [e.data] : [];
        });
        if (
            events.some(
                (e) =>
                    e.workerId !== this.identity.workerId ||
                    e.runId !== this.identity.runId ||
                    e.taskId !== this.identity.taskId
            )
        )
            throw new Error('Worker journal identity mismatch');
        this.sequence = events.reduce((n, e) => Math.max(n, e.sequence + 1), 0);
        await this.client.request({ op: 'begin_run', ...this.identity });
        for (const event of events)
            if (!acknowledged.has(event.id)) {
                await this.client.request({ op: 'publish', event });
                this.appendJournal({ ack: event.id });
            }
        this.active = true;
        this.output.on('data', this.onData);
        this.output.on('end', this.onEnd);
        this.output.on('error', this.onEnd);
        this.client.on('changed', this.wake);
        this.output.resume();
        this.wake();
    }
    detach(): void {
        this.active = false;
        this.output.pause();
        this.output.off('data', this.onData);
        this.output.off('end', this.onEnd);
        this.output.off('error', this.onEnd);
        this.client.off('changed', this.wake);
        for (const p of this.pending.values()) {
            clearTimeout(p.timer);
            p.reject(new Error('Worker RPC disconnected; reconcile before retry'));
        }
        this.pending.clear();
    }
    private consume(chunk: Buffer): void {
        this.buffer = Buffer.concat([this.buffer, chunk]);
        while (true) {
            const index = this.buffer.indexOf(10);
            if (index === -1) break;
            if (index > 256 * 1024) {
                this.publish('failed', 'Worker RPC frame exceeded limit.');
                this.detach();
                return;
            }
            const line = this.buffer.subarray(0, index);
            this.buffer = this.buffer.subarray(index + 1);
            try {
                const event = RpcEvent.parse(JSON.parse(line.toString('utf8')));
                if (event.type === 'response' && event.id) {
                    const p = this.pending.get(event.id);
                    if (!p) continue;
                    this.pending.delete(event.id);
                    clearTimeout(p.timer);
                    if (event.success) p.resolve(event.data);
                    else p.reject(new Error('Worker rejected RPC request'));
                } else if (event.type === 'agent_start') {
                    this.last = undefined;
                    this.completed = false;
                } else if (event.type === 'message_end') {
                    const message = Message.safeParse(event.message);
                    if (message.success && message.data.role === 'assistant')
                        this.last = message.data;
                } else if (event.type === 'agent_end') {
                    this.completed = true;
                    if (!this.last || this.last.stopReason !== 'stop')
                        this.publish(
                            'failed',
                            'Worker ended without a successful final stop (error, abort or output limit).'
                        );
                    else {
                        const text = this.last.content
                            .filter((c) => c.type === 'text')
                            .map((c) => c.text ?? '')
                            .join('\n');
                        if (!text.trim()) this.publish('failed', 'Worker final answer was empty.');
                        else {
                            let type: WorkerEventRecord['type'] = 'result',
                                summary = text;
                            try {
                                const value = z
                                    .object({
                                        status: z.enum(['result', 'question', 'blocked']),
                                        summary: z.string().min(1)
                                    })
                                    .strict()
                                    .parse(JSON.parse(text));
                                type = value.status;
                                summary = value.summary;
                            } catch {
                                /* Plain final text remains data, not an instruction. */
                            }
                            this.publish(
                                type,
                                summary.length > 1950
                                    ? summary.slice(0, 1900) + ' [truncated; verification required]'
                                    : summary
                            );
                        }
                    }
                }
            } catch {
                this.publish('failed', 'Malformed worker RPC event; stopped consuming stream.');
                this.detach();
                return;
            }
        }
        if (this.buffer.length > 256 * 1024) {
            this.publish('failed', 'Worker RPC frame exceeded limit.');
            this.detach();
        }
    }
    private appendJournal(value: unknown): void {
        const file = fs.openSync(this.journalPath, 'a', 0o600);
        try {
            fs.writeSync(file, JSON.stringify(value) + '\n');
            fs.fsyncSync(file);
        } finally {
            fs.closeSync(file);
        }
    }
    private publish(type: WorkerEventRecord['type'], summary: string): void {
        const event = {
            version: 1 as const,
            id: randomUUID(),
            ...this.identity,
            sequence: this.sequence++,
            type,
            summary
        };
        try {
            this.appendJournal(event);
        } catch {
            this.onError(new Error('Worker event journal unavailable'));
            this.detach();
            return;
        }
        this.publications = this.publications
            .then(async () => {
                await this.client.request({ op: 'publish', event });
                this.appendJournal({ ack: event.id });
            })
            .catch((error: unknown) => {
                this.onError(
                    error instanceof Error ? error : new Error('Worker event persistence failed')
                );
                this.detach();
            });
    }
    private rpc(type: string, extra: Record<string, unknown> = {}): Promise<unknown> {
        const id = randomUUID(),
            frame = JSON.stringify({ type, id, ...extra }) + '\n';
        if (Buffer.byteLength(frame) > 4096)
            return Promise.reject(new Error('Worker command exceeds atomic frame bound'));
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(id);
                reject(new Error('Worker receipt unknown; do not resend'));
            }, 10_000);
            this.pending.set(id, { resolve, reject, timer });
            this.input.write(frame, (error) => {
                if (error) {
                    clearTimeout(timer);
                    this.pending.delete(id);
                    reject(error);
                }
            });
        });
    }
    private async sendPending(): Promise<void> {
        if (!this.active) return;
        if (this.sending) {
            this.sendAgain = true;
            return;
        }
        this.sending = true;
        try {
            const commands = z
                .array(Command)
                .parse(
                    await this.client.request({ op: 'commands', workerId: this.identity.workerId })
                );
            if (commands.some((c) => c.state === 'sending' || c.state === 'delivery_unknown'))
                return;
            for (const command of commands.filter((c) => c.state === 'pending')) {
                await this.client.request({
                    op: 'command_state',
                    id: command.id,
                    state: 'sending'
                });
                try {
                    if (command.mode === 'stop') {
                        await this.rpc('clear_queue');
                        await this.rpc('abort');
                        const state = z
                            .object({
                                isStreaming: z.boolean(),
                                isCompacting: z.boolean(),
                                pendingMessageCount: z.number()
                            })
                            .parse(await this.rpc('get_state'));
                        if (state.isStreaming || state.isCompacting || state.pendingMessageCount)
                            throw new Error('Stop not reconciled');
                    } else
                        await this.rpc(command.mode === 'task' ? 'prompt' : command.mode, {
                            message: command.text
                        });
                    await this.client.request({
                        op: 'command_state',
                        id: command.id,
                        state: 'accepted'
                    });
                } catch (error) {
                    await this.client.request({
                        op: 'command_state',
                        id: command.id,
                        state: 'delivery_unknown'
                    });
                    this.onError(
                        error instanceof Error
                            ? error
                            : new Error('Worker command delivery unknown')
                    );
                    this.publish(
                        'blocked',
                        'An instruction receipt is uncertain. No instruction will be resent automatically; reconcile worker state before continuing.'
                    );
                    break;
                }
            }
        } catch (error) {
            this.onError(
                error instanceof Error ? error : new Error('Worker command dispatch failed')
            );
        } finally {
            this.sending = false;
            if (this.sendAgain && this.active) {
                this.sendAgain = false;
                queueMicrotask(this.wake);
            }
        }
    }
}
