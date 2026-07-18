import { execFileSync, type ExecFileSyncOptions } from 'child_process';
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';
import chalk from 'chalk';
import ora from 'ora';
import { z } from 'zod';
import {
    findTarsProcessesByHome,
    restartTarsProcessNames,
    stopTarsProcessNames
} from '../../utils/pm2-processes.js';
import { getTarsHome } from '../../utils/paths.js';
import { withTarsHomeMutationLease } from '../../utils/tars-home-lease.js';

const packageSchema = z
    .object({
        scripts: z.record(z.string()).optional()
    })
    .passthrough();
const extensionEnablementEntrySchema = z.union([
    z.boolean(),
    z
        .object({
            enabled: z.boolean().optional(),
            overrides: z.array(z.string()).optional(),
            envAllowlist: z.array(z.string()).optional(),
            startupTimeoutMs: z.number().int().positive().optional(),
            toolTimeoutMs: z.number().int().positive().optional()
        })
        .passthrough()
]);
const extensionEnablementSchema = z.record(
    z.string().trim().min(1),
    extensionEnablementEntrySchema
);
type ExtensionEnablement = z.infer<typeof extensionEnablementSchema>;
const sensitiveEnvironmentKeyPattern = /(api_?key|credential|password|private_?key|secret|token)/i;
const packageManagerCredentialKeys = new Set(['NODE_AUTH_TOKEN', 'NPM_TOKEN']);

export interface RefreshOptions {
    extensions?: boolean;
    dashboard?: boolean;
    force?: boolean;
    silent?: boolean;
}

export interface StagedAsset {
    destination: string;
    stagedPath: string;
}

interface SwappedAsset extends StagedAsset {
    backupPath?: string;
}

interface AssetSwapTransaction {
    commit(): Promise<void>;
    rollback(): Promise<void>;
}

export function mergeBundledExtensionEnablement(
    current: ExtensionEnablement,
    bundledNames: readonly string[]
): ExtensionEnablement {
    const merged = { ...current };
    for (const name of bundledNames) {
        if (!Object.prototype.hasOwnProperty.call(merged, name)) {
            merged[name] = { overrides: [] };
        }
    }
    return merged;
}

function getErrorMessage(error: unknown): string {
    if (error instanceof Error) return error.message;
    return String(error);
}

function getPackageRoot(): string {
    const thisFile = fileURLToPath(import.meta.url);
    return path.resolve(path.dirname(thisFile), '../../..');
}

function extensionDestinationName(sourceName: string): string {
    const names: Record<string, string> = {
        memory: 'tars-memory',
        search: 'tars-search',
        tasks: 'tars-tasks'
    };
    return names[sourceName] || sourceName;
}

async function pathExists(filePath: string): Promise<boolean> {
    try {
        await fsp.lstat(filePath);
        return true;
    } catch (error) {
        const code = error instanceof Error && 'code' in error ? error.code : undefined;
        if (code === 'ENOENT') return false;
        throw error;
    }
}

function isRegularFile(filePath: string): boolean {
    try {
        const stats = fs.lstatSync(filePath);
        return stats.isFile() && !stats.isSymbolicLink();
    } catch {
        return false;
    }
}

function isRealDirectory(directoryPath: string): boolean {
    try {
        const stats = fs.lstatSync(directoryPath);
        return stats.isDirectory() && !stats.isSymbolicLink();
    } catch {
        return false;
    }
}

function readPackageScripts(packagePath: string): Record<string, string> {
    const parsed: unknown = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
    return packageSchema.parse(parsed).scripts || {};
}

function createBuildEnvironment(): NodeJS.ProcessEnv {
    return Object.fromEntries(
        Object.entries(process.env).filter(([key]) => {
            if (packageManagerCredentialKeys.has(key)) return true;
            return !sensitiveEnvironmentKeyPattern.test(key);
        })
    );
}

function runNpm(directory: string, requireBuild: boolean): void {
    const installCommand = fs.existsSync(path.join(directory, 'package-lock.json'))
        ? 'ci'
        : 'install';
    const options: ExecFileSyncOptions = {
        cwd: directory,
        env: { ...createBuildEnvironment(), npm_config_production: 'false' },
        stdio: 'pipe'
    };
    execFileSync('npm', [installCommand], options);

    const scripts = readPackageScripts(path.join(directory, 'package.json'));
    if (scripts.build) {
        execFileSync('npm', ['run', 'build'], options);
    } else if (requireBuild) {
        throw new Error(`Package at ${directory} has no build script.`);
    }
}

async function copyPackageSource(source: string, destination: string): Promise<void> {
    await fsp.cp(source, destination, {
        recursive: true,
        filter: (sourcePath) => {
            const relative = path.relative(source, sourcePath);
            if (!relative) return true;
            const segments = relative.split(path.sep);
            if (segments.some((segment) => ['.next', 'dist', 'node_modules'].includes(segment))) {
                return false;
            }
            return !segments.some((segment) => segment === '.env' || segment.startsWith('.env.'));
        }
    });
}

async function removePath(filePath: string): Promise<void> {
    await fsp.rm(filePath, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
}

async function rollbackAssets(swappedAssets: SwappedAsset[]): Promise<void> {
    const rollbackErrors: string[] = [];
    for (const asset of [...swappedAssets].reverse()) {
        try {
            await removePath(asset.destination);
            if (asset.backupPath) await fsp.rename(asset.backupPath, asset.destination);
        } catch (error) {
            rollbackErrors.push(getErrorMessage(error));
        }
    }
    if (rollbackErrors.length > 0) {
        throw new Error(`Rollback failed: ${rollbackErrors.join('; ')}`);
    }
}

async function beginAssetSwap(assets: StagedAsset[]): Promise<AssetSwapTransaction> {
    const swappedAssets: SwappedAsset[] = [];
    try {
        for (const asset of assets) {
            const swapped: SwappedAsset = { ...asset };
            if (await pathExists(asset.destination)) {
                swapped.backupPath = `${asset.destination}.backup-${randomUUID()}`;
                await fsp.rename(asset.destination, swapped.backupPath);
            }
            swappedAssets.push(swapped);
            await fsp.rename(asset.stagedPath, asset.destination);
        }
    } catch (error) {
        try {
            await rollbackAssets(swappedAssets);
        } catch (rollbackError) {
            throw new Error(`${getErrorMessage(error)}; ${getErrorMessage(rollbackError)}`);
        }
        throw error;
    }

    let finalized = false;
    return {
        commit: async (): Promise<void> => {
            if (finalized) return;
            finalized = true;
            await Promise.allSettled(
                swappedAssets
                    .map((asset) => asset.backupPath)
                    .filter((backupPath): backupPath is string => Boolean(backupPath))
                    .map((backupPath) => removePath(backupPath))
            );
        },
        rollback: async (): Promise<void> => {
            if (finalized) return;
            finalized = true;
            await rollbackAssets(swappedAssets);
        }
    };
}

export async function swapStagedAssets(assets: StagedAsset[]): Promise<void> {
    const transaction = await beginAssetSwap(assets);
    await transaction.commit();
}

export async function activateStagedAssets(
    assets: StagedAsset[],
    activate: () => Promise<void>
): Promise<void> {
    let transaction: AssetSwapTransaction;
    try {
        transaction = await beginAssetSwap(assets);
    } catch (error: unknown) {
        try {
            await activate();
        } catch (recoveryError: unknown) {
            throw new Error(
                `${getErrorMessage(error)}; asset swap was rolled back, but process recovery failed: ${getErrorMessage(recoveryError)}`
            );
        }
        throw error;
    }

    try {
        await activate();
        await transaction.commit();
    } catch (error: unknown) {
        try {
            await transaction.rollback();
        } catch (rollbackError: unknown) {
            throw new Error(
                `${getErrorMessage(error)}; asset rollback failed: ${getErrorMessage(rollbackError)}`
            );
        }

        try {
            await activate();
        } catch (recoveryError: unknown) {
            throw new Error(
                `${getErrorMessage(error)}; previous assets were restored, but process recovery failed: ${getErrorMessage(recoveryError)}`
            );
        }
        throw error;
    }
}

async function stageBundledExtensions(
    extensionsSource: string,
    extensionsDestination: string
): Promise<StagedAsset[]> {
    const stagedAssets: StagedAsset[] = [];
    const entries = await fsp.readdir(extensionsSource, { withFileTypes: true });

    try {
        for (const entry of entries) {
            if (!entry.isDirectory()) continue;
            const destinationName = extensionDestinationName(entry.name);
            const sourcePath = path.join(extensionsSource, entry.name);
            const stagedPath = path.join(
                extensionsDestination,
                `.tars-refresh-${destinationName}-${randomUUID()}`
            );
            stagedAssets.push({
                destination: path.join(extensionsDestination, destinationName),
                stagedPath
            });
            await copyPackageSource(sourcePath, stagedPath);
            runNpm(stagedPath, true);
            if (!isRegularFile(path.join(stagedPath, 'dist', 'server.js'))) {
                throw new Error(`Extension ${destinationName} did not produce dist/server.js.`);
            }
            await fsp.writeFile(
                path.join(stagedPath, '.tars-managed-extension.json'),
                `${JSON.stringify({ schemaVersion: 1, name: destinationName }, null, 2)}\n`,
                { encoding: 'utf8', flag: 'wx', mode: 0o600 }
            );
        }
        return stagedAssets;
    } catch (error) {
        await Promise.allSettled(stagedAssets.map((asset) => removePath(asset.stagedPath)));
        throw error;
    }
}

async function stageRestoredExtensions(
    extensionsDestination: string,
    bundledDestinations: Set<string>
): Promise<StagedAsset[]> {
    const stagedAssets: StagedAsset[] = [];
    const entries = await fsp.readdir(extensionsDestination, { withFileTypes: true });

    try {
        for (const entry of entries) {
            if (
                !entry.isDirectory() ||
                entry.name.startsWith('.tars-refresh-') ||
                bundledDestinations.has(entry.name)
            ) {
                continue;
            }

            const extensionPath = path.join(extensionsDestination, entry.name);
            const stats = await fsp.lstat(extensionPath);
            if (stats.isSymbolicLink()) continue;
            if (
                !fs.existsSync(path.join(extensionPath, 'package.json')) ||
                fs.existsSync(path.join(extensionPath, 'node_modules'))
            ) {
                continue;
            }

            const stagedPath = path.join(
                extensionsDestination,
                `.tars-refresh-${entry.name}-${randomUUID()}`
            );
            stagedAssets.push({ destination: extensionPath, stagedPath });
            await fsp.cp(extensionPath, stagedPath, {
                recursive: true,
                filter: (sourcePath) => path.basename(sourcePath) !== 'node_modules'
            });
            runNpm(stagedPath, false);
        }
        return stagedAssets;
    } catch (error) {
        await Promise.allSettled(stagedAssets.map((asset) => removePath(asset.stagedPath)));
        throw error;
    }
}

async function cleanupStagedAssets(assets: StagedAsset[]): Promise<void> {
    await Promise.allSettled(assets.map((asset) => removePath(asset.stagedPath)));
}

async function stageExtensionEnablement(
    extensionsDestination: string,
    bundledNames: readonly string[]
): Promise<StagedAsset> {
    const destination = path.join(extensionsDestination, 'extension-enablement.json');
    let current: ExtensionEnablement = {};
    if (await pathExists(destination)) {
        const stats = await fsp.lstat(destination);
        if (!stats.isFile() || stats.isSymbolicLink()) {
            throw new Error('Extension enablement configuration must be a regular file.');
        }
        const parsed: unknown = JSON.parse(await fsp.readFile(destination, 'utf8'));
        current = extensionEnablementSchema.parse(parsed);
    }

    const stagedPath = path.join(
        extensionsDestination,
        `.tars-refresh-extension-enablement-${randomUUID()}`
    );
    await fsp.writeFile(
        stagedPath,
        `${JSON.stringify(mergeBundledExtensionEnablement(current, bundledNames), null, 2)}\n`,
        { encoding: 'utf8', flag: 'wx', mode: 0o600 }
    );
    return { destination, stagedPath };
}

async function prepareExtensionAssets(tarsHome: string): Promise<StagedAsset[]> {
    const extensionsSource = path.join(getPackageRoot(), 'extensions');
    const extensionsDestination = path.join(tarsHome, 'extensions');
    if (!fs.existsSync(extensionsSource)) {
        throw new Error('Extensions source not found.');
    }

    const stagedAssets: StagedAsset[] = [];
    try {
        await fsp.mkdir(extensionsDestination, { recursive: true });
        stagedAssets.push(
            ...(await stageBundledExtensions(extensionsSource, extensionsDestination))
        );
        if (stagedAssets.length === 0) throw new Error('No bundled extensions were found.');
        const bundledNames = new Set(stagedAssets.map((asset) => path.basename(asset.destination)));
        stagedAssets.push(...(await stageRestoredExtensions(extensionsDestination, bundledNames)));
        stagedAssets.push(
            await stageExtensionEnablement(extensionsDestination, Array.from(bundledNames))
        );
        return stagedAssets;
    } catch (error) {
        await cleanupStagedAssets(stagedAssets);
        throw error;
    }
}

export async function refreshExtensions(tarsHome: string, silent = false): Promise<boolean> {
    const spinner = silent ? null : ora('  Staging Tars extensions...').start();
    let stagedAssets: StagedAsset[] = [];
    try {
        stagedAssets = await prepareExtensionAssets(tarsHome);
        await swapStagedAssets(stagedAssets);
        spinner?.succeed('  Extensions validated and refreshed.');
        return true;
    } catch (error) {
        spinner?.fail(`  Extension refresh failed: ${getErrorMessage(error)}`);
        return false;
    } finally {
        await cleanupStagedAssets(stagedAssets);
    }
}

async function pauseActiveDashboards(tarsHome: string): Promise<string[]> {
    const names = (await findTarsProcessesByHome(tarsHome))
        .filter(({ isActive, isSupervisor, name }) => {
            return isActive && !isSupervisor && name.endsWith('-dash');
        })
        .map(({ name }) => name);
    const stopped: string[] = [];
    try {
        for (const name of names) {
            await stopTarsProcessNames([name]);
            stopped.push(name);
        }
        return stopped;
    } catch (error) {
        await restartTarsProcessNames(stopped).catch(() => undefined);
        throw error;
    }
}

async function prepareDashboardAsset(tarsHome: string): Promise<StagedAsset> {
    const dashboardSource = path.join(getPackageRoot(), 'dash');
    const dashboardDestination = path.join(tarsHome, 'apps', 'dashboard');
    if (!fs.existsSync(dashboardSource)) {
        throw new Error('Dashboard source not found.');
    }

    const appsDirectory = path.dirname(dashboardDestination);
    const stagedPath = path.join(appsDirectory, `.tars-refresh-dashboard-${randomUUID()}`);
    try {
        await fsp.mkdir(appsDirectory, { recursive: true });
        await copyPackageSource(dashboardSource, stagedPath);
        runNpm(stagedPath, true);
        if (
            !isRegularFile(path.join(stagedPath, 'server.js')) ||
            !isRealDirectory(path.join(stagedPath, '.next'))
        ) {
            throw new Error('Dashboard build validation failed.');
        }
        return { destination: dashboardDestination, stagedPath };
    } catch (error) {
        await removePath(stagedPath).catch(() => undefined);
        throw error;
    }
}

export async function refreshDashboard(tarsHome: string, silent = false): Promise<boolean> {
    const spinner = silent ? null : ora('  Staging Tars Dashboard...').start();
    let stagedAsset: StagedAsset | undefined;
    let pausedDashboards: string[] = [];
    try {
        stagedAsset = await prepareDashboardAsset(tarsHome);
        pausedDashboards = await pauseActiveDashboards(tarsHome);
        await activateStagedAssets([stagedAsset], () => restartTarsProcessNames(pausedDashboards));
    } catch (error) {
        spinner?.fail(`  Dashboard refresh failed: ${getErrorMessage(error)}`);
        return false;
    } finally {
        if (stagedAsset) await removePath(stagedAsset.stagedPath).catch(() => undefined);
    }
    spinner?.succeed('  Dashboard validated and refreshed.');
    return true;
}

async function refreshAllComponents(tarsHome: string, silent: boolean): Promise<boolean> {
    const spinner = silent ? null : ora('  Staging extensions and dashboard...').start();
    const stagedAssets: StagedAsset[] = [];
    let pausedDashboards: string[] = [];
    try {
        stagedAssets.push(...(await prepareExtensionAssets(tarsHome)));
        stagedAssets.push(await prepareDashboardAsset(tarsHome));

        pausedDashboards = await pauseActiveDashboards(tarsHome);
        await activateStagedAssets(stagedAssets, () => restartTarsProcessNames(pausedDashboards));
    } catch (error) {
        spinner?.fail(`  Component refresh failed: ${getErrorMessage(error)}`);
        return false;
    } finally {
        await cleanupStagedAssets(stagedAssets);
    }
    spinner?.succeed('  All components validated and refreshed atomically.');
    return true;
}

export async function refresh(options: RefreshOptions = {}): Promise<boolean> {
    const tarsHome = getTarsHome();
    return withTarsHomeMutationLease(tarsHome, 'refresh Tars components', () =>
        refreshWithLease(tarsHome, options)
    );
}

async function refreshWithLease(tarsHome: string, options: RefreshOptions): Promise<boolean> {
    const { extensions = true, dashboard = true, silent = false } = options;

    if (!extensions && !dashboard) {
        if (!silent) console.log(chalk.red('Select at least one component to refresh.'));
        return false;
    }

    if (!silent) {
        console.log(chalk.cyan.bold('\n🔄 Refreshing Tars Components'));
        console.log(chalk.cyan('━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n'));
    }

    let succeeded: boolean;
    if (extensions && dashboard) {
        if (!silent) console.log(chalk.bold('Extensions + Dashboard:'));
        succeeded = await refreshAllComponents(tarsHome, silent);
        if (!silent) console.log('');
    } else if (extensions) {
        if (!silent) console.log(chalk.bold('Extensions:'));
        succeeded = await refreshExtensions(tarsHome, silent);
        if (!silent) console.log('');
    } else {
        if (!silent) console.log(chalk.bold('Dashboard:'));
        succeeded = await refreshDashboard(tarsHome, silent);
        if (!silent) console.log('');
    }

    if (!silent) {
        if (succeeded) {
            console.log(chalk.green.bold('✅ Refresh complete.'));
            console.log(chalk.dim('  Run "tars restart" to apply changes.\n'));
        } else {
            console.log(
                chalk.red('❌ Refresh did not complete; failed components were preserved.')
            );
        }
    }
    return succeeded;
}
