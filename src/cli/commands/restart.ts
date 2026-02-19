import { execSync } from 'child_process';
import chalk from 'chalk';
import { pkg } from '../../utils/version.js';
import { stop } from './stop.js';
import { start } from './start.js';

export async function restart() {
    console.log(chalk.cyan('🔄 Checking for updates...'));
    let updated = false;

    try {
        // Check npm for the latest version
        const latest = execSync('npm view @saccolabs/tars version', { encoding: 'utf-8' }).trim();

        if (latest && latest !== pkg.version) {
            console.log(chalk.green(`✨ Update available: ${latest} (Current: ${pkg.version})`));
            console.log(chalk.cyan('📦 Upgrading Tars...'));

            // Install the latest version globally
            execSync('npm install -g @saccolabs/tars@latest', { stdio: 'inherit' });

            updated = true;
            console.log(chalk.green('✅ Upgrade complete.'));
        } else {
            console.log(chalk.dim('✅ Tars is up to date.'));
        }
    } catch (error: any) {
        // Don't crash if offline or npm fails, just proceed with restart
        console.warn(chalk.yellow('⚠️ Update check failed:'), error.message);
    }

    // Always stop the current process
    await stop();

    if (updated) {
        // If we updated, the code on disk has changed.
        // We must spawn a fresh process via shell to load the new code.
        console.log(chalk.cyan('🚀 Restarting with new version...'));
        try {
            execSync('tars start', { stdio: 'inherit' });
        } catch (e) {
            console.error(chalk.red('❌ Failed to restart automatically. Please run "tars start" manually.'));
        }
    } else {
        // If no update, just start using the internal function (faster)
        await start();
    }

    // Force exit to prevent hanging due to potentially lingering PM2 IPC connections
    process.exit(0);
}
