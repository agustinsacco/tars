import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { z } from 'zod';

const DigestStateSchema = z.object({
    entries: z.array(z.string().min(1).max(4_000)).default([]),
    nextDeliveryAt: z.string().datetime()
});

type DigestState = z.infer<typeof DigestStateSchema>;

function getErrorCode(error: unknown): string | undefined {
    if (typeof error !== 'object' || error === null) return undefined;
    const code = Reflect.get(error, 'code');
    return typeof code === 'string' ? code : undefined;
}

function calculateNextDelivery(now: Date): string {
    const next = new Date(now);
    next.setHours(9, 0, 0, 0);
    if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1);
    return next.toISOString();
}

export class TaskDigestStore {
    public constructor(private readonly filePath: string) {}

    public async enqueue(entry: string, now: Date = new Date()): Promise<void> {
        const state = await this.load(now);
        state.entries.push(entry.trim().slice(0, 4_000));
        state.entries = state.entries.slice(-100);
        await this.save(state);
    }

    public async getDueEntries(now: Date = new Date()): Promise<readonly string[]> {
        const state = await this.load(now);
        if (new Date(state.nextDeliveryAt).getTime() > now.getTime()) return [];
        return state.entries;
    }

    public async markDelivered(now: Date = new Date()): Promise<void> {
        await this.save({ entries: [], nextDeliveryAt: calculateNextDelivery(now) });
    }

    private async load(now: Date): Promise<DigestState> {
        try {
            const parsed: unknown = JSON.parse(await fs.readFile(this.filePath, 'utf8'));
            return DigestStateSchema.parse(parsed);
        } catch (error: unknown) {
            if (getErrorCode(error) !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
            return { entries: [], nextDeliveryAt: calculateNextDelivery(now) };
        }
    }

    private async save(state: DigestState): Promise<void> {
        await fs.mkdir(path.dirname(this.filePath), { recursive: true });
        const temporaryPath = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`;
        try {
            await fs.writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, {
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
