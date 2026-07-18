import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    activateStagedAssets,
    mergeBundledExtensionEnablement,
    swapStagedAssets
} from '../../cli/commands/refresh.js';
import { installExtensions, isManagedBundledExtension } from '../../supervisor/bootstrap.js';
import type { Config } from '../../config/config.js';

const temporaryDirectories: string[] = [];

async function makeTemporaryDirectory(): Promise<string> {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'tars-refresh-test-'));
    temporaryDirectories.push(directory);
    return directory;
}

async function writeAsset(directory: string, name: string, content: string): Promise<string> {
    const assetPath = path.join(directory, name);
    await fs.mkdir(assetPath);
    await fs.writeFile(path.join(assetPath, 'value.txt'), content);
    return assetPath;
}

afterEach(async () => {
    // ARRANGE
    vi.resetAllMocks();

    // ACT
    await Promise.all(
        temporaryDirectories
            .splice(0)
            .map((directory) => fs.rm(directory, { recursive: true, force: true }))
    );
});

describe('swapStagedAssets', () => {
    it('atomically replaces validated assets', async () => {
        // ARRANGE
        const root = await makeTemporaryDirectory();
        const destination = await writeAsset(root, 'live', 'old');
        const stagedPath = await writeAsset(root, 'staged', 'new');

        // ACT
        await swapStagedAssets([{ destination, stagedPath }]);

        // ASSERT
        expect(await fs.readFile(path.join(destination, 'value.txt'), 'utf8')).toBe('new');
        expect(await fs.readdir(root)).toEqual(['live']);
    });

    it('rolls every asset back when a later swap fails', async () => {
        // ARRANGE
        const root = await makeTemporaryDirectory();
        const firstDestination = await writeAsset(root, 'first-live', 'first-old');
        const secondDestination = await writeAsset(root, 'second-live', 'second-old');
        const firstStagedPath = await writeAsset(root, 'first-staged', 'first-new');
        const missingSecondStage = path.join(root, 'missing-second-stage');

        // ACT
        const operation = swapStagedAssets([
            { destination: firstDestination, stagedPath: firstStagedPath },
            { destination: secondDestination, stagedPath: missingSecondStage }
        ]);

        // ASSERT
        await expect(operation).rejects.toThrow();
        expect(await fs.readFile(path.join(firstDestination, 'value.txt'), 'utf8')).toBe(
            'first-old'
        );
        expect(await fs.readFile(path.join(secondDestination, 'value.txt'), 'utf8')).toBe(
            'second-old'
        );
    });
});

describe('activateStagedAssets', () => {
    it('restores previous assets and reactivates them when activation fails', async () => {
        // ARRANGE
        const root = await makeTemporaryDirectory();
        const destination = await writeAsset(root, 'live', 'old');
        const stagedPath = await writeAsset(root, 'staged', 'new');
        const activate = vi
            .fn<() => Promise<void>>()
            .mockImplementationOnce(async () => {
                expect(await fs.readFile(path.join(destination, 'value.txt'), 'utf8')).toBe('new');
                expect(
                    (await fs.readdir(root)).some((entry) => entry.startsWith('live.backup-'))
                ).toBe(true);
                throw new Error('restart failed');
            })
            .mockImplementationOnce(async () => {
                expect(await fs.readFile(path.join(destination, 'value.txt'), 'utf8')).toBe('old');
            });

        // ACT
        const operation = activateStagedAssets([{ destination, stagedPath }], activate);

        // ASSERT
        await expect(operation).rejects.toThrow('restart failed');
        expect(activate).toHaveBeenCalledTimes(2);
        expect(await fs.readFile(path.join(destination, 'value.txt'), 'utf8')).toBe('old');
        expect(await fs.readdir(root)).toEqual(['live']);
    });

    it('reactivates previous assets when swapping fails before activation', async () => {
        // ARRANGE
        const root = await makeTemporaryDirectory();
        const firstDestination = await writeAsset(root, 'first-live', 'first-old');
        const secondDestination = await writeAsset(root, 'second-live', 'second-old');
        const firstStagedPath = await writeAsset(root, 'first-staged', 'first-new');
        const missingSecondStage = path.join(root, 'missing-second-stage');
        const activate = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);

        // ACT
        const operation = activateStagedAssets(
            [
                { destination: firstDestination, stagedPath: firstStagedPath },
                { destination: secondDestination, stagedPath: missingSecondStage }
            ],
            activate
        );

        // ASSERT
        await expect(operation).rejects.toThrow();
        expect(activate).toHaveBeenCalledOnce();
        expect(await fs.readFile(path.join(firstDestination, 'value.txt'), 'utf8')).toBe(
            'first-old'
        );
        expect(await fs.readFile(path.join(secondDestination, 'value.txt'), 'utf8')).toBe(
            'second-old'
        );
    });
});

describe('mergeBundledExtensionEnablement', () => {
    it('authorizes newly installed bundled extensions without overriding explicit disablement', () => {
        // ARRANGE
        const current = {
            'tars-memory': { enabled: false, overrides: ['/custom/*'] },
            'third-party': { enabled: true }
        };

        // ACT
        const merged = mergeBundledExtensionEnablement(current, [
            'tars-memory',
            'tars-search',
            'tars-tasks'
        ]);

        // ASSERT
        expect(merged).toEqual({
            'tars-memory': { enabled: false, overrides: ['/custom/*'] },
            'tars-search': { overrides: [] },
            'tars-tasks': { overrides: [] },
            'third-party': { enabled: true }
        });
    });
});

describe('managed bundled extension markers', () => {
    it('distinguishes trusted refresh output from an unmanaged directory', async () => {
        // ARRANGE
        const root = await makeTemporaryDirectory();
        const managed = path.join(root, 'managed');
        const unmanaged = path.join(root, 'unmanaged');
        await Promise.all([fs.mkdir(managed), fs.mkdir(unmanaged)]);
        await fs.writeFile(
            path.join(managed, '.tars-managed-extension.json'),
            JSON.stringify({ schemaVersion: 1, name: 'tars-memory' })
        );

        // ACT / ASSERT
        expect(isManagedBundledExtension(managed, 'tars-memory')).toBe(true);
        expect(isManagedBundledExtension(managed, 'tars-search')).toBe(false);
        expect(isManagedBundledExtension(unmanaged, 'tars-memory')).toBe(false);
    });

    it('preserves validated refresh output during an offline bootstrap', async () => {
        // ARRANGE
        const root = await makeTemporaryDirectory();
        const extensions = path.join(root, 'extensions');
        await fs.mkdir(extensions);
        for (const name of ['tars-memory', 'tars-search', 'tars-tasks']) {
            const extension = path.join(extensions, name);
            await fs.mkdir(path.join(extension, 'dist'), { recursive: true });
            await fs.mkdir(path.join(extension, 'node_modules'));
            await fs.writeFile(path.join(extension, 'dist', 'server.js'), `// ${name}`);
            await fs.writeFile(path.join(extension, 'node_modules', 'offline.txt'), 'preserve-me');
            await fs.writeFile(
                path.join(extension, '.tars-managed-extension.json'),
                JSON.stringify({ schemaVersion: 1, name })
            );
        }

        // ACT
        installExtensions({ homeDir: root } as Config);

        // ASSERT
        for (const name of ['tars-memory', 'tars-search', 'tars-tasks']) {
            expect(
                await fs.readFile(
                    path.join(extensions, name, 'node_modules', 'offline.txt'),
                    'utf8'
                )
            ).toBe('preserve-me');
        }
    });
});
