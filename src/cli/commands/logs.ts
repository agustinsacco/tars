import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

/**
 * tars logs - Wrapper for pm2 logs tars-supervisor
 */
export async function logs() {
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const pm2Path = path.resolve(__dirname, '../../../node_modules/.bin/pm2');

    // Run pm2 logs
    const child = spawn(pm2Path, ['logs', 'tars-supervisor', '--lines', '20'], {
        stdio: 'inherit',
        shell: true
    });

    child.on('error', (err) => {
        // Fallback to npx if relative path fails (though it shouldn't)
        spawn('npx', ['pm2', 'logs', 'tars-supervisor', '--lines', '20'], {
            stdio: 'inherit',
            shell: true
        });
    });
}
