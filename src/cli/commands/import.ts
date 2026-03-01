import { spawn } from 'child_process';
import chalk from 'chalk';
import os from 'os';
import path from 'path';
import fs from 'fs';
import { BrainAuditor } from '../../utils/brain-audit.js';
import { getTarsHome } from '../../utils/paths.js';

export async function importBrain(archivePath: string) {
    const fullPath = path.resolve(archivePath);
    const tarsHome = getTarsHome();
    const parentDir = path.dirname(tarsHome);

    console.log(chalk.cyan(`📥 Importing Tars brain from ${fullPath}...`));

    // 1. Extract the archive into the parent directory
    const tar = spawn('tar', ['-xzf', fullPath, '-C', parentDir]);

    tar.stderr.on('data', (data) => console.warn(chalk.yellow(data.toString())));

    return new Promise<void>((resolve) => {
        tar.on('close', async (code) => {
            if (code !== 0) {
                console.error(
                    chalk.red('\n❌ Import failed. Check if the file exists and is valid.')
                );
                resolve();
                return;
            }

            // 2. Machine Portability & Healing
            const auditor = new BrainAuditor();
            await auditor.audit();

            console.log(chalk.green('\n✅ Brain imported successfully!'));
            console.log(`Tars is now restored. Run ${chalk.cyan('tars status')} to verify.`);
            resolve();
        });
    });
}
