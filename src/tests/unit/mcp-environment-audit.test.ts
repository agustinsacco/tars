import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { scanExtensionEnvironmentReferences } from '../../utils/mcp-environment-audit.js';

const temporaryDirectories: string[] = [];

function createExtensionDirectory(): string {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tars-environment-audit-'));
    temporaryDirectories.push(directory);
    return directory;
}

afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

describe('MCP environment reference scanner', () => {
    it('finds static process.env references without scanning dependencies or implicit names', () => {
        // ARRANGE
        const extensionPath = createExtensionDirectory();
        fs.mkdirSync(path.join(extensionPath, 'src'));
        fs.mkdirSync(path.join(extensionPath, 'node_modules', 'dependency'), { recursive: true });
        fs.writeFileSync(
            path.join(extensionPath, 'src', 'server.ts'),
            [
                'process.env.QUESTRADE_TOKEN;',
                'process.env["SHOPIFY_PARTNER_TOKEN"];',
                "process.env['TARS_HOME'];",
                'process.env.EXPLICIT_VALUE;'
            ].join('\n')
        );
        fs.writeFileSync(
            path.join(extensionPath, 'node_modules', 'dependency', 'index.js'),
            'process.env.DEPENDENCY_SECRET;\n'
        );

        // ACT
        const result = scanExtensionEnvironmentReferences(extensionPath, ['EXPLICIT_VALUE']);

        // ASSERT
        expect(result).toEqual({
            names: ['QUESTRADE_TOKEN', 'SHOPIFY_PARTNER_TOKEN'],
            truncated: false
        });
    });
});
