import { spawn } from 'child_process';
import chalk from 'chalk';
import os from 'os';
import path from 'path';
import fs from 'fs';

export async function importBrain(archivePath: string) {
    const fullPath = path.resolve(archivePath);
    const homeDir = os.homedir();
    const tarsDir = path.join(homeDir, '.tars');

    console.log(chalk.cyan(`📥 Importing Tars brain from ${fullPath}...`));

    // 1. Extract the archive
    const tar = spawn('tar', ['-xzf', fullPath, '-C', homeDir]);

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

            // 2. Machine Portability: Re-home absolute paths in extension-enablement.json
            const enablementPath = path.join(
                tarsDir,
                '.gemini',
                'extensions',
                'extension-enablement.json'
            );

            if (fs.existsSync(enablementPath)) {
                try {
                    console.log(chalk.blue('🏠 Normalizing paths for this machine...'));
                    const content = fs.readFileSync(enablementPath, 'utf-8');

                    // Regex to find things that look like old home directory paths ending in .tars
                    // e.g. /home/olduser/.tars/* or /Users/olduser/.tars/* -> current tarsDir
                    const rehomedContent = content.replace(
                        /\/(home|Users)\/[^/]+\/\.tars/g,
                        tarsDir
                    );

                    if (content !== rehomedContent) {
                        fs.writeFileSync(enablementPath, rehomedContent);
                        console.log(chalk.green('✨ Extensions successfully re-homed.'));
                    }
                } catch (err: any) {
                    console.warn(
                        chalk.yellow(`⚠️ Could not normalize extension paths: ${err.message}`)
                    );
                }
            }

            console.log(chalk.green('\n✅ Brain imported successfully!'));
            console.log(`Tars is now restored. Run ${chalk.cyan('tars status')} to verify.`);
            resolve();
        });
    });
}
