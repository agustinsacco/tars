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
