import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    acquireForegroundChatLease,
    getTarsHomeLeasePath,
    withTarsHomeMutationLease
} from '../../utils/tars-home-lease.js';

const temporaryDirectories: string[] = [];

async function makeTarsHome(): Promise<string> {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tars-home-lease-test-'));
    temporaryDirectories.push(root);
    const tarsHome = path.join(root, 'brain');
    await fs.mkdir(tarsHome);
    return tarsHome;
}

async function writeLease(
    tarsHome: string,
    owner: { readonly createdAt: number; readonly hostname: string; readonly pid: number }
): Promise<string> {
    const leasePath = await getTarsHomeLeasePath(tarsHome);
    await fs.writeFile(
        leasePath,
        `${JSON.stringify({
            schemaVersion: 1,
            token: randomUUID(),
            pid: owner.pid,
            hostname: owner.hostname,
            kind: 'foreground-chat',
            operation: 'run foreground chat',
            createdAt: owner.createdAt
        })}\n`,
        { encoding: 'utf8', flag: 'wx', mode: 0o600 }
    );
    return leasePath;
}

afterEach(async () => {
    // ARRANGE
    vi.restoreAllMocks();
    vi.resetAllMocks();

    // ACT
    await Promise.all(
        temporaryDirectories
            .splice(0)
            .map((directory) => fs.rm(directory, { recursive: true, force: true }))
    );
});

describe('Tars home leases', () => {
    it('uses one lease path before and after a home is created through a path alias', async () => {
        // ARRANGE
        const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tars-home-lease-test-'));
        temporaryDirectories.push(root);
        const tarsHome = path.join(root, 'future-brain');

        // ACT
        const beforeCreation = await getTarsHomeLeasePath(tarsHome);
        await fs.mkdir(tarsHome);
        const afterCreation = await getTarsHomeLeasePath(tarsHome);

        // ASSERT
        expect(afterCreation).toBe(beforeCreation);
    });

    it('blocks mutations while foreground chat owns the home and releases cleanly', async () => {
        // ARRANGE
        const tarsHome = await makeTarsHome();
        const lease = await acquireForegroundChatLease(tarsHome);
        const mutation = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);

        try {
            // ACT
            const operation = withTarsHomeMutationLease(tarsHome, 'import a brain', mutation);

            // ASSERT
            await expect(operation).rejects.toThrow(/foreground chat \(PID \d+\)/);
            expect(mutation).not.toHaveBeenCalled();
        } finally {
            await lease.release();
        }

        await withTarsHomeMutationLease(tarsHome, 'import a brain', mutation);
        expect(mutation).toHaveBeenCalledOnce();
    });

    it('does not treat a separate same-process caller as a nested mutation', async () => {
        // ARRANGE
        const tarsHome = await makeTarsHome();
        let signalFirstStarted: (() => void) | undefined;
        const firstStarted = new Promise<void>((resolve) => {
            signalFirstStarted = resolve;
        });
        let releaseFirst: (() => void) | undefined;
        const firstGate = new Promise<void>((resolve) => {
            releaseFirst = resolve;
        });
        const secondMutation = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
        const firstMutation = withTarsHomeMutationLease(tarsHome, 'first mutation', async () => {
            signalFirstStarted?.();
            await firstGate;
        });
        await firstStarted;

        // ACT
        const secondOperation = withTarsHomeMutationLease(
            tarsHome,
            'second mutation',
            secondMutation
        );

        try {
            // ASSERT
            await expect(secondOperation).rejects.toThrow(/first mutation \(PID \d+\)/);
            expect(secondMutation).not.toHaveBeenCalled();
        } finally {
            releaseFirst?.();
            await firstMutation;
        }
    });

    it('allows nested mutation helpers in the originating async call chain', async () => {
        // ARRANGE
        const tarsHome = await makeTarsHome();
        const nestedMutation = vi.fn<() => Promise<string>>().mockResolvedValue('done');

        // ACT
        const result = await withTarsHomeMutationLease(tarsHome, 'update Tars', () =>
            withTarsHomeMutationLease(tarsHome, 'refresh Tars components', nestedMutation)
        );

        // ASSERT
        expect(result).toBe('done');
        expect(nestedMutation).toHaveBeenCalledOnce();
    });

    it('recovers a lease whose verified local owner process no longer exists', async () => {
        // ARRANGE
        const tarsHome = await makeTarsHome();
        const stalePid = 424_242;
        await writeLease(tarsHome, {
            createdAt: Date.now(),
            hostname: os.hostname(),
            pid: stalePid
        });
        const kill = vi.spyOn(process, 'kill').mockImplementation((pid: number) => {
            if (pid === stalePid) {
                const error = new Error('process not found');
                Reflect.set(error, 'code', 'ESRCH');
                throw error;
            }
            return true;
        });
        const mutation = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);

        // ACT
        await withTarsHomeMutationLease(tarsHome, 'recover a stale lease', mutation);

        // ASSERT
        expect(kill).toHaveBeenCalledWith(stalePid, 0);
        expect(mutation).toHaveBeenCalledOnce();
    });

    it('recovers a valid lease that predates the current boot even when its PID is live', async () => {
        // ARRANGE
        const tarsHome = await makeTarsHome();
        vi.spyOn(os, 'uptime').mockReturnValue(60);
        const leasePath = await writeLease(tarsHome, {
            createdAt: Date.now() - 120_000,
            hostname: 'previous-hostname',
            pid: process.pid
        });
        const mutation = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);

        // ACT
        await withTarsHomeMutationLease(tarsHome, 'recover after reboot', mutation);

        // ASSERT
        expect(mutation).toHaveBeenCalledOnce();
        await expect(fs.lstat(leasePath)).rejects.toMatchObject({ code: 'ENOENT' });
    });
});
