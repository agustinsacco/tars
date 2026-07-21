import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

// pi-coding-agent publishes an npm-shrinkwrap that currently overrides root-level
// resolutions. Keep its vulnerable nested copies from surviving installation while
// upstream catches up, without downloading or executing any additional packages.
const repairs = [
    {
        minimumVersion: [5, 0, 7],
        name: 'brace-expansion',
        nestedPath: path.join(
            packageRoot,
            'node_modules',
            '@earendil-works',
            'pi-coding-agent',
            'node_modules',
            'brace-expansion'
        ),
        patchedPath: path.join(packageRoot, 'node_modules', 'brace-expansion')
    },
    {
        minimumVersion: [7, 6, 5],
        name: 'protobufjs',
        nestedPath: path.join(
            packageRoot,
            'node_modules',
            '@earendil-works',
            'pi-coding-agent',
            'node_modules',
            'protobufjs'
        ),
        patchedPath: path.join(packageRoot, 'node_modules', 'protobufjs')
    }
];

function readVersion(directory) {
    const manifestPath = path.join(directory, 'package.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (typeof manifest.version !== 'string') throw new Error(`Missing version in ${manifestPath}`);
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

for (const repair of repairs) {
    const patchedVersion = readVersion(repair.patchedPath);
    if (!isAtLeast(patchedVersion, repair.minimumVersion)) {
        throw new Error(`${repair.name} ${patchedVersion} is below the required patched version.`);
    }
    if (!fs.existsSync(repair.nestedPath)) continue;

    const nestedVersion = readVersion(repair.nestedPath);
    if (isAtLeast(nestedVersion, repair.minimumVersion)) continue;

    fs.rmSync(repair.nestedPath, { force: false, recursive: true });
    const target =
        process.platform === 'win32'
            ? repair.patchedPath
            : path.relative(path.dirname(repair.nestedPath), repair.patchedPath);
    fs.symlinkSync(target, repair.nestedPath, process.platform === 'win32' ? 'junction' : 'dir');
    console.log(`Enforced patched ${repair.name} ${patchedVersion} for pi-coding-agent.`);
}
