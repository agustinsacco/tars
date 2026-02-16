import { spawn } from 'child_process';
import chalk from 'chalk';
import path from 'path';
import os from 'os';

export async function exportBrain(options: { output?: string }) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const defaultName = `tars-brain-${timestamp}.tar.gz`;
    const outputPath = options.output
        ? path.resolve(options.output)
        : path.join(process.cwd(), defaultName);

    console.log(chalk.cyan(`📦 Exporting Tars brain to ${outputPath}...`));

    const tarsHome = path.join(os.homedir(), '.tars');
    const geminiHome = path.join(os.homedir(), '.gemini');

    // Exclude heavy directories to keep the brain lean
    const excludes = [
        '--exclude=node_modules',
        '--exclude=.next',
        '--exclude=dist',
        '--exclude=build',
        '--exclude=.cache',
        '--exclude=venv',
        '--exclude=.venv',
        '--exclude=target', // Rust
        '--exclude=vendor', // PHP/Go
        '--exclude=.sass-cache'
    ];

    const tar = spawn('tar', ['-czf', outputPath, ...excludes, '-C', os.homedir(), '.tars']);

    tar.stderr.on('data', (data) => console.warn(chalk.yellow(data.toString())));

    tar.on('close', (code) => {
        if (code === 0) {
            console.log(chalk.green('\n✅ Brain exported successfully!'));
            console.log(`Keep this file safe: ${chalk.bold(outputPath)}`);
        } else {
            console.error(chalk.red('\n❌ Export failed.'));
        }
    });
}
