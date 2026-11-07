import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type { BrokerClient } from './broker-client.js';
import { WorkerEvent } from './protocol.js';

export type RunIdentity = { workerId: string; runId: string; taskId: string };
const Ack = z.object({ ack: z.string().uuid() }).strict();
/** Shared by active adapters and passive broker recovery. No inference or RPC writes. */
export class WorkerJournal {
    readonly sequence: number;
    constructor(
        readonly filename: string,
        private readonly identity: RunIdentity
    ) {
        fs.mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
        this.check();
        const fd = fs.openSync(filename, 'a', 0o600);
        fs.closeSync(fd);
        const events = this.entries().flatMap((entry) => {
            const event = WorkerEvent.safeParse(entry);
            return event.success ? [event.data] : [];
        });
        if (
            events.some(
                (event) =>
                    event.workerId !== identity.workerId ||
                    event.runId !== identity.runId ||
                    event.taskId !== identity.taskId
            )
        )
            throw new Error('Worker journal identity mismatch');
        this.sequence = events.reduce((n, event) => Math.max(n, event.sequence + 1), 0);
    }
    private check(): void {
        if (fs.existsSync(this.filename)) {
            const stat = fs.lstatSync(this.filename);
            if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024 * 1024)
                throw new Error('Unsafe or oversized worker journal');
        }
    }
    private entries(): Array<z.infer<typeof WorkerEvent> | z.infer<typeof Ack>> {
        this.check();
        const content = fs.readFileSync(this.filename, 'utf8');
        if (content && !content.endsWith('\n'))
            throw new Error('Incomplete worker journal requires reconciliation');
        return content
            .split('\n')
            .filter(Boolean)
            .map((line) => z.union([WorkerEvent, Ack]).parse(JSON.parse(line)));
    }
    append(value: unknown): void {
        this.check();
        const file = fs.openSync(this.filename, 'a', 0o600);
        try {
            fs.writeSync(file, JSON.stringify(value) + '\n');
            fs.fsyncSync(file);
        } finally {
            fs.closeSync(file);
        }
    }
    async replay(client: BrokerClient): Promise<void> {
        const entries = this.entries(),
            acks = new Set(entries.flatMap((entry) => ('ack' in entry ? [entry.ack] : [])));
        if (!entries.some((entry) => !('ack' in entry) && !acks.has(entry.id))) return;
        await client.request({
            op: 'begin_run',
            workerId: this.identity.workerId,
            runId: this.identity.runId,
            taskId: this.identity.taskId
        });
        for (const event of entries)
            if (!('ack' in event) && !acks.has(event.id)) {
                await client.request({ op: 'publish', event });
                this.append({ ack: event.id });
            }
    }
}
