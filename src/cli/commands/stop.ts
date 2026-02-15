import pm2 from 'pm2';
import chalk from 'chalk';

export async function stop() {
    pm2.connect((err) => {
        if (err) {
            console.error(chalk.red('❌ Failed to connect to PM2'), err);
            process.exit(2);
        }

        pm2.stop('tars-supervisor', (err) => {
            pm2.disconnect();
            if (err) {
                console.log(chalk.yellow('⚠️ Tars supervisor is not running.'));
            } else {
                console.log(chalk.green('🛑 Tars supervisor stopped.'));
            }
        });
    });
}
