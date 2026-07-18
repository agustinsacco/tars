import { execFile } from 'child_process';
import fs from 'fs';
import fsp from 'fs/promises';
import os from 'os';
import path from 'path';
import { randomUUID } from 'crypto';
import chalk from 'chalk';
import { getTarsHome } from '../../utils/paths.js';
import { DLPService } from '../../utils/dlp-service.js';
import { assertTarsHomeInactive } from '../../utils/pm2-processes.js';
import { withTarsHomeMutationLease } from '../../utils/tars-home-lease.js';

const TAR_COMMAND_TIMEOUT_MS = 5 * 60 * 1000;
const heavyDirectoryNames = new Set([
    '.cache',
    '.next',
    '.sass-cache',
    '.venv',
    'build',
    'dist',
    'logs',
    'node_modules',
    'target',
    'tmp',
    'vendor',
    'venv'
]);
const builtInExtensionNames = new Set(['tars-memory', 'tars-search', 'tars-tasks']);
const credentialFileNames = new Set([
    '.npmrc',
    'auth.json',
    'credentials.json',
    'models.json',
    'secrets.json'
]);
const credentialNamePattern = /(^|[._-])(credential|password|secret|token)([._-]|$)/i;
const credentialExtensionPattern = /\.(key|p12|pfx|pem)$/i;

export interface ExportOptions {
    output?: string;
    includeSecrets?: boolean;
}

function isPathInside(rootPath: string, candidatePath: string): boolean {
    const relative = path.relative(rootPath, candidatePath);
    return (
        relative === '' ||
        (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
    );
}

export function isSecretExportPath(relativePath: string): boolean {
    const normalized = path.basename(relativePath).toLowerCase();
    return (
        normalized === '.env' ||
        normalized.startsWith('.env.') ||
        normalized.endsWith('.log') ||
        credentialFileNames.has(normalized) ||
        credentialNamePattern.test(normalized) ||
        credentialExtensionPattern.test(normalized)
    );
}

function isHeavyExportPath(relativePath: string): boolean {
    const segments = relativePath.split(path.sep);
    if (
        segments[0] === 'extensions' &&
        segments.length > 1 &&
        !builtInExtensionNames.has(segments[1])
    ) {
        return segments.slice(2).some((segment) => ['.cache', 'logs', 'tmp'].includes(segment));
    }
    return segments.some((segment) => heavyDirectoryNames.has(segment));
}

function isOfflineExtensionArtifactPath(relativePath: string): boolean {
    const segments = relativePath.split(path.sep);
    return (
        segments[0] === 'extensions' &&
        segments.length > 2 &&
        !builtInExtensionNames.has(segments[1]) &&
        segments
            .slice(2)
            .some((segment) => ['build', 'dist', 'node_modules', 'vendor'].includes(segment))
    );
}

export function redactSensitiveValues(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value.map((entry) => redactSensitiveValues(entry));
    }
    if (!value || typeof value !== 'object') return value;

    const redacted: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
        if (!DLPService.isSensitiveKey(key)) {
            redacted[key] = redactSensitiveValues(entry);
        }
    }
    return redacted;
}

async function shouldCopyPath(
    tarsHome: string,
    realTarsHome: string,
    sourcePath: string,
    includeSecrets: boolean
): Promise<boolean> {
    const relativePath = path.relative(tarsHome, sourcePath);
    if (relativePath === '') return true;
    if (isHeavyExportPath(relativePath)) return false;

    const stats = await fsp.lstat(sourcePath);
    const isOfflineArtifact = isOfflineExtensionArtifactPath(relativePath);
    if (
        !includeSecrets &&
        !stats.isDirectory() &&
        !isOfflineArtifact &&
        isSecretExportPath(relativePath)
    ) {
        return false;
    }
    if (!stats.isSymbolicLink()) return true;

    try {
        const realPath = await fsp.realpath(sourcePath);
        return (
            isPathInside(realTarsHome, realPath) &&
            (includeSecrets ||
                isOfflineArtifact ||
                !isSecretExportPath(path.relative(realTarsHome, realPath)))
        );
    } catch {
        return false;
    }
}

function isOfflineExtensionArtifact(rootDirectory: string, filePath: string): boolean {
    return isOfflineExtensionArtifactPath(path.relative(rootDirectory, filePath));
}

async function redactJsonFiles(directory: string, rootDirectory = directory): Promise<void> {
    const entries = await fsp.readdir(directory, { withFileTypes: true });
    await Promise.all(
        entries.map(async (entry) => {
            const entryPath = path.join(directory, entry.name);
            if (entry.isDirectory()) {
                if (isOfflineExtensionArtifact(rootDirectory, entryPath)) return;
                await redactJsonFiles(entryPath, rootDirectory);
                return;
            }
            if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== '.json') return;
            if (isOfflineExtensionArtifact(rootDirectory, entryPath)) return;

            try {
                const stats = await fsp.stat(entryPath);
                if (stats.size > 10 * 1024 * 1024) return;
                const parsed: unknown = JSON.parse(await fsp.readFile(entryPath, 'utf8'));
                await fsp.writeFile(
                    entryPath,
                    `${JSON.stringify(redactSensitiveValues(parsed), null, 2)}\n`
                );
            } catch {
                // Non-JSON files with a .json suffix are copied as-is.
            }
        })
    );
}

function runTar(args: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
        execFile('tar', args, { timeout: TAR_COMMAND_TIMEOUT_MS }, (error) => {
            if (error) {
                reject(error);
                return;
            }
            resolve();
        });
    });
}

function defaultArchiveName(): string {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    return `tars-brain-${timestamp}.tar.gz`;
}

export async function exportBrain(options: ExportOptions = {}): Promise<string> {
    const tarsHome = path.resolve(getTarsHome());
    return withTarsHomeMutationLease(tarsHome, 'export the Tars brain', () =>
        exportBrainWithLease(tarsHome, options)
    );
}

async function exportBrainWithLease(tarsHome: string, options: ExportOptions): Promise<string> {
    const outputPath = options.output
        ? path.resolve(options.output)
        : path.join(process.cwd(), defaultArchiveName());
    const includeSecrets = options.includeSecrets === true;

    if (!fs.existsSync(tarsHome) || !(await fsp.lstat(tarsHome)).isDirectory()) {
        throw new Error(`Tars home is not a directory: ${tarsHome}`);
    }
    const realTarsHome = await fsp.realpath(tarsHome);
    const reportedHome = process.env.REAL_HOME || os.homedir();
    const userHome = reportedHome.endsWith(`${path.sep}.tars`)
        ? path.dirname(reportedHome)
        : reportedHome;
    const realUserHome = await fsp.realpath(userHome);
    if (realTarsHome === path.parse(realTarsHome).root || realTarsHome === realUserHome) {
        throw new Error('Refusing to export a filesystem root or user home directory.');
    }
    if (isPathInside(tarsHome, outputPath)) {
        throw new Error('Export destination must be outside the Tars home directory.');
    }
    if (fs.existsSync(outputPath)) {
        throw new Error(`Refusing to overwrite existing archive: ${outputPath}`);
    }
    await assertTarsHomeInactive(realTarsHome, 'export a potentially inconsistent brain');

    console.log(chalk.cyan(`📦 Exporting Tars brain to ${outputPath}...`));
    if (includeSecrets) {
        console.log(chalk.yellow('⚠️  This archive will include credentials and secret values.'));
    } else {
        console.log(
            chalk.yellow(
                '⚠️  Credential filtering is best-effort. Treat every export as sensitive data.'
            )
        );
    }

    await fsp.mkdir(path.dirname(outputPath), { recursive: true });
    const realOutputPath = path.join(
        await fsp.realpath(path.dirname(outputPath)),
        path.basename(outputPath)
    );
    if (isPathInside(realTarsHome, realOutputPath)) {
        throw new Error('Export destination resolves inside the Tars home directory.');
    }
    const stagingRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'tars-export-'));
    const stagedHome = path.join(stagingRoot, path.basename(tarsHome));
    const partialOutput = `${outputPath}.partial-${randomUUID()}`;

    try {
        await fsp.cp(tarsHome, stagedHome, {
            dereference: false,
            recursive: true,
            preserveTimestamps: true,
            verbatimSymlinks: true,
            filter: (sourcePath) =>
                shouldCopyPath(tarsHome, realTarsHome, sourcePath, includeSecrets)
        });

        if (!includeSecrets) await redactJsonFiles(stagedHome);

        const partialHandle = await fsp.open(partialOutput, 'wx', 0o600);
        await partialHandle.close();
        await runTar(['-czf', partialOutput, '-C', stagingRoot, '--', path.basename(stagedHome)]);
        await fsp.chmod(partialOutput, 0o600);
        await fsp.rename(partialOutput, outputPath);

        console.log(chalk.green('\n✅ Brain exported successfully!'));
        console.log(`Keep this file safe: ${chalk.bold(outputPath)}`);
        return outputPath;
    } finally {
        await fsp.rm(partialOutput, { force: true }).catch(() => undefined);
        await fsp.rm(stagingRoot, { recursive: true, force: true });
    }
}
