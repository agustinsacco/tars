import pm2 from 'pm2';
import chalk from 'chalk';
import { execSync } from 'child_process';
import { Config } from '../../config/config.js';

export function stop(): Promise<void> {
    return new Promise((resolve, reject) => {
        const config = Config.getInstance();
        const instanceName = config.instanceName;
        console.log(chalk.cyan(`🛑 Stopping Tars supervisor [${instanceName}]...`));

        pm2.connect((err) => {
            if (err) {
                console.error(chalk.red('❌ Failed to connect to PM2'), err);
                // Fallback to pkill even if PM2 fails
                forceKill();
                resolve();
                return;
            }

            // Use delete instead of stop to completely remove from PM2 list
            pm2.delete(instanceName, (err) => {
                // Also clean up auxiliary processes
                pm2.delete(`${instanceName}-dash`, () => {});
                pm2.delete(`${instanceName}-tunnel`, () => {});

                pm2.disconnect();
                if (err) {
                    console.log(chalk.yellow(`⚠️ Tars [${instanceName}] was not managed by PM2.`));
                } else {
                    console.log(chalk.green(`✅ PM2 process [${instanceName}] removed.`));
                }

                forceKill();
                resolve();
            });
        });
    });
}

function forceKill() {
    try {
        console.log(chalk.dim('🔍 Checking for orphan processes...'));
        // Find and kill any process running our supervisor, but NOT the CLI itself
        // Use pkill -f to match the script path
        execSync('pkill -9 -f "supervisor/main.js" || true');
        console.log(chalk.green('✨ Assistant supervisor terminated.'));
    } catch (e) {
        // Ignore errors if no processes were found
    }
}
