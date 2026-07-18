import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function canonicalizeExistingPath(filePath: string): string {
    try {
        return fs.realpathSync.native(filePath);
    } catch {
        return filePath;
    }
}

function normalizeUserHome(homePath: string): string {
    const resolved = path.resolve(homePath);
    return path.basename(resolved) === '.tars' ? path.dirname(resolved) : resolved;
}

/**
 * Resolves the Tars Home directory.
 * Priority:
 * 1. TARS_HOME environment variable
 * 2. ~/.tars (default)
 *
 * Includes logic to prevent recursion if HOME is already pointing to a .tars directory.
 */
export function getTarsHome(): string {
    const userHomes = [process.env.REAL_HOME, os.homedir()]
        .filter((value): value is string => Boolean(value?.trim()))
        .map(normalizeUserHome);
    const base = userHomes[0] ?? normalizeUserHome(os.homedir());
    const configuredHome = process.env.TARS_HOME?.trim();
    const resolvedHome = path.resolve(configuredHome || path.join(base, '.tars'));
    const canonicalHome = canonicalizeExistingPath(resolvedHome);
    const protectedHomes = new Set(
        userHomes.flatMap((home) => [home, canonicalizeExistingPath(home)])
    );

    if (
        resolvedHome === path.parse(resolvedHome).root ||
        canonicalHome === path.parse(canonicalHome).root
    ) {
        throw new Error('Refusing to use a filesystem root as TARS_HOME.');
    }
    if (protectedHomes.has(resolvedHome) || protectedHomes.has(canonicalHome)) {
        throw new Error('Refusing to use a user home directory as TARS_HOME.');
    }

    return resolvedHome;
}
