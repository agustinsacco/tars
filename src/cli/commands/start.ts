import pm2 from 'pm2';
import chalk from 'chalk';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { fileURLToPath } from 'url';

import { getTarsHome } from '../../utils/paths.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function start(options: { name?: string; role?: string } = {}): Promise<void> {
    const instanceName = options.name || 'tars-supervisor';
    const role = options.role || 'General purpose';

    console.log(chalk.cyan(`🚀 Starting Tars supervisor [${instanceName}]...`));

    // Point to the compiled JS entry point (dist/supervisor/main.js)
    const mainPath = path.resolve(__dirname, '../../supervisor/main.js');

    const tarsHome = getTarsHome();
    if (!fs.existsSync(tarsHome)) {
        fs.mkdirSync(tarsHome, { recursive: true });
    }

    return new Promise((resolve, reject) => {
        pm2.connect((err) => {
            if (err) {
                console.error(chalk.red('❌ Failed to connect to PM2'), err);
                process.exit(2);
                resolve();
                return;
            }

            // Check if this specific instance is already running
            pm2.describe(instanceName, async (err, list) => {
                if (!err && list && list.length > 0) {
                    const proc = list[0];
                    if (proc.pm2_env?.status === 'online') {
                        console.log(
                            chalk.yellow(`⚠️ Tars supervisor [${instanceName}] is already running.`)
                        );
                        console.log(`  Use ${chalk.cyan('tars status')} to check status.`);
                        pm2.disconnect();
                        resolve();
                        return;
                    }
                }

                pm2.start(
                    {
                        script: mainPath,
                        name: instanceName,
                        cwd: tarsHome,
                        interpreter: 'node',
                        env: {
                            NODE_ENV: 'production',
                            LOG_LEVEL: 'debug',
                            TARS_SUPERVISOR_MODE: 'true',
                            TARS_HOME: tarsHome,
                            TARS_INSTANCE_NAME: instanceName,
                            TARS_INSTANCE_ROLE: role,
                            REAL_HOME: os.homedir(),
                            NODE_NO_WARNINGS: '1'
                        },
                        node_args: ['--no-warnings', '--disable-warning=ExperimentalWarning']
                    },
                    (err, apps) => {
                        pm2.disconnect();
                        if (err) {
                            console.error(
                                chalk.red(`❌ Error starting Tars [${instanceName}]:`),
                                err
                            );
                            process.exit(1);
                        } else {
                            console.log(
                                chalk.green(
                                    `✅ Tars supervisor [${instanceName}] is now running in the background.`
                                )
                            );
                            if (options.role) {
                                console.log(chalk.dim(`   Role: ${role}`));
                            }
                            console.log(
                                `  Use ${chalk.cyan('tars status')} to check status and logs.`
                            );
                            resolve();
                        }
                    }
                );
            });
        });
    });
}
