/** Isolated smoke: real broker child/socket, fake model and fake Discord. Never uses owner home. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { WorkerRuntime } from '../workers/worker-runtime.js';
import { Worker } from '../workers/protocol.js';
import type { BrokerClient } from '../workers/broker-client.js';

async function untilChanged(
    client: BrokerClient,
    predicate: () => Promise<boolean>
): Promise<void> {
    return new Promise((resolve, reject) => {
        let checking = false,
            again = false,
            done = false;
        const finish = (error?: Error): void => {
            done = true;
            clearTimeout(timer);
            client.off('changed', wake);
            if (error) reject(error);
            else resolve();
        };
        const wake = (): void => {
            if (done) return;
            if (checking) {
                again = true;
                return;
            }
            checking = true;
            void predicate()
                .then((ok) => {
                    if (ok && !done) finish();
                })
                .catch((error: Error) => {
                    if (!done) finish(error);
                })
                .finally(() => {
                    checking = false;
                    if (again && !done) {
                        again = false;
                        wake();
                    }
                });
        };
        const timer = setTimeout(
            () => finish(new Error('Worker push smoke deadline exceeded')),
            5000
        );
        client.on('changed', wake);
        wake();
    });
}

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tars-worker-smoke-'));
let busy = false,
    inferences = 0;
const deliveries: string[] = [],
    warnings: string[] = [];
const supervisor = Object.assign(new EventEmitter(), {
    isBusy: () => busy,
    executeWorkerEvent: async () => {
        inferences++;
        return JSON.stringify({
            decision: 'ask_owner',
            summary: 'Test-only assessment; no live Discord message sent.'
        });
    }
});
const notifier = {
    notifyTo: async (channel: string, content: string) => {
        assert.equal(channel, 'discord');
        assert.match(content, /📬 Relay/);
        deliveries.push(content);
    }
};
let runtime = new WorkerRuntime(home, supervisor, notifier, (text) => warnings.push(text));
try {
    await runtime.start();
    const worker = Worker.parse(
        await runtime.client.request({
            op: 'register',
            input: {
                name: 'Relay',
                emoji: '📬',
                objective: 'Smoke test',
                scope: 'Test-only synthetic events',
                allowFollowUp: false
            }
        })
    );
    const runId = randomUUID(),
        taskId = randomUUID();
    await runtime.client.request({ op: 'begin_run', workerId: worker.id, runId, taskId });
    const event = {
        version: 1 as const,
        id: randomUUID(),
        workerId: worker.id,
        runId,
        taskId,
        sequence: 0,
        type: 'question' as const,
        summary: 'Test only'
    };
    await runtime.client.request({ op: 'publish', event });
    await untilChanged(
        runtime.client,
        async () =>
            deliveries.length === 1 &&
            ((await runtime.client.request({ op: 'deliveries' })) as unknown[]).length === 0
    );
    busy = true;
    await runtime.client.request({
        op: 'publish',
        event: { ...event, id: randomUUID(), sequence: 1 }
    });
    await runtime.stop();
    busy = false;
    runtime = new WorkerRuntime(home, supervisor, notifier, (text) => warnings.push(text));
    await runtime.start();
    const recovered = Worker.parse(
        await runtime.client.request({ op: 'get', workerId: worker.id })
    );
    assert.equal(recovered.name, 'Relay');
    assert.equal(recovered.emoji, '📬');
    await untilChanged(
        runtime.client,
        async () =>
            deliveries.length === 2 &&
            ((await runtime.client.request({ op: 'deliveries' })) as unknown[]).length === 0
    );
    assert.equal(inferences, 2);
    assert.equal(warnings.length, 0);
    console.log(
        JSON.stringify({
            realBrokerChild: true,
            privateSocketPush: true,
            identityAndPendingEventSurviveRestart: true,
            inferences,
            deliveries: deliveries.length,
            liveModelOrDiscordUsed: false
        })
    );
} finally {
    await runtime.stop();
    fs.rmSync(home, { recursive: true, force: true });
}
