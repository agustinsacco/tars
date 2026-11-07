import { describe, it, expect, vi, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { BrokerServer } from '../../workers/broker-server.js';
import { BrokerClient } from '../../workers/broker-client.js';
import { WorkerStore } from '../../workers/worker-store.js';
import { WorkerEventDispatcher } from '../../workers/event-dispatcher.js';
import { Worker } from '../../workers/protocol.js';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
    vi.useRealTimers();
    for (const fn of cleanup.splice(0).reverse()) await fn();
});
async function setup() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tars-wpush-'));
    const server = new BrokerServer(
        path.join(root, 'b.sock'),
        new WorkerStore(path.join(root, 'db'))
    );
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
                scope: 'Read only',
                allowFollowUp: false
            }
        })
    );
    const runId = randomUUID(),
        taskId = randomUUID();
    await client.request({ op: 'begin_run', workerId: worker.id, runId, taskId });
    const event = {
        version: 1 as const,
        id: randomUUID(),
        workerId: worker.id,
        runId,
        taskId,
        sequence: 0,
        type: 'question' as const,
        summary: 'Which approach?'
    };
    const supervisor = Object.assign(new EventEmitter(), {
        isBusy: vi.fn(() => false),
        executeWorkerEvent: vi.fn(async (_prompt: string) =>
            JSON.stringify({
                decision: 'ask_owner',
                summary: 'I recommend option A; please approve.'
            })
        )
    });
    const notifier = { notifyTo: vi.fn(async () => undefined) };
    const dispatcher = new WorkerEventDispatcher(client, supervisor, notifier);
    dispatcher.start();
    cleanup.push(async () => dispatcher.stop());
    return { root, server, client, event, worker, supervisor, notifier, dispatcher };
}
describe('event-driven worker push', () => {
    it('pushes via a real socket into Tars reasoning and explicit Discord delivery without cron', async () => {
        const { client, event, supervisor, notifier } = await setup();
        await client.request({ op: 'publish', event });
        await vi.waitFor(() => expect(notifier.notifyTo).toHaveBeenCalledOnce());
        expect(supervisor.executeWorkerEvent).toHaveBeenCalledOnce();
        expect(supervisor.executeWorkerEvent.mock.calls[0][0]).toContain('UNTRUSTED');
        expect(notifier.notifyTo).toHaveBeenCalledWith(
            'discord',
            expect.stringContaining('📬 Relay')
        );
        await client.request({ op: 'publish', event });
        await new Promise((r) => setTimeout(r, 30));
        expect(supervisor.executeWorkerEvent).toHaveBeenCalledOnce();
    });
    it('keeps a busy event pending and dispatches on idle event', async () => {
        const { client, event, supervisor, notifier } = await setup();
        supervisor.isBusy.mockReturnValue(true);
        await client.request({ op: 'publish', event });
        await new Promise((r) => setTimeout(r, 30));
        expect(supervisor.executeWorkerEvent).not.toHaveBeenCalled();
        supervisor.isBusy.mockReturnValue(false);
        supervisor.emit('idle');
        await vi.waitFor(() => expect(notifier.notifyTo).toHaveBeenCalledOnce());
    });
    it('turns malformed model output into a held decision, not worker commands', async () => {
        const { client, event, supervisor, notifier, worker } = await setup();
        supervisor.executeWorkerEvent.mockResolvedValue('not json');
        await client.request({ op: 'publish', event });
        await vi.waitFor(() => expect(notifier.notifyTo).toHaveBeenCalledOnce());
        expect(notifier.notifyTo).toHaveBeenCalledWith(
            'discord',
            expect.stringContaining('No follow-up was sent')
        );
        expect(await client.request({ op: 'commands', workerId: worker.id })).toEqual([]);
    });
    it('retains failed Discord delivery without repeating inference', async () => {
        const { client, event, supervisor, notifier, dispatcher } = await setup();
        notifier.notifyTo.mockRejectedValue(new Error('offline'));
        await client.request({ op: 'publish', event });
        await vi.waitFor(() => expect(notifier.notifyTo).toHaveBeenCalledOnce());
        dispatcher.stop();
        expect(await client.request({ op: 'deliveries' })).toHaveLength(1);
        notifier.notifyTo.mockResolvedValue(undefined);
        dispatcher.start();
        await vi.waitFor(() => expect(notifier.notifyTo).toHaveBeenCalledTimes(2));
        expect(supervisor.executeWorkerEvent).toHaveBeenCalledOnce();
    });
});
