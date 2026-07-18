import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { Task, TaskStore } from './store.js';

const LOCK_TOKEN = '00000000-0000-4000-8000-000000000001';
const DEAD_PID = 2_147_483_647;

async function wait(milliseconds: number): Promise<void> {
    await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

async function writeOldLock(filePath: string, pid: number): Promise<string> {
    const lockPath = `${filePath}.lock`;
    const createdAt = Date.now() - 60_000;
    await fs.writeFile(lockPath, `${LOCK_TOKEN}\n${pid}\n${createdAt}\n`);
    const staleTime = new Date(createdAt);
    await fs.utimes(lockPath, staleTime, staleTime);
    return lockPath;
}

function createTask(id: string): Task {
    const now = new Date().toISOString();
    return {
        id,
        title: `Task ${id}`,
        prompt: `Run ${id}`,
        schedule: '0 0 * * *',
        nextRun: now,
        enabled: true,
        mode: 'silent',
        source: 'user',
        failedCount: 0,
        createdAt: now,
        updatedAt: now
    };
}

test('separate store instances do not lose concurrent task additions', async () => {
    // ARRANGE
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'tars-task-store-'));
    const filePath = path.join(directory, 'tasks.json');
    const firstStore = new TaskStore(filePath);
    const secondStore = new TaskStore(filePath);

    try {
        // ACT
        await Promise.all([
            firstStore.addTask(createTask('first')),
            secondStore.addTask(createTask('second'))
        ]);

        // ASSERT
        const tasks = await firstStore.loadTasks();
        assert.deepEqual(tasks.map((task) => task.id).sort(), ['first', 'second']);
    } finally {
        await fs.rm(directory, { recursive: true, force: true });
    }
});

test('task updates are validated and persisted atomically', async () => {
    // ARRANGE
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'tars-task-store-'));
    const filePath = path.join(directory, 'tasks.json');
    const store = new TaskStore(filePath);

    try {
        await store.addTask(createTask('update-me'));

        // ACT
        const updated = await store.updateTask('update-me', { mode: 'notify', enabled: false });

        // ASSERT
        assert.equal(updated?.mode, 'notify');
        assert.equal(updated?.enabled, false);
        assert.equal((await store.loadTasks())[0]?.mode, 'notify');
    } finally {
        await fs.rm(directory, { recursive: true, force: true });
    }
});

test('an old task lock owned by a live process is not evicted', async () => {
    // ARRANGE
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'tars-task-store-'));
    const filePath = path.join(directory, 'tasks.json');
    const lockPath = await writeOldLock(filePath, process.pid);
    const store = new TaskStore(filePath);

    try {
        // ACT
        const addition = store.addTask(createTask('live-owner'));
        try {
            await wait(75);

            // ASSERT
            assert.match(await fs.readFile(lockPath, 'utf8'), new RegExp(`${process.pid}`));
        } finally {
            await fs.unlink(lockPath).catch(() => undefined);
        }
        await addition;

        assert.deepEqual(
            (await store.loadTasks()).map((task) => task.id),
            ['live-owner']
        );
    } finally {
        await fs.rm(directory, { recursive: true, force: true });
    }
});

test('an old task lock is recovered after its owner process exits', async () => {
    // ARRANGE
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'tars-task-store-'));
    const filePath = path.join(directory, 'tasks.json');
    const lockPath = await writeOldLock(filePath, DEAD_PID);
    const store = new TaskStore(filePath);

    try {
        // ACT
        await store.addTask(createTask('dead-owner'));

        // ASSERT
        assert.deepEqual(
            (await store.loadTasks()).map((task) => task.id),
            ['dead-owner']
        );
        await assert.rejects(fs.lstat(lockPath), { code: 'ENOENT' });
    } finally {
        await fs.rm(directory, { recursive: true, force: true });
    }
});
