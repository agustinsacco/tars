import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import type * as ChildProcessModule from 'node:child_process';
import { WorkerLifecycle } from '../../workers/worker-lifecycle.js';
import { BrokerServer } from '../../workers/broker-server.js';
import { BrokerClient } from '../../workers/broker-client.js';
import { WorkerStore } from '../../workers/worker-store.js';

vi.mock('node:child_process', async (original) => {
    const actual = await original<typeof ChildProcessModule>();
    return {
        ...actual,
        spawn: vi.fn((command, args, options) =>
            actual.spawn(
                command,
                [
                    fileURLToPath(new URL('../fixtures/worker-rpc.mjs', import.meta.url)),
                    ...args.slice(1)
                ],
                options
            )
        )
    };
});
const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
    for (const fn of cleanup.splice(0).reverse()) await fn();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
});
async function setup() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tars-lifecycle-'));
    const store = new WorkerStore(path.join(root, 'data', 'workers', 'state.sqlite'));
    const server = new BrokerServer(path.join(root, 'broker.sock'), store);
    await server.start();
    cleanup.push(async () => {
        await server.stop();
        fs.rmSync(root, { recursive: true, force: true });
    });
    const client = new BrokerClient(path.join(root, 'broker.sock'));
    await client.connect(true);
    cleanup.push(async () => client.close());
    const lifecycle = new WorkerLifecycle(root, client, vi.fn());
    cleanup.push(async () => lifecycle.close());
    fs.writeFileSync(
        path.join(root, 'data', 'workers', 'local-profile.json'),
        JSON.stringify({ modelId: 'fixture', lifetimeSeconds: 10 })
    );
    vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string) => ({
            ok: true,
            json: async () =>
                url.endsWith('/health') ? { status: 'ok' } : { data: [{ id: 'fixture' }] }
        }))
    );
    const worker = store.register({
        name: 'Relay',
        emoji: '📬',
        objective: 'Test',
        scope: 'Fixture only',
        allowFollowUp: false
    });
    return { root, store, client, lifecycle, worker };
}
describe('Packaged worker lifecycle (real child, fixture RPC)', () => {
    it('registration is passive; launch verifies RPC before sending and resume retains identity/session', async () => {
        const { lifecycle, store, client, worker } = await setup();
        expect(spawn).not.toHaveBeenCalled();
        const receipt = await lifecycle.launch(worker.id);
        expect(receipt.state).toBe('attached');
        expect(receipt.workerId).toBe(worker.id);
        const call = vi.mocked(spawn).mock.calls[0];
        expect(call[1]).toEqual(
            expect.arrayContaining([
                '--no-tools',
                '--no-skills',
                '--no-extensions',
                '--no-context-files',
                '--offline',
                '--no-approve'
            ])
        );
        expect(Object.keys(call[2]!.env!)).toEqual([
            'HOME',
            'PATH',
            'LANG',
            'PI_CODING_AGENT_DIR',
            'PI_OFFLINE',
            'PI_SKIP_VERSION_CHECK'
        ]);
        await client.request({
            op: 'send',
            commandId: randomUUID(),
            workerId: worker.id,
            mode: 'task',
            text: 'test'
        });
        await vi.waitFor(() =>
            expect(store.messages(worker.id)[0]?.summary).toBe('fixture complete')
        );
        const trace = store.trace(worker.id) as any;
        expect(trace.commands[0].state).toBe('accepted');
        expect(trace.events[0].event.runId).toBe(receipt.runId);
        await lifecycle.stop(worker.id);
        expect(lifecycle.inspect(worker.id)?.state).toBe('stopped');
        const next = await lifecycle.launch(worker.id, true);
        expect(next.workerId).toBe(receipt.workerId);
        expect(next.runId).not.toBe(receipt.runId);
        expect(next.sessionFile).toBe(receipt.sessionFile);
        await expect(lifecycle.launch(worker.id)).rejects.toThrow('One local worker');
    });
    it('blocks a stale active receipt without killing or relaunching its PID', async () => {
        const { lifecycle, root, worker } = await setup();
        const directory = path.join(root, 'data', 'workers', 'processes');
        fs.mkdirSync(directory);
        fs.writeFileSync(
            path.join(directory, worker.id + '.json'),
            JSON.stringify({
                version: 1,
                workerId: worker.id,
                runId: randomUUID(),
                taskId: randomUUID(),
                directory: directory + '/old',
                modelId: 'fixture',
                state: 'starting',
                createdAt: new Date().toISOString()
            })
        );
        await expect(lifecycle.launch(worker.id)).rejects.toThrow('reconciliation');
        await expect(lifecycle.reconcile(worker.id)).rejects.toThrow(
            'manual writer reconciliation'
        );
        expect(spawn).not.toHaveBeenCalled();
    });
    it('fails before spawn on missing profile/model mismatch', async () => {
        const { lifecycle, root, worker } = await setup();
        fs.unlinkSync(path.join(root, 'data', 'workers', 'local-profile.json'));
        await expect(lifecycle.launch(worker.id)).rejects.toThrow();
        expect(spawn).not.toHaveBeenCalled();
        fs.writeFileSync(
            path.join(root, 'data', 'workers', 'local-profile.json'),
            JSON.stringify({ modelId: 'wrong' })
        );
        await expect(lifecycle.launch(worker.id)).rejects.toThrow('not served');
        expect(spawn).not.toHaveBeenCalled();
    });
    it('reconciles only an absent verified writer, retaining session and command uncertainty', async () => {
        const { lifecycle, client, store, worker } = await setup();
        const receipt = await lifecycle.launch(worker.id);
        await lifecycle.stop(worker.id);
        const filename = path.join(path.dirname(receipt.directory), worker.id + '.json');
        fs.writeFileSync(filename, JSON.stringify({ ...receipt, state: 'attached' }));
        const command = store.send(randomUUID(), worker.id, 'task', 'uncertain');
        store.setCommandState(command.id, 'sending');
        await lifecycle.reconcile(worker.id);
        expect(store.commands(worker.id)[0].state).toBe('delivery_unknown');
        expect(lifecycle.inspect(worker.id)?.sessionFile).toBe(receipt.sessionFile);
        expect(await client.request({ op: 'messages', workerId: worker.id })).toEqual([]);
    });
    it('shutdown waits for launch preflight and prevents a late worker spawn', async () => {
        const { lifecycle, worker } = await setup();
        let release!: () => void;
        const barrier = new Promise<void>((resolve) => {
            release = resolve;
        });
        vi.stubGlobal(
            'fetch',
            vi.fn(async (url: string) => {
                await barrier;
                return {
                    ok: true,
                    json: async () =>
                        url.endsWith('/health') ? { status: 'ok' } : { data: [{ id: 'fixture' }] }
                };
            })
        );
        const launched = lifecycle.launch(worker.id);
        const failed = expect(launched).rejects.toThrow('stopping');
        const stopped = lifecycle.stopAll();
        release();
        await failed;
        await stopped;
        expect(spawn).not.toHaveBeenCalled();
    });
    it('deadline emits a durable failure and physically stops the owned writer', async () => {
        const { lifecycle, worker, store } = await setup();
        await lifecycle.launch(worker.id);
        await vi.waitFor(() => expect(lifecycle.inspect(worker.id)?.state).toBe('stopped'), {
            timeout: 12000,
            interval: 100
        });
        expect(store.messages(worker.id)[0].type).toBe('timed_out');
    }, 15000);
    it('passive recovery replays only unacked events without launching a process', async () => {
        const { lifecycle, store, worker } = await setup();
        const receipt = await lifecycle.launch(worker.id);
        await lifecycle.stop(worker.id);
        const event = {
            version: 1,
            id: randomUUID(),
            workerId: worker.id,
            runId: receipt.runId,
            taskId: receipt.taskId,
            sequence: 0,
            type: 'result',
            summary: 'Saved before broker outage'
        };
        const journal = path.join(receipt.directory, receipt.runId + '.events.jsonl');
        fs.appendFileSync(journal, JSON.stringify(event) + '\n');
        const calls = vi.mocked(spawn).mock.calls.length;
        await lifecycle.recoverEvents();
        await lifecycle.recoverEvents();
        expect(store.messages(worker.id)).toHaveLength(1);
        expect(vi.mocked(spawn).mock.calls.length).toBe(calls);
        expect(fs.readFileSync(journal, 'utf8')).toContain('"ack"');
    });
});
