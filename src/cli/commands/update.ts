import { execFileSync } from 'child_process';
import fs from 'fs';
import fsp from 'fs/promises';
import os from 'os';
import path from 'path';
import chalk from 'chalk';
import ora from 'ora';
import { z } from 'zod';
import { restartActiveTarsProcessesByHome } from '../../utils/pm2-processes.js';
import { getTarsHome } from '../../utils/paths.js';
import { assertMcpPoliciesReadyForUpdate } from '../../supervisor/mcp-bridge.js';
import { pkg } from '../../utils/version.js';
import { withTarsHomeMutationLease } from '../../utils/tars-home-lease.js';
import { refresh } from './refresh.js';

const versionSchema = z.string().regex(/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/);
const packageSchema = z.object({ version: versionSchema }).passthrough();
const sensitiveEnvironmentKeyPattern = /(api_?key|credential|password|private_?key|secret|token)/i;
const packageManagerCredentialKeys = new Set(['NODE_AUTH_TOKEN', 'NPM_TOKEN']);

function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function createUpdateEnvironment(): NodeJS.ProcessEnv {
    return Object.fromEntries(
        Object.entries(process.env).filter(([key]) => {
            if (packageManagerCredentialKeys.has(key)) return true;
            return !sensitiveEnvironmentKeyPattern.test(key);
        })
    );
}

function npmOutput(args: string[]): string {
    return execFileSync('npm', args, {
        encoding: 'utf8',
        env: createUpdateEnvironment(),
        stdio: ['ignore', 'pipe', 'pipe']
    }).trim();
}

function validateStagedPackage(packageRoot: string, expectedVersion: string): void {
    const packagePath = path.join(packageRoot, 'package.json');
    const parsed: unknown = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
    const stagedPackage = packageSchema.parse(parsed);
    if (stagedPackage.version !== expectedVersion) {
        throw new Error(
            `Staged package version ${stagedPackage.version} does not match ${expectedVersion}.`
        );
    }

    const requiredPaths = [
        'dist/cli/index.js',
        'dist/supervisor/main.js',
        'dash/server.js',
        'extensions'
    ];
    for (const requiredPath of requiredPaths) {
        if (!fs.existsSync(path.join(packageRoot, requiredPath))) {
            throw new Error(`Staged package is missing ${requiredPath}.`);
        }
    }
}

async function stageLatestPackage(version: string): Promise<string> {
    const stagingRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'tars-update-'));
    try {
        execFileSync(
            'npm',
            [
                'install',
                '--prefix',
                stagingRoot,
                '--ignore-scripts',
                '--prefer-online',
                `@saccolabs/tars@${version}`
            ],
            { env: createUpdateEnvironment(), stdio: 'pipe' }
        );
        validateStagedPackage(
            path.join(stagingRoot, 'node_modules', '@saccolabs', 'tars'),
            version
        );
        return stagingRoot;
    } catch (error) {
        await fsp.rm(stagingRoot, { recursive: true, force: true });
        throw error;
    }
}

export async function update(): Promise<boolean> {
    const tarsHome = getTarsHome();
    return withTarsHomeMutationLease(tarsHome, 'update Tars', () => updateWithLease(tarsHome));
}

async function updateWithLease(tarsHome: string): Promise<boolean> {
    console.log(chalk.cyan.bold('\n🚀 Tars Update System'));
    console.log(chalk.cyan('━━━━━━━━━━━━━━━━━━━━\n'));

    const checkSpinner = ora('Checking for latest version on npm...').start();
    let latest: string;
    try {
        latest = versionSchema.parse(
            npmOutput(['view', '@saccolabs/tars@latest', 'version', '--prefer-online'])
        );
    } catch (error) {
        checkSpinner.fail('Update check failed.');
        console.error(chalk.dim(getErrorMessage(error)));
        return false;
    }

    if (latest === pkg.version) {
        checkSpinner.succeed(chalk.green(`Tars is already up to date (v${pkg.version}).`));
        return true;
    }

    checkSpinner.info(
        chalk.blue(`Update available: ${chalk.bold(latest)} (Current: v${pkg.version})`)
    );
    const upgradeSpinner = ora('📦 Staging and validating the update...').start();
    let stagingRoot: string | undefined;
    let globalUpgradeAttempted = false;
    let componentRefreshComplete = false;

    try {
        assertMcpPoliciesReadyForUpdate(tarsHome);
        stagingRoot = await stageLatestPackage(latest);
        upgradeSpinner.text = '📦 Installing the validated update...';
        globalUpgradeAttempted = true;
        execFileSync(
            'npm',
            ['install', '--global', `@saccolabs/tars@${latest}`, '--prefer-online'],
            { env: createUpdateEnvironment(), stdio: 'inherit' }
        );
        const refreshed = await refresh();
        if (!refreshed) throw new Error('Component refresh failed after the package update.');
        componentRefreshComplete = true;

        const restarted = await restartActiveTarsProcessesByHome(tarsHome);
        upgradeSpinner.succeed(chalk.green('Update installed and validated.'));
        if (restarted.length > 0) {
            console.log(
                chalk.green(
                    `\n✨ Restarted ${restarted.map(({ name }) => `[${name}]`).join(', ')}.`
                )
            );
        } else {
            console.log(chalk.green('\n✨ Tars updated successfully. Run "tars start" to begin.'));
        }
        return true;
    } catch (error) {
        let failureMessage = getErrorMessage(error);
        if (componentRefreshComplete) {
            upgradeSpinner.warn(
                chalk.yellow(
                    `Update installed, but the running process was not restarted: ${failureMessage}`
                )
            );
            console.log(chalk.yellow('Run "tars restart" to apply the validated update.'));
            return false;
        }
        if (globalUpgradeAttempted) {
            try {
                execFileSync(
                    'npm',
                    ['install', '--global', `@saccolabs/tars@${pkg.version}`, '--prefer-online'],
                    { env: createUpdateEnvironment(), stdio: 'inherit' }
                );
                failureMessage += ` The global package was rolled back to v${pkg.version}.`;
            } catch (rollbackError) {
                failureMessage += ` Global rollback also failed: ${getErrorMessage(rollbackError)}`;
            }
        }
        upgradeSpinner.fail(chalk.red(`Update failed: ${failureMessage}`));
        return false;
    } finally {
        if (stagingRoot) {
            await fsp.rm(stagingRoot, { recursive: true, force: true });
        }
    }
}
