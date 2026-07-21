import { type AgentTool } from '@earendil-works/pi-agent-core';
import path from 'node:path';
import { Type, type Static } from 'typebox';

import { type Config } from '../config/config.js';
import { TarsDoctor } from '../maintenance/doctor.js';
import { RepairRegistry } from '../maintenance/repair-registry.js';
import { CreateObjectiveSchema, ObjectiveStore } from '../initiative/objective-store.js';

const ManageTarsParamsSchema = Type.Object({
    action: Type.Union(
        [
            Type.Literal('doctor'),
            Type.Literal('repair-safe'),
            Type.Literal('list-objectives'),
            Type.Literal('create-objective')
        ],
        {
            description:
                'doctor is read-only; repair-safe applies registered reversible repairs; objective actions manage explicit initiative contracts.'
        }
    ),
    title: Type.Optional(Type.String()),
    desiredOutcome: Type.Optional(Type.String()),
    successCriteria: Type.Optional(Type.Array(Type.String())),
    allowedActions: Type.Optional(Type.Array(Type.String())),
    approvalRequired: Type.Optional(Type.Array(Type.String())),
    attentionPolicy: Type.Optional(
        Type.Union([Type.Literal('immediate'), Type.Literal('digest'), Type.Literal('quiet')])
    ),
    reviewAt: Type.Optional(
        Type.String({ description: 'ISO date-time for the next objective review' })
    )
});

type ManageTarsParams = Static<typeof ManageTarsParamsSchema>;

export class ManageTarsTool implements AgentTool<typeof ManageTarsParamsSchema> {
    public readonly name = 'manage_tars';
    public readonly label = 'Manage Tars';
    public readonly description =
        'Diagnose Tars or apply its narrow set of registered safe internal repairs. Use repair-safe only when the owner requested a fix or safe-auto initiative policy explicitly permits it.';
    public readonly parameters = ManageTarsParamsSchema;

    public constructor(private readonly config: Config) {}

    public async execute(_toolCallId: string, params: ManageTarsParams) {
        if (params.action === 'doctor') {
            const report = await new TarsDoctor(this.config).run();
            return {
                content: [{ type: 'text' as const, text: JSON.stringify(report) }],
                details: {}
            };
        }

        if (params.action === 'repair-safe') {
            const registry = new RepairRegistry(this.config);
            const plan = await registry.plan();
            const results = await registry.apply(plan);
            return {
                content: [{ type: 'text' as const, text: JSON.stringify({ plan, results }) }],
                details: {}
            };
        }

        const objectives = new ObjectiveStore(
            path.join(this.config.homeDir, 'data', 'objectives.json')
        );
        if (params.action === 'list-objectives') {
            const entries = await objectives.list();
            return {
                content: [{ type: 'text' as const, text: JSON.stringify(entries) }],
                details: {}
            };
        }

        const input = CreateObjectiveSchema.parse(params);
        const objective = await objectives.create(input);
        return {
            content: [{ type: 'text' as const, text: JSON.stringify(objective) }],
            details: {}
        };
    }
}
