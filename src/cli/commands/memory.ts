import chalk from 'chalk';
import { Config } from '../../config/config.js';
import { MemoryManager } from '../../memory/memory-manager.js';
import { withTarsHomeMutationLease } from '../../utils/tars-home-lease.js';

export async function memory(action: string, ...args: string[]): Promise<void> {
    const config = Config.getInstance();
    await withTarsHomeMutationLease(config.homeDir, `${action} Tars memory`, () =>
        runMemoryAction(config, action, args)
    );
}

async function runMemoryAction(config: Config, action: string, args: string[]): Promise<void> {
    const manager = new MemoryManager(config);

    switch (action) {
        case 'search':
            const query = args.join(' ');
            if (!query) {
                console.error(chalk.red('❌ Please provide a search query.'));
                return;
            }
            const results = await manager.search(query);
            if (results.length === 0) {
                console.log(chalk.yellow('No matching memories found.'));
            } else {
                console.log(chalk.cyan(`\n🧠 Search Results for: "${query}"`));
                results.forEach((r, i) => {
                    console.log(
                        chalk.white(
                            `\n[${i + 1}] ${chalk.bold(r.path)} (Score: ${r.score.toFixed(2)})`
                        )
                    );
                    console.log(chalk.gray(r.content));
                });
            }
            break;

        case 'sync':
            console.log(chalk.cyan('🔄 Syncing knowledge base...'));
            await manager.fullSync();
            console.log(chalk.green('✅ Sync complete.'));
            break;

        default:
            console.error(chalk.red(`❌ Unknown action: ${action}`));
    }
}
