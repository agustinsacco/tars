import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const updateMocks = vi.hoisted(() => {
    const spinner = {
        fail: vi.fn(),
        info: vi.fn(),
        start: vi.fn(),
        succeed: vi.fn(),
        text: '',
        warn: vi.fn()
    };
    return {
        execFileSync: vi.fn(),
        ora: vi.fn(),
        refresh: vi.fn(),
        restartActiveTarsProcessesByHome: vi.fn(),
        spinner,
        tarsHome: '',
        withTarsHomeMutationLease: vi.fn()
    };
});

vi.mock('child_process', () => ({ execFileSync: updateMocks.execFileSync }));
vi.mock('ora', () => ({ default: updateMocks.ora }));
vi.mock('../../utils/paths.js', () => ({ getTarsHome: () => updateMocks.tarsHome }));
vi.mock('../../utils/pm2-processes.js', () => ({
    restartActiveTarsProcessesByHome: updateMocks.restartActiveTarsProcessesByHome
}));
vi.mock('../../utils/tars-home-lease.js', () => ({
    withTarsHomeMutationLease: updateMocks.withTarsHomeMutationLease
}));
vi.mock('../../cli/commands/refresh.js', () => ({ refresh: updateMocks.refresh }));

import { update } from '../../cli/commands/update.js';
import { pkg } from '../../utils/version.js';

const temporaryDirectories: string[] = [];
const versionMatch = /^(\d+)\.(\d+)\.(\d+)$/.exec(pkg.version);
if (!versionMatch) throw new Error(`Unexpected package version: ${pkg.version}`);
const targetVersion = `${versionMatch[1]}.${versionMatch[2]}.${Number(versionMatch[3]) + 1}`;

function createStagedTarget(stagingRoot: string): void {
    const packageRoot = path.join(stagingRoot, 'node_modules', '@saccolabs', 'tars');
    fs.mkdirSync(path.join(packageRoot, 'dist', 'cli'), { recursive: true });
    fs.mkdirSync(path.join(packageRoot, 'dist', 'supervisor'), { recursive: true });
    fs.mkdirSync(path.join(packageRoot, 'dash'), { recursive: true });
    fs.mkdirSync(path.join(packageRoot, 'extensions'), { recursive: true });
    fs.writeFileSync(
        path.join(packageRoot, 'package.json'),
        JSON.stringify({ name: '@saccolabs/tars', type: 'module', version: targetVersion })
    );
    fs.writeFileSync(path.join(packageRoot, 'dist', 'cli', 'index.js'), 'export {};\n');
    fs.writeFileSync(path.join(packageRoot, 'dist', 'supervisor', 'main.js'), 'export {};\n');
    fs.writeFileSync(path.join(packageRoot, 'dash', 'server.js'), 'export {};\n');
    fs.writeFileSync(
        path.join(packageRoot, 'dist', 'cli', 'update-preflight.js'),
        [
            'export const UPDATE_PREFLIGHT_CONTRACT_VERSION = 1;',
            'export function runUpdatePreflight() {',
            '  return { contractVersion: 1, blockers: [{',
            "    code: 'missing-environment-policy',",
            "    extension: 'legacy-search',",
            "    manifestPath: '/tmp/legacy-search/tars-extension.json',",
            "    reason: 'missing an explicit envAllowlist',",
            "    server: 'search',",
            '    suggestedEnvironmentVariables: [],',
            '    suggestionScanTruncated: false',
            '  }] };',
            '}'
        ].join('\n')
    );
}

beforeEach(async () => {
    updateMocks.tarsHome = await fsp.mkdtemp(path.join(os.tmpdir(), 'tars-update-command-'));
    temporaryDirectories.push(updateMocks.tarsHome);
    updateMocks.withTarsHomeMutationLease.mockImplementation(
        async (_home: string, _operation: string, callback: () => Promise<unknown>) => callback()
    );
    updateMocks.ora.mockReturnValue(updateMocks.spinner);
    updateMocks.spinner.start.mockReturnValue(updateMocks.spinner);
    updateMocks.refresh.mockResolvedValue(true);
    updateMocks.restartActiveTarsProcessesByHome.mockResolvedValue([]);
    updateMocks.execFileSync.mockImplementation((command: string, args: readonly string[]) => {
        if (args[0] === 'view') return targetVersion;
        const prefixIndex = args.indexOf('--prefix');
        if (args[0] === 'install' && prefixIndex >= 0) {
            createStagedTarget(args[prefixIndex + 1]);
            return '';
        }
        if (args[0] === 'install' && args.includes('--global')) return '';
        if (command === process.execPath) {
            return JSON.stringify({
                contractVersion: 1,
                blockers: [],
                warnings: [
                    {
                        code: 'missing-environment-policy',
                        extension: 'legacy-search',
                        manifestPath: '/tmp/legacy-search/tars-extension.json',
                        reason: 'missing an explicit envAllowlist',
                        server: 'search',
                        suggestedEnvironmentVariables: [],
                        suggestionScanTruncated: false
                    }
                ]
            });
        }
        throw new Error(`Unexpected npm invocation: ${args.join(' ')}`);
    });
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
});

afterEach(async () => {
    vi.restoreAllMocks();
    vi.resetAllMocks();
    await Promise.all(
        temporaryDirectories
            .splice(0)
            .map((directory) => fsp.rm(directory, { recursive: true, force: true }))
    );
});

describe('update policy preflight', () => {
    it('continues the core update while policy warnings remain fail-closed', async () => {
        // ARRANGE
        const before = await fsp.readdir(updateMocks.tarsHome);

        // ACT
        const updated = await update();

        // ASSERT
        expect(updated).toBe(true);
        expect(await fsp.readdir(updateMocks.tarsHome)).toEqual(before);
        expect(updateMocks.execFileSync).toHaveBeenCalledTimes(4);
        expect(updateMocks.spinner.warn).toHaveBeenCalledWith(
            expect.stringContaining('remaining fail-closed')
        );
        expect(updateMocks.restartActiveTarsProcessesByHome).toHaveBeenCalledOnce();
    });

    it('treats legacy target blockers as fail-closed warnings', async () => {
        // ARRANGE
        updateMocks.execFileSync.mockImplementation((command: string, args: readonly string[]) => {
            if (args[0] === 'view') return targetVersion;
            const prefixIndex = args.indexOf('--prefix');
            if (args[0] === 'install' && prefixIndex >= 0) {
                createStagedTarget(args[prefixIndex + 1]);
                return '';
            }
            if (args[0] === 'install' && args.includes('--global')) return '';
            if (command === process.execPath) {
                return JSON.stringify({
                    contractVersion: 1,
                    blockers: [
                        {
                            code: 'missing-environment-policy',
                            extension: 'legacy-search',
                            manifestPath: '/tmp/legacy-search/tars-extension.json',
                            reason: 'missing an explicit envAllowlist',
                            server: 'search',
                            suggestedEnvironmentVariables: [],
                            suggestionScanTruncated: false
                        }
                    ]
                });
            }
            throw new Error(`Unexpected npm invocation: ${args.join(' ')}`);
        });

        // ACT
        const updated = await update();

        // ASSERT
        expect(updated).toBe(true);
        expect(updateMocks.spinner.warn).toHaveBeenCalledWith(
            expect.stringContaining('remaining fail-closed')
        );
        expect(updateMocks.refresh).toHaveBeenCalledOnce();
    });
});
