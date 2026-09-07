import chalk from 'chalk';
import inquirer from 'inquirer';
import {
    type OAuthLoginCallbacks,
    type OAuthProviderInterface,
    type OAuthSelectPrompt
} from '@earendil-works/pi-ai';
import { type AuthStatus, type AuthStorage } from '@earendil-works/pi-coding-agent';

import { Config } from '../../config/config.js';
import { createAuthStorage, getAuthStoragePath } from '../../supervisor/model-manager.js';
import { withTarsHomeMutationLease } from '../../utils/tars-home-lease.js';

/**
 * Finds an OAuth provider by id. Returns undefined when the id is missing or
 * not offered, so the caller can list the valid ids.
 */
export function resolveOAuthProvider(
    providers: readonly OAuthProviderInterface[],
    requestedId: string | undefined
): OAuthProviderInterface | undefined {
    if (!requestedId) return undefined;
    return providers.find((provider) => provider.id === requestedId);
}

/** Renders one provider auth status line without exposing credential values. */
export function formatAuthStatusLine(
    providerId: string,
    providerName: string,
    status: AuthStatus
): string {
    if (!status.configured) return `- ${providerName} (${providerId}): not configured`;
    const source = status.label ?? status.source ?? 'configured';
    return `- ${providerName} (${providerId}): configured (${source})`;
}

function createLoginCallbacks(): OAuthLoginCallbacks {
    return {
        onAuth: (info) => {
            console.log(chalk.cyan('\n🔐 Open this URL in your browser to authorize:'));
            console.log(chalk.bold(info.url));
            if (info.instructions) console.log(chalk.dim(info.instructions));
        },
        onDeviceCode: (info) => {
            console.log(chalk.cyan(`\n🔐 Visit ${chalk.bold(info.verificationUri)} and enter:`));
            console.log(chalk.bold(info.userCode));
        },
        onPrompt: async (prompt) => {
            const answers = await inquirer.prompt<{ value: string }>([
                { type: 'input', name: 'value', message: prompt.message }
            ]);
            return answers.value ?? '';
        },
        onManualCodeInput: async () => {
            const answers = await inquirer.prompt<{ value: string }>([
                { type: 'input', name: 'value', message: 'Paste the authorization code:' }
            ]);
            return answers.value ?? '';
        },
        onSelect: async (prompt: OAuthSelectPrompt) => {
            const answers = await inquirer.prompt<{ value: string }>([
                {
                    type: 'list',
                    name: 'value',
                    message: prompt.message,
                    choices: prompt.options.map((option) => ({
                        name: option.label,
                        value: option.id
                    }))
                }
            ]);
            return answers.value;
        },
        onProgress: (message) => console.log(chalk.dim(message))
    };
}

function printAvailableProviders(providers: readonly OAuthProviderInterface[]): void {
    console.log(chalk.cyan('Available OAuth providers:'));
    for (const provider of providers) {
        console.log(`- ${provider.id} (${provider.name})`);
    }
    console.log(chalk.dim('API-key providers are configured with `tars secret set` instead.'));
}

async function runLogin(
    authStorage: AuthStorage,
    providers: readonly OAuthProviderInterface[],
    providerId: string | undefined
): Promise<boolean> {
    let provider = resolveOAuthProvider(providers, providerId);
    if (!provider && providerId) {
        console.log(chalk.red(`❌ Unknown OAuth provider: ${providerId}`));
        printAvailableProviders(providers);
        return false;
    }
    if (!provider) {
        const answers = await inquirer.prompt<{ value: string }>([
            {
                type: 'list',
                name: 'value',
                message: 'Which provider do you want to log in to?',
                choices: providers.map((candidate) => ({
                    name: `${candidate.name} (${candidate.id})`,
                    value: candidate.id
                }))
            }
        ]);
        provider = resolveOAuthProvider(providers, answers.value);
        if (!provider) return false;
    }

    await authStorage.login(provider.id, createLoginCallbacks());
    console.log(chalk.green(`\n✅ Logged in to ${provider.name}.`));
    console.log(
        chalk.dim(
            'Credentials are stored in auth.json inside your Tars home. The supervisor picks them up on the next message; no restart is required.'
        )
    );
    return true;
}

function runLogout(authStorage: AuthStorage, providerId: string | undefined): boolean {
    if (!providerId) {
        console.log(chalk.red('❌ Usage: tars auth logout <provider>'));
        return false;
    }
    if (!authStorage.has(providerId)) {
        console.log(chalk.yellow(`No stored credentials for ${providerId}.`));
        return true;
    }
    authStorage.logout(providerId);
    console.log(chalk.green(`✅ Removed stored credentials for ${providerId}.`));
    return true;
}

function runStatus(config: Config, authStorage: AuthStorage): boolean {
    const providers = authStorage.getOAuthProviders();
    console.log(chalk.cyan.bold('\n🔐 Provider authentication'));
    console.log(chalk.cyan('──────────────────────────'));
    console.log(chalk.dim(`Credential store: ${getAuthStoragePath(config.homeDir)}`));

    const reportedProviders = new Set<string>();
    for (const provider of providers) {
        reportedProviders.add(provider.id);
        console.log(
            formatAuthStatusLine(provider.id, provider.name, authStorage.getAuthStatus(provider.id))
        );
    }

    const configuredProviders = [
        config.piProvider,
        ...Object.values(config.models).flatMap((reference) =>
            reference ? [reference.slice(0, reference.indexOf('/'))] : []
        )
    ];
    for (const providerId of configuredProviders) {
        if (!providerId || reportedProviders.has(providerId)) continue;
        reportedProviders.add(providerId);
        console.log(
            formatAuthStatusLine(providerId, providerId, authStorage.getAuthStatus(providerId))
        );
    }
    console.log('');
    return true;
}

/**
 * tars auth login [provider]
 * tars auth logout <provider>
 * tars auth status
 */
export async function auth(action: string, providerId?: string): Promise<boolean> {
    const config = Config.getInstance();
    const authStorage = createAuthStorage(config.homeDir);

    try {
        switch (action) {
            case 'login':
                return await withTarsHomeMutationLease(
                    config.homeDir,
                    'modify Tars provider credentials',
                    () => runLogin(authStorage, authStorage.getOAuthProviders(), providerId)
                );
            case 'logout':
                return await withTarsHomeMutationLease(
                    config.homeDir,
                    'modify Tars provider credentials',
                    async () => runLogout(authStorage, providerId)
                );
            case 'status':
                return runStatus(config, authStorage);
            default:
                console.log(chalk.red(`❌ Unknown action: ${action}`));
                console.log(chalk.dim('Try: login, logout, status'));
                return false;
        }
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        console.log(chalk.red(`❌ Auth ${action} failed: ${message}`));
        return false;
    }
}
