import { execFileSync } from 'child_process';
import fsSync from 'fs';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
    isSecretExportPath,
    redactSensitiveValues,
    exportBrain
} from '../../cli/commands/export.js';
import {
    importBrain,
    validateArchiveEntryTypes,
    validateArchiveMembers,
    validateArchiveUncompressedSize
} from '../../cli/commands/import.js';
import { uninstall, validateUninstallTarget } from '../../cli/commands/uninstall.js';
import { start } from '../../cli/commands/start.js';
import {
    deleteTarsProcessesByHome,
    findTarsProcessesByHome,
    restartActiveTarsProcessesByHome,
    stopTarsProcessNames
} from '../../utils/pm2-processes.js';
import { STARTUP_LOCK_FILE_NAME } from '../../utils/startup-lock.js';
import { acquireForegroundChatLease } from '../../utils/tars-home-lease.js';

const pm2Mocks = vi.hoisted(() => ({
    connect: vi.fn(),
    delete: vi.fn(),
    describe: vi.fn(),
    disconnect: vi.fn(),
    list: vi.fn(),
    restart: vi.fn(),
    start: vi.fn(),
    stop: vi.fn()
}));

vi.mock('pm2', () => ({ default: pm2Mocks }));

const temporaryDirectories: string[] = [];
const originalTarsHome = process.env.TARS_HOME;

beforeEach(() => {
    pm2Mocks.connect.mockImplementation((callback: (error: Error | null) => void) =>
        callback(null)
    );
    pm2Mocks.list.mockImplementation(
        (callback: (error: Error | null, processes: unknown[]) => void) => callback(null, [])
    );
    pm2Mocks.delete.mockImplementation((_name: string, callback: (error: Error | null) => void) =>
        callback(null)
    );
    pm2Mocks.describe.mockImplementation(
        (_name: string, callback: (error: Error | null, processes: unknown[]) => void) =>
            callback(null, [])
    );
    pm2Mocks.restart.mockImplementation((_name: string, callback: (error: Error | null) => void) =>
        callback(null)
    );
    pm2Mocks.start.mockImplementation(
        (_options: unknown, callback: (error: Error | null, processes: unknown[]) => void) =>
            callback(null, [])
    );
    pm2Mocks.stop.mockImplementation((_name: string, callback: (error: Error | null) => void) =>
        callback(null)
    );
});

async function makeTemporaryDirectory(): Promise<string> {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'tars-lifecycle-test-'));
    temporaryDirectories.push(directory);
    return directory;
}

afterEach(async () => {
    // ARRANGE
    vi.resetAllMocks();
    if (originalTarsHome === undefined) delete process.env.TARS_HOME;
    else process.env.TARS_HOME = originalTarsHome;

    // ACT
    await Promise.all(
        temporaryDirectories
            .splice(0)
            .map((directory) => fs.rm(directory, { recursive: true, force: true }))
    );
});

describe('brain export safety', () => {
    it('identifies credential paths and recursively removes sensitive keys', () => {
        // ARRANGE
        const input = {
            assistantName: 'Tars',
            discordToken: 'secret',
            totalInputTokens: 42_000,
            tokenCount: 12,
            nested: { apiKey: 'secret', model: 'safe' }
        };

        // ACT
        const redacted = redactSensitiveValues(input);

        // ASSERT
        expect(isSecretExportPath('.env')).toBe(true);
        expect(isSecretExportPath(path.join('provider', 'private.key'))).toBe(true);
        expect(isSecretExportPath(path.join('data', 'notes.txt'))).toBe(false);
        expect(isSecretExportPath(path.join('extensions', 'token', 'index.js'))).toBe(false);
        expect(redacted).toEqual({
            assistantName: 'Tars',
            totalInputTokens: 42_000,
            tokenCount: 12,
            nested: { model: 'safe' }
        });
    });

    it('excludes known credential files and redacts sensitive JSON keys by default', async () => {
        // ARRANGE
        const root = await makeTemporaryDirectory();
        const brain = path.join(root, 'brain');
        const output = path.join(root, 'brain.tar.gz');
        const extracted = path.join(root, 'extracted');
        await fs.mkdir(path.join(brain, 'data'), { recursive: true });
        await fs.writeFile(
            path.join(brain, 'metadata.json'),
            JSON.stringify({ lastAudit: new Date().toISOString(), version: '1.0.0' })
        );
        await fs.writeFile(
            path.join(brain, 'config.json'),
            JSON.stringify({ assistantName: 'Tars', discordToken: 'secret' })
        );
        await fs.writeFile(path.join(brain, '.env'), 'TOKEN=secret');
        await fs.writeFile(
            path.join(brain, 'data', 'facts.json'),
            JSON.stringify({ fact: 'safe', apiKey: 'secret' })
        );
        process.env.TARS_HOME = brain;

        // ACT
        await exportBrain({ output });
        await fs.mkdir(extracted);
        execFileSync('tar', ['-xzf', output, '-C', extracted]);
        const exportedRoot = path.join(extracted, 'brain');
        const config = JSON.parse(
            await fs.readFile(path.join(exportedRoot, 'config.json'), 'utf8')
        );
        const facts = JSON.parse(
            await fs.readFile(path.join(exportedRoot, 'data', 'facts.json'), 'utf8')
        );

        // ASSERT
        expect(fsSync.existsSync(path.join(exportedRoot, '.env'))).toBe(false);
        expect(config).toEqual({ assistantName: 'Tars' });
        expect(facts).toEqual({ fact: 'safe' });
        expect((await fs.stat(output)).mode & 0o777).toBe(0o600);
    });

    it('refuses to export while a matching supervisor is active', async () => {
        // ARRANGE
        const root = await makeTemporaryDirectory();
        const brain = path.join(root, 'brain');
        await fs.mkdir(brain);
        process.env.TARS_HOME = brain;
        pm2Mocks.list.mockImplementation(
            (callback: (error: Error | null, processes: unknown[]) => void) =>
                callback(null, [
                    {
                        name: 'custom-tars',
                        pm2_env: {
                            status: 'online',
                            TARS_HOME: brain,
                            TARS_MANAGED_PROCESS: 'true',
                            TARS_PROCESS_KIND: 'supervisor',
                            TARS_SUPERVISOR_MODE: 'true'
                        }
                    }
                ])
        );

        // ACT / ASSERT
        await expect(exportBrain({ output: path.join(root, 'brain.tar.gz') })).rejects.toThrow(
            /tars stop/
        );
    });
});

describe('brain import preflight', () => {
    it('stages a valid import and preserves the previous brain as a backup', async () => {
        // ARRANGE
        const root = await makeTemporaryDirectory();
        const source = path.join(root, 'source');
        const destination = path.join(root, 'destination');
        const archive = path.join(root, 'brain.tar.gz');
        await fs.mkdir(path.join(source, 'data'), { recursive: true });
        await fs.writeFile(
            path.join(source, 'metadata.json'),
            JSON.stringify({
                installationId: 'preserved-installation',
                lastAudit: new Date().toISOString(),
                version: '1.0.0'
            })
        );
        await fs.writeFile(
            path.join(source, 'config.json'),
            JSON.stringify({ assistantName: 'New' })
        );
        await fs.writeFile(
            path.join(source, 'data', 'facts.json'),
            JSON.stringify({ fact: 'new' })
        );
        await fs.mkdir(destination);
        await fs.writeFile(
            path.join(destination, 'metadata.json'),
            JSON.stringify({ lastAudit: new Date().toISOString(), version: '1.0.0' })
        );
        await fs.writeFile(path.join(destination, 'old.txt'), 'old');
        process.env.TARS_HOME = source;
        await exportBrain({ output: archive });
        process.env.TARS_HOME = destination;

        // ACT
        const backupPath = await importBrain(archive);

        // ASSERT
        expect(
            JSON.parse(await fs.readFile(path.join(destination, 'data', 'facts.json'), 'utf8'))
        ).toEqual({ fact: 'new' });
        expect(backupPath).toBeDefined();
        if (!backupPath) throw new Error('Expected the previous brain to be backed up.');
        expect(await fs.readFile(path.join(backupPath, 'old.txt'), 'utf8')).toBe('old');
        const importedMetadata: unknown = JSON.parse(
            await fs.readFile(path.join(destination, 'metadata.json'), 'utf8')
        );
        const packageMetadata = z
            .object({ version: z.string() })
            .parse(JSON.parse(await fs.readFile(path.join(process.cwd(), 'package.json'), 'utf8')));
        expect(importedMetadata).toMatchObject({
            installationId: 'preserved-installation',
            version: packageMetadata.version
        });
        expect((await fs.stat(path.join(destination, 'metadata.json'))).mode & 0o777).toBe(0o600);
    });

    it('round-trips a custom extension with offline artifacts and token-named directories', async () => {
        // ARRANGE
        const root = await makeTemporaryDirectory();
        const source = path.join(root, 'source');
        const destination = path.join(root, 'destination');
        const archive = path.join(root, 'offline-extension.tar.gz');
        const extension = path.join(source, 'extensions', 'custom-token-tools');
        await fs.mkdir(path.join(source, 'data'), { recursive: true });
        await fs.mkdir(path.join(extension, 'dist'), { recursive: true });
        await fs.mkdir(path.join(extension, 'node_modules', 'offline-dependency'), {
            recursive: true
        });
        await fs.mkdir(path.join(extension, 'token'), { recursive: true });
        await fs.writeFile(
            path.join(source, 'metadata.json'),
            JSON.stringify({ lastAudit: new Date().toISOString(), version: '1.0.0' })
        );
        await fs.writeFile(path.join(source, 'config.json'), '{}');
        await fs.writeFile(path.join(extension, 'dist', 'server.js'), 'export const ready = true;');
        await fs.writeFile(
            path.join(extension, 'node_modules', 'offline-dependency', 'package.json'),
            JSON.stringify({ name: 'offline-dependency', token: 'parser-token' })
        );
        await fs.writeFile(
            path.join(extension, 'node_modules', 'offline-dependency', 'credentials.json'),
            JSON.stringify({ fixture: 'required-offline-data' })
        );
        await fs.symlink(
            'offline-dependency',
            path.join(extension, 'node_modules', 'offline-dependency-link')
        );
        await fs.writeFile(path.join(extension, 'token', 'index.js'), 'export const parse = true;');
        process.env.TARS_HOME = source;
        await exportBrain({ output: archive });
        process.env.TARS_HOME = destination;

        // ACT
        await importBrain(archive);

        // ASSERT
        expect(
            await fs.readFile(
                path.join(destination, 'extensions', 'custom-token-tools', 'dist', 'server.js'),
                'utf8'
            )
        ).toContain('ready');
        expect(
            JSON.parse(
                await fs.readFile(
                    path.join(
                        destination,
                        'extensions',
                        'custom-token-tools',
                        'node_modules',
                        'offline-dependency',
                        'package.json'
                    ),
                    'utf8'
                )
            )
        ).toEqual({ name: 'offline-dependency', token: 'parser-token' });
        expect(
            JSON.parse(
                await fs.readFile(
                    path.join(
                        destination,
                        'extensions',
                        'custom-token-tools',
                        'node_modules',
                        'offline-dependency',
                        'credentials.json'
                    ),
                    'utf8'
                )
            )
        ).toEqual({ fixture: 'required-offline-data' });
        const dependencyLink = path.join(
            destination,
            'extensions',
            'custom-token-tools',
            'node_modules',
            'offline-dependency-link'
        );
        expect((await fs.lstat(dependencyLink)).isSymbolicLink()).toBe(true);
        expect(await fs.readlink(dependencyLink)).toBe('offline-dependency');
        expect(
            await fs.readFile(
                path.join(destination, 'extensions', 'custom-token-tools', 'token', 'index.js'),
                'utf8'
            )
        ).toContain('parse');
    });

    it('rejects malformed core JSON before replacing the live brain', async () => {
        // ARRANGE
        const root = await makeTemporaryDirectory();
        const source = path.join(root, 'invalid-source');
        const destination = path.join(root, 'destination');
        const archive = path.join(root, 'invalid-core.tar.gz');
        await fs.mkdir(path.join(source, 'data'), { recursive: true });
        await fs.mkdir(destination);
        await fs.writeFile(
            path.join(source, 'metadata.json'),
            JSON.stringify({ lastAudit: new Date().toISOString(), version: '1.0.0' })
        );
        await fs.writeFile(path.join(source, 'config.json'), '{}');
        await fs.writeFile(path.join(source, 'data', 'session.json'), '{ invalid json');
        await fs.writeFile(
            path.join(destination, 'metadata.json'),
            JSON.stringify({ lastAudit: new Date().toISOString(), version: '1.0.0' })
        );
        await fs.writeFile(path.join(destination, 'old.txt'), 'preserved');
        execFileSync('tar', ['-czf', archive, '-C', root, '--', path.basename(source)]);
        process.env.TARS_HOME = destination;

        // ACT
        const operation = importBrain(archive);

        // ASSERT
        await expect(operation).rejects.toThrow(/data\/session\.json contains invalid JSON/);
        expect(await fs.readFile(path.join(destination, 'old.txt'), 'utf8')).toBe('preserved');
    });

    it('rejects an archive without all recognizable Tars core paths', async () => {
        // ARRANGE
        const root = await makeTemporaryDirectory();
        const source = path.join(root, 'incomplete-source');
        const archive = path.join(root, 'incomplete.tar.gz');
        await fs.mkdir(path.join(source, 'data'), { recursive: true });
        await fs.writeFile(path.join(source, 'config.json'), '{}');
        execFileSync('tar', ['-czf', archive, '-C', root, '--', path.basename(source)]);
        process.env.TARS_HOME = path.join(root, 'destination');

        // ACT / ASSERT
        await expect(importBrain(archive)).rejects.toThrow(
            /metadata\.json, config\.json, and a data directory/
        );
    });

    it('accepts one normalized root and rejects traversal and multiple roots', () => {
        // ARRANGE / ACT
        const manifest = validateArchiveMembers(['brain/', 'brain/data/', 'brain/data/facts.json']);

        // ASSERT
        expect(manifest.rootName).toBe('brain');
        expect(() => validateArchiveMembers(['brain/', '../escape'])).toThrow(/Unsafe archive/);
        expect(() => validateArchiveMembers(['brain/', 'other/file'])).toThrow(/one top-level/);
    });

    it('totals BSD and GNU tar entry sizes and enforces the aggregate cap', () => {
        // ARRANGE
        const manifest = validateArchiveMembers(['brain/', 'brain/a.txt', 'brain/b.txt']);
        const verboseEntries = [
            'drwx------  0 user group 0 Jul 17 10:00 brain/',
            '-rw------- user/group 4 2026-07-17 10:00 brain/a.txt',
            '-rw-------  0 user group 5 Jul 17 10:00 brain/b.txt'
        ];

        // ACT
        const total = validateArchiveUncompressedSize(manifest, verboseEntries, 9);

        // ASSERT
        expect(total).toBe(9);
        expect(() => validateArchiveUncompressedSize(manifest, verboseEntries, 8)).toThrow(
            /uncompressed safety limit/
        );
    });

    it('rejects symbolic links that escape the archive root', () => {
        // ARRANGE
        const manifest = validateArchiveMembers(['brain/', 'brain/link']);
        const verboseEntries = [
            'drwx------ user/group 0 2026-01-01 00:00 brain/',
            'lrwxr-xr-x user/group 0 2026-01-01 00:00 brain/link -> ../../etc/passwd'
        ];

        // ACT / ASSERT
        expect(() => validateArchiveEntryTypes(manifest, verboseEntries)).toThrow(/escapes/);
    });
});

describe('uninstall target validation', () => {
    it('accepts marked Tars homes and rejects unmarked or protected directories', async () => {
        // ARRANGE
        const root = await makeTemporaryDirectory();
        const marked = path.join(root, 'marked');
        const isolatedHome = path.join(root, '.tars');
        const unmarked = path.join(root, 'unmarked');
        const workspace = path.join(root, 'workspace');
        await Promise.all([
            fs.mkdir(marked),
            fs.mkdir(isolatedHome),
            fs.mkdir(unmarked),
            fs.mkdir(workspace)
        ]);
        await fs.writeFile(
            path.join(marked, 'metadata.json'),
            JSON.stringify({ lastAudit: new Date().toISOString(), version: '1.0.0' })
        );
        await fs.copyFile(
            path.join(marked, 'metadata.json'),
            path.join(isolatedHome, 'metadata.json')
        );

        // ACT
        const markedResult = validateUninstallTarget(marked, path.join(root, 'home'), workspace);
        const unmarkedResult = validateUninstallTarget(
            unmarked,
            path.join(root, 'home'),
            workspace
        );
        const homeResult = validateUninstallTarget(root, root, workspace);
        const workspaceResult = validateUninstallTarget(
            workspace,
            path.join(root, 'home'),
            workspace
        );
        const isolatedHomeResult = validateUninstallTarget(isolatedHome, isolatedHome, workspace);

        // ASSERT
        expect(markedResult.safe).toBe(true);
        expect(unmarkedResult.safe).toBe(false);
        expect(homeResult.safe).toBe(false);
        expect(workspaceResult.safe).toBe(false);
        expect(isolatedHomeResult.safe).toBe(true);
    });
});

describe('PM2 lifecycle scoping', () => {
    it('operates on marked and strict legacy Tars processes without touching inherited apps', async () => {
        // ARRANGE
        const root = await makeTemporaryDirectory();
        const selectedHome = path.join(root, 'selected');
        const otherHome = path.join(root, 'other');
        await Promise.all([fs.mkdir(selectedHome), fs.mkdir(otherHome)]);
        const dashboardDirectory = path.join(selectedHome, 'apps', 'dashboard');
        pm2Mocks.list.mockImplementation(
            (callback: (error: Error | null, processes: unknown[]) => void) =>
                callback(null, [
                    {
                        name: 'personal-assistant',
                        pm2_env: {
                            status: 'online',
                            TARS_HOME: selectedHome,
                            TARS_INSTANCE_ROLE: 'Home',
                            TARS_MANAGED_PROCESS: 'true',
                            TARS_PROCESS_KIND: 'supervisor',
                            TARS_SUPERVISOR_MODE: 'true'
                        }
                    },
                    {
                        name: 'personal-assistant-dash',
                        pm2_env: {
                            status: 'online',
                            TARS_HOME: selectedHome,
                            TARS_MANAGED_PROCESS: 'true',
                            TARS_PROCESS_KIND: 'dashboard'
                        }
                    },
                    {
                        name: 'legacy-assistant',
                        pm2_env: {
                            status: 'online',
                            TARS_HOME: selectedHome,
                            TARS_SUPERVISOR_MODE: 'true',
                            pm_exec_path: path.join(
                                root,
                                'package',
                                'dist',
                                'supervisor',
                                'main.js'
                            )
                        }
                    },
                    {
                        name: 'legacy-assistant-dash',
                        pm2_env: {
                            status: 'online',
                            TARS_HOME: selectedHome,
                            pm_cwd: dashboardDirectory,
                            pm_exec_path: path.join(dashboardDirectory, 'server.js')
                        }
                    },
                    {
                        name: 'legacy-assistant-tunnel',
                        pm2_env: {
                            status: 'online',
                            TARS_HOME: selectedHome,
                            pm_exec_path: '/usr/local/bin/cloudflared'
                        }
                    },
                    {
                        name: 'inherited-worker',
                        pm2_env: {
                            status: 'online',
                            TARS_HOME: selectedHome,
                            TARS_SUPERVISOR_MODE: 'true',
                            pm_exec_path: path.join(root, 'worker.js')
                        }
                    },
                    {
                        name: 'inherited-worker-dash',
                        pm2_env: {
                            status: 'online',
                            TARS_HOME: selectedHome,
                            pm_cwd: selectedHome,
                            pm_exec_path: path.join(root, 'server.js')
                        }
                    },
                    {
                        name: 'incomplete-marker',
                        pm2_env: {
                            status: 'online',
                            TARS_HOME: selectedHome,
                            TARS_MANAGED_PROCESS: 'true',
                            TARS_SUPERVISOR_MODE: 'true',
                            pm_exec_path: path.join(
                                root,
                                'package',
                                'dist',
                                'supervisor',
                                'main.js'
                            )
                        }
                    },
                    {
                        name: 'work-assistant',
                        pm2_env: {
                            status: 'online',
                            TARS_HOME: otherHome,
                            TARS_MANAGED_PROCESS: 'true',
                            TARS_PROCESS_KIND: 'supervisor',
                            TARS_SUPERVISOR_MODE: 'true'
                        }
                    }
                ])
        );

        // ACT
        const matches = await findTarsProcessesByHome(selectedHome);
        await stopTarsProcessNames(matches.map(({ name }) => name));
        const restarted = await restartActiveTarsProcessesByHome(selectedHome);
        const removed = await deleteTarsProcessesByHome(selectedHome);

        // ASSERT
        expect(matches.map(({ name }) => name)).toEqual([
            'personal-assistant',
            'personal-assistant-dash',
            'legacy-assistant',
            'legacy-assistant-dash',
            'legacy-assistant-tunnel'
        ]);
        expect(matches.filter(({ legacy }) => legacy).map(({ kind }) => kind)).toEqual([
            'supervisor',
            'dashboard',
            'tunnel'
        ]);
        expect(matches.find(({ name }) => name.endsWith('-dash'))?.isSupervisor).toBe(false);
        expect(restarted).toEqual(matches);
        expect(removed).toEqual(matches);
        expect(pm2Mocks.stop).toHaveBeenCalledTimes(5);
        expect(pm2Mocks.restart).toHaveBeenCalledTimes(5);
        expect(pm2Mocks.delete).toHaveBeenCalledTimes(5);
        expect(pm2Mocks.restart.mock.calls.map(([name]) => name)).toEqual([
            'personal-assistant-dash',
            'legacy-assistant-dash',
            'legacy-assistant-tunnel',
            'personal-assistant',
            'legacy-assistant'
        ]);
        expect(pm2Mocks.delete.mock.calls.map(([name]) => name)).toEqual([
            'personal-assistant-dash',
            'legacy-assistant-dash',
            'legacy-assistant-tunnel',
            'personal-assistant',
            'legacy-assistant'
        ]);
        for (const unrelatedName of [
            'inherited-worker',
            'inherited-worker-dash',
            'incomplete-marker',
            'work-assistant'
        ]) {
            expect(pm2Mocks.stop).not.toHaveBeenCalledWith(unrelatedName, expect.any(Function));
            expect(pm2Mocks.restart).not.toHaveBeenCalledWith(unrelatedName, expect.any(Function));
            expect(pm2Mocks.delete).not.toHaveBeenCalledWith(unrelatedName, expect.any(Function));
        }
    });

    it('restarts only active processes and preserves intentionally stopped entries', async () => {
        // ARRANGE
        const root = await makeTemporaryDirectory();
        await fs.mkdir(path.join(root, 'brain'));
        const brain = path.join(root, 'brain');
        pm2Mocks.list.mockImplementation(
            (callback: (error: Error | null, processes: unknown[]) => void) =>
                callback(null, [
                    {
                        name: 'custom-name',
                        pm2_env: {
                            status: 'online',
                            TARS_HOME: brain,
                            TARS_MANAGED_PROCESS: 'true',
                            TARS_PROCESS_KIND: 'supervisor',
                            TARS_SUPERVISOR_MODE: 'true'
                        }
                    },
                    {
                        name: 'custom-name-dash',
                        pm2_env: {
                            status: 'stopped',
                            TARS_HOME: brain,
                            TARS_MANAGED_PROCESS: 'true',
                            TARS_PROCESS_KIND: 'dashboard'
                        }
                    }
                ])
        );

        // ACT
        const restarted = await restartActiveTarsProcessesByHome(brain);

        // ASSERT
        expect(restarted.map(({ name }) => name)).toEqual(['custom-name']);
        expect(pm2Mocks.restart).toHaveBeenCalledTimes(1);
        expect(pm2Mocks.restart).toHaveBeenCalledWith('custom-name', expect.any(Function));
    });

    it('refuses to start a background engine while foreground chat owns the home', async () => {
        // ARRANGE
        const root = await makeTemporaryDirectory();
        const brain = path.join(root, 'brain');
        await fs.mkdir(brain);
        process.env.TARS_HOME = brain;
        const lease = await acquireForegroundChatLease(brain);

        try {
            // ACT
            const operation = start({ name: 'blocked-tars', role: 'Primary' });

            // ASSERT
            await expect(operation).rejects.toThrow(/foreground chat/);
            expect(pm2Mocks.start).not.toHaveBeenCalled();
        } finally {
            await lease.release();
        }
    });

    it('rejects every destructive lifecycle command while foreground chat owns the home', async () => {
        // ARRANGE
        const root = await makeTemporaryDirectory();
        const brain = path.join(root, 'brain');
        await fs.mkdir(path.join(brain, 'data'), { recursive: true });
        await fs.writeFile(path.join(brain, 'config.json'), '{}');
        await fs.writeFile(
            path.join(brain, 'metadata.json'),
            JSON.stringify({ lastAudit: new Date().toISOString(), version: '1.0.0' })
        );
        process.env.TARS_HOME = brain;
        const lease = await acquireForegroundChatLease(brain);
        const { refresh } = await import('../../cli/commands/refresh.js');
        const { restart } = await import('../../cli/commands/restart.js');
        const { setup } = await import('../../cli/commands/setup.js');
        const { stop } = await import('../../cli/commands/stop.js');
        const { update } = await import('../../cli/commands/update.js');
        const operations: ReadonlyArray<() => Promise<unknown>> = [
            () => exportBrain({ output: path.join(root, 'brain.tar.gz') }),
            () => importBrain(path.join(root, 'missing.tar.gz')),
            () => stop(),
            () => restart(),
            () => refresh({ silent: true }),
            () => update(),
            () => uninstall(),
            () => setup()
        ];

        try {
            // ACT / ASSERT
            for (const operation of operations) {
                await expect(operation()).rejects.toThrow(/foreground chat/);
            }
        } finally {
            await lease.release();
        }
    });

    it('serializes concurrent starts that use canonical aliases for the same home', async () => {
        // ARRANGE
        const root = await makeTemporaryDirectory();
        const brain = path.join(root, 'brain');
        const brainAlias = path.join(root, 'brain-alias');
        await fs.mkdir(brain);
        await fs.symlink(brain, brainAlias, 'dir');

        let activeProcesses: unknown[] = [];
        pm2Mocks.list.mockImplementation(
            (callback: (error: Error | null, processes: unknown[]) => void) =>
                callback(null, activeProcesses)
        );

        let signalFirstStart: (() => void) | undefined;
        const firstStartReachedPm2 = new Promise<void>((resolve) => {
            signalFirstStart = resolve;
        });
        let releaseFirstStart: (() => void) | undefined;
        const firstStartGate = new Promise<void>((resolve) => {
            releaseFirstStart = resolve;
        });
        pm2Mocks.start.mockImplementationOnce(
            (_options: unknown, callback: (error: Error | null, processes: unknown[]) => void) => {
                signalFirstStart?.();
                void firstStartGate.then(() => {
                    activeProcesses = [
                        {
                            name: 'first-tars',
                            pm2_env: {
                                status: 'online',
                                TARS_HOME: brain,
                                TARS_MANAGED_PROCESS: 'true',
                                TARS_PROCESS_KIND: 'supervisor',
                                TARS_SUPERVISOR_MODE: 'true'
                            }
                        }
                    ];
                    callback(null, []);
                });
            }
        );

        process.env.TARS_HOME = brain;
        const firstStart = start({ name: 'first-tars', role: 'Primary' });
        await firstStartReachedPm2;

        process.env.TARS_HOME = brainAlias;
        const secondStart = start({ name: 'second-tars', role: 'Secondary' });
        let secondStartSettled = false;
        void secondStart.then(
            () => {
                secondStartSettled = true;
            },
            () => {
                secondStartSettled = true;
            }
        );
        await new Promise<void>((resolve) => setImmediate(resolve));

        // ACT
        expect(pm2Mocks.start).toHaveBeenCalledTimes(1);
        expect(pm2Mocks.list).toHaveBeenCalledTimes(1);
        expect(secondStartSettled).toBe(false);
        releaseFirstStart?.();
        await firstStart;

        // ASSERT
        await expect(secondStart).rejects.toThrow(/already active as \[first-tars\]/);
        expect(pm2Mocks.start).toHaveBeenCalledTimes(1);
        expect(fsSync.existsSync(path.join(brain, STARTUP_LOCK_FILE_NAME))).toBe(false);
    });

    it('recovers an abandoned stale startup lock before starting', async () => {
        // ARRANGE
        const root = await makeTemporaryDirectory();
        const brain = path.join(root, 'brain');
        await fs.mkdir(brain);
        const lockPath = path.join(brain, STARTUP_LOCK_FILE_NAME);
        await fs.writeFile(lockPath, 'abandoned partial lock');
        const staleTime = new Date(Date.now() - 60_000);
        await fs.utimes(lockPath, staleTime, staleTime);
        process.env.TARS_HOME = brain;

        // ACT
        await start({ name: 'recovered-tars', role: 'Primary' });

        // ASSERT
        expect(pm2Mocks.start).toHaveBeenCalledTimes(1);
        expect(pm2Mocks.start).toHaveBeenCalledWith(
            expect.objectContaining({
                env: expect.objectContaining({
                    TARS_HOME: brain,
                    TARS_MANAGED_PROCESS: 'true',
                    TARS_PROCESS_KIND: 'supervisor'
                })
            }),
            expect.any(Function)
        );
        expect(fsSync.existsSync(lockPath)).toBe(false);
    });
});
