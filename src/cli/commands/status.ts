import pm2 from 'pm2';
import chalk from 'chalk';
import { pkg, isDev } from '../../utils/Version.js';

export async function status() {
    pm2.connect((err) => {
        if (err) {
            console.error(chalk.red('❌ Failed to connect to PM2'), err);
            process.exit(2);
        }

        pm2.describe('tars-supervisor', (err, list) => {
            pm2.disconnect();
            if (err || !list || list.length === 0) {
                console.log(chalk.red('🔴 Tars supervisor is not running.'));
                return;
            }

            const proc = list[0];
            const status = proc.pm2_env?.status === 'online' ? chalk.green('online') : chalk.red(proc.pm2_env?.status);

            console.log(chalk.cyan.bold('\n📊 Tars Status'));
            console.log(chalk.cyan('──────────────'));
            console.log(`Version: ${pkg.version}${isDev ? chalk.yellow(' (dev)') : ''}`);
            console.log(`Status:  ${status}`);
            console.log(`CPU:     ${proc.monit?.cpu}%`);
            console.log(`Memory:  ${(proc.monit?.memory ? proc.monit.memory / 1024 / 1024 : 0).toFixed(1)} MB`);
            console.log(`Uptime:  ${Math.floor((Date.now() - (proc.pm2_env?.pm_uptime || 0)) / 1000 / 60)} minutes`);
            console.log(`PID:     ${proc.pid}`);
            console.log(`Logs:    tars logs\n`);
        });
    });
}
