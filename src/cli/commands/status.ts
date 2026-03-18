import pm2 from 'pm2';
import chalk from 'chalk';
import { pkg, isDev } from '../../utils/version.js';
import { Config } from '../../config/config.js';
import { SessionManager } from '../../supervisor/session-manager.js';

export async function status() {
    // Load config to find session file
    const config = Config.getInstance();
    const sessionManager = new SessionManager(config.sessionFilePath);
    const stats = sessionManager.load(); // Just loads ID, but populates internal state if exists
    // Actually we need to call load() then check internal state or re-read
    // SessionManager.load() returns ID but populates this.sessionData.
    // However, status.ts is a separate process from supervisor.
    // So we just need to read the file directly or use SessionManager.

    // Let's use SessionManager since we have it.
    // Issue: load() returns string | null. We need getStats().
    // We must call load() first to populate internal state from disk.
    sessionManager.load();
    const sessionStats = sessionManager.getStats();

    pm2.connect((err) => {
        if (err) {
            console.error(chalk.red('❌ Failed to connect to PM2'), err);
            process.exit(2);
        }

        const instanceName = config.instanceName;

        pm2.list((err, list) => {
            pm2.disconnect();
            if (err || !list || list.length === 0) {
                console.log(chalk.red(`🔴 Tars supervisor [${instanceName}] is not running.`));
                return;
            }

            const proc = list.find((p) => p.name === instanceName);
            const dashProc = list.find((p) => p.name === `${instanceName}-dash`);
            const tunnelProc = list.find((p) => p.name === `${instanceName}-tunnel`);

            if (!proc) {
                console.log(chalk.red(`🔴 Tars supervisor [${instanceName}] is not running.`));
                return;
            }

            const status =
                proc.pm2_env?.status === 'online'
                    ? chalk.green('online')
                    : chalk.red(proc.pm2_env?.status);

            console.log(chalk.cyan.bold('\n📊 Tars Status'));
            console.log(chalk.cyan('──────────────'));
            console.log(`Version: ${pkg.version}${isDev ? chalk.yellow(' (dev)') : ''}`);
            console.log(`Status:  ${status}`);
            console.log(`CPU:     ${proc.monit?.cpu}%`);
            console.log(
                `Memory:  ${(proc.monit?.memory ? proc.monit.memory / 1024 / 1024 : 0).toFixed(1)} MB`
            );
            console.log(
                `Uptime:  ${Math.floor((Date.now() - (proc.pm2_env?.pm_uptime || 0)) / 1000 / 60)} minutes`
            );
            console.log(`PID:     ${proc.pid}`);

            if (dashProc) {
                const dashStatus =
                    dashProc.pm2_env?.status === 'online'
                        ? chalk.green('online')
                        : chalk.red(dashProc.pm2_env?.status);
                const port = process.env.DASH_PORT || '3000';
                console.log(`Dash:    ${dashStatus} (port ${port})`);
            }

            if (tunnelProc) {
                const tunnelStatus =
                    tunnelProc.pm2_env?.status === 'online'
                        ? chalk.green('online')
                        : chalk.red(tunnelProc.pm2_env?.status);
                console.log(`Tunnel:  ${tunnelStatus}`);
            }

            if (sessionStats) {
                console.log(chalk.cyan('──────────────'));
                console.log(chalk.bold('🧠 Session Stats'));
                console.log(`Session ID:   ${sessionStats.sessionId}`);
                console.log(`Interactions: ${sessionStats.interactionCount}`);
                console.log(`Context Size: ${(sessionStats.totalInputTokens / 1000).toFixed(1)}k`);
                console.log(`Cached:       ${(sessionStats.totalCachedTokens / 1000).toFixed(1)}k`);
                console.log(
                    `Total Usage:  ${((sessionStats.totalNetTokens + sessionStats.totalOutputTokens) / 1000).toFixed(1)}k`
                );
            }

            console.log(`\nLogs:    tars logs\n`);
        });
    });
}
        });
    });
}
