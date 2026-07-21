import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { TaskDigestStore } from '../../supervisor/task-digest-store.js';

const temporaryDirectories: string[] = [];

afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
        fs.rmSync(directory, { force: true, recursive: true });
    }
});

describe('TaskDigestStore', () => {
    it('persists routine entries until the next daily delivery window', async () => {
        // ARRANGE
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tars-task-digest-'));
        temporaryDirectories.push(directory);
        const filePath = path.join(directory, 'digest.json');
        const store = new TaskDigestStore(filePath);
        const queuedAt = new Date(2026, 6, 20, 10, 0, 0);

        // ACT
        await store.enqueue('Portfolio unchanged.', queuedAt);
        const due = await store.getDueEntries(new Date(2026, 6, 21, 10, 0, 0));
        await store.markDelivered(new Date(2026, 6, 21, 10, 0, 0));

        // ASSERT
        expect(due).toEqual(['Portfolio unchanged.']);
        expect(await store.getDueEntries(new Date(2026, 6, 21, 10, 1, 0))).toEqual([]);
        expect(fs.statSync(filePath).mode & 0o077).toBe(0);
    });
});
