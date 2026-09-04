import { z } from 'zod';

const BooleanLikeSchema = z
    .preprocess(
        (value) => (typeof value === 'string' ? value.trim().toLowerCase() : value),
        z.union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
    )
    .transform((value) => value === true || value === 'true' || value === '1');

/**
 * Default directive handed to the agent when heartbeat agent invocation is enabled.
 * Deliberately scoped: make progress on already-authorized work, keep the task
 * list current, and avoid consequential or unauthorized actions.
 */
export const DEFAULT_HEARTBEAT_AGENT_PROMPT =
    'Autonomous heartbeat check: Review my scheduled tasks, notes, and objectives for work I have already authorized. Make concrete progress where it is safe to do so, keep the task list accurate, and record anything notable or blocked as a note. Work silently by default — use the send_notification tool ONLY when something is genuinely important or needs my attention; if nothing warrants it, do not message me. Never take consequential or unauthorized actions such as purchases, trades, or deployments.';

const HttpUrlSchema = z
    .string()
    .url()
    .refine(
        (value) => {
            const protocol = new URL(value).protocol;
            return protocol === 'http:' || protocol === 'https:';
        },
        { message: 'URL must use HTTP or HTTPS' }
    );

export const ChannelConfigSchema = z
    .object({
        enabled: z.boolean().default(false),
        token: z.string().min(1).optional(),
        ownerId: z.string().min(1).optional()
    })
    .passthrough();

export const ConfigFileSchema = z.record(z.unknown());

export const RuntimeConfigSchema = z.object({
    assistantName: z.string().trim().min(1).max(100).default('Tars'),
    instanceName: z
        .string()
        .trim()
        .min(1)
        .max(100)
        .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/)
        .default('tars-supervisor'),
    instanceRole: z.string().trim().min(1).max(200).default('General purpose'),
    geminiModel: z.string().trim().min(1).default('auto'),
    piProvider: z.string().trim().min(1).default('google'),
    piModel: z.string().trim().min(1).default('gemini-2.5-flash'),
    piBaseUrl: z.union([z.literal(''), HttpUrlSchema]).default(''),
    inferenceBackend: z
        .preprocess(
            (value) => (typeof value === 'string' ? value.trim().toLowerCase() : value),
            z.enum(['tars', 'pi', 'gemini', 'llamacpp'])
        )
        .default('tars')
        .transform((value): 'tars' | 'llamacpp' => {
            return value === 'llamacpp' ? 'llamacpp' : 'tars';
        }),
    localInferenceUrl: HttpUrlSchema.default('http://localhost:8080'),
    statusUpdates: z
        .object({
            tars: BooleanLikeSchema.default(true),
            llamacpp: BooleanLikeSchema.default(true)
        })
        .default({ tars: true, llamacpp: true }),
    heartbeatIntervalSec: z.coerce.number().int().min(1).max(86_400).default(300),
    heartbeatRunAgent: BooleanLikeSchema.default(true),
    heartbeatAgentPrompt: z
        .string()
        .trim()
        .min(1)
        .max(8_000)
        .default(DEFAULT_HEARTBEAT_AGENT_PROMPT),
    initiative: z
        .object({
            mode: z
                .enum(['off', 'observe', 'propose', 'safe-auto', 'delegated'])
                .default('observe'),
            intervalSec: z.coerce.number().int().min(60).max(86_400).default(900),
            maxNotificationsPerDay: z.coerce.number().int().min(0).max(50).default(3),
            quietHoursStart: z.coerce.number().int().min(0).max(23).default(22),
            quietHoursEnd: z.coerce.number().int().min(0).max(23).default(8),
            repeatAfterHours: z.coerce.number().int().min(1).max(720).default(24)
        })
        .default({
            mode: 'observe',
            intervalSec: 900,
            maxNotificationsPerDay: 3,
            quietHoursStart: 22,
            quietHoursEnd: 8,
            repeatAfterHours: 24
        }),
    contextWindowTokens: z.coerce.number().int().min(1).max(10_000_000).default(128_000),
    compressionThreshold: z.coerce.number().min(0.1).max(0.9).default(0.6),
    preflightCompressionThreshold: z.coerce.number().min(0.2).max(0.98).default(0.75),
    maxRPM: z.coerce.number().int().min(1).max(10_000).default(14),
    maxTPM: z.coerce.number().int().min(1).max(100_000_000).default(900_000),
    channels: z.record(ChannelConfigSchema).default({}),
    primaryChannel: z.string().trim().min(1).default('discord'),
    discordToken: z.string().default(''),
    discordOwnerId: z.string().trim().min(1).nullable().default(null)
});

export type RuntimeConfig = z.infer<typeof RuntimeConfigSchema>;
