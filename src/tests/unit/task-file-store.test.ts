import fs from 'fs/promises';
import os from 'os';
import path from 'path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { TaskFileStore } from '../../supervisor/task-file-store.js';
import type { Task } from '../../types/index.js';

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

function createTask(): Task {
    const now = new Date().toISOString();
    return {
        id: 'task-1',
        title: 'Task 1',
        prompt: 'Run the task',
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

describe('TaskFileStore', () => {
    let directory: string;
    let filePath: string;

    beforeEach(async () => {
        directory = await fs.mkdtemp(path.join(os.tmpdir(), 'tars-task-store-test-'));
        filePath = path.join(directory, 'tasks.json');
    });

    afterEach(async () => {
        await fs.rm(directory, { recursive: true, force: true });
    });

    it('serializes updates across independent store instances', async () => {
        // ARRANGE
        await fs.writeFile(filePath, JSON.stringify([createTask()]));
        const firstStore = new TaskFileStore(filePath);
        const secondStore = new TaskFileStore(filePath);

        // ACT
        await Promise.all([
            firstStore.updateTask('task-1', (task) => {
                task.failedCount += 1;
            }),
            secondStore.updateTask('task-1', (task) => {
                task.failedCount += 1;
            })
        ]);

        // ASSERT
        await expect(firstStore.loadTasks()).resolves.toMatchObject([{ failedCount: 2 }]);
    });

    it('rejects malformed task files instead of silently executing partial data', async () => {
        // ARRANGE
        await fs.writeFile(filePath, JSON.stringify([{ id: 'partial-task' }]));
        const store = new TaskFileStore(filePath);

        // ACT / ASSERT
        await expect(store.loadTasks()).rejects.toThrow();
    });

    it('does not evict an old lock owned by a live process', async () => {
        // ARRANGE
        await fs.writeFile(filePath, JSON.stringify([createTask()]));
        const lockPath = await writeOldLock(filePath, process.pid);
        const store = new TaskFileStore(filePath);

        // ACT
        const update = store.updateTask('task-1', (task) => {
            task.failedCount += 1;
        });
        try {
            await wait(75);

            // ASSERT
            await expect(fs.readFile(lockPath, 'utf8')).resolves.toContain(`${process.pid}`);
        } finally {
            await fs.unlink(lockPath).catch(() => undefined);
        }

        await expect(update).resolves.toMatchObject({ failedCount: 1 });
    });

    it('recovers an old lock whose owner process is gone', async () => {
        // ARRANGE
        await fs.writeFile(filePath, JSON.stringify([createTask()]));
        const lockPath = await writeOldLock(filePath, DEAD_PID);
        const store = new TaskFileStore(filePath);

        // ACT
        const updated = await store.updateTask('task-1', (task) => {
            task.failedCount += 1;
        });

        // ASSERT
        expect(updated).toMatchObject({ failedCount: 1 });
        await expect(fs.lstat(lockPath)).rejects.toMatchObject({ code: 'ENOENT' });
    });
});
