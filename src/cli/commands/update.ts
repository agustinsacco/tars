import { execSync } from 'child_process';
import chalk from 'chalk';
import ora from 'ora';
import { pkg } from '../../utils/version.js';
import { restart } from './restart.js';
import pm2 from 'pm2';

/**
 * tars update - Force check for new versions and upgrade
 */
export async function update() {
    console.log(chalk.cyan.bold('\n🚀 Tars Update System'));
    console.log(chalk.cyan('━━━━━━━━━━━━━━━━━━━━\n'));

    const spinner = ora('Checking for latest version on npm...').start();

    try {
        // Check npm for the latest version
        const latest = execSync('npm view @saccolabs/tars@latest version --prefer-online', {
            encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'pipe'] // Suppress stderror for clean output
        }).trim();

        if (!latest) {
            spinner.fail('Could not retrieve version information from npm.');
            return;
        }

        if (latest === pkg.version) {
            spinner.succeed(chalk.green(`Tars is already up to date (v${pkg.version}).`));
            return;
        }

        spinner.info(
            chalk.blue(`Update available: ${chalk.bold(latest)} (Current: v${pkg.version})`)
        );

        const upgradeSpinner = ora('📦 Upgrading Tars to latest...').start();

        try {
            // Install the latest version globally
            execSync('npm install -g @saccolabs/tars@latest --prefer-online', { stdio: 'inherit' });
            upgradeSpinner.succeed(chalk.green('Upgrade complete!'));

            // Check if Tars is currently running via PM2
            pm2.connect((err) => {
                if (err) {
                    console.log(
                        chalk.yellow('\nℹ️ Skipping automatic restart: Could not connect to PM2.')
                    );
                    process.exit(0);
                }

                pm2.describe('tars-supervisor', async (err, list) => {
                    pm2.disconnect();

                    if (!err && list && list.length > 0 && list[0].pm2_env?.status === 'online') {
                        console.log(
                            chalk.cyan(
                                '\n🔄 Tars is currently running. Restarting to apply changes...'
                            )
                        );
                        // We use the restart logic which handles the clean handover
                        await restart();
                    } else {
                        console.log(
                            chalk.green(
                                '\n✨ Tars updated successfully. Run "tars start" to begin.'
                            )
                        );
                        process.exit(0);
                    }
                });
            });
        } catch (err: any) {
            upgradeSpinner.fail(chalk.red(`Upgrade failed: ${err.message}`));
            console.log(chalk.yellow('\n👉 Try running: npm install -g @saccolabs/tars@latest'));
        }
    } catch (error: any) {
        spinner.fail(chalk.red('Update check failed.'));
        console.error(chalk.dim(error.message));
        process.exit(1);
    }
}
