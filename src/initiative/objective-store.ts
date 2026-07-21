import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { z } from 'zod';

export const ObjectiveSchema = z.object({
    allowedActions: z.array(z.string().min(1).max(200)).max(20).default([]),
    approvalRequired: z.array(z.string().min(1).max(200)).max(20).default([]),
    attentionPolicy: z.enum(['immediate', 'digest', 'quiet']).default('digest'),
    createdAt: z.string().datetime(),
    desiredOutcome: z.string().min(1).max(2_000),
    enabled: z.boolean().default(true),
    id: z.string().uuid(),
    reviewAt: z.string().datetime(),
    successCriteria: z.array(z.string().min(1).max(500)).min(1).max(20),
    title: z.string().min(1).max(200),
    updatedAt: z.string().datetime()
});

export type Objective = z.infer<typeof ObjectiveSchema>;

export const CreateObjectiveSchema = ObjectiveSchema.pick({
    allowedActions: true,
    approvalRequired: true,
    attentionPolicy: true,
    desiredOutcome: true,
    reviewAt: true,
    successCriteria: true,
    title: true
});

export type CreateObjectiveInput = z.input<typeof CreateObjectiveSchema>;

const ObjectiveFileSchema = z.object({ objectives: z.array(ObjectiveSchema) });

function getErrorCode(error: unknown): string | undefined {
    if (typeof error !== 'object' || error === null) return undefined;
    const code = Reflect.get(error, 'code');
    return typeof code === 'string' ? code : undefined;
}

export class ObjectiveStore {
    public constructor(private readonly filePath: string) {}

    public async list(): Promise<readonly Objective[]> {
        return (await this.load()).objectives;
    }

    public async listDue(now: Date = new Date()): Promise<readonly Objective[]> {
        return (await this.list()).filter(
            ({ enabled, reviewAt }) => enabled && new Date(reviewAt).getTime() <= now.getTime()
        );
    }

    public async create(input: CreateObjectiveInput): Promise<Objective> {
        const validated = CreateObjectiveSchema.parse(input);
        const now = new Date().toISOString();
        const objective = ObjectiveSchema.parse({
            ...validated,
            createdAt: now,
            enabled: true,
            id: randomUUID(),
            updatedAt: now
        });
        const file = await this.load();
        file.objectives.push(objective);
        await this.save(file);
        return objective;
    }

    private async load(): Promise<z.infer<typeof ObjectiveFileSchema>> {
        try {
            const parsed: unknown = JSON.parse(await fs.readFile(this.filePath, 'utf8'));
            return ObjectiveFileSchema.parse(parsed);
        } catch (error: unknown) {
            if (getErrorCode(error) === 'ENOENT') return { objectives: [] };
            throw error;
        }
    }

    private async save(file: z.infer<typeof ObjectiveFileSchema>): Promise<void> {
        await fs.mkdir(path.dirname(this.filePath), { recursive: true });
        const temporaryPath = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`;
        try {
            await fs.writeFile(temporaryPath, `${JSON.stringify(file, null, 2)}\n`, {
                encoding: 'utf8',
                mode: 0o600
            });
            await fs.rename(temporaryPath, this.filePath);
            await fs.chmod(this.filePath, 0o600);
        } catch (error: unknown) {
            await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
            throw error;
        }
    }
}
