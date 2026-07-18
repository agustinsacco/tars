import { rm } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const sourcePaths = ['dist'];
const extensionPaths = [
    'extensions/memory/dist',
    'extensions/search/dist',
    'extensions/tasks/dist'
];

const corePaths = [...sourcePaths, ...extensionPaths];
const allPaths = [...corePaths, 'coverage', 'dash/.next', 'site/dist'];
const modes = new Map([
    ['src', sourcePaths],
    ['extensions', extensionPaths],
    ['core', corePaths],
    ['all', allPaths]
]);

const mode = process.argv[2];
const paths = modes.get(mode);

if (!paths) {
    throw new Error(`Expected one of: ${[...modes.keys()].join(', ')}`);
}

for (const relativePath of paths) {
    const targetPath = path.resolve(repositoryRoot, relativePath);
    if (!targetPath.startsWith(`${repositoryRoot}${path.sep}`)) {
        throw new Error(`Refusing to clean path outside the repository: ${targetPath}`);
    }
    await rm(targetPath, { force: true, recursive: true });
}
