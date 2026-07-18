import chalk from 'chalk';
import { deleteTarsProcessesByHome } from '../../utils/pm2-processes.js';
import { getTarsHome } from '../../utils/paths.js';
import { withTarsHomeMutationLease } from '../../utils/tars-home-lease.js';

export async function stop(): Promise<void> {
    const tarsHome = getTarsHome();
    await withTarsHomeMutationLease(tarsHome, 'stop Tars', () => stopWithLease(tarsHome));
}

async function stopWithLease(tarsHome: string): Promise<void> {
    console.log(chalk.cyan(`🛑 Stopping Tars processes for ${tarsHome}...`));
    const removed = await deleteTarsProcessesByHome(tarsHome);
    if (removed.length === 0) {
        console.log(chalk.yellow('⚠️ No PM2-managed Tars processes were found for this home.'));
        return;
    }
    console.log(
        chalk.green(`✅ Removed ${removed.map(({ name }) => `[${name}]`).join(', ')} from PM2.`)
    );
}
