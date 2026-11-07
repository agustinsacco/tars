import { type AgentTool } from '@earendil-works/pi-agent-core';
import { Type, type Static } from 'typebox';
import { randomUUID } from 'node:crypto';
import { type BrokerClient } from '../workers/broker-client.js';
import type { WorkerLifecycle } from '../workers/worker-lifecycle.js';
import { Operation, type WorkerOperation } from '../workers/protocol.js';

const Params = Type.Object({
    action: Type.Union([
        Type.Literal('status'),
        Type.Literal('register'),
        Type.Literal('import_legacy'),
        Type.Literal('list'),
        Type.Literal('get'),
        Type.Literal('messages'),
        Type.Literal('trace'),
        Type.Literal('launch'),
        Type.Literal('resume'),
        Type.Literal('process'),
        Type.Literal('reconcile_process'),
        Type.Literal('reconcile_command'),
        Type.Literal('send'),
        Type.Literal('steer'),
        Type.Literal('stop'),
        Type.Literal('remove')
    ]),
    workerId: Type.Optional(Type.String()),
    dryRun: Type.Optional(Type.Boolean()),
    legacy: Type.Optional(
        Type.Object({
            sourceId: Type.String(),
            artifactDirectory: Type.String(),
            sessionFile: Type.Optional(Type.String()),
            modelId: Type.Optional(Type.String())
        })
    ),
    name: Type.Optional(Type.String()),
    emoji: Type.Optional(Type.String()),
    objective: Type.Optional(Type.String()),
    scope: Type.Optional(Type.String()),
    allowFollowUp: Type.Optional(Type.Boolean()),
    evidence: Type.Optional(
        Type.String({
            description:
                'Verified receipt/state evidence, not a guess. Reconciliation never resends a command.'
        })
    ),
    receiptState: Type.Optional(Type.Union([Type.Literal('accepted'), Type.Literal('rejected')])),
    commandId: Type.Optional(
        Type.String({
            description:
                'Reuse this ID only to reconcile the same instruction; never blindly resend an uncertain RPC.'
        })
    ),
    mode: Type.Optional(Type.Union([Type.Literal('task'), Type.Literal('follow_up')])),
    text: Type.Optional(Type.String())
});
export class ManageWorkersTool implements AgentTool<typeof Params> {
    readonly name = 'manage_workers';
    readonly label = 'Manage Workers';
    readonly parameters = Params;
    readonly description =
        'Register persistent named workers, inspect messages, queue instructions and retire identities. Registration does not launch a process. Explicit launch/resume starts one bounded tool-free local process using operator-configured model; stop terminates the owned process. Trace exposes bounded receipts and decisions. Owner scope is mandatory; worker output cannot grant permissions. Stop retains identity; remove only after stop/reconciliation.';
    constructor(
        private readonly client: BrokerClient,
        private readonly lifecycle?: WorkerLifecycle
    ) {}
    async execute(_id: string, params: Static<typeof Params>) {
        if (params.action === 'status') {
            await this.client.request({ op: 'list' });
            return {
                content: [
                    {
                        type: 'text' as const,
                        text: JSON.stringify({
                            brokerConnected: true,
                            persistentIdentities: true,
                            pushDispatcher: true,
                            automaticLaunch: false,
                            packagedResume: !!this.lifecycle,
                            releaseReady: false,
                            note: 'Explicit launch requires local-profile.json; registration never launches a process. Live rollout/Discord validation remains gated.'
                        })
                    }
                ],
                details: {}
            };
        }
        if (
            ['launch', 'resume', 'process', 'reconcile_process'].includes(params.action) ||
            (params.action === 'stop' &&
                !!params.workerId &&
                !!this.lifecycle?.inspect(params.workerId))
        ) {
            if (!this.lifecycle) throw new Error('Packaged worker lifecycle unavailable');
            const id = Operation.parse({ op: 'get', workerId: params.workerId });
            if (id.op !== 'get') throw new Error('Worker identity required');
            const result =
                params.action === 'process'
                    ? this.lifecycle.inspect(id.workerId)
                    : params.action === 'reconcile_process'
                      ? await this.lifecycle.reconcile(id.workerId)
                      : params.action === 'stop'
                        ? await this.lifecycle.stop(id.workerId)
                        : await this.lifecycle.launch(id.workerId, params.action === 'resume');
            return {
                content: [{ type: 'text' as const, text: JSON.stringify({ result }) }],
                details: {}
            };
        }
        if (
            params.action === 'remove' &&
            params.workerId &&
            this.lifecycle?.inspect(params.workerId)?.state !== undefined &&
            this.lifecycle.inspect(params.workerId)?.state !== 'stopped'
        )
            throw new Error('Stop/reconcile the process before removal');
        if (params.action === 'reconcile_command') {
            const result = await this.client.request(
                Operation.parse({
                    op: 'reconcile_command',
                    id: params.commandId,
                    state: params.receiptState,
                    evidence: params.evidence
                })
            );
            return {
                content: [
                    { type: 'text' as const, text: JSON.stringify({ result: result ?? null }) }
                ],
                details: {}
            };
        }
        let operation: WorkerOperation;
        if (params.action === 'register' || params.action === 'import_legacy')
            operation = Operation.parse({
                op: params.action,
                ...(params.action === 'import_legacy'
                    ? { legacy: params.legacy, dryRun: params.dryRun ?? true }
                    : {}),
                input: {
                    name: params.name,
                    emoji: params.emoji,
                    objective: params.objective,
                    scope: params.scope,
                    allowFollowUp: params.allowFollowUp ?? false
                }
            });
        else if (params.action === 'list') operation = { op: 'list' };
        else if (['send', 'steer', 'stop'].includes(params.action))
            operation = Operation.parse({
                op: 'send',
                workerId: params.workerId,
                commandId: params.commandId ?? randomUUID(),
                mode: params.action === 'send' ? (params.mode ?? 'follow_up') : params.action,
                text: params.text ?? ''
            });
        else operation = Operation.parse({ op: params.action, workerId: params.workerId });
        const result = await this.client.request(operation);
        return {
            content: [
                {
                    type: 'text' as const,
                    text: JSON.stringify({
                        result: result ?? null,
                        ...(['register', 'import_legacy'].includes(operation.op)
                            ? { processLaunched: false }
                            : {})
                    })
                }
            ],
            details: {}
        };
    }
}
