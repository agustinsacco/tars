import fs from 'fs';
import path from 'path';
import pm2 from 'pm2';
import { Config } from '../config/config.js';
import logger from '../utils/logger.js';
import {
    createTarsPm2Identity,
    deleteTarsProcessNames,
    findTarsProcessesByHome
} from '../utils/pm2-processes.js';

const unsafeDashboardPasswords = new Set(['changeme', 'tars123']);

export function isSafeDashboardPassword(password: string | undefined): boolean {
    const normalized = password?.trim().toLowerCase();
    return Boolean(
        normalized && normalized.length >= 16 && !unsafeDashboardPasswords.has(normalized)
    );
}

export class DashboardService {
    private readonly dashDir: string;
    private readonly dashName: string;

    constructor(private readonly config: Config) {
        // Dashboard is now located in ~/.tars/apps/dashboard
        this.dashDir = path.join(this.config.homeDir, 'apps', 'dashboard');
        this.dashName = `${this.config.instanceName}-dash`;
    }

    public async start(): Promise<void> {
        const dashEnabled = process.env.DASH_ENABLED === 'true';
        if (!dashEnabled) return;

        if (!isSafeDashboardPassword(process.env.DASH_PASSWORD)) {
            logger.error(
                '❌ Dashboard disabled: configure a strong DASH_PASSWORD before enabling it.'
            );
            return;
        }

        if (!fs.existsSync(this.dashDir)) {
            logger.warn('⚠️ Tars Dashboard directory not found. Skipping dashboard start.');
            return;
        }

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
            const host = process.env.DASH_HOST || '127.0.0.1';

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
                        DASH_HOST: host,
                        ...createTarsPm2Identity('dashboard'),
                        TARS_HOME: this.config.homeDir,
                        TARS_SUPERVISOR_MODE: 'false',
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
                        logger.info(`🔗 Dashboard URL: http://${host}:${port}`);
                    }
                    resolve();
                }
            );
        });
    }

    public async stop(): Promise<void> {
        try {
            const dashboard = (await findTarsProcessesByHome(this.config.homeDir)).find(
                ({ kind, name }) => kind === 'dashboard' && name === this.dashName
            );
            if (!dashboard) return;
            await deleteTarsProcessNames([dashboard.name]);
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            logger.warn(`[DashboardService] Failed to stop dashboard: ${message}`);
        }
    }
}
