import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Find package.json by walking up (handles both src/ and dist/ structures)
function getPkg() {
    let currentDir = __dirname;
    while (currentDir !== path.parse(currentDir).root) {
        const pkgPath = path.join(currentDir, 'package.json');
        try {
            return JSON.parse(readFileSync(pkgPath, 'utf-8'));
        } catch {
            currentDir = path.dirname(currentDir);
        }
    }
    return { version: '0.0.0' };
}

export const pkg = getPkg();
export const isDev = !__filename.includes('node_modules');
export const versionString = `${pkg.version}${isDev ? ' (dev)' : ''}`;
