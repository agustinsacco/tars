import chalk from 'chalk';
import { migrateMcpPoliciesInteractively } from './extensions.js';
import { restartActiveTarsProcessesByHome } from '../../utils/pm2-processes.js';
import { getTarsHome } from '../../utils/paths.js';
import { withTarsHomeMutationLease } from '../../utils/tars-home-lease.js';

export async function restart(): Promise<boolean> {
    const tarsHome = getTarsHome();
    return withTarsHomeMutationLease(tarsHome, 'restart Tars', () => restartWithLease(tarsHome));
}

async function restartWithLease(tarsHome: string): Promise<boolean> {
    console.log(chalk.cyan(`🔄 Restarting active Tars processes for ${tarsHome}...`));
    const migration = await migrateMcpPoliciesInteractively(tarsHome);
    if (!migration.ready) {
        console.log(chalk.yellow('⚠️ Restart cancelled until extension policies are ready.'));
        return false;
    }

    const restarted = await restartActiveTarsProcessesByHome(tarsHome);
    if (restarted.length === 0) {
        console.log(chalk.yellow('⚠️ No active Tars processes found. Run `tars start` first.'));
        return false;
    }
    console.log(
        chalk.green(`✅ Restarted ${restarted.map(({ name }) => `[${name}]`).join(', ')}.`)
    );
    return true;
}
