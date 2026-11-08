import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

// Pi 0.85.1's published shrinkwrap wins over npm overrides, even during npm ci.
// Keep its source/version pinned while replacing vulnerable nested dependencies
// with the registry-verified copies installed by this project's lockfile.
const repairs = [
    { minimumVersion: [5, 0, 12], name: 'brace-expansion' },
    { minimumVersion: [7, 6, 5], name: 'protobufjs' },
    { minimumVersion: [8, 12, 4], name: 'undici' },
    { minimumVersion: [11, 0, 2], name: 'minimatch' }
];

function readVersion(directory) {
    const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8'));
    if (typeof manifest.version !== 'string') throw new Error(`Missing version in ${directory}`);
    return manifest.version;
}

function isAtLeast(version, minimum) {
    const parts = /^(\d+)\.(\d+)\.(\d+)$/.exec(version)?.slice(1).map(Number);
    if (!parts) return false;
    for (let index = 0; index < minimum.length; index++) {
        if (parts[index] > minimum[index]) return true;
        if (parts[index] < minimum[index]) return false;
    }
    return true;
}

export function enforcePatchedTransitives(root, { repairLockfile = false } = {}) {
    const lockPath = path.join(root, 'package-lock.json');
    const lock = repairLockfile ? JSON.parse(fs.readFileSync(lockPath, 'utf8')) : undefined;
    // Validate every replacement before changing the installation or lockfile.
    const planned = repairs.map((repair) => {
        const patchedPath = path.join(root, 'node_modules', repair.name);
        const version = readVersion(patchedPath);
        if (!isAtLeast(version, repair.minimumVersion)) {
            throw new Error(`${repair.name} ${version} is below the required patched version.`);
        }
        const nestedKey = `node_modules/@earendil-works/pi-coding-agent/node_modules/${repair.name}`;
        const replacement = lock?.packages?.[`node_modules/${repair.name}`];
        if (
            lock?.packages?.[nestedKey] &&
            (replacement?.version !== version || !replacement?.resolved || !replacement?.integrity)
        ) {
            throw new Error(`Missing matching registry lock metadata for ${repair.name}.`);
        }
        return { ...repair, patchedPath, version, nestedKey, replacement };
    });

    for (const repair of planned) {
        const nestedPath = path.join(root, repair.nestedKey);
        if (
            fs.existsSync(nestedPath) &&
            !isAtLeast(readVersion(nestedPath), repair.minimumVersion)
        ) {
            // Removing a symlink never traverses or deletes its target.
            fs.rmSync(nestedPath, { force: false, recursive: true });
            const target =
                process.platform === 'win32'
                    ? repair.patchedPath
                    : path.relative(path.dirname(nestedPath), repair.patchedPath);
            fs.symlinkSync(target, nestedPath, process.platform === 'win32' ? 'junction' : 'dir');
            console.log(`Enforced patched ${repair.name} ${repair.version} for pi-coding-agent.`);
        }
        if (lock?.packages?.[repair.nestedKey]) {
            // Copy genuine npm-resolved metadata, including integrity, rather than
            // inventing versions or deleting advisories. Normal postinstall above
            // makes the installed packages match this audited final dependency tree.
            lock.packages[repair.nestedKey] = { ...repair.replacement };
        }
    }
    if (lock) fs.writeFileSync(lockPath, JSON.stringify(lock, null, 4) + '\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    enforcePatchedTransitives(packageRoot, {
        repairLockfile: process.argv.includes('--repair-lockfile')
    });
}
