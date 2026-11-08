import { describe, it, expect, vi, afterEach } from 'vitest';
import { PassThrough } from 'node:stream';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { BrokerServer } from '../../workers/broker-server.js';
import { BrokerClient } from '../../workers/broker-client.js';
import { WorkerStore } from '../../workers/worker-store.js';
import { Worker } from '../../workers/protocol.js';
import { PiRpcAdapter } from '../../workers/pi-rpc-adapter.js';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
    for (const fn of cleanup.splice(0).reverse()) await fn();
});
async function setup() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tars-wrpc-'));
    const store = new WorkerStore(path.join(root, 'db')),
        server = new BrokerServer(path.join(root, 'b.sock'), store);
    await server.start();
    cleanup.push(async () => {
        await server.stop();
        fs.rmSync(root, { recursive: true, force: true });
    });
    const client = new BrokerClient(path.join(root, 'b.sock'));
    await client.connect(true);
    cleanup.push(async () => client.close());
    const worker = Worker.parse(
        await client.request({
            op: 'register',
            input: {
                name: 'Relay',
                emoji: '📬',
                objective: 'Review',
                scope: 'Staged source',
                allowFollowUp: false
            }
        })
    );
    const identity = { workerId: worker.id, runId: randomUUID(), taskId: randomUUID() };
    const input = new PassThrough(),
        output = new PassThrough(),
        onError = vi.fn();
    const journal = path.join(root, 'events.jsonl');
    const adapter = new PiRpcAdapter(client, input, output, identity, onError, journal);
    input.on('data', (bytes: Buffer) => {
        for (const line of bytes.toString('utf8').trim().split('\n')) {
            const request = JSON.parse(line);
            if (request.type === 'get_state')
                output.write(
                    JSON.stringify({
                        type: 'response',
                        id: request.id,
                        success: true,
                        data: { isStreaming: false, isCompacting: false, pendingMessageCount: 0 }
                    }) + '\n'
                );
        }
    });
    await adapter.start();
    cleanup.push(async () => {
        adapter.detach();
        input.destroy();
        output.destroy();
    });
    return { root, store, client, worker, identity, input, output, onError, adapter, journal };
}
function final(summary: string, stopReason = 'stop') {
    return (
        JSON.stringify({ type: 'agent_start' }) +
        '\n' +
        JSON.stringify({
            type: 'message_end',
            message: { role: 'assistant', stopReason, content: [{ type: 'text', text: summary }] }
        }) +
        '\n' +
        JSON.stringify({ type: 'agent_end' }) +
        '\n'
    );
}
describe('Pi RPC adapter', () => {
    it('frames split UTF-8/partial lines and preserves bound identity rather than text claims', async () => {
        const { output, client, worker, onError } = await setup();
        const bytes = Buffer.from(
            final(JSON.stringify({ status: 'question', summary: '📬 Which approach?' }))
        );
        for (let i = 0; i < bytes.length; i++) output.write(bytes.subarray(i, i + 1));
        await vi.waitFor(async () =>
            expect(await client.request({ op: 'messages', workerId: worker.id })).toHaveLength(1)
        );
        const messages = (await client.request({ op: 'messages', workerId: worker.id })) as any[];
        expect(messages[0].workerId).toBe(worker.id);
        expect(messages[0].type).toBe('question');
        expect(messages[0].summary).toContain('📬');
        expect(onError).not.toHaveBeenCalled();
    });
    it('does not turn output-limit completion into success', async () => {
        const { output, client, worker } = await setup();
        output.write(final('partial', 'length'));
        await vi.waitFor(async () =>
            expect(await client.request({ op: 'messages', workerId: worker.id })).toHaveLength(1)
        );
        expect(
            ((await client.request({ op: 'messages', workerId: worker.id })) as any[])[0].type
        ).toBe('failed');
    });
    it('journals before publishing and replays an unacknowledged event idempotently', async () => {
        const { output, client, worker, identity, adapter, journal, input, onError } =
            await setup();
        output.write(final('Reviewed'));
        await vi.waitFor(async () =>
            expect(await client.request({ op: 'messages', workerId: worker.id })).toHaveLength(1)
        );
        await vi.waitFor(() => expect(fs.readFileSync(journal, 'utf8')).toContain('"ack"'));
        adapter.detach();
        const lines = fs.readFileSync(journal, 'utf8').trim().split('\n');
        fs.writeFileSync(journal, lines.filter((l) => !JSON.parse(l).ack).join('\n') + '\n');
        const second = new PiRpcAdapter(client, input, output, identity, onError, journal);
        await second.start();
        cleanup.push(async () => second.detach());
        expect(await client.request({ op: 'messages', workerId: worker.id })).toHaveLength(1);
        expect(fs.readFileSync(journal, 'utf8')).toContain('"ack"');
    });
    it('distinguishes command acceptance from completion', async () => {
        const { input, output, client, worker } = await setup();
        input.on('data', (bytes: Buffer) => {
            for (const line of bytes.toString('utf8').trim().split('\n')) {
                const request = JSON.parse(line);
                output.write(
                    JSON.stringify({ type: 'response', id: request.id, success: true, data: {} }) +
                        '\n'
                );
            }
        });
        const commandId = randomUUID();
        await client.request({
            op: 'send',
            commandId,
            workerId: worker.id,
            mode: 'task',
            text: 'Review staged file'
        });
        await vi.waitFor(async () =>
            expect(
                ((await client.request({ op: 'commands', workerId: worker.id })) as any[])[0]?.state
            ).toBe('accepted')
        );
        expect(await client.request({ op: 'messages', workerId: worker.id })).toHaveLength(0);
    });
});

describe('RPC completion deduplication', () => {
    it('ignores duplicate and unsolicited agent_end frames', async () => {
        const { output, client, worker } = await setup();
        output.write('{"type":"agent_end"}\n');
        output.write(final('done'));
        output.write('{"type":"agent_end"}\n');
        await vi.waitFor(async () =>
            expect(await client.request({ op: 'messages', workerId: worker.id })).toHaveLength(1)
        );
        const events = (await client.request({ op: 'messages', workerId: worker.id })) as any[];
        expect(events[0].summary).toBe('done');
    });
    it('does not send queued instructions until preflight enables commands', async () => {
        const { adapter, input, output, client, worker, identity, onError, root } = await setup();
        adapter.detach();
        const guarded = new PiRpcAdapter(
            client,
            input,
            output,
            identity,
            onError,
            path.join(root, 'guarded.jsonl')
        );
        await guarded.start(false);
        cleanup.push(async () => guarded.detach());
        const requests: string[] = [];
        input.on('data', (bytes: Buffer) => {
            requests.push(JSON.parse(bytes.toString()).type);
        });
        await client.request({
            op: 'send',
            commandId: randomUUID(),
            workerId: worker.id,
            mode: 'task',
            text: 'not yet'
        });
        await new Promise((resolve) => setImmediate(resolve));
        expect(requests).toEqual([]);
    });
    it('does not publish later sequences past a failed event, and replays in order', async () => {
        const { adapter, input, output, client, worker, identity, onError, journal } =
            await setup();
        const original = client.request.bind(client);
        const request = vi.spyOn(client, 'request').mockImplementation(async (operation) => {
            if (operation.op === 'publish') throw new Error('simulated unavailable inbox');
            return original(operation);
        });
        output.write(final('first') + final('second'));
        await vi.waitFor(() => expect(onError).toHaveBeenCalled());
        await adapter.flush();
        request.mockRestore();
        adapter.detach();
        expect(await client.request({ op: 'messages', workerId: worker.id })).toHaveLength(0);
        const replay = new PiRpcAdapter(client, input, output, identity, onError, journal);
        await replay.start(false);
        cleanup.push(async () => replay.detach());
        const events = (await client.request({ op: 'messages', workerId: worker.id })) as any[];
        expect(events.map((e) => e.sequence)).toEqual([1, 0]);
    });
    it('a failed connection can be retried immediately without a stale close affecting the replacement', async () => {
        const { root } = await setup();
        const socket = path.join(root, 'later.sock');
        const retry = new BrokerClient(socket);
        await expect(retry.connect()).rejects.toThrow();
        await expect(retry.connect()).rejects.not.toThrow('already connected');
        const server = new BrokerServer(socket, new WorkerStore(path.join(root, 'later.db')));
        await server.start();
        cleanup.push(async () => server.stop());
        cleanup.push(async () => retry.close());
        await retry.connect();
        expect(await retry.request({ op: 'list' })).toEqual([]);
    });
});

describe('uncertain instruction cancellation', () => {
    it('allows cancellation without retrying an instruction with an unknown receipt', async () => {
        const { adapter, input, output, client, worker, identity, onError, root } = await setup();
        adapter.detach();
        const command = (await client.request({
            op: 'send',
            commandId: randomUUID(),
            workerId: worker.id,
            mode: 'task',
            text: 'uncertain'
        })) as any;
        await client.request({ op: 'command_state', id: command.id, state: 'sending' });
        await client.request({ op: 'command_state', id: command.id, state: 'delivery_unknown' });
        const requests: string[] = [];
        input.on('data', (bytes: Buffer) => {
            const rpc = JSON.parse(bytes.toString());
            requests.push(rpc.type);
            if (rpc.type !== 'get_state')
                output.write(
                    JSON.stringify({ type: 'response', id: rpc.id, success: true, data: {} }) + '\n'
                );
        });
        const active = new PiRpcAdapter(
            client,
            input,
            output,
            identity,
            onError,
            path.join(root, 'cancel.jsonl')
        );
        await active.start();
        cleanup.push(async () => active.detach());
        const stop = (await client.request({
            op: 'send',
            commandId: randomUUID(),
            workerId: worker.id,
            mode: 'stop',
            text: ''
        })) as any;
        await vi.waitFor(async () =>
            expect(
                ((await client.request({ op: 'commands', workerId: worker.id })) as any[]).find(
                    (c) => c.id === stop.id
                )?.state
            ).toBe('accepted')
        );
        expect(requests).toEqual(['clear_queue', 'abort', 'get_state']);
    });
});
