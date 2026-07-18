import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { SecretsManager } from '../../utils/secrets-manager.js';

const temporaryPaths: string[] = [];

async function makeTemporaryDirectory(): Promise<string> {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'tars-secrets-test-'));
    temporaryPaths.push(directory);
    return directory;
}

afterEach(async () => {
    await Promise.all(
        temporaryPaths
            .splice(0)
            .map((temporaryPath) => fs.rm(temporaryPath, { recursive: true, force: true }))
    );
});

describe('SecretsManager', () => {
    it('persists secrets atomically with owner-only permissions', async () => {
        // ARRANGE
        const home = await makeTemporaryDirectory();
        const manager = new SecretsManager(home);

        // ACT
        manager.set('OPENAI_API_KEY', 'example-value');

        // ASSERT
        expect(manager.load()).toEqual({ OPENAI_API_KEY: 'example-value' });
        expect((await fs.stat(path.join(home, '.env'))).mode & 0o777).toBe(0o600);
    });

    it('propagates persistence failures instead of reporting false success', async () => {
        // ARRANGE
        const root = await makeTemporaryDirectory();
        const invalidHome = path.join(root, 'not-a-directory');
        await fs.writeFile(invalidHome, 'file');
        const manager = new SecretsManager(invalidHome);

        // ACT / ASSERT
        expect(() => manager.set('OPENAI_API_KEY', 'example-value')).toThrow();
    });

    it('never treats an unreadable existing secrets path as an empty store', async () => {
        // ARRANGE
        const home = await makeTemporaryDirectory();
        await fs.mkdir(path.join(home, '.env'));
        const manager = new SecretsManager(home);

        // ACT / ASSERT
        expect(() => manager.load()).toThrow();
        expect(() => manager.set('NEW_SECRET', 'value')).toThrow();
        expect((await fs.stat(path.join(home, '.env'))).isDirectory()).toBe(true);
    });
});
