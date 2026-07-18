import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash, randomUUID } from 'node:crypto';
import type { Stats } from 'node:fs';
import fs, { type FileHandle } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { z } from 'zod';

export const TARS_HOME_LEASE_FILE_PREFIX = '.tars-home-';

const INVALID_LEASE_GRACE_MS = 30_000;
const BOOT_TIME_TOLERANCE_MS = 5_000;
const LEASE_ACQUIRE_ATTEMPTS = 3;
const LeaseKindSchema = z.enum(['foreground-chat', 'mutation']);
const LeaseOwnerSchema = z
    .object({
        schemaVersion: z.literal(1),
        token: z.string().uuid(),
        pid: z.number().int().positive(),
        hostname: z.string().min(1),
        kind: LeaseKindSchema,
        operation: z.string().min(1).max(200),
        createdAt: z.number().int().nonnegative()
    })
    .passthrough();

type LeaseKind = z.infer<typeof LeaseKindSchema>;
type LeaseOwner = z.infer<typeof LeaseOwnerSchema>;

interface LeaseLocation {
    readonly canonicalHome: string;
    readonly leasePath: string;
}

interface MissingLeaseState {
    readonly type: 'missing';
}

interface InvalidLeaseState {
    readonly type: 'invalid';
    readonly stats: Stats;
    readonly removable: boolean;
}

interface ValidLeaseState {
    readonly type: 'valid';
    readonly owner: LeaseOwner;
    readonly stats: Stats;
}

type LeaseState = MissingLeaseState | InvalidLeaseState | ValidLeaseState;

export interface TarsHomeLease {
    readonly canonicalHome: string;
    readonly kind: LeaseKind;
    readonly operation: string;
    release(): Promise<void>;
}

const mutationLeaseContext = new AsyncLocalStorage<ReadonlySet<string>>();

function getErrorCode(error: unknown): string | undefined {
    if (typeof error !== 'object' || error === null) return undefined;
    const code = Reflect.get(error, 'code');
    return typeof code === 'string' ? code : undefined;
}

function isProcessAlive(owner: LeaseOwner): boolean {
    try {
        const bootTime = Date.now() - os.uptime() * 1_000;
        if (owner.createdAt < bootTime - BOOT_TIME_TOLERANCE_MS) return false;
    } catch {
        // Some restricted runtimes cannot query uptime; PID liveness remains authoritative.
    }
    if (owner.hostname !== os.hostname()) return true;
    try {
        process.kill(owner.pid, 0);
        return true;
    } catch (error: unknown) {
        return getErrorCode(error) !== 'ESRCH';
    }
}

async function resolveLeaseLocation(tarsHome: string): Promise<LeaseLocation> {
    const resolvedHome = path.resolve(tarsHome);
    const missingSegments: string[] = [];
    let existingAncestor = resolvedHome;
    let canonicalHome: string;
    while (true) {
        try {
            canonicalHome = path.join(await fs.realpath(existingAncestor), ...missingSegments);
            break;
        } catch (error: unknown) {
            if (getErrorCode(error) !== 'ENOENT') throw error;
            const parent = path.dirname(existingAncestor);
            if (parent === existingAncestor) {
                canonicalHome = resolvedHome;
                break;
            }
            missingSegments.unshift(path.basename(existingAncestor));
            existingAncestor = parent;
        }
    }

    const digest = createHash('sha256').update(canonicalHome).digest('hex').slice(0, 24);
    return {
        canonicalHome,
        leasePath: path.join(
            path.dirname(canonicalHome),
            `${TARS_HOME_LEASE_FILE_PREFIX}${digest}.lease`
        )
    };
}

export async function getTarsHomeLeasePath(tarsHome: string): Promise<string> {
    return (await resolveLeaseLocation(tarsHome)).leasePath;
}

async function readLeaseState(leasePath: string): Promise<LeaseState> {
    let stats: Stats;
    try {
        stats = await fs.lstat(leasePath);
    } catch (error: unknown) {
        if (getErrorCode(error) === 'ENOENT') return { type: 'missing' };
        throw error;
    }

    if (!stats.isFile() || stats.isSymbolicLink()) {
        return { type: 'invalid', stats, removable: false };
    }

    try {
        const contents = await fs.readFile(leasePath, 'utf8');
        const parsed: unknown = JSON.parse(contents);
        const owner = LeaseOwnerSchema.safeParse(parsed);
        if (!owner.success) return { type: 'invalid', stats, removable: true };
        return { type: 'valid', owner: owner.data, stats };
    } catch (error: unknown) {
        if (getErrorCode(error) === 'ENOENT') return { type: 'missing' };
        if (error instanceof SyntaxError) return { type: 'invalid', stats, removable: true };
        throw error;
    }
}

function statsMatch(first: Stats, second: Stats): boolean {
    return (
        first.dev === second.dev &&
        first.ino === second.ino &&
        first.mtimeMs === second.mtimeMs &&
        first.size === second.size
    );
}

async function removeUnchangedLease(leasePath: string, expectedStats: Stats): Promise<boolean> {
    try {
        const currentStats = await fs.lstat(leasePath);
        if (!statsMatch(currentStats, expectedStats)) return false;
        await fs.unlink(leasePath);
        return true;
    } catch (error: unknown) {
        if (getErrorCode(error) === 'ENOENT') return true;
        throw error;
    }
}

function describeOwner(owner: LeaseOwner): string {
    return owner.kind === 'foreground-chat'
        ? `foreground chat (PID ${owner.pid})`
        : `${owner.operation} (PID ${owner.pid})`;
}

async function findLiveOwnerOrRecover(leasePath: string): Promise<LeaseOwner | null> {
    const state = await readLeaseState(leasePath);
    if (state.type === 'missing') return null;

    if (state.type === 'invalid') {
        const oldEnough = Date.now() - state.stats.mtimeMs > INVALID_LEASE_GRACE_MS;
        if (state.removable && oldEnough) {
            await removeUnchangedLease(leasePath, state.stats);
            return null;
        }
        throw new Error(
            `Tars home lease ${leasePath} is invalid; refusing to remove an owner that cannot be verified.`
        );
    }

    if (isProcessAlive(state.owner)) return state.owner;
    await removeUnchangedLease(leasePath, state.stats);
    return null;
}

async function writeLeaseOwner(handle: FileHandle, owner: LeaseOwner): Promise<void> {
    await handle.writeFile(`${JSON.stringify(owner)}\n`, 'utf8');
    await handle.sync();
}

async function acquireTarsHomeLease(
    tarsHome: string,
    kind: LeaseKind,
    operation: string
): Promise<TarsHomeLease> {
    const location = await resolveLeaseLocation(tarsHome);
    await fs.mkdir(path.dirname(location.canonicalHome), { recursive: true });

    for (let attempt = 0; attempt < LEASE_ACQUIRE_ATTEMPTS; attempt += 1) {
        const token = randomUUID();
        const owner = LeaseOwnerSchema.parse({
            schemaVersion: 1,
            token,
            pid: process.pid,
            hostname: os.hostname(),
            kind,
            operation,
            createdAt: Date.now()
        });

        let handle: FileHandle | undefined;
        try {
            const openedHandle = await fs.open(location.leasePath, 'wx', 0o600);
            handle = openedHandle;
            try {
                await writeLeaseOwner(openedHandle, owner);
                await openedHandle.close();
                handle = undefined;
            } catch (error: unknown) {
                const failedStats = await openedHandle.stat();
                await openedHandle.close().catch(() => undefined);
                handle = undefined;
                await removeUnchangedLease(location.leasePath, failedStats).catch(() => false);
                throw error;
            }

            let released = false;
            return {
                canonicalHome: location.canonicalHome,
                kind,
                operation,
                release: async (): Promise<void> => {
                    if (released) return;
                    released = true;
                    const state = await readLeaseState(location.leasePath);
                    if (state.type === 'valid' && state.owner.token === token) {
                        await removeUnchangedLease(location.leasePath, state.stats);
                    }
                }
            };
        } catch (error: unknown) {
            if (handle) await handle.close().catch(() => undefined);
            if (getErrorCode(error) !== 'EEXIST') throw error;
            const liveOwner = await findLiveOwnerOrRecover(location.leasePath);
            if (liveOwner) {
                throw new Error(
                    `Refusing to ${operation} while ${describeOwner(liveOwner)} owns Tars home ${location.canonicalHome}.`
                );
            }
        }
    }

    throw new Error(`Unable to acquire the Tars home lease for ${location.canonicalHome}.`);
}

export async function acquireForegroundChatLease(tarsHome: string): Promise<TarsHomeLease> {
    return acquireTarsHomeLease(tarsHome, 'foreground-chat', 'run foreground chat');
}

export async function withTarsHomeMutationLease<T>(
    tarsHome: string,
    operation: string,
    callback: () => Promise<T>
): Promise<T> {
    const location = await resolveLeaseLocation(tarsHome);
    const inheritedLeases = mutationLeaseContext.getStore();
    if (inheritedLeases?.has(location.leasePath)) return callback();

    const lease = await acquireTarsHomeLease(location.canonicalHome, 'mutation', operation);
    const activeLeases = new Set(inheritedLeases);
    activeLeases.add(location.leasePath);
    try {
        return await mutationLeaseContext.run(activeLeases, callback);
    } finally {
        await lease.release();
    }
}
