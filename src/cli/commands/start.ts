import pm2 from 'pm2';
import chalk from 'chalk';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { randomUUID } from 'crypto';
import { fileURLToPath } from 'url';
import { z } from 'zod';

import { ConfigFileSchema } from '../../config/schema.js';
import { Config } from '../../config/config.js';
import { createTarsPm2Identity, findTarsProcessesByHome } from '../../utils/pm2-processes.js';
import { getTarsHome } from '../../utils/paths.js';
import { withTarsStartupLock } from '../../utils/startup-lock.js';
import { withTarsHomeMutationLease } from '../../utils/tars-home-lease.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const InstanceNameSchema = z
    .string()
    .trim()
    .min(1)
    .max(100)
    .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, 'Use letters, numbers, dots, underscores, or dashes');
const InstanceRoleSchema = z.string().trim().min(1).max(200);

function persistInstanceIdentity(tarsHome: string, name: string, role: string): void {
    const configPath = path.join(tarsHome, 'config.json');
    let current: Record<string, unknown> = {};
    if (fs.existsSync(configPath)) {
        const parsed: unknown = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        current = ConfigFileSchema.parse(parsed);
    }
    const temporaryPath = `${configPath}.${process.pid}.${randomUUID()}.tmp`;
    fs.writeFileSync(
        temporaryPath,
        `${JSON.stringify({ ...current, instanceName: name, instanceRole: role }, null, 2)}\n`,
        { encoding: 'utf8', mode: 0o600 }
    );
    fs.renameSync(temporaryPath, configPath);
}

export async function start(options: { name?: string; role?: string } = {}): Promise<void> {
    const config = Config.getInstance();
    const instanceName = InstanceNameSchema.parse(options.name ?? config.instanceName);
    const role = InstanceRoleSchema.parse(options.role ?? config.instanceRole);

    console.log(chalk.cyan(`🚀 Starting Tars supervisor [${instanceName}]...`));

    // Point to the compiled JS entry point (dist/supervisor/main.js)
    const mainPath = path.resolve(__dirname, '../../supervisor/main.js');

    const tarsHome = getTarsHome();
    return withTarsStartupLock(tarsHome, () =>
        withTarsHomeMutationLease(tarsHome, 'start Tars', async () => {
            const activeSupervisors = (await findTarsProcessesByHome(tarsHome)).filter(
                ({ isActive, isSupervisor }) => isActive && isSupervisor
            );
            if (activeSupervisors.some(({ name }) => name === instanceName)) {
                console.log(
                    chalk.yellow(`⚠️ Tars supervisor [${instanceName}] is already running.`)
                );
                return;
            }
            if (activeSupervisors.length > 0) {
                throw new Error(
                    `This TARS_HOME is already active as ${activeSupervisors.map(({ name }) => `[${name}]`).join(', ')}. Stop it before starting another engine.`
                );
            }

            await new Promise<void>((resolve, reject) => {
                pm2.connect((err) => {
                    if (err) {
                        console.error(chalk.red('❌ Failed to connect to PM2'), err);
                        reject(err);
                        return;
                    }

                    // Check if this specific instance is already running
                    pm2.describe(instanceName, (err, list) => {
                        if (!err && list && list.length > 0) {
                            pm2.disconnect();
                            reject(
                                new Error(
                                    `PM2 process name [${instanceName}] already exists. Run "tars stop" for its TARS_HOME or choose a unique --name.`
                                )
                            );
                            return;
                        }

                        try {
                            persistInstanceIdentity(tarsHome, instanceName, role);
                        } catch (error) {
                            pm2.disconnect();
                            reject(error);
                            return;
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
                                    ...createTarsPm2Identity('supervisor'),
                                    TARS_SUPERVISOR_MODE: 'true',
                                    TARS_HOME: tarsHome,
                                    TARS_INSTANCE_NAME: instanceName,
                                    TARS_INSTANCE_ROLE: role,
                                    REAL_HOME: os.homedir(),
                                    NODE_NO_WARNINGS: '1'
                                },
                                node_args: [
                                    '--no-warnings',
                                    '--disable-warning=ExperimentalWarning'
                                ]
                            },
                            (err) => {
                                pm2.disconnect();
                                if (err) {
                                    console.error(
                                        chalk.red(`❌ Error starting Tars [${instanceName}]:`),
                                        err
                                    );
                                    reject(err);
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
        })
    );
}
