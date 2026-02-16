import chalk from 'chalk';
import { SecretsManager } from '../../utils/secrets-manager.js';
import { Config } from '../../config/config.js';

/**
 * tars secret set <KEY> <VALUE>
 * tars secret list
 * tars secret remove <KEY>
 */
export async function secret(action: string, key?: string, value?: string) {
    const config = Config.getInstance();
    const secretsManager = new SecretsManager(config.homeDir);

    switch (action) {
        case 'set':
            if (!key || !value) {
                console.log(chalk.red('❌ Usage: tars secret set <KEY> <VALUE>'));
                return;
            }
            secretsManager.set(key, value);
            console.log(chalk.green(`✅ Secret ${chalk.bold(key)} stored securely.`));
            console.log(chalk.dim('Tars supervisor will need to restart to pick up the change.'));
            break;

        case 'list':
            const keys = secretsManager.list();
            if (keys.length === 0) {
                console.log(chalk.yellow('No secrets stored.'));
                return;
            }
            console.log(chalk.cyan.bold('\n🔒 Stored Secrets (Keys only)'));
            console.log(chalk.cyan('──────────────────────────'));
            keys.forEach((k) => console.log(`- ${k}`));
            console.log('');
            break;

        case 'remove':
            if (!key) {
                console.log(chalk.red('❌ Usage: tars secret remove <KEY>'));
                return;
            }
            secretsManager.remove(key);
            console.log(chalk.green(`✅ Secret ${chalk.bold(key)} removed.`));
            break;

        default:
            console.log(chalk.red(`❌ Unknown action: ${action}`));
            console.log(chalk.dim('Try: set, list, remove'));
    }
}
