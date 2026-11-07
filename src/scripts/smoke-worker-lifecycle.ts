/** Opt-in real local pi lifecycle; fake Tars reasoning/Discord, never owner state. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { WorkerRuntime } from '../workers/worker-runtime.js';
import { Worker, WorkerEvent } from '../workers/protocol.js';

if (process.argv[2] !== '--allow-local-inference' || !process.argv[3])
    throw new Error('Explicit --allow-local-inference and exact expected model ID required');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tars-worker-live-smoke-'));
fs.mkdirSync(path.join(home, 'data', 'workers'), { recursive: true, mode: 0o700 });
fs.writeFileSync(
    path.join(home, 'data', 'workers', 'local-profile.json'),
    JSON.stringify({ modelId: process.argv[3], lifetimeSeconds: 120 }),
    { mode: 0o600 }
);
const deliveryEvents = new EventEmitter();
const delivered: string[] = [],
    warnings: string[] = [];
const supervisor = Object.assign(new EventEmitter(), {
    isBusy: () => false,
    executeWorkerEvent: async () =>
        JSON.stringify({
            decision: 'hold',
            summary: 'Synthetic Tars assessment for opt-in local smoke. No live Discord.'
        })
});
const runtime = new WorkerRuntime(
    home,
    supervisor,
    {
        notifyTo: async (channel, content) => {
            assert.equal(channel, 'discord');
            delivered.push(content);
            deliveryEvents.emit('delivery');
        }
    },
    (text) => warnings.push(text)
);
async function result(id: string, runId: string): Promise<string> {
    return new Promise((resolve, reject) => {
        let checking = false;
        const timer = setTimeout(
            () => finish(new Error('Local worker completion deadline exceeded')),
            90_000
        );
        const finish = (error?: Error, summary = ''): void => {
            clearTimeout(timer);
            runtime.client.off('changed', check);
            if (error) reject(error);
            else resolve(summary);
        };
        const check = (): void => {
            if (checking) return;
            checking = true;
            void runtime.client
                .request({ op: 'messages', workerId: id })
                .then((raw) => {
                    const found = WorkerEvent.array()
                        .parse(raw)
                        .find((event) => event.runId === runId);
                    if (!found) return;
                    if (found.type !== 'result')
                        finish(new Error('Worker did not complete successfully: ' + found.type));
                    else finish(undefined, found.summary);
                })
                .catch((error: Error) => finish(error))
                .finally(() => {
                    checking = false;
                });
        };
        runtime.client.on('changed', check);
        check();
    });
}
let receipt: Record<string, unknown> = {
    home,
    liveModel: true,
    liveTarsReasoning: false,
    liveDiscord: false
};
try {
    await runtime.start();
    const worker = Worker.parse(
        await runtime.client.request({
            op: 'register',
            input: {
                name: 'Smoke',
                emoji: '🧪',
                objective: 'Verify private local lifecycle and saved recall only',
                scope: 'No tools or external actions. Two bounded text replies.',
                allowFollowUp: false
            }
        })
    );
    const first = await runtime.lifecycle.launch(worker.id);
    await runtime.client.request({
        op: 'send',
        workerId: worker.id,
        commandId: randomUUID(),
        mode: 'task',
        text: 'Remember the exact token TRACE-LINK-42 for the next question. Reply only READY.'
    });
    const initial = await result(worker.id, first.runId);
    assert.equal(initial.trim(), 'READY');
    await runtime.lifecycle.stop(worker.id);
    assert.equal(runtime.lifecycle.inspect(worker.id)?.state, 'stopped');
    const second = await runtime.lifecycle.launch(worker.id, true);
    assert.equal(second.sessionFile, first.sessionFile);
    assert.notEqual(second.runId, first.runId);
    await runtime.client.request({
        op: 'send',
        workerId: worker.id,
        commandId: randomUUID(),
        mode: 'task',
        text: 'What exact token did I ask you to remember? Reply only that token.'
    });
    const recall = await result(worker.id, second.runId);
    assert.equal(recall.trim(), 'TRACE-LINK-42');
    await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
            deliveryEvents.off('delivery', check);
            reject(new Error('Synthetic Discord delivery deadline exceeded'));
        }, 5000);
        const check = (): void => {
            if (delivered.length >= 2) {
                clearTimeout(timer);
                deliveryEvents.off('delivery', check);
                resolve();
            }
        };
        deliveryEvents.on('delivery', check);
        check();
    });
    receipt = {
        ...receipt,
        passed: true,
        workerId: worker.id,
        firstRun: first.runId,
        resumedRun: second.runId,
        sessionFile: second.sessionFile,
        initial,
        recall,
        syntheticDeliveriesObserved: delivered.length
    };
} catch (error) {
    receipt = {
        ...receipt,
        passed: false,
        error: error instanceof Error ? error.message : 'unknown failure'
    };
    process.exitCode = 1;
} finally {
    await runtime.stop();
    receipt = { ...receipt, stopped: true, warnings };
    fs.writeFileSync(path.join(home, 'smoke-receipt.json'), JSON.stringify(receipt, null, 2), {
        mode: 0o600
    });
    console.log(JSON.stringify(receipt, null, 2));
}
