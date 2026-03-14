import pm2 from 'pm2';
import chalk from 'chalk';
import fs from 'fs';
import path from 'path';
import qrcode from 'qrcode-terminal';
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

        pm2.describe('tars-supervisor', (err, list) => {
            pm2.disconnect();
            if (err || !list || list.length === 0) {
                console.log(chalk.red('🔴 Tars supervisor is not running.'));
                return;
            }

            const proc = list[0];
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

            const qrPath = path.join(config.homeDir, 'data', 'whatsapp-qr.txt');
            if (fs.existsSync(qrPath)) {
                try {
                    const qrString = fs.readFileSync(qrPath, 'utf8');
                    if (qrString) {
                        console.log(chalk.cyan('──────────────'));
                        console.log(chalk.bold('📱 WhatsApp Registration Required'));
                        console.log(
                            chalk.dim('Scan the QR code below from your WhatsApp app to link Tars:')
                        );
                        qrcode.generate(qrString, { small: true });
                        console.log('');
                    }
                } catch (err: any) {
                    // ignore if file couldn't be read in the split second it generated
                }
            }
        });
    });
}
