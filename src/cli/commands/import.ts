import { spawn } from 'child_process';
import chalk from 'chalk';
import os from 'os';
import path from 'path';

export async function importBrain(archivePath: string) {
    const fullPath = path.resolve(archivePath);
    console.log(chalk.cyan(`📥 Importing Tars brain from ${fullPath}...`));

    // Confirm overwrite if directories exist?
    // For now, simplicity: just extract.

    const tar = spawn('tar', ['-xzf', fullPath, '-C', os.homedir()]);

    tar.stderr.on('data', (data) => console.warn(chalk.yellow(data.toString())));

    tar.on('close', (code) => {
        if (code === 0) {
            console.log(chalk.green('\n✅ Brain imported successfully!'));
            console.log(`Tars is now restored. Run ${chalk.cyan('tars status')} to verify.`);
        } else {
            console.error(chalk.red('\n❌ Import failed. Check if the file exists and is valid.'));
        }
    });
}
