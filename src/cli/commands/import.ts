import { execFile } from 'child_process';
import fs from 'fs';
import fsp from 'fs/promises';
import os from 'os';
import path from 'path';
import { randomUUID } from 'crypto';
import chalk from 'chalk';
import { z } from 'zod';
import { ConfigFileSchema } from '../../config/schema.js';
import { BrainAuditor } from '../../utils/brain-audit.js';
import { getTarsHome } from '../../utils/paths.js';
import { assertTarsHomeInactive } from '../../utils/pm2-processes.js';
import { withTarsHomeMutationLease } from '../../utils/tars-home-lease.js';

const maximumArchiveEntries = 100_000;
const maximumArchiveBytes = 5 * 1024 * 1024 * 1024;
export const maximumArchiveUncompressedBytes = 10 * 1024 * 1024 * 1024;
const maximumListingBuffer = 64 * 1024 * 1024;
const TAR_COMMAND_TIMEOUT_MS = 5 * 60 * 1000;
const metadataSchema = z
    .object({
        lastAudit: z.string().datetime(),
        version: z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/)
    })
    .passthrough();
const coreJsonSchema = z.union([z.record(z.unknown()), z.array(z.unknown())]);

export interface ArchiveManifest {
    members: string[];
    rootName: string;
}

function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function isPathInside(rootPath: string, candidatePath: string): boolean {
    const relative = path.relative(rootPath, candidatePath);
    return (
        relative === '' ||
        (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
    );
}

function assertSafeImportTarget(tarsHome: string): void {
    const target = path.resolve(tarsHome);
    const reportedHome = path.resolve(process.env.REAL_HOME || os.homedir());
    const userHome =
        path.basename(reportedHome) === '.tars' ? path.dirname(reportedHome) : reportedHome;
    const workspace = path.resolve(process.cwd());

    if (target === path.parse(target).root || target === userHome) {
        throw new Error('Refusing to import into a filesystem root or user home directory.');
    }
    if (target === workspace || isPathInside(target, workspace)) {
        throw new Error('Refusing to import into or over the current workspace.');
    }
}

function normalizeArchiveMember(member: string): string {
    const withoutTrailingSlash = member.endsWith('/') ? member.slice(0, -1) : member;
    if (
        !withoutTrailingSlash ||
        withoutTrailingSlash.includes('\\') ||
        /[\0-\x1f\x7f]/.test(withoutTrailingSlash) ||
        path.posix.isAbsolute(withoutTrailingSlash) ||
        path.win32.isAbsolute(withoutTrailingSlash) ||
        /^[A-Za-z]:/.test(withoutTrailingSlash)
    ) {
        throw new Error(`Unsafe archive member: ${JSON.stringify(member)}`);
    }

    const segments = withoutTrailingSlash.split('/');
    if (segments.some((segment) => !segment || segment === '.' || segment === '..')) {
        throw new Error(`Unsafe archive member: ${JSON.stringify(member)}`);
    }

    const normalized = path.posix.normalize(withoutTrailingSlash);
    if (normalized !== withoutTrailingSlash) {
        throw new Error(`Ambiguous archive member: ${JSON.stringify(member)}`);
    }
    return normalized;
}

export function validateArchiveMembers(members: string[]): ArchiveManifest {
    if (members.length === 0) throw new Error('The archive is empty.');
    if (members.length > maximumArchiveEntries) {
        throw new Error(`Archive contains more than ${maximumArchiveEntries} entries.`);
    }

    const normalizedMembers = members.map(normalizeArchiveMember);
    const rootName = normalizedMembers[0].split('/')[0];
    if (normalizedMembers.some((member) => member.split('/')[0] !== rootName)) {
        throw new Error('Archive must contain exactly one top-level Tars directory.');
    }
    if (new Set(normalizedMembers).size !== normalizedMembers.length) {
        throw new Error('Archive contains duplicate or ambiguous member names.');
    }

    return { members: normalizedMembers, rootName };
}

export function validateArchiveEntryTypes(
    manifest: ArchiveManifest,
    verboseEntries: string[]
): void {
    if (verboseEntries.length !== manifest.members.length) {
        throw new Error('Unable to verify every archive entry.');
    }

    verboseEntries.forEach((entry, index) => {
        const entryType = entry[0];
        if (entryType === '-' || entryType === 'd') return;
        if (entryType !== 'l') {
            throw new Error('Archive contains an unsupported special file or hard link.');
        }

        const member = manifest.members[index];
        const marker = `${member} -> `;
        const markerIndex = entry.lastIndexOf(marker);
        if (markerIndex < 0) throw new Error('Unable to validate an archive symbolic link.');

        const target = entry.slice(markerIndex + marker.length);
        if (
            !target ||
            target.includes('\\') ||
            /[\0-\x1f\x7f]/.test(target) ||
            path.posix.isAbsolute(target) ||
            path.win32.isAbsolute(target) ||
            /^[A-Za-z]:/.test(target)
        ) {
            throw new Error(`Unsafe symbolic link target in archive: ${JSON.stringify(target)}`);
        }

        const resolvedTarget = path.posix.normalize(
            path.posix.join(path.posix.dirname(member), target)
        );
        if (
            resolvedTarget !== manifest.rootName &&
            !resolvedTarget.startsWith(`${manifest.rootName}/`)
        ) {
            throw new Error('Archive symbolic link escapes the Tars directory.');
        }
    });
}

function archiveEntryMetadata(entry: string, member: string): string[] {
    const entryType = entry[0];
    const memberMarker = entryType === 'l' ? `${member} -> ` : ` ${member}`;
    const memberIndex = entry.lastIndexOf(memberMarker);
    if (memberIndex < 0) {
        throw new Error(`Unable to read archive metadata for ${JSON.stringify(member)}.`);
    }

    return entry.slice(0, memberIndex).trim().split(/\s+/);
}

function parseArchiveEntrySize(entry: string, member: string): number {
    const metadata = archiveEntryMetadata(entry, member);
    const isoDateIndex = metadata.findIndex((token) => /^\d{4}-\d{2}-\d{2}$/.test(token));
    const sizeIndex = isoDateIndex > 0 ? isoDateIndex - 1 : metadata.length - 4;
    const size = Number(metadata[sizeIndex]);
    if (!Number.isSafeInteger(size) || size < 0) {
        throw new Error(`Unable to determine archive size for ${JSON.stringify(member)}.`);
    }
    return size;
}

export function validateArchiveUncompressedSize(
    manifest: ArchiveManifest,
    verboseEntries: string[],
    maximumBytes = maximumArchiveUncompressedBytes
): number {
    if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 0) {
        throw new Error('Archive size limit must be a non-negative safe integer.');
    }
    if (verboseEntries.length !== manifest.members.length) {
        throw new Error('Unable to verify the size of every archive entry.');
    }

    let aggregateBytes = 0;
    verboseEntries.forEach((entry, index) => {
        const entryBytes = parseArchiveEntrySize(entry, manifest.members[index]);
        if (entryBytes > maximumBytes - aggregateBytes) {
            throw new Error(
                `Archive expands beyond the ${maximumBytes}-byte uncompressed safety limit.`
            );
        }
        aggregateBytes += entryBytes;
    });
    return aggregateBytes;
}

function runTar(args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
        execFile(
            'tar',
            args,
            {
                encoding: 'utf8',
                maxBuffer: maximumListingBuffer,
                timeout: TAR_COMMAND_TIMEOUT_MS
            },
            (error, stdout) => {
                if (error) {
                    reject(new Error(`tar failed: ${getErrorMessage(error)}`));
                    return;
                }
                resolve(stdout);
            }
        );
    });
}

async function readArchiveManifest(archivePath: string): Promise<ArchiveManifest> {
    const memberOutput = await runTar(['-tzf', archivePath]);
    const members = memberOutput.split('\n').filter((member) => member.length > 0);
    const manifest = validateArchiveMembers(members);

    const verboseOutput = await runTar(['-tvzf', archivePath]);
    const verboseEntries = verboseOutput.split('\n').filter((entry) => entry.length > 0);
    validateArchiveEntryTypes(manifest, verboseEntries);
    validateArchiveUncompressedSize(manifest, verboseEntries);
    return manifest;
}

async function validateExtractedTree(directoryPath: string, realRoot?: string): Promise<void> {
    const canonicalRoot = realRoot || (await fsp.realpath(directoryPath));
    const entries = await fsp.readdir(directoryPath, { withFileTypes: true });
    for (const entry of entries) {
        const entryPath = path.join(directoryPath, entry.name);
        const stats = await fsp.lstat(entryPath);
        if (stats.isSymbolicLink()) {
            const realPath = await fsp.realpath(entryPath);
            if (!isPathInside(canonicalRoot, realPath)) {
                throw new Error('Extracted archive contains a symbolic link outside its root.');
            }
            continue;
        }
        if (stats.isDirectory()) await validateExtractedTree(entryPath, canonicalRoot);
        if (!stats.isDirectory() && !stats.isFile()) {
            throw new Error('Extracted archive contains an unsupported special file.');
        }
    }
}

async function readCoreJson(filePath: string, label: string): Promise<unknown> {
    const stats = await fsp.lstat(filePath);
    if (!stats.isFile() || stats.isSymbolicLink()) {
        throw new Error(`Archive ${label} must be a regular JSON file.`);
    }

    try {
        return JSON.parse(await fsp.readFile(filePath, 'utf8'));
    } catch {
        throw new Error(`Archive ${label} contains invalid JSON.`);
    }
}

async function validateImportedBrain(stagedHome: string): Promise<void> {
    await validateExtractedTree(stagedHome);

    const metadataPath = path.join(stagedHome, 'metadata.json');
    const configPath = path.join(stagedHome, 'config.json');
    const dataPath = path.join(stagedHome, 'data');
    if (!fs.existsSync(metadataPath) || !fs.existsSync(configPath) || !fs.existsSync(dataPath)) {
        throw new Error('Archive must contain metadata.json, config.json, and a data directory.');
    }

    const dataStats = await fsp.lstat(dataPath);
    if (!dataStats.isDirectory() || dataStats.isSymbolicLink()) {
        throw new Error('Archive data must be a real directory.');
    }

    const metadata: unknown = await readCoreJson(metadataPath, 'metadata.json');
    if (!metadataSchema.safeParse(metadata).success) {
        throw new Error('Archive metadata.json does not contain valid Tars metadata.');
    }

    const config: unknown = await readCoreJson(configPath, 'config.json');
    if (!ConfigFileSchema.safeParse(config).success) {
        throw new Error('Archive config.json must contain a JSON object.');
    }

    const optionalCoreJsonPaths = [
        'data/session.json',
        'data/tasks.json',
        'data/memory/facts.json',
        'extensions/extension-enablement.json'
    ];
    for (const relativePath of optionalCoreJsonPaths) {
        const filePath = path.join(stagedHome, relativePath);
        if (!fs.existsSync(filePath)) continue;
        const value: unknown = await readCoreJson(filePath, relativePath);
        if (!coreJsonSchema.safeParse(value).success) {
            throw new Error(`Archive ${relativePath} must contain a JSON object or array.`);
        }
    }

    const secretsPath = path.join(stagedHome, '.env');
    if (fs.existsSync(secretsPath)) await fsp.chmod(secretsPath, 0o600);
    await new BrainAuditor(stagedHome).audit({ repair: true, silent: true });
}

function backupName(tarsHome: string): string {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    return `${tarsHome}.backup-${timestamp}-${randomUUID().slice(0, 8)}`;
}

export async function importBrain(archivePath: string): Promise<string | undefined> {
    const tarsHome = path.resolve(getTarsHome());
    return withTarsHomeMutationLease(tarsHome, 'import a Tars brain', () =>
        importBrainWithLease(tarsHome, archivePath)
    );
}

async function importBrainWithLease(
    tarsHome: string,
    archivePath: string
): Promise<string | undefined> {
    const fullPath = path.resolve(archivePath);
    const parentDir = path.dirname(tarsHome);
    assertSafeImportTarget(tarsHome);

    if (!fs.existsSync(fullPath)) {
        throw new Error(`Import archive is not a regular file: ${fullPath}`);
    }
    const archiveStats = await fsp.lstat(fullPath);
    if (!archiveStats.isFile() || archiveStats.isSymbolicLink()) {
        throw new Error(`Import archive is not a regular file: ${fullPath}`);
    }
    if (archiveStats.size > maximumArchiveBytes) {
        throw new Error('Import archive exceeds the 5 GiB safety limit.');
    }
    if (fs.existsSync(tarsHome)) {
        const targetStats = await fsp.lstat(tarsHome);
        if (!targetStats.isDirectory() || targetStats.isSymbolicLink()) {
            throw new Error('Refusing to replace a non-directory or symbolic-link Tars home.');
        }
        assertSafeImportTarget(await fsp.realpath(tarsHome));
        try {
            const markerPath = path.join(tarsHome, 'metadata.json');
            const markerStats = await fsp.lstat(markerPath);
            if (!markerStats.isFile() || markerStats.isSymbolicLink()) {
                throw new Error('Invalid marker');
            }
            const marker: unknown = JSON.parse(await fsp.readFile(markerPath, 'utf8'));
            if (!metadataSchema.safeParse(marker).success) throw new Error('Invalid marker');
        } catch {
            throw new Error(
                'Refusing to replace an existing directory without valid Tars metadata.'
            );
        }
    }
    await assertTarsHomeInactive(tarsHome, 'import a brain');

    console.log(chalk.cyan(`📥 Importing Tars brain from ${fullPath}...`));
    await fsp.mkdir(parentDir, { recursive: true });
    const realDestination = path.join(await fsp.realpath(parentDir), path.basename(tarsHome));
    assertSafeImportTarget(realDestination);

    const stagingRoot = await fsp.mkdtemp(path.join(parentDir, '.tars-import-'));
    const stagedArchive = path.join(stagingRoot, 'archive.tar.gz');
    const stagedHome = path.join(stagingRoot, 'payload');
    let backupPath: string | undefined;
    let liveSwapComplete = false;

    try {
        // Work from a private snapshot so a concurrently replaced or modified
        // source archive cannot differ between preflight and extraction.
        await fsp.copyFile(fullPath, stagedArchive, fs.constants.COPYFILE_EXCL);
        await fsp.chmod(stagedArchive, 0o600);
        const stagedArchiveStats = await fsp.lstat(stagedArchive);
        if (!stagedArchiveStats.isFile() || stagedArchiveStats.size > maximumArchiveBytes) {
            throw new Error('Import archive exceeds the 5 GiB safety limit.');
        }
        await readArchiveManifest(stagedArchive);

        await fsp.mkdir(stagedHome, { mode: 0o700 });
        await runTar([
            '-xzf',
            stagedArchive,
            '-C',
            stagedHome,
            '--strip-components=1',
            '--no-same-owner'
        ]);
        await validateImportedBrain(stagedHome);

        if (fs.existsSync(tarsHome)) {
            backupPath = backupName(tarsHome);
            await fsp.rename(tarsHome, backupPath);
        }

        await fsp.rename(stagedHome, tarsHome);
        liveSwapComplete = true;

        console.log(chalk.green('\n✅ Brain imported successfully!'));
        if (backupPath) console.log(chalk.dim(`Previous brain backup: ${backupPath}`));
        console.log(`Tars is now restored. Run ${chalk.cyan('tars status')} to verify.`);
        return backupPath;
    } catch (error) {
        let rollbackError: unknown;
        try {
            if (liveSwapComplete) {
                await fsp.rm(tarsHome, { recursive: true, force: true });
            }
            if (backupPath) {
                if (fs.existsSync(tarsHome)) {
                    throw new Error('Import target was unexpectedly recreated during rollback.');
                }
                await fsp.rename(backupPath, tarsHome);
                backupPath = undefined;
            }
        } catch (caughtRollbackError) {
            rollbackError = caughtRollbackError;
        }

        const rollbackMessage = rollbackError
            ? ` Rollback also failed: ${getErrorMessage(rollbackError)}`
            : '';
        const failurePrefix = rollbackError ? 'Import and rollback failed' : 'Import failed safely';
        throw new Error(`${failurePrefix}: ${getErrorMessage(error)}${rollbackMessage}`);
    } finally {
        await fsp.rm(stagingRoot, { recursive: true, force: true });
    }
}
