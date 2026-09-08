import chalk from 'chalk';
import inquirer from 'inquirer';
import { type AuthEvent, type AuthInteraction, type AuthPrompt } from '@earendil-works/pi-ai';
import { type ModelRuntime } from '@earendil-works/pi-coding-agent';

import { Config } from '../../config/config.js';
import { createModelRuntime, getAuthStoragePath } from '../../supervisor/model-manager.js';
import { withTarsHomeMutationLease } from '../../utils/tars-home-lease.js';

/** Minimal provider view used by the auth command and its tests. */
export interface OAuthProviderChoice {
    readonly id: string;
    readonly name: string;
}

/** Structural mirror of pi's provider auth status; never carries secrets. */
export interface ProviderAuthStatus {
    readonly configured: boolean;
    readonly source?: string;
    readonly label?: string;
}

/**
 * Finds an OAuth-capable provider by id. Returns undefined when the id is
 * missing or not offered, so the caller can list the valid ids.
 */
export function resolveOAuthProvider<T extends OAuthProviderChoice>(
    providers: readonly T[],
    requestedId: string | undefined
): T | undefined {
    if (!requestedId) return undefined;
    return providers.find((provider) => provider.id === requestedId);
}

/** Renders one provider auth status line without exposing credential values. */
export function formatAuthStatusLine(
    providerId: string,
    providerName: string,
    status: ProviderAuthStatus
): string {
    if (!status.configured) return `- ${providerName} (${providerId}): not configured`;
    const source = status.label ?? status.source ?? 'configured';
    return `- ${providerName} (${providerId}): configured (${source})`;
}

async function promptForInput(prompt: AuthPrompt): Promise<string> {
    if (prompt.type === 'select') {
        const answers = await inquirer.prompt<{ value: string }>([
            {
                type: 'list',
                name: 'value',
                message: prompt.message,
                choices: prompt.options.map((option) => ({
                    name: option.description
                        ? `${option.label} — ${option.description}`
                        : option.label,
                    value: option.id
                }))
            }
        ]);
        return answers.value;
    }
    const answers = await inquirer.prompt<{ value: string }>([
        {
            type: prompt.type === 'secret' ? 'password' : 'input',
            name: 'value',
            message: prompt.message
        }
    ]);
    return answers.value ?? '';
}

function printAuthEvent(event: AuthEvent): void {
    if (event.type === 'auth_url') {
        console.log(chalk.cyan('\n🔐 Open this URL in your browser to authorize:'));
        console.log(chalk.bold(event.url));
        if (event.instructions) console.log(chalk.dim(event.instructions));
        return;
    }
    if (event.type === 'device_code') {
        console.log(chalk.cyan(`\n🔐 Visit ${chalk.bold(event.verificationUri)} and enter:`));
        console.log(chalk.bold(event.userCode));
        return;
    }
    if (event.type === 'info') {
        console.log(event.message);
        for (const link of event.links ?? []) {
            console.log(chalk.dim(link.label ? `${link.label}: ${link.url}` : link.url));
        }
        return;
    }
    console.log(chalk.dim(event.message));
}

function createLoginInteraction(): AuthInteraction {
    return {
        prompt: promptForInput,
        notify: printAuthEvent
    };
}

function getOAuthProviders(runtime: ModelRuntime): OAuthProviderChoice[] {
    return runtime
        .getProviders()
        .filter((provider) => provider.auth.oauth !== undefined)
        .map((provider) => ({ id: provider.id, name: provider.name }));
}

function printAvailableProviders(providers: readonly OAuthProviderChoice[]): void {
    console.log(chalk.cyan('Available OAuth providers:'));
    for (const provider of providers) {
        console.log(`- ${provider.id} (${provider.name})`);
    }
    console.log(chalk.dim('API-key providers are configured with `tars secret set` instead.'));
}

async function runLogin(runtime: ModelRuntime, providerId: string | undefined): Promise<boolean> {
    const providers = getOAuthProviders(runtime);
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

    await runtime.login(provider.id, 'oauth', createLoginInteraction());
    console.log(chalk.green(`\n✅ Logged in to ${provider.name}.`));
    console.log(
        chalk.dim(
            'Credentials are stored in auth.json inside your Tars home. The supervisor picks them up on the next message; no restart is required.'
        )
    );
    return true;
}

async function runLogout(runtime: ModelRuntime, providerId: string | undefined): Promise<boolean> {
    if (!providerId) {
        console.log(chalk.red('❌ Usage: tars auth logout <provider>'));
        return false;
    }
    const stored = await runtime.listCredentials();
    if (!stored.some((credential) => credential.providerId === providerId)) {
        console.log(chalk.yellow(`No stored credentials for ${providerId}.`));
        return true;
    }
    await runtime.logout(providerId);
    console.log(chalk.green(`✅ Removed stored credentials for ${providerId}.`));
    return true;
}

function runStatus(config: Config, runtime: ModelRuntime): boolean {
    console.log(chalk.cyan.bold('\n🔐 Provider authentication'));
    console.log(chalk.cyan('──────────────────────────'));
    console.log(chalk.dim(`Credential store: ${getAuthStoragePath(config.homeDir)}`));

    const reportedProviders = new Set<string>();
    for (const provider of getOAuthProviders(runtime)) {
        reportedProviders.add(provider.id);
        console.log(
            formatAuthStatusLine(
                provider.id,
                provider.name,
                runtime.getProviderAuthStatus(provider.id)
            )
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
            formatAuthStatusLine(
                providerId,
                runtime.getProvider(providerId)?.name ?? providerId,
                runtime.getProviderAuthStatus(providerId)
            )
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

    try {
        const runtime = await createModelRuntime(config.homeDir);
        switch (action) {
            case 'login':
                return await withTarsHomeMutationLease(
                    config.homeDir,
                    'modify Tars provider credentials',
                    () => runLogin(runtime, providerId)
                );
            case 'logout':
                return await withTarsHomeMutationLease(
                    config.homeDir,
                    'modify Tars provider credentials',
                    () => runLogout(runtime, providerId)
                );
            case 'status':
                return runStatus(config, runtime);
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
