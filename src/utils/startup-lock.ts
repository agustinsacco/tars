import { randomUUID } from 'node:crypto';
import fs, { type FileHandle } from 'node:fs/promises';
import path from 'node:path';

import { z } from 'zod';

export const STARTUP_LOCK_FILE_NAME = '.tars-startup.lock';

const LOCK_RETRY_MS = 25;
const LOCK_TIMEOUT_MS = 5_000;
const STALE_LOCK_MS = 30_000;

const LockOwnerSchema = z.object({
    token: z.string().uuid(),
    pid: z.number().int().positive(),
    createdAt: z.number().int().nonnegative()
});

interface AcquiredLock {
    readonly handle: FileHandle;
    readonly path: string;
    readonly token: string;
}

function getErrorCode(error: unknown): string | undefined {
    if (typeof error !== 'object' || error === null) return undefined;
    const code = Reflect.get(error, 'code');
    return typeof code === 'string' ? code : undefined;
}

function isProcessAlive(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch (error: unknown) {
        return getErrorCode(error) !== 'ESRCH';
    }
}

async function wait(milliseconds: number): Promise<void> {
    await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

async function readOwner(lockPath: string): Promise<z.infer<typeof LockOwnerSchema> | null> {
    try {
        const contents = await fs.readFile(lockPath, 'utf8');
        const parsed: unknown = JSON.parse(contents);
        const owner = LockOwnerSchema.safeParse(parsed);
        return owner.success ? owner.data : null;
    } catch (error: unknown) {
        if (getErrorCode(error) === 'ENOENT') return null;
        if (error instanceof SyntaxError) return null;
        throw error;
    }
}

async function removeAbandonedLock(lockPath: string): Promise<void> {
    try {
        const initialStats = await fs.stat(lockPath);
        if (Date.now() - initialStats.mtimeMs <= STALE_LOCK_MS) return;

        const owner = await readOwner(lockPath);
        if (owner && isProcessAlive(owner.pid)) return;

        const currentStats = await fs.stat(lockPath);
        if (
            currentStats.dev !== initialStats.dev ||
            currentStats.ino !== initialStats.ino ||
            currentStats.mtimeMs !== initialStats.mtimeMs
        ) {
            return;
        }
        await fs.unlink(lockPath);
    } catch (error: unknown) {
        if (getErrorCode(error) !== 'ENOENT') throw error;
    }
}

async function acquireStartupLock(tarsHome: string): Promise<AcquiredLock> {
    await fs.mkdir(tarsHome, { recursive: true });
    const canonicalHome = await fs.realpath(tarsHome);
    const lockPath = path.join(canonicalHome, STARTUP_LOCK_FILE_NAME);
    const deadline = Date.now() + LOCK_TIMEOUT_MS;

    while (Date.now() < deadline) {
        try {
            const handle = await fs.open(lockPath, 'wx', 0o600);
            const token = randomUUID();
            try {
                await handle.writeFile(
                    `${JSON.stringify({ token, pid: process.pid, createdAt: Date.now() })}\n`,
                    'utf8'
                );
                return { handle, path: lockPath, token };
            } catch (error: unknown) {
                await handle.close().catch(() => undefined);
                await fs.unlink(lockPath).catch(() => undefined);
                throw error;
            }
        } catch (error: unknown) {
            if (getErrorCode(error) !== 'EEXIST') throw error;
            await removeAbandonedLock(lockPath);
            await wait(LOCK_RETRY_MS);
        }
    }

    throw new Error(`Timed out waiting for another Tars startup to finish for ${canonicalHome}.`);
}

async function releaseStartupLock(lock: AcquiredLock): Promise<void> {
    await lock.handle.close();
    try {
        const owner = await readOwner(lock.path);
        if (owner?.token === lock.token) await fs.unlink(lock.path);
    } catch (error: unknown) {
        if (getErrorCode(error) !== 'ENOENT') throw error;
    }
}

export async function withTarsStartupLock<T>(
    tarsHome: string,
    operation: () => Promise<T>
): Promise<T> {
    const lock = await acquireStartupLock(tarsHome);
    try {
        return await operation();
    } finally {
        await releaseStartupLock(lock);
    }
}
