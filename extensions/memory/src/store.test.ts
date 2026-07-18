import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { MemoryStore } from './store.js';

const LOCK_TOKEN = '00000000-0000-4000-8000-000000000001';
const DEAD_PID = 2_147_483_647;

async function wait(milliseconds: number): Promise<void> {
    await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

async function writeOldLock(tarsHome: string, pid: number): Promise<string> {
    const memoryDirectory = path.join(tarsHome, 'data', 'memory');
    const lockPath = path.join(memoryDirectory, '.store.lock');
    const createdAt = Date.now() - 60_000;
    await fs.mkdir(memoryDirectory, { recursive: true });
    await fs.writeFile(lockPath, `${LOCK_TOKEN}\n${pid}\n${createdAt}\n`);
    const staleTime = new Date(createdAt);
    await fs.utimes(lockPath, staleTime, staleTime);
    return lockPath;
}

test('separate stores do not lose concurrent fact updates', async () => {
    // ARRANGE
    const tarsHome = await fs.mkdtemp(path.join(os.tmpdir(), 'tars-memory-store-'));
    const firstStore = new MemoryStore(tarsHome);
    const secondStore = new MemoryStore(tarsHome);

    try {
        // ACT
        await Promise.all([
            firstStore.storeFact('first', 'one'),
            secondStore.storeFact('second', 'two')
        ]);

        // ASSERT
        const facts = await firstStore.listFacts();
        assert.deepEqual(facts.map(({ key }) => key).sort(), ['first', 'second']);
        const factsPath = path.join(tarsHome, 'data', 'memory', 'facts.json');
        assert.equal((await fs.stat(factsPath)).mode & 0o777, 0o600);
    } finally {
        await fs.rm(tarsHome, { recursive: true, force: true });
    }
});

test('invalid facts data is rejected without being overwritten', async () => {
    // ARRANGE
    const tarsHome = await fs.mkdtemp(path.join(os.tmpdir(), 'tars-memory-store-'));
    const memoryDirectory = path.join(tarsHome, 'data', 'memory');
    const factsPath = path.join(memoryDirectory, 'facts.json');
    await fs.mkdir(memoryDirectory, { recursive: true });
    await fs.writeFile(factsPath, '{"facts":{"broken":{"value":42}}}');
    const store = new MemoryStore(tarsHome);

    try {
        // ACT / ASSERT
        await assert.rejects(store.storeFact('safe', 'value'));
        assert.equal(await fs.readFile(factsPath, 'utf8'), '{"facts":{"broken":{"value":42}}}');
    } finally {
        await fs.rm(tarsHome, { recursive: true, force: true });
    }
});

test('an old memory lock owned by a live process is not evicted', async () => {
    // ARRANGE
    const tarsHome = await fs.mkdtemp(path.join(os.tmpdir(), 'tars-memory-store-'));
    const lockPath = await writeOldLock(tarsHome, process.pid);
    const store = new MemoryStore(tarsHome);

    try {
        // ACT
        const factWrite = store.storeFact('live-owner', 'preserved');
        try {
            await wait(75);

            // ASSERT
            assert.match(await fs.readFile(lockPath, 'utf8'), new RegExp(`${process.pid}`));
        } finally {
            await fs.unlink(lockPath).catch(() => undefined);
        }
        await factWrite;

        assert.deepEqual(
            (await store.listFacts()).map(({ key }) => key),
            ['live-owner']
        );
    } finally {
        await fs.rm(tarsHome, { recursive: true, force: true });
    }
});

test('an old memory lock is recovered after its owner process exits', async () => {
    // ARRANGE
    const tarsHome = await fs.mkdtemp(path.join(os.tmpdir(), 'tars-memory-store-'));
    const lockPath = await writeOldLock(tarsHome, DEAD_PID);
    const store = new MemoryStore(tarsHome);

    try {
        // ACT
        await store.storeFact('dead-owner', 'recovered');

        // ASSERT
        assert.deepEqual(
            (await store.listFacts()).map(({ key }) => key),
            ['dead-owner']
        );
        await assert.rejects(fs.lstat(lockPath), { code: 'ENOENT' });
    } finally {
        await fs.rm(tarsHome, { recursive: true, force: true });
    }
});
