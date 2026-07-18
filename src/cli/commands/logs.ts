import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { Config } from '../../config/config.js';

/**
 * tars logs - Wrapper for pm2 logs tars-supervisor
 */
export async function logs(): Promise<void> {
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const pm2Path = path.resolve(__dirname, '../../../node_modules/.bin/pm2');

    const instanceName = Config.getInstance().instanceName;
    const args = ['logs', instanceName, '--lines', '20'];
    const child = spawn(pm2Path, args, {
        stdio: 'inherit',
        shell: false
    });

    child.on('error', () => {
        spawn('pm2', args, {
            stdio: 'inherit',
            shell: false
        });
    });
}
