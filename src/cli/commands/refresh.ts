import { execSync } from 'child_process';
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import chalk from 'chalk';
import ora from 'ora';
import { getTarsHome } from '../../utils/paths.js';

/**
 * Resolves the package source directory for bundled assets (dash/, extensions/).
 * Works both in development (src/) and production (dist/).
 */
function getPackageRoot(): string {
    const thisFile = new URL(import.meta.url).pathname;
    // From dist/cli/commands/refresh.js → go up 3 levels to package root
    // From src/cli/commands/refresh.ts → go up 3 levels to package root
    return path.resolve(path.dirname(thisFile), '../../..');
}

export interface RefreshOptions {
    /** Refresh extensions (default: true) */
    extensions?: boolean;
    /** Refresh dashboard (default: true) */
    dashboard?: boolean;
    /** Force refresh even if already installed (default: true for refresh, false for setup) */
    force?: boolean;
    /** Silent mode — suppress output (for testing) */
    silent?: boolean;
}

/**
 * Refreshes extensions from the package source to ~/.tars/.gemini/extensions/.
 * Deletes existing copies and re-copies + rebuilds.
 */
export async function refreshExtensions(tarsHome: string, silent = false): Promise<boolean> {
    const packageRoot = getPackageRoot();
    const extensionsSrc = path.join(packageRoot, 'extensions');
    const extensionsDest = path.join(tarsHome, 'extensions');

    if (!fs.existsSync(extensionsSrc)) {
        if (!silent) console.log(chalk.yellow('  ⚠ Extensions source not found. Skipping.'));
        return false;
    }

    await fsp.mkdir(extensionsDest, { recursive: true });

    const extensions = fs.readdirSync(extensionsSrc);
    let allOk = true;

    for (const extName of extensions) {
        const extSrc = path.join(extensionsSrc, extName);
        if (!fs.statSync(extSrc).isDirectory()) continue;

        const finalExtName =
            extName === 'tasks' ? 'tars-tasks' : extName === 'memory' ? 'tars-memory' : extName;
        const linkTarget = path.join(extensionsDest, finalExtName);

        const spinner = silent ? null : ora(`  Refreshing extension: ${finalExtName}...`).start();

        try {
            let exists = false;
            try {
                await fsp.lstat(linkTarget);
                exists = true;
            } catch {}

            if (exists) {
                await fsp.rm(linkTarget, {
                    recursive: true,
                    force: true,
                    maxRetries: 3,
                    retryDelay: 200
                });
            }
            await fsp.cp(extSrc, linkTarget, { recursive: true });
            if (spinner) spinner.text = `  Hydrating ${finalExtName}...`;
            execSync('npm install', { cwd: linkTarget, stdio: 'pipe' });
            execSync('npm run build', { cwd: linkTarget, stdio: 'pipe' });
            if (spinner) spinner.succeed(`  Extension refreshed: ${finalExtName}`);
        } catch (err: any) {
            allOk = false;
            if (spinner) spinner.warn(`  Extension ${finalExtName} failed: ${err.message}`);
        }
    }

    // Hydrate any user-installed or restored extensions missing node_modules
    if (fs.existsSync(extensionsDest)) {
        const destEntries = fs.readdirSync(extensionsDest);
        for (const destName of destEntries) {
            const extPath = path.join(extensionsDest, destName);
            if (!fs.statSync(extPath).isDirectory()) continue;

            const pkgJson = path.join(extPath, 'package.json');
            const nodeModules = path.join(extPath, 'node_modules');
            if (fs.existsSync(pkgJson) && !fs.existsSync(nodeModules)) {
                const spinner = silent
                    ? null
                    : ora(`  Hydrating restored extension: ${destName}...`).start();
                try {
                    execSync('npm install', { cwd: extPath, stdio: 'pipe' });
                    const pkgRaw = fs.readFileSync(pkgJson, 'utf-8');
                    const pkg = JSON.parse(pkgRaw);
                    if (pkg.scripts && pkg.scripts.build) {
                        execSync('npm run build', { cwd: extPath, stdio: 'pipe' });
                    }
                    if (spinner) spinner.succeed(`  Extension hydrated: ${destName}`);
                } catch (err: any) {
                    allOk = false;
                    const msg = err.stdout?.toString() || err.stderr?.toString() || err.message;
                    if (spinner)
                        spinner.warn(`  Extension hydration failed for ${destName}: ${msg}`);
                }
            }
        }
    }

    return allOk;
}

/**
 * Refreshes the dashboard from the package source to ~/.tars/apps/dashboard/.
 * Deletes existing copy and re-copies + rebuilds.
 */
export async function refreshDashboard(tarsHome: string, silent = false): Promise<boolean> {
    const packageRoot = getPackageRoot();
    const dashSrc = path.join(packageRoot, 'dash');
    const dashDest = path.join(tarsHome, 'apps', 'dashboard');

    if (!fs.existsSync(dashSrc)) {
        if (!silent) console.log(chalk.yellow('  ⚠ Dashboard source not found. Skipping.'));
        return false;
    }

    await fsp.mkdir(path.join(tarsHome, 'apps'), { recursive: true });

    const spinner = silent ? null : ora('  Refreshing Tars Dashboard...').start();

    try {
        if (fs.existsSync(dashDest)) {
            if (spinner) spinner.text = '  Stopping running dashboard service...';
            try {
                execSync('npx pm2 stop tars-dashboard', { stdio: 'ignore' });
            } catch (e) {
                // Ignore if not running or PM2 not installed
            }

            if (spinner) spinner.text = '  Removing existing dashboard...';
            try {
                await fsp.rm(dashDest, {
                    recursive: true,
                    force: true,
                    maxRetries: 3,
                    retryDelay: 200
                });
            } catch (rmErr: any) {
                if (rmErr.code === 'ENOTEMPTY' || rmErr.code === 'EBUSY') {
                    if (process.platform !== 'win32') {
                        execSync(`rm -rf "${dashDest}"`, { stdio: 'ignore' });
                    } else {
                        throw rmErr;
                    }
                } else {
                    throw rmErr;
                }
            }
        }

        await fsp.cp(dashSrc, dashDest, { recursive: true });

        if (spinner) spinner.text = '  Installing Dashboard dependencies...';
        execSync('npm install', { cwd: dashDest, stdio: 'pipe' });

        if (spinner) spinner.text = '  Building Dashboard...';
        execSync('npm run build', { cwd: dashDest, stdio: 'pipe' });

        if (spinner) spinner.succeed('  Dashboard refreshed to latest version.');
        return true;
    } catch (err: any) {
        const out = err.stdout?.toString() || err.stderr?.toString() || err.message;
        if (spinner) spinner.fail(`  Dashboard refresh failed: ${out}`);
        return false;
    }
}

/**
 * Full refresh — updates extensions and dashboard from the package source.
 * Used by `tars update` after npm upgrade and available standalone.
 */
export async function refresh(options: RefreshOptions = {}): Promise<void> {
    const { extensions = true, dashboard = true, silent = false } = options;
    const tarsHome = getTarsHome();

    if (!silent) {
        console.log(chalk.cyan.bold('\n🔄 Refreshing Tars Components'));
        console.log(chalk.cyan('━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n'));
    }

    if (extensions) {
        if (!silent) console.log(chalk.bold('Extensions:'));
        await refreshExtensions(tarsHome, silent);
        if (!silent) console.log('');
    }

    if (dashboard) {
        if (!silent) console.log(chalk.bold('Dashboard:'));
        await refreshDashboard(tarsHome, silent);
        if (!silent) console.log('');
    }

    if (!silent) {
        console.log(chalk.green.bold('✅ Refresh complete.'));
        console.log(chalk.dim('  Run "tars restart" to apply changes to a running instance.\n'));
    }
}
