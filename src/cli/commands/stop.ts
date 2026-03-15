import pm2 from 'pm2';
import chalk from 'chalk';
import { execSync } from 'child_process';

export function stop(): Promise<void> {
    return new Promise((resolve, reject) => {
        console.log(chalk.cyan('🛑 Stopping Tars supervisor...'));

        pm2.connect((err) => {
            if (err) {
                console.error(chalk.red('❌ Failed to connect to PM2'), err);
                // Fallback to pkill even if PM2 fails
                forceKill();
                resolve();
                return;
            }

            // Use delete instead of stop to completely remove from PM2 list
            pm2.delete('tars-supervisor', (err) => {
                // Also clean up auxiliary processes
                pm2.delete('tars-dashboard', () => {});
                pm2.delete('tars-tunnel', () => {});

                pm2.disconnect();
                if (err) {
                    console.log(chalk.yellow('⚠️ Tars was not managed by PM2.'));
                } else {
                    console.log(chalk.green('✅ PM2 process removed.'));
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
        console.log(chalk.green('✨ All supervisor instances terminated.'));
    } catch (e) {
        // Ignore errors if no processes were found
    }
}
