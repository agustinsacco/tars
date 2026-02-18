import pm2 from 'pm2';
import chalk from 'chalk';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function start() {
    console.log(chalk.cyan('🚀 Starting Tars supervisor...'));

    // Point to the compiled JS entry point (dist/supervisor/main.js)
    const mainPath = path.resolve(__dirname, '../../supervisor/main.js');

    // Pre-start cleanup: Kill any stray orphans that aren't managed by PM2
    try {
        const { execSync } = await import('child_process');
        execSync('pkill -9 -f "supervisor/main.js" || true');
    } catch (e) {}

    pm2.connect((err) => {
        if (err) {
            console.error(chalk.red('❌ Failed to connect to PM2'), err);
            process.exit(2);
        }

        pm2.start(
            {
                script: mainPath,
                name: 'tars-supervisor',
                interpreter: 'node',
                env: {
                    NODE_ENV: 'production',
                    LOG_LEVEL: 'debug',
                    TARS_SUPERVISOR_MODE: 'true'
                }
            },
            (err, apps) => {
                pm2.disconnect();
                if (err) {
                    console.error(chalk.red('❌ Error starting Tars:'), err);
                } else {
                    console.log(
                        chalk.green('✅ Tars supervisor is now running in the background.')
                    );
                    console.log(`  Use ${chalk.cyan('tars status')} to check status and logs.`);
                }
            }
        );
    });
}
