import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
    runUpdatePreflight,
    UPDATE_PREFLIGHT_CONTRACT_VERSION
} from '../../cli/update-preflight.js';

const temporaryDirectories: string[] = [];

afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

describe('target update preflight contract', () => {
    it('returns structured blockers understood by an older updater', () => {
        // ARRANGE
        const tarsHome = fs.mkdtempSync(path.join(os.tmpdir(), 'tars-update-preflight-'));
        temporaryDirectories.push(tarsHome);
        const extensionPath = path.join(tarsHome, 'extensions', 'legacy-search');
        fs.mkdirSync(extensionPath, { recursive: true });
        fs.writeFileSync(
            path.join(tarsHome, 'extensions', 'extension-enablement.json'),
            JSON.stringify({ 'legacy-search': true })
        );
        fs.writeFileSync(
            path.join(extensionPath, 'tars-extension.json'),
            JSON.stringify({
                name: 'legacy-search',
                mcpServers: { search: { command: 'node', args: ['server.js'] } }
            })
        );

        // ACT
        const result = runUpdatePreflight(tarsHome);

        // ASSERT
        expect(result.contractVersion).toBe(UPDATE_PREFLIGHT_CONTRACT_VERSION);
        expect(result.blockers).toEqual([
            expect.objectContaining({
                code: 'missing-environment-policy',
                extension: 'legacy-search',
                server: 'search'
            })
        ]);
    });
});
