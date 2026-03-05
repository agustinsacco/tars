import pm2 from 'pm2';
import chalk from 'chalk';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { fileURLToPath } from 'url';

import { getTarsHome } from '../../utils/paths.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function start(): Promise<void> {
    console.log(chalk.cyan('🚀 Starting Tars supervisor...'));

    // Point to the compiled JS entry point (dist/supervisor/main.js)
    const mainPath = path.resolve(__dirname, '../../supervisor/main.js');

    // Pin CWD to the Tars home so the supervisor is truly global and doesn't
    // pick up context from whatever directory the user runs `tars start` in.
    const tarsHome = getTarsHome();
    if (!fs.existsSync(tarsHome)) {
        fs.mkdirSync(tarsHome, { recursive: true });
    }

    return new Promise((resolve, reject) => {
        pm2.connect((err) => {
            if (err) {
                console.error(chalk.red('❌ Failed to connect to PM2'), err);
                process.exit(2);
                resolve(); // Unreachable but typesafe
                return;
            }

            // Check if already running
            pm2.describe('tars-supervisor', async (err, list) => {
                if (!err && list && list.length > 0) {
                    const proc = list[0];
                    if (proc.pm2_env?.status === 'online') {
                        console.log(chalk.yellow('⚠️ Tars supervisor is already running.'));
                        console.log(`  Use ${chalk.cyan('tars status')} to check status.`);
                        pm2.disconnect();
                        resolve();
                        return;
                    }
                }

                // Pre-start cleanup: Kill any stray orphans that aren't managed by PM2
                try {
                    const { execSync } = await import('child_process');
                    execSync('pkill -9 -f "supervisor/main.js" || true');
                } catch (e) {
                    // Ignore Pkill errors
                }

                pm2.start(
                    {
                        script: mainPath,
                        name: 'tars-supervisor',
                        cwd: tarsHome,
                        interpreter: 'node',
                        env: {
                            NODE_ENV: 'production',
                            LOG_LEVEL: 'debug',
                            TARS_SUPERVISOR_MODE: 'true',
                            TARS_HOME: tarsHome,
                            REAL_HOME: os.homedir(),
                            NODE_NO_WARNINGS: '1'
                        },
                        node_args: ['--no-warnings', '--disable-warning=ExperimentalWarning']
                    },
                    (err, apps) => {
                        pm2.disconnect();
                        if (err) {
                            console.error(chalk.red('❌ Error starting Tars:'), err);
                            process.exit(1);
                        } else {
                            console.log(
                                chalk.green('✅ Tars supervisor is now running in the background.')
                            );
                            console.log(`  Use ${chalk.cyan('tars status')} to check status and logs.`);
                            resolve();
                        }
                    }
                );
            });
        });
    });
}
