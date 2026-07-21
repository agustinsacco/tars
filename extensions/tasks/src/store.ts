import { randomUUID } from 'crypto';
import type { Stats } from 'fs';
import fs, { type FileHandle } from 'fs/promises';
import os from 'os';
import path from 'path';

import { z } from 'zod';

export const TaskSchema = z.object({
    id: z.string().min(1),
    title: z.string().min(1),
    prompt: z.string().min(1),
    schedule: z.string().min(1),
    nextRun: z.string().datetime(),
    lastRun: z.string().datetime().optional(),
    enabled: z.boolean(),
    mode: z.enum(['notify', 'silent', 'on-failure', 'on-change', 'action-required', 'digest']),
    source: z.enum(['user', 'system']),
    failedCount: z.number().int().nonnegative(),
    lastOutcomeFingerprint: z.string().length(64).optional(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime()
});

export type Task = z.infer<typeof TaskSchema>;

const TasksSchema = z.array(TaskSchema);
const LOCK_RETRY_MS = 25;
const LOCK_TIMEOUT_MS = 5_000;
const STALE_LOCK_MS = 30_000;
const LockOwnerSchema = z.object({
    token: z.string().uuid(),
    pid: z.number().int().positive(),
    createdAt: z.number().int().nonnegative()
});

type LockOwner = z.infer<typeof LockOwnerSchema>;

interface AcquiredLock {
    readonly handle: FileHandle;
    readonly token: string;
}

function getErrorCode(error: unknown): string | undefined {
    if (typeof error !== 'object' || error === null) return undefined;
    const code = Reflect.get(error, 'code');
    return typeof code === 'string' ? code : undefined;
}

function isProcessAlive(owner: LockOwner): boolean {
    try {
        process.kill(owner.pid, 0);
        return true;
    } catch (error: unknown) {
        return getErrorCode(error) !== 'ESRCH';
    }
}

function parseLockOwner(contents: string): LockOwner | null {
    const lines = contents.trimEnd().split(/\r?\n/);
    if (lines.length !== 3) return null;

    const owner = LockOwnerSchema.safeParse({
        token: lines[0],
        pid: Number(lines[1]),
        createdAt: Number(lines[2])
    });
    return owner.success ? owner.data : null;
}

function statsMatch(first: Stats, second: Stats): boolean {
    return (
        first.dev === second.dev &&
        first.ino === second.ino &&
        first.mtimeMs === second.mtimeMs &&
        first.size === second.size
    );
}

async function wait(milliseconds: number): Promise<void> {
    await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

export class TaskStore {
    private readonly filePath: string;
    private readonly lockPath: string;
    private queue: Promise<void> = Promise.resolve();

    constructor(filePath?: string) {
        const tarsHome = process.env.TARS_HOME || path.join(os.homedir(), '.tars');
        this.filePath = filePath || path.join(tarsHome, 'data', 'tasks.json');
        this.lockPath = `${this.filePath}.lock`;
    }

    private async serialize<T>(operation: () => Promise<T>): Promise<T> {
        const result = this.queue.then(operation);
        this.queue = result.then(
            () => undefined,
            () => undefined
        );
        return result;
    }

    private async acquireFileLock(): Promise<AcquiredLock> {
        await fs.mkdir(path.dirname(this.filePath), { recursive: true });
        const deadline = Date.now() + LOCK_TIMEOUT_MS;

        while (Date.now() < deadline) {
            try {
                const handle = await fs.open(this.lockPath, 'wx', 0o600);
                const token = randomUUID();
                try {
                    await handle.writeFile(`${token}\n${process.pid}\n${Date.now()}\n`, 'utf-8');
                    return { handle, token };
                } catch (error: unknown) {
                    await handle.close().catch(() => undefined);
                    await fs.unlink(this.lockPath).catch(() => undefined);
                    throw error;
                }
            } catch (error: unknown) {
                if (getErrorCode(error) !== 'EEXIST') throw error;
                await this.removeStaleLock();
                await wait(LOCK_RETRY_MS);
            }
        }

        throw new Error('Timed out waiting for the task store lock');
    }

    private async releaseFileLock(lock: AcquiredLock): Promise<void> {
        await lock.handle.close();
        try {
            const currentToken = (await fs.readFile(this.lockPath, 'utf-8')).split('\n')[0];
            if (currentToken === lock.token) await fs.unlink(this.lockPath);
        } catch (error: unknown) {
            if (getErrorCode(error) !== 'ENOENT') throw error;
        }
    }

    private async removeStaleLock(): Promise<void> {
        try {
            const initialStats = await fs.lstat(this.lockPath);
            if (Date.now() - initialStats.mtimeMs <= STALE_LOCK_MS) return;

            const owner =
                initialStats.isFile() && !initialStats.isSymbolicLink()
                    ? parseLockOwner(await fs.readFile(this.lockPath, 'utf-8'))
                    : null;
            if (owner && isProcessAlive(owner)) return;

            const currentStats = await fs.lstat(this.lockPath);
            if (statsMatch(initialStats, currentStats)) await fs.unlink(this.lockPath);
        } catch (error: unknown) {
            if (getErrorCode(error) !== 'ENOENT') throw error;
        }
    }

    private async withFileLock<T>(operation: () => Promise<T>): Promise<T> {
        const lock = await this.acquireFileLock();
        try {
            return await operation();
        } finally {
            await this.releaseFileLock(lock);
        }
    }

    private async load(): Promise<Task[]> {
        try {
            const data = await fs.readFile(this.filePath, 'utf-8');
            const parsed: unknown = JSON.parse(data);
            return TasksSchema.parse(parsed);
        } catch (error: unknown) {
            if (getErrorCode(error) === 'ENOENT') return [];
            throw error;
        }
    }

    private async save(tasks: readonly Task[]): Promise<void> {
        await fs.mkdir(path.dirname(this.filePath), { recursive: true });
        const tempPath = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`;
        try {
            await fs.writeFile(tempPath, JSON.stringify(tasks, null, 2), {
                encoding: 'utf-8',
                mode: 0o600
            });
            await fs.rename(tempPath, this.filePath);
        } catch (error: unknown) {
            await fs.unlink(tempPath).catch(() => undefined);
            throw error;
        }
    }

    private async mutate<T>(operation: (tasks: Task[]) => T | Promise<T>): Promise<T> {
        return this.serialize(() =>
            this.withFileLock(async () => {
                const tasks = await this.load();
                const result = await operation(tasks);
                await this.save(tasks);
                return result;
            })
        );
    }

    public async loadTasks(): Promise<Task[]> {
        return this.serialize(() => this.load());
    }

    public async addTask(task: Task): Promise<void> {
        await this.mutate((tasks) => {
            tasks.push(TaskSchema.parse(task));
        });
    }

    public async updateTask(id: string, updates: Partial<Task>): Promise<Task | null> {
        return this.mutate((tasks) => {
            const index = tasks.findIndex((task) => task.id === id);
            if (index === -1) return null;

            const updatedTask = TaskSchema.parse({
                ...tasks[index],
                ...updates,
                updatedAt: new Date().toISOString()
            });
            tasks[index] = updatedTask;
            return updatedTask;
        });
    }

    public async deleteTask(id: string): Promise<boolean> {
        return this.mutate((tasks) => {
            const index = tasks.findIndex((task) => task.id === id);
            if (index === -1) return false;
            tasks.splice(index, 1);
            return true;
        });
    }
}
