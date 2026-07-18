import chalk from 'chalk';
import { SecretsManager } from '../../utils/secrets-manager.js';
import { Config } from '../../config/config.js';
import { withTarsHomeMutationLease } from '../../utils/tars-home-lease.js';

async function readSecretFromStdin(): Promise<string | undefined> {
    if (process.stdin.isTTY) return undefined;
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of process.stdin) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
        size += buffer.length;
        if (size > 65_536) throw new Error('Secret value exceeds 65536 bytes.');
        chunks.push(buffer);
    }
    const value = Buffer.concat(chunks)
        .toString('utf8')
        .replace(/[\r\n]+$/, '');
    return value || undefined;
}

/**
 * printf '%s' "$VALUE" | tars secret set <KEY>
 * tars secret list
 * tars secret remove <KEY>
 */
export async function secret(action: string, key?: string, value?: string): Promise<void> {
    const config = Config.getInstance();
    if (action === 'set' || action === 'remove') {
        await withTarsHomeMutationLease(config.homeDir, 'modify Tars secrets', () =>
            runSecretAction(config.homeDir, action, key, value)
        );
        return;
    }
    await runSecretAction(config.homeDir, action, key, value);
}

async function runSecretAction(
    tarsHome: string,
    action: string,
    key?: string,
    value?: string
): Promise<void> {
    const secretsManager = new SecretsManager(tarsHome);

    switch (action) {
        case 'set':
            value = value ?? (await readSecretFromStdin());
            if (!key || !value) {
                console.log(
                    chalk.red(
                        `❌ Usage: printf '%s' "$VALUE" | tars secret set <KEY> (inline VALUE remains supported for compatibility)`
                    )
                );
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
