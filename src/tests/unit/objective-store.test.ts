import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { ObjectiveStore } from '../../initiative/objective-store.js';

const temporaryDirectories: string[] = [];

afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
        fs.rmSync(directory, { force: true, recursive: true });
    }
});

describe('ObjectiveStore', () => {
    it('persists explicit authority boundaries and returns due objectives', async () => {
        // ARRANGE
        const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tars-objective-'));
        temporaryDirectories.push(homeDir);
        const store = new ObjectiveStore(path.join(homeDir, 'data', 'objectives.json'));

        // ACT
        const objective = await store.create({
            allowedActions: ['Read health data', 'Draft recommendations'],
            approvalRequired: ['Change calendar', 'Contact a clinician'],
            attentionPolicy: 'digest',
            desiredOutcome: 'Notice material recovery changes.',
            reviewAt: new Date(Date.now() - 1_000).toISOString(),
            successCriteria: ['Daily recovery review completed'],
            title: 'Improve recovery'
        });
        const due = await store.listDue();

        // ASSERT
        expect(due).toHaveLength(1);
        expect(due[0]).toEqual(objective);
        expect(fs.statSync(path.join(homeDir, 'data', 'objectives.json')).mode & 0o077).toBe(0);
    });
});
