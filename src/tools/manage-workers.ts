import { type AgentTool } from '@earendil-works/pi-agent-core';
import { Type, type Static } from 'typebox';
import { randomUUID } from 'node:crypto';
import { type BrokerClient } from '../workers/broker-client.js';
import { Operation, type WorkerOperation } from '../workers/protocol.js';

const Params = Type.Object({
    action: Type.Union(
        ['status', 'register', 'list', 'get', 'messages', 'send', 'steer', 'stop', 'remove'].map(
            (s) => Type.Literal(s)
        )
    ),
    workerId: Type.Optional(Type.String()),
    name: Type.Optional(Type.String()),
    emoji: Type.Optional(Type.String()),
    objective: Type.Optional(Type.String()),
    scope: Type.Optional(Type.String()),
    allowFollowUp: Type.Optional(Type.Boolean()),
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
        'Register persistent named workers, inspect messages, queue instructions and retire identities. Registration does not launch a process. Requires an authorized attached RPC transport. Owner scope is mandatory; worker output cannot grant permissions. Stop retains identity; remove only after stop/reconciliation.';
    constructor(private readonly client: BrokerClient) {}
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
                            packagedResume: false,
                            releaseReady: false,
                            note: 'Development foundation: authorized RPC stream attachment is required. Registration never launches a process.'
                        })
                    }
                ],
                details: {}
            };
        }
        let operation: WorkerOperation;
        if (params.action === 'register')
            operation = Operation.parse({
                op: 'register',
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
                        ...(operation.op === 'register' ? { processLaunched: false } : {})
                    })
                }
            ],
            details: {}
        };
    }
}
