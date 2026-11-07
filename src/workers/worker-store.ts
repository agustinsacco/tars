import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import {
    Command,
    Decision,
    RegisterWorker,
    Worker,
    WorkerEvent,
    type WorkerCommand,
    type WorkerEventRecord,
    type WorkerRecord
} from './protocol.js';

const Row = z.object({ body: z.string() });
function body(row: unknown): unknown {
    return JSON.parse(Row.parse(row).body);
}

/** Single broker-owned connection. No worker content is executed or used as a path. */
export class WorkerStore {
    private readonly db: DatabaseSync;
    constructor(filename: string) {
        fs.mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
        if (fs.existsSync(filename) && fs.lstatSync(filename).isSymbolicLink())
            throw new Error('Worker database cannot be a symlink');
        this.db = new DatabaseSync(filename);
        fs.chmodSync(filename, 0o600);
        this.db.exec(
            'PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=3000;'
        );
        const version = z
            .object({ user_version: z.number() })
            .parse(this.db.prepare('PRAGMA user_version').get()).user_version;
        if (version > 1) {
            this.db.close();
            throw new Error('Worker database requires a newer Tars');
        }
        this.db.exec(`BEGIN IMMEDIATE;
            CREATE TABLE IF NOT EXISTS workers(id TEXT PRIMARY KEY, name_key TEXT UNIQUE, emoji TEXT UNIQUE, body TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS runs(id TEXT PRIMARY KEY, worker_id TEXT NOT NULL REFERENCES workers(id), task_id TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS events(id TEXT PRIMARY KEY, worker_id TEXT NOT NULL REFERENCES workers(id), run_id TEXT NOT NULL, sequence INTEGER NOT NULL, body TEXT NOT NULL, decision TEXT, attempts INTEGER NOT NULL DEFAULT 0, UNIQUE(worker_id,run_id,sequence));
            CREATE TABLE IF NOT EXISTS commands(id TEXT PRIMARY KEY, worker_id TEXT NOT NULL REFERENCES workers(id), body TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS deliveries(id TEXT PRIMARY KEY, worker_id TEXT NOT NULL REFERENCES workers(id), body TEXT NOT NULL, delivered INTEGER NOT NULL DEFAULT 0);
            PRAGMA user_version=1; COMMIT;`);
        // A crash after writing a command may have reached pi. Never blindly resend.
        for (const row of this.db.prepare('SELECT body FROM commands').all()) {
            const command = Command.parse(body(row));
            if (command.state === 'sending') this.setCommandState(command.id, 'delivery_unknown');
        }
    }
    close(): void {
        this.db.close();
    }
    private transaction<T>(fn: () => T): T {
        this.db.exec('BEGIN IMMEDIATE');
        try {
            const result = fn();
            this.db.exec('COMMIT');
            return result;
        } catch (error) {
            this.db.exec('ROLLBACK');
            throw error;
        }
    }
    register(input: unknown): WorkerRecord {
        const count = this.list().length;
        if (count >= 32)
            throw new Error('Maximum 32 registered workers; explicitly remove an identity first');
        const parsed = RegisterWorker.parse(input),
            now = new Date().toISOString();
        const worker = Worker.parse({
            ...parsed,
            id: randomUUID(),
            state: 'registered',
            createdAt: now,
            updatedAt: now
        });
        this.db
            .prepare('INSERT INTO workers VALUES(?,?,?,?)')
            .run(worker.id, worker.name.toLowerCase(), worker.emoji, JSON.stringify(worker));
        return worker;
    }
    list(): WorkerRecord[] {
        return this.db
            .prepare(
                "SELECT body FROM workers WHERE json_extract(body, '$.state') != 'removed' ORDER BY rowid LIMIT 32"
            )
            .all()
            .map((r) => Worker.parse(body(r)));
    }
    get(id: string): WorkerRecord {
        const row = this.db.prepare('SELECT body FROM workers WHERE id=?').get(id);
        if (!row) throw new Error('Unknown worker');
        return Worker.parse(body(row));
    }
    private active(id: string): WorkerRecord {
        const worker = this.get(id);
        if (worker.state === 'removed') throw new Error('Worker removed');
        return worker;
    }
    private update(worker: WorkerRecord): void {
        worker.updatedAt = new Date().toISOString();
        this.db
            .prepare('UPDATE workers SET body=? WHERE id=?')
            .run(JSON.stringify(worker), worker.id);
    }
    remove(id: string): void {
        this.transaction(() => {
            const worker = this.active(id);
            if (
                this.commands(id).some(
                    (c) => c.state === 'sending' || c.state === 'delivery_unknown'
                )
            )
                throw new Error('Reconcile commands before removal');
            if (worker.state === 'running') throw new Error('Stop worker before removal');
            for (const command of this.commands(id))
                if (command.state === 'pending') this.changeCommandState(command.id, 'rejected');
            worker.state = 'removed';
            this.update(worker);
            // Tombstone identity/history; release display labels for explicit reuse.
            this.db.prepare('UPDATE workers SET name_key=NULL,emoji=NULL WHERE id=?').run(id);
        });
    }
    beginRun(workerId: string, runId: string, taskId: string): void {
        this.active(workerId);
        const previous = this.db
            .prepare('SELECT worker_id,task_id FROM runs WHERE id=?')
            .get(runId);
        if (previous) {
            if (previous.worker_id !== workerId || previous.task_id !== taskId)
                throw new Error('Run identity conflict');
            return;
        }
        this.db.prepare('INSERT INTO runs VALUES(?,?,?)').run(runId, workerId, taskId);
    }
    publish(input: unknown): { inserted: boolean } {
        const event = WorkerEvent.parse(input);
        return this.transaction(() => {
            const worker = this.active(event.workerId);
            const run = this.db
                .prepare('SELECT worker_id,task_id FROM runs WHERE id=?')
                .get(event.runId);
            if (!run || run.worker_id !== event.workerId || run.task_id !== event.taskId)
                throw new Error('Event does not match registered run');
            const existing = this.db
                .prepare(
                    'SELECT body FROM events WHERE id=? OR (worker_id=? AND run_id=? AND sequence=?)'
                )
                .get(event.id, event.workerId, event.runId, event.sequence);
            if (existing) {
                if (JSON.stringify(body(existing)) !== JSON.stringify(event))
                    throw new Error('Conflicting event replay');
                return { inserted: false };
            }
            const latest = this.db
                .prepare(
                    'SELECT max(sequence) AS sequence FROM events WHERE worker_id=? AND run_id=?'
                )
                .get(event.workerId, event.runId);
            if (latest && typeof latest.sequence === 'number' && event.sequence <= latest.sequence)
                throw new Error('Stale event sequence');
            const pending = z
                .object({ count: z.number() })
                .parse(
                    this.db
                        .prepare('SELECT count(*) AS count FROM events WHERE decision IS NULL')
                        .get()
                ).count;
            if (pending >= 256)
                throw new Error('Worker inbox full; producer must retain event and retry');
            this.db
                .prepare('INSERT INTO events(id,worker_id,run_id,sequence,body) VALUES(?,?,?,?,?)')
                .run(event.id, event.workerId, event.runId, event.sequence, JSON.stringify(event));
            worker.state =
                event.type === 'result'
                    ? 'completed'
                    : ['question', 'blocked'].includes(event.type)
                      ? 'awaiting_direction'
                      : 'failed';
            this.update(worker);
            return { inserted: true };
        });
    }
    next(): { event: WorkerEventRecord; worker: WorkerRecord; attempts: number } | null {
        const row = this.db
            .prepare(
                'SELECT body,attempts FROM events WHERE decision IS NULL ORDER BY rowid LIMIT 1'
            )
            .get();
        if (!row) return null;
        const event = WorkerEvent.parse(body(row));
        return {
            event,
            worker: this.get(event.workerId),
            attempts: z.object({ attempts: z.number() }).parse(row).attempts
        };
    }
    beginInference(eventId: string): void {
        const result = this.db
            .prepare(
                'UPDATE events SET attempts=attempts+1 WHERE id=? AND decision IS NULL AND attempts<3'
            )
            .run(eventId);
        if (!result.changes)
            throw new Error('Event inference budget exhausted or event already processed');
    }
    deferInference(eventId: string): void {
        this.db
            .prepare('UPDATE events SET attempts=max(0,attempts-1) WHERE id=? AND decision IS NULL')
            .run(eventId);
    }
    messages(id: string): WorkerEventRecord[] {
        this.get(id);
        return this.db
            .prepare('SELECT body FROM events WHERE worker_id=? ORDER BY rowid DESC LIMIT 20')
            .all(id)
            .map((r) => WorkerEvent.parse(body(r)));
    }
    send(id: string, workerId: string, mode: WorkerCommand['mode'], text: string): WorkerCommand {
        const command = Command.parse({ id, workerId, mode, text, state: 'pending' });
        this.active(workerId);
        const row = this.db.prepare('SELECT body FROM commands WHERE id=?').get(id);
        if (row) {
            const previous = Command.parse(body(row));
            if (previous.workerId !== workerId || previous.mode !== mode || previous.text !== text)
                throw new Error('Command ID conflict');
            return previous;
        }
        if (this.commands(workerId).some((c) => c.state === 'delivery_unknown'))
            throw new Error('Reconcile uncertain command delivery before adding instructions');
        if (mode !== 'stop' && !text.trim()) throw new Error('Instruction required');
        if (this.commands(workerId).filter((c) => c.state === 'pending').length >= 16)
            throw new Error('Worker command queue full');
        this.db
            .prepare('INSERT INTO commands VALUES(?,?,?)')
            .run(id, workerId, JSON.stringify(command));
        return command;
    }
    commands(id: string): WorkerCommand[] {
        return this.db
            .prepare('SELECT body FROM commands WHERE worker_id=? ORDER BY rowid DESC LIMIT 32')
            .all(id)
            .map((r) => Command.parse(body(r)))
            .reverse();
    }
    setCommandState(id: string, state: Exclude<WorkerCommand['state'], 'pending'>): void {
        this.transaction(() => this.changeCommandState(id, state));
    }
    private changeCommandState(
        id: string,
        state: Exclude<WorkerCommand['state'], 'pending'>
    ): void {
        const row = this.db.prepare('SELECT body FROM commands WHERE id=?').get(id);
        if (!row) throw new Error('Unknown command');
        const command = Command.parse(body(row));
        const allowed: Record<WorkerCommand['state'], string[]> = {
            pending: ['sending', 'rejected'],
            sending: ['accepted', 'delivery_unknown', 'rejected'],
            accepted: [],
            delivery_unknown: ['accepted', 'rejected'],
            rejected: []
        };
        if (command.state !== state && !allowed[command.state].includes(state))
            throw new Error('Invalid command transition');
        command.state = state;
        this.db.prepare('UPDATE commands SET body=? WHERE id=?').run(JSON.stringify(command), id);
        if (state === 'sending' && command.mode !== 'stop') {
            const worker = this.active(command.workerId);
            worker.state = 'running';
            this.update(worker);
        } else if (state === 'accepted' && command.mode === 'stop') {
            const worker = this.active(command.workerId);
            worker.state = 'stopped';
            this.update(worker);
        } else if (state === 'delivery_unknown') {
            const worker = this.active(command.workerId);
            worker.state = 'awaiting_direction';
            this.update(worker);
        }
    }
    decide(eventId: string, input: unknown): void {
        const decision = Decision.parse(input);
        this.transaction(() => {
            const row = this.db.prepare('SELECT body,decision FROM events WHERE id=?').get(eventId);
            if (!row) throw new Error('Unknown event');
            const previous = z.object({ decision: z.string().nullable() }).parse(row).decision;
            if (previous) {
                if (previous !== JSON.stringify(decision))
                    throw new Error('Decision already committed');
                return;
            }
            const event = WorkerEvent.parse(body(row)),
                worker = this.get(event.workerId);
            if (decision.followUp) {
                if (
                    !worker.allowFollowUp ||
                    worker.state === 'removed' ||
                    ['failed', 'timed_out', 'exited'].includes(event.type)
                )
                    throw new Error('Automatic follow-up not authorized');
                this.send(eventId, worker.id, 'follow_up', decision.followUp);
            }
            const content =
                `**${worker.emoji} ${worker.name} — ${event.type}**\n${decision.summary}`.replace(
                    /@/g,
                    '@\u200b'
                );
            this.db
                .prepare('INSERT INTO deliveries VALUES(?,?,?,0)')
                .run(
                    eventId,
                    worker.id,
                    JSON.stringify({ id: eventId, workerId: worker.id, content })
                );
            this.db
                .prepare('UPDATE events SET decision=? WHERE id=?')
                .run(JSON.stringify(decision), eventId);
        });
    }
    deliveries(): unknown[] {
        return this.db
            .prepare('SELECT body FROM deliveries WHERE delivered=0 ORDER BY rowid LIMIT 20')
            .all()
            .map(body);
    }
    delivered(id: string): void {
        this.db.prepare('UPDATE deliveries SET delivered=1 WHERE id=?').run(id);
    }
}
