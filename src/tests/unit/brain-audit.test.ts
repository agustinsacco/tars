import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { BrainAuditor } from '../../utils/brain-audit.js';

const temporaryDirectories: string[] = [];

afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
        fs.rmSync(directory, { force: true, recursive: true });
    }
});

describe('BrainAuditor', () => {
    it('does not mutate anomalies during a read-only startup audit', async () => {
        // ARRANGE
        const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tars-brain-audit-'));
        temporaryDirectories.push(homeDir);
        const anomaly = path.join(homeDir, '.tars');
        fs.mkdirSync(anomaly);

        // ACT
        await new BrainAuditor(homeDir).audit({ repair: false, silent: true });

        // ASSERT
        expect(fs.existsSync(anomaly)).toBe(true);
    });

    it('removes known anomalies only during an explicit repair', async () => {
        // ARRANGE
        const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tars-brain-repair-'));
        temporaryDirectories.push(homeDir);
        const anomaly = path.join(homeDir, '.tars');
        fs.mkdirSync(anomaly);

        // ACT
        await new BrainAuditor(homeDir).audit({ repair: true, silent: true });

        // ASSERT
        expect(fs.existsSync(anomaly)).toBe(false);
    });
});
