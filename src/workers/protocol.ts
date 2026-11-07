import { z } from 'zod';

export const Id = z.string().uuid();
const Label = z
    .string()
    .min(1)
    .max(32)
    .regex(/^[A-Za-z][A-Za-z0-9 _-]*$/);
const Emoji = z
    .string()
    .min(1)
    .max(16)
    .refine(
        (s) => /\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(s) && !/[\s@<>]/u.test(s)
    );
export const RegisterWorker = z
    .object({
        name: Label,
        emoji: Emoji,
        objective: z.string().min(1).max(2000),
        scope: z.string().min(1).max(2000),
        allowFollowUp: z.boolean().default(false)
    })
    .strict();
export const LegacyReference = z
    .object({
        sourceId: z.string().min(1).max(200),
        artifactDirectory: z.string().min(1).max(1000),
        sessionFile: z.string().min(1).max(1000).optional(),
        modelId: z.string().min(1).max(1000).optional()
    })
    .strict();
export const Worker = RegisterWorker.extend({
    legacy: LegacyReference.optional(),
    id: Id,
    state: z.enum([
        'registered',
        'running',
        'awaiting_direction',
        'completed',
        'failed',
        'stopped',
        'removed'
    ]),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime()
});
export type WorkerRecord = z.infer<typeof Worker>;
export const WorkerEvent = z
    .object({
        version: z.literal(1),
        id: Id,
        workerId: Id,
        runId: Id,
        taskId: Id,
        sequence: z.number().int().nonnegative(),
        type: z.enum(['result', 'question', 'blocked', 'failed', 'timed_out', 'exited']),
        summary: z.string().min(1).max(2000)
    })
    .strict();
export type WorkerEventRecord = z.infer<typeof WorkerEvent>;
export const Decision = z
    .object({
        decision: z.enum(['continue', 'ask_owner', 'finish', 'hold']),
        summary: z.string().min(1).max(2000),
        followUp: z.string().min(1).max(2000).optional()
    })
    .strict()
    .superRefine((d, context) => {
        if ((d.decision === 'continue') !== !!d.followUp)
            context.addIssue({
                code: z.ZodIssueCode.custom,
                message: 'continue requires followUp; other decisions forbid it'
            });
    });
export type WorkerDecision = z.infer<typeof Decision>;
export const Command = z.object({
    id: Id,
    workerId: Id,
    mode: z.enum(['task', 'steer', 'follow_up', 'stop']),
    text: z.string().max(2000),
    state: z.enum(['pending', 'sending', 'accepted', 'delivery_unknown', 'rejected']),
    reconciliation: z
        .object({ evidence: z.string().min(20).max(2000), at: z.string().datetime() })
        .optional()
});
export type WorkerCommand = z.infer<typeof Command>;
export const Operation = z.discriminatedUnion('op', [
    z.object({ op: z.literal('register'), input: RegisterWorker }).strict(),
    z
        .object({
            op: z.literal('import_legacy'),
            input: RegisterWorker,
            legacy: LegacyReference,
            dryRun: z.boolean()
        })
        .strict(),
    z.object({ op: z.literal('list') }).strict(),
    z.object({ op: z.literal('get'), workerId: Id }).strict(),
    z.object({ op: z.literal('remove'), workerId: Id }).strict(),
    z.object({ op: z.literal('process_stopped'), workerId: Id }).strict(),
    z
        .object({
            op: z.literal('send'),
            commandId: Id,
            workerId: Id,
            mode: z.enum(['task', 'steer', 'follow_up', 'stop']),
            text: z.string().max(2000)
        })
        .strict(),
    z.object({ op: z.literal('messages'), workerId: Id }).strict(),
    z.object({ op: z.literal('trace'), workerId: Id }).strict(),
    z
        .object({
            op: z.literal('reconcile_command'),
            id: Id,
            state: z.enum(['accepted', 'rejected']),
            evidence: z.string().min(20).max(2000)
        })
        .strict(),
    z.object({ op: z.literal('begin_run'), workerId: Id, runId: Id, taskId: Id }).strict(),
    z.object({ op: z.literal('publish'), event: WorkerEvent }).strict(),
    z.object({ op: z.literal('next') }).strict(),
    z.object({ op: z.literal('begin_inference'), eventId: Id }).strict(),
    z.object({ op: z.literal('defer_inference'), eventId: Id }).strict(),
    z.object({ op: z.literal('decide'), eventId: Id, decision: Decision }).strict(),
    z.object({ op: z.literal('deliveries') }).strict(),
    z.object({ op: z.literal('delivered'), id: Id }).strict(),
    z.object({ op: z.literal('commands'), workerId: Id }).strict(),
    z
        .object({
            op: z.literal('command_state'),
            id: Id,
            state: z.enum(['sending', 'accepted', 'delivery_unknown', 'rejected'])
        })
        .strict()
]);
export type WorkerOperation = z.infer<typeof Operation>;
export const Request = z.object({ id: Id, operation: Operation }).strict();
export const Response = z
    .object({ id: Id, ok: z.boolean(), data: z.unknown().optional(), error: z.string().optional() })
    .strict();
export const Delivery = z.object({ id: Id, workerId: Id, content: z.string() });
export const NextEvent = z.object({
    event: WorkerEvent,
    worker: Worker,
    attempts: z.number().int().nonnegative()
});
