import pm2 from 'pm2';
import chalk from 'chalk';
import inquirer from 'inquirer';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import os from 'os';
import path from 'path';
import { execSync } from 'child_process';
import ora from 'ora';

export async function uninstall() {
    console.log(chalk.red.bold('\n⚠️  DANGER ZONE: Uninstall Tars ⚠️\n'));
    console.log(chalk.white('This action will:'));
    console.log(chalk.red('  1. Stop and remove the Tars background supervisor'));
    console.log(chalk.red('  2. PERMANENTLY DELETE ~/.tars (Your Brain, Memories, and Data)'));
    console.log(chalk.red('  3. Remove all configuration and logs\n'));

    const { confirm } = await inquirer.prompt([
        {
            type: 'confirm',
            name: 'confirm',
            message: 'Are you absolutely sure you want to proceed?',
            default: false
        }
    ]);

    if (!confirm) {
        console.log(chalk.cyan('\nUninstall cancelled.'));
        return;
    }

    const { finalConfirm } = await inquirer.prompt([
        {
            type: 'input',
            name: 'finalConfirm',
            message: 'Type "delete" to confirm complete removal:',
            validate: (input) => (input === 'delete' ? true : 'You must type "delete" to confirm.')
        }
    ]);

    if (finalConfirm !== 'delete') {
        console.log(chalk.cyan('\nUninstall cancelled.'));
        return;
    }

    console.log('\nStarting uninstallation...\n');

    // 1. Stop Tars
    const stopSpinner = ora('Stopping Tars services...').start();
    await new Promise<void>((resolve) => {
        pm2.connect((err) => {
            if (err) {
                // If PM2 fails, we just try to kill manually
                forceKill();
                resolve();
                return;
            }

            pm2.delete('tars-supervisor', (delErr) => {
                pm2.disconnect();
                // Even if delete fails (e.g. not running), force kill
                forceKill();
                resolve();
            });
        });
    });
    stopSpinner.succeed('Tars services stopped.');

    // 2. Remove ~/.tars
    const cleanSpinner = ora('Removing ~/.tars directory...').start();
    const tarsHome =
        process.env.TARS_HOME || path.join(process.env.REAL_HOME || os.homedir(), '.tars');

    if (existsSync(tarsHome)) {
        try {
            await fs.rm(tarsHome, { recursive: true, force: true });
            cleanSpinner.succeed('Data directory (~/.tars) permanently removed.');
        } catch (error: any) {
            cleanSpinner.fail(`Failed to remove ~/.tars: ${error.message}`);
            console.log(
                chalk.yellow(
                    '\nYou may need to manually remove the directory using: rm -rf ~/.tars'
                )
            );
        }
    } else {
        cleanSpinner.info('~/.tars directory not found (already clean).');
    }

    // 3. Final message
    console.log(chalk.green.bold('\n✅ Tars has been scrubbed from this system.'));
    console.log(chalk.white('\nTo complete the removal, uninstall the CLI package:'));
    console.log(chalk.cyan('  npm uninstall -g @saccolabs/tars'));
    console.log(chalk.dim('\nGoodbye! 👋'));
    process.exit(0);
}

function forceKill() {
    try {
        execSync('pkill -9 -f "supervisor/main.js" || true', { stdio: 'ignore' });
    } catch (e) {
        // Ignore
    }
}
