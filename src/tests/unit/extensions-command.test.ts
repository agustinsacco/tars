import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
    applyMcpPolicyMigrationDecisions,
    parseEnvironmentNames,
    writeMcpPolicyEnablementWithBackup
} from '../../cli/commands/extensions.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
    await Promise.all(
        temporaryDirectories
            .splice(0)
            .map((directory) => fs.rm(directory, { recursive: true, force: true }))
    );
});

describe('extension policy migration', () => {
    it('normalizes and validates manually entered environment-variable names', () => {
        // ARRANGE
        const input = 'SHOPIFY_TOKEN, QUESTRADE_TOKEN SHOPIFY_TOKEN';

        // ACT
        const names = parseEnvironmentNames(input);

        // ASSERT
        expect(names).toEqual(['QUESTRADE_TOKEN', 'SHOPIFY_TOKEN']);
        expect(() => parseEnvironmentNames('INVALID-NAME')).toThrow();
    });

    it('migrates boolean and object entries while preserving existing settings', () => {
        // ARRANGE
        const enablement = {
            playwright: true,
            shopify: { enabled: true, startupTimeoutMs: 45_000 },
            disabled: false
        };

        // ACT
        const migrated = applyMcpPolicyMigrationDecisions(enablement, [
            { action: 'allow', envAllowlist: [], extension: 'playwright' },
            {
                action: 'allow',
                envAllowlist: ['SHOPIFY_TOKEN'],
                extension: 'shopify'
            },
            { action: 'disable', extension: 'disabled' }
        ]);

        // ASSERT
        expect(migrated).toEqual({
            playwright: { enabled: true, envAllowlist: [] },
            shopify: {
                enabled: true,
                envAllowlist: ['SHOPIFY_TOKEN'],
                startupTimeoutMs: 45_000
            },
            disabled: { enabled: false }
        });
    });

    it('backs up and atomically replaces enablement with owner-only permissions', async () => {
        // ARRANGE
        const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'tars-extension-command-'));
        temporaryDirectories.push(directory);
        const enablementPath = path.join(directory, 'extension-enablement.json');
        await fs.writeFile(enablementPath, JSON.stringify({ legacy: true }), { mode: 0o644 });

        // ACT
        const backupPath = await writeMcpPolicyEnablementWithBackup(enablementPath, {
            legacy: { enabled: true, envAllowlist: ['LEGACY_TOKEN'] }
        });

        // ASSERT
        expect(JSON.parse(await fs.readFile(enablementPath, 'utf8'))).toEqual({
            legacy: { enabled: true, envAllowlist: ['LEGACY_TOKEN'] }
        });
        expect(JSON.parse(await fs.readFile(backupPath, 'utf8'))).toEqual({ legacy: true });
        expect((await fs.stat(enablementPath)).mode & 0o777).toBe(0o600);
        expect((await fs.stat(backupPath)).mode & 0o777).toBe(0o600);
    });
});
