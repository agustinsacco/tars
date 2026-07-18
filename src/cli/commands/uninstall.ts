import fsSync from 'fs';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import chalk from 'chalk';
import inquirer from 'inquirer';
import ora from 'ora';
import { z } from 'zod';
import { deleteTarsProcessesByHome } from '../../utils/pm2-processes.js';
import { getTarsHome } from '../../utils/paths.js';
import { withTarsHomeMutationLease } from '../../utils/tars-home-lease.js';

const metadataSchema = z
    .object({
        lastAudit: z.string().min(1),
        version: z.string().min(1)
    })
    .passthrough();

export interface UninstallTargetValidation {
    exists: boolean;
    reason?: string;
    safe: boolean;
}

function isPathInside(rootPath: string, candidatePath: string): boolean {
    const relative = path.relative(rootPath, candidatePath);
    return (
        relative === '' ||
        (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
    );
}

export function validateUninstallTarget(
    requestedPath: string,
    userHome = os.homedir(),
    workspace = process.cwd()
): UninstallTargetValidation {
    const target = path.resolve(requestedPath);
    const protectedHomes = new Set(
        [userHome, process.env.REAL_HOME]
            .filter((value): value is string => Boolean(value))
            .map((value) => path.resolve(value))
            .map((value) => (path.basename(value) === '.tars' ? path.dirname(value) : value))
    );
    const workspacePath = path.resolve(workspace);

    if (target === path.parse(target).root) {
        return { exists: true, safe: false, reason: 'Target is a filesystem root.' };
    }
    if (protectedHomes.has(target)) {
        return { exists: true, safe: false, reason: 'Target is a user home directory.' };
    }
    if (target === workspacePath || isPathInside(target, workspacePath)) {
        return {
            exists: fsSync.existsSync(target),
            safe: false,
            reason: 'Target overlaps the current workspace.'
        };
    }
    if (!fsSync.existsSync(target)) return { exists: false, safe: true };

    const stats = fsSync.lstatSync(target);
    if (!stats.isDirectory() || stats.isSymbolicLink()) {
        return {
            exists: true,
            safe: false,
            reason: 'Target is not a real directory.'
        };
    }

    const realTarget = fsSync.realpathSync(target);
    if (
        realTarget === path.parse(realTarget).root ||
        protectedHomes.has(realTarget) ||
        realTarget === workspacePath ||
        isPathInside(realTarget, workspacePath)
    ) {
        return { exists: true, safe: false, reason: 'Resolved target is a protected directory.' };
    }

    const markerPath = path.join(target, 'metadata.json');
    try {
        const markerStats = fsSync.lstatSync(markerPath);
        if (!markerStats.isFile() || markerStats.isSymbolicLink()) {
            return { exists: true, safe: false, reason: 'Tars metadata marker is invalid.' };
        }
        const marker: unknown = JSON.parse(fsSync.readFileSync(markerPath, 'utf8'));
        if (!metadataSchema.safeParse(marker).success) {
            return { exists: true, safe: false, reason: 'Tars metadata marker is invalid.' };
        }
    } catch {
        return { exists: true, safe: false, reason: 'Tars metadata marker is missing.' };
    }

    return { exists: true, safe: true };
}

export async function uninstall(): Promise<boolean> {
    const tarsHome = path.resolve(getTarsHome());
    const validation = validateUninstallTarget(tarsHome);
    if (!validation.safe) {
        throw new Error(`Refusing to uninstall: ${validation.reason}`);
    }
    return withTarsHomeMutationLease(tarsHome, 'uninstall Tars', () =>
        uninstallWithLease(tarsHome)
    );
}

async function uninstallWithLease(tarsHome: string): Promise<boolean> {
    console.log(chalk.red.bold('\n⚠️  DANGER ZONE: Uninstall Tars ⚠️\n'));
    console.log(chalk.white('This action will:'));
    console.log(chalk.red('  1. Stop and remove the Tars background supervisor'));
    console.log(chalk.red(`  2. PERMANENTLY DELETE ${tarsHome} (Your Brain, Memories, and Data)`));
    console.log(chalk.red('  3. Remove configuration and logs stored in that directory\n'));

    const { confirm } = await inquirer.prompt<{ confirm: boolean }>([
        {
            type: 'confirm',
            name: 'confirm',
            message: 'Are you absolutely sure you want to proceed?',
            default: false
        }
    ]);

    if (!confirm) {
        console.log(chalk.cyan('\nUninstall cancelled.'));
        return false;
    }

    const { finalConfirm } = await inquirer.prompt<{ finalConfirm: string }>([
        {
            type: 'input',
            name: 'finalConfirm',
            message: 'Type "delete" to confirm complete removal:',
            validate: (input: string) =>
                input === 'delete' ? true : 'You must type "delete" to confirm.'
        }
    ]);

    if (finalConfirm !== 'delete') {
        console.log(chalk.cyan('\nUninstall cancelled.'));
        return false;
    }

    const stopSpinner = ora('Stopping Tars services...').start();
    try {
        await deleteTarsProcessesByHome(tarsHome);
        stopSpinner.succeed('Tars services stopped.');
    } catch (error) {
        stopSpinner.fail('Unable to stop Tars services. No data was removed.');
        throw error;
    }

    const finalValidation = validateUninstallTarget(tarsHome);
    if (!finalValidation.safe) {
        throw new Error(`Refusing to uninstall after revalidation: ${finalValidation.reason}`);
    }

    const cleanSpinner = ora(`Removing ${tarsHome} directory...`).start();
    if (finalValidation.exists) {
        await fs.rm(tarsHome, { recursive: true, force: false, maxRetries: 3, retryDelay: 200 });
        cleanSpinner.succeed(`Data directory (${tarsHome}) permanently removed.`);
    } else {
        cleanSpinner.info(`${tarsHome} directory not found (already clean).`);
    }

    console.log(chalk.green.bold('\n✅ Tars has been scrubbed from this system.'));
    console.log(chalk.white('\nTo complete the removal, uninstall the CLI package:'));
    console.log(chalk.cyan('  npm uninstall -g @saccolabs/tars'));
    console.log(chalk.dim('\nGoodbye! 👋'));
    return true;
}
