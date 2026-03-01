import path from 'path';
import os from 'os';

/**
 * Resolves the Tars Home directory.
 * Priority:
 * 1. TARS_HOME environment variable
 * 2. ~/.tars (default)
 *
 * Includes logic to prevent recursion if HOME is already pointing to a .tars directory.
 */
export function getTarsHome(): string {
    const realUserHome = process.env.REAL_HOME || os.homedir();
    // If REAL_HOME is set, we use it as the base.
    // If not, we use os.homedir() but strip out existing .tars suffix if it's already there (to avoid nesting)
    const base = realUserHome.replace(/\/\.tars$/, '');
    return process.env.TARS_HOME || path.join(base, '.tars');
}
