import pm2 from 'pm2';
import path from 'path';
import fs from 'fs';
import logger from '../utils/logger.js';
import { Config } from '../config/config.js';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class DashboardService {
    private readonly dashDir: string;
    private readonly dashName: string;

    constructor(private readonly config: Config) {
        // Dashboard is now located in ~/.tars/apps/dashboard
        this.dashDir = path.join(this.config.homeDir, 'apps', 'dashboard');
        this.dashName = `${this.config.instanceName}-dash`;
    }

    public async start(): Promise<void> {
        if (!fs.existsSync(this.dashDir)) {
            logger.warn('⚠️ Tars Dashboard directory not found. Skipping dashboard start.');
            return;
        }

        const dashEnabled = process.env.DASH_ENABLED === 'true';
        if (!dashEnabled) return;

        return new Promise((resolve) => {
            pm2.connect((err) => {
                if (err) {
                    logger.error(`❌ PM2 connection failed for Dashboard: ${err.message}`);
                    resolve();
                    return;
                }

                this.startDash().finally(() => {
                    pm2.disconnect();
                    resolve();
                });
            });
        });
    }

    private async startDash(): Promise<void> {
        return new Promise((resolve) => {
            logger.info(`🚀 Starting Tars Dashboard [${this.dashName}] (PM2)...`);

            const port = process.env.DASH_PORT || '3000';

            // Strip PM2 injected variables to prevent overwriting the parent process
            const cleanEnv: Record<string, string | undefined> = { ...process.env };
            for (const key of Object.keys(cleanEnv)) {
                if (
                    key.startsWith('PM2_') ||
                    key.startsWith('pm_') ||
                    ['name', 'status', 'unique_id', 'pm2_env'].includes(key)
                ) {
                    delete cleanEnv[key];
                }
            }

            pm2.start(
                {
                    script: 'server.js',
                    name: this.dashName,
                    cwd: this.dashDir,
                    env: {
                        ...cleanEnv,
                        PORT: port,
                        NODE_ENV: 'production'
                    }
                },
                (err) => {
                    if (err) {
                        logger.error(
                            `❌ Dashboard [${this.dashName}] failed to start: ${err.message}`
                        );
                    } else {
                        logger.info(`✨ Dashboard [${this.dashName}] active on port ${port}`);
                        logger.info(`🔗 Local URL: http://localhost:${port}`);
                    }
                    resolve();
                }
            );
        });
    }

    public stop(): void {
        pm2.connect((err) => {
            if (err) return;

            pm2.delete(this.dashName, () => {
                pm2.disconnect();
            });
        });
    }
}
