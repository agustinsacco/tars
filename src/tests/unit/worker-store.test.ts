import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { WorkerStore } from '../../workers/worker-store.js';

let root: string, store: WorkerStore;
beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'tars-worker-store-'));
    store = new WorkerStore(path.join(root, 'state.sqlite'));
});
afterEach(() => {
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
});
function setup(allowFollowUp = false) {
    const worker = store.register({
        name: 'Relay',
        emoji: '📬',
        objective: 'Review source',
        scope: 'Read approved staged inputs only',
        allowFollowUp
    });
    const runId = randomUUID(),
        taskId = randomUUID();
    store.beginRun(worker.id, runId, taskId);
    const event = {
        version: 1 as const,
        id: randomUUID(),
        workerId: worker.id,
        runId,
        taskId,
        sequence: 0,
        type: 'result' as const,
        summary: 'Found two options'
    };
    return { worker, event };
}
describe('WorkerStore', () => {
    it('persists stable identity and unread events across restart', () => {
        const { worker, event } = setup();
        store.publish(event);
        store.close();
        store = new WorkerStore(path.join(root, 'state.sqlite'));
        expect(store.get(worker.id).name).toBe('Relay');
        expect(store.next()?.event).toEqual(event);
    });
    it('requires unique name and emoji; removal tombstones history and releases labels', () => {
        const { worker } = setup();
        expect(() =>
            store.register({ name: 'relay', emoji: '🔎', objective: 'x', scope: 'x' })
        ).toThrow();
        expect(() =>
            store.register({ name: 'Scout', emoji: '📬', objective: 'x', scope: 'x' })
        ).toThrow();
        store.remove(worker.id);
        expect(store.get(worker.id).state).toBe('removed');
        expect(
            store.register({ name: 'Relay', emoji: '📬', objective: 'x', scope: 'x' }).id
        ).not.toBe(worker.id);
    });
    it('deduplicates exact replay and rejects conflicting sequence/identity', () => {
        const { event } = setup();
        expect(store.publish(event)).toEqual({ inserted: true });
        expect(store.publish(event)).toEqual({ inserted: false });
        expect(() => store.publish({ ...event, summary: 'changed' })).toThrow('Conflicting');
        expect(() => store.publish({ ...event, id: randomUUID() })).toThrow('Conflicting');
        expect(() =>
            store.publish({ ...event, id: randomUUID(), sequence: 1, taskId: randomUUID() })
        ).toThrow('registered run');
    });
    it('rejects stale out-of-order events and removed producers', () => {
        const { worker, event } = setup();
        store.publish({ ...event, sequence: 2 });
        expect(() => store.publish({ ...event, id: randomUUID() })).toThrow('Stale');
        store.remove(worker.id);
        expect(() => store.publish({ ...event, sequence: 3 })).toThrow('removed');
    });
    it('commits one decision and delivery; discord acknowledgement is separate', () => {
        const { event } = setup();
        store.publish(event);
        const decision = { decision: 'ask_owner', summary: 'Need approval @everyone' };
        store.decide(event.id, decision);
        store.decide(event.id, decision);
        expect(store.next()).toBeNull();
        expect(store.deliveries()).toHaveLength(1);
        expect(JSON.stringify(store.deliveries())).not.toContain('@everyone');
        store.close();
        store = new WorkerStore(path.join(root, 'state.sqlite'));
        expect(store.deliveries()).toHaveLength(1);
        store.delivered(event.id);
        expect(store.deliveries()).toHaveLength(0);
        expect(() => store.decide(event.id, { decision: 'finish', summary: 'different' })).toThrow(
            'committed'
        );
    });
    it('does not grant follow-up or retry failure merely because model requested it', () => {
        const { worker, event } = setup();
        store.publish(event);
        expect(() =>
            store.decide(event.id, { decision: 'continue', summary: 'go', followUp: 'do more' })
        ).toThrow('not authorized');
        expect(store.commands(worker.id)).toHaveLength(0);
        expect(store.next()).not.toBeNull();
    });
    it('deduplicates authorized follow-up command when decision is replayed', () => {
        const { worker, event } = setup(true);
        store.publish(event);
        const decision = {
            decision: 'continue',
            summary: 'Review another approved section',
            followUp: 'Review the second approved section only'
        };
        store.decide(event.id, decision);
        store.decide(event.id, decision);
        expect(store.commands(worker.id)).toHaveLength(1);
    });
    it('recovers interrupted sends as unknown rather than resending', () => {
        const { worker } = setup();
        const id = randomUUID();
        store.send(id, worker.id, 'task', 'review');
        store.setCommandState(id, 'sending');
        store.close();
        store = new WorkerStore(path.join(root, 'state.sqlite'));
        expect(store.commands(worker.id)[0].state).toBe('delivery_unknown');
        expect(() => store.remove(worker.id)).toThrow('Reconcile');
        expect(() => store.send(id, worker.id, 'task', 'another')).toThrow('conflict');
    });
    it('validates labels and decision schema', () => {
        expect(() =>
            store.register({ name: '@everyone', emoji: '📬', objective: 'x', scope: 'x' })
        ).toThrow();
        const { event } = setup();
        store.publish(event);
        expect(() =>
            store.decide(event.id, { decision: 'finish', summary: 'done', followUp: 'unsafe' })
        ).toThrow();
    });
    it('rolls back follow-up and decision together if delivery insertion fails', () => {
        const { worker, event } = setup(true);
        store.publish(event);
        (store as any).db.exec(
            "CREATE TRIGGER fail_delivery BEFORE INSERT ON deliveries BEGIN SELECT RAISE(ABORT,'injected failure'); END"
        );
        expect(() =>
            store.decide(event.id, {
                decision: 'continue',
                summary: 'go',
                followUp: 'Read next approved section'
            })
        ).toThrow('injected failure');
        expect(store.commands(worker.id)).toHaveLength(0);
        expect(store.next()).not.toBeNull();
    });
    it('late command acceptance cannot overwrite a completed response', () => {
        const { worker, event } = setup();
        const id = randomUUID();
        store.send(id, worker.id, 'task', 'review');
        store.setCommandState(id, 'sending');
        store.publish(event);
        store.setCommandState(id, 'accepted');
        expect(store.get(worker.id).state).toBe('completed');
    });
    it('limits persisted inference attempts across restart', () => {
        const { event } = setup();
        store.publish(event);
        store.beginInference(event.id);
        store.beginInference(event.id);
        store.close();
        store = new WorkerStore(path.join(root, 'state.sqlite'));
        store.beginInference(event.id);
        expect(store.next()?.attempts).toBe(3);
        expect(() => store.beginInference(event.id)).toThrow('budget');
    });
});
