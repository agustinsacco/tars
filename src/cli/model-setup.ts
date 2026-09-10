import chalk from 'chalk';
import inquirer from 'inquirer';
import ora from 'ora';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { type Api, type Model, type Provider } from '@earendil-works/pi-ai';
import { type ModelRuntime } from '@earendil-works/pi-coding-agent';

import { RuntimeConfigSchema, THINKING_LEVELS, type ThinkingLevel } from '../config/schema.js';
import { createModelRuntime, getAuthStoragePath } from '../supervisor/model-manager.js';
import { type SecretsManager } from '../utils/secrets-manager.js';
import { writePrivateJson } from './config-file.js';
import { createLoginInteraction, type ProviderAuthStatus } from './commands/auth.js';

/*
 * Shared provider/model selection used by `tars setup` and `tars model`.
 *
 * Every provider known to the pi model registry is offered. Providers with a
 * native pi OAuth flow (ChatGPT, Claude Pro/Max, GitHub Copilot, ...) can sign
 * in from the wizard; every other registry provider can store an API key.
 * After credentials are confirmed the model list is discovered from the
 * runtime (built-in catalog plus the live pi.dev catalog and provider model
 * endpoints) so the operator picks from real ids instead of typing them.
 */

/** Providers served through `piBaseUrl` rather than the pi registry. */
export const ENDPOINT_PROVIDER_IDS = ['local', 'custom'] as const;
export type EndpointProviderId = (typeof ENDPOINT_PROVIDER_IDS)[number];

const MANUAL_MODEL_CHOICE = '__manual__';
const ENDPOINT_DISCOVERY_TIMEOUT_MS = 5_000;

/** Registry providers most operators look for, shown before the alphabetical rest. */
const FEATURED_PROVIDER_IDS = [
    'openai-codex',
    'anthropic',
    'openai',
    'google',
    'github-copilot',
    'openrouter'
];

const THINKING_LEVEL_DESCRIPTIONS: Record<ThinkingLevel, string> = {
    off: 'no extended reasoning (fastest, cheapest)',
    minimal: 'briefest reasoning the model allows',
    low: 'light reasoning for everyday chat',
    medium: 'balanced reasoning (recommended)',
    high: 'deep reasoning for hard problems',
    xhigh: 'very deep reasoning; slow and costly',
    max: 'maximum reasoning budget'
};

export interface ProviderSummary {
    readonly id: string;
    readonly name: string;
    /** Native pi OAuth login is available. */
    readonly oauth: boolean;
    readonly oauthLabel?: string;
    /** Interactive API-key entry is available. */
    readonly apiKey: boolean;
    /** Credentials come only from the environment (cloud profiles, env vars). */
    readonly ambientOnly: boolean;
    readonly status: ProviderAuthStatus;
    readonly modelCount: number;
}

export interface ProviderChoice {
    readonly name: string;
    readonly value: string;
}

export interface ModelChoice {
    readonly name: string;
    readonly value: string;
}

export type ModelSummary = Pick<
    Model<Api>,
    'id' | 'name' | 'contextWindow' | 'reasoning' | 'input' | 'thinkingLevelMap'
>;

export interface ExistingModelConfig {
    readonly piProvider?: string;
    readonly piModel?: string;
    readonly piBaseUrl?: string;
    readonly piThinkingLevel?: string;
    readonly contextWindowTokens?: number;
}

/** Values the wizard writes back into `config.json`. */
export interface ModelSelection {
    readonly piProvider: string;
    readonly piModel: string;
    readonly piBaseUrl: string;
    readonly piThinkingLevel: ThinkingLevel;
    readonly contextWindowTokens: number;
}

/** Pre-supplied answers (CLI flags) that skip the matching prompt. */
export interface ModelSetupAnswers {
    readonly provider?: string;
    readonly model?: string;
    readonly thinkingLevel?: ThinkingLevel;
}

export interface ModelSetupOptions {
    readonly tarsHome: string;
    readonly existing: ExistingModelConfig;
    readonly secretsManager: SecretsManager;
    readonly secrets: Record<string, string>;
    readonly answers?: ModelSetupAnswers;
}

type AuthAction = 'keep' | 'oauth' | 'api_key' | 'import' | 'skip';

// ─────────────────────────────────────────────────────────────────────────────
// Pure helpers (unit tested)
// ─────────────────────────────────────────────────────────────────────────────

export function isEndpointProvider(providerId: string): providerId is EndpointProviderId {
    return (ENDPOINT_PROVIDER_IDS as readonly string[]).includes(providerId);
}

/** Maps legacy provider ids onto the ids offered by the wizard. */
export function normalizeProviderId(providerId: string | undefined): string | undefined {
    if (!providerId) return undefined;
    return providerId === 'local-stark' ? 'local' : providerId;
}

export function summarizeProvider(
    provider: Pick<Provider, 'id' | 'name' | 'auth' | 'getModels'>,
    status: ProviderAuthStatus
): ProviderSummary {
    const oauth = provider.auth.oauth !== undefined;
    const apiKey = provider.auth.apiKey?.login !== undefined;
    let modelCount = 0;
    try {
        modelCount = provider.getModels().length;
    } catch {
        modelCount = 0;
    }
    return {
        id: provider.id,
        name: provider.name,
        oauth,
        oauthLabel: provider.auth.oauth?.loginLabel ?? provider.auth.oauth?.name,
        apiKey,
        ambientOnly: !oauth && !apiKey,
        status,
        modelCount
    };
}

/** Featured providers first (in their listed order), then the rest by name. */
export function sortProviders<T extends { readonly id: string; readonly name: string }>(
    providers: readonly T[]
): T[] {
    const rank = (id: string): number => {
        const index = FEATURED_PROVIDER_IDS.indexOf(id);
        return index === -1 ? FEATURED_PROVIDER_IDS.length : index;
    };
    return [...providers].sort((left, right) => {
        const byRank = rank(left.id) - rank(right.id);
        if (byRank !== 0) return byRank;
        return left.name.localeCompare(right.name);
    });
}

export function formatAuthMethods(summary: ProviderSummary): string {
    if (summary.oauth && summary.apiKey) return 'OAuth or API key';
    if (summary.oauth) return 'OAuth';
    if (summary.apiKey) return 'API key';
    return 'environment credentials';
}

export function formatAuthStatus(status: ProviderAuthStatus): string {
    if (!status.configured) return 'not signed in';
    return `signed in (${status.label ?? status.source ?? 'configured'})`;
}

export function formatProviderChoiceLabel(summary: ProviderSummary): string {
    const state = summary.status.configured
        ? chalk.green(formatAuthStatus(summary.status))
        : chalk.dim(formatAuthStatus(summary.status));
    return `${summary.name} ${chalk.dim(`(${summary.id})`)} — ${formatAuthMethods(summary)} · ${state}`;
}

export function buildProviderChoices(
    summaries: readonly ProviderSummary[]
): Array<ProviderChoice | InstanceType<typeof inquirer.Separator>> {
    const registry = sortProviders(summaries.filter((summary) => summary.modelCount > 0));
    return [
        ...registry.map((summary) => ({
            name: formatProviderChoiceLabel(summary),
            value: summary.id
        })),
        new inquirer.Separator(),
        {
            name: `Local endpoint ${chalk.dim('(llama.cpp, Ollama, LM Studio, vLLM, ...)')} — OpenAI-compatible URL`,
            value: 'local'
        },
        {
            name: `Custom endpoint ${chalk.dim('(proxy or hosted OpenAI-compatible API)')} — URL and optional key`,
            value: 'custom'
        }
    ];
}

function formatTokens(tokens: number): string {
    if (tokens >= 1_000_000)
        return `${(tokens / 1_000_000).toFixed(tokens % 1_000_000 === 0 ? 0 : 1)}M`;
    if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}k`;
    return String(tokens);
}

export function formatModelChoiceLabel(model: ModelSummary): string {
    const traits: string[] = [];
    if (model.contextWindow > 0) traits.push(`${formatTokens(model.contextWindow)} context`);
    if (model.reasoning) traits.push('reasoning');
    if (model.input.includes('image')) traits.push('vision');
    const title =
        model.name && model.name !== model.id
            ? `${model.name} ${chalk.dim(`(${model.id})`)}`
            : model.id;
    return traits.length > 0 ? `${title} ${chalk.dim(`· ${traits.join(' · ')}`)}` : title;
}

export function buildModelChoices(models: readonly ModelSummary[]): ModelChoice[] {
    return [
        ...models.map((model) => ({ name: formatModelChoiceLabel(model), value: model.id })),
        { name: 'Enter a model id manually…', value: MANUAL_MODEL_CHOICE }
    ];
}

/** Levels the model accepts; `off` is always allowed because it sends no effort parameter. */
export function getSupportedThinkingLevels(
    model: Pick<ModelSummary, 'reasoning' | 'thinkingLevelMap'> | undefined
): ThinkingLevel[] {
    if (!model) return [...THINKING_LEVELS];
    if (!model.reasoning) return ['off'];
    return THINKING_LEVELS.filter(
        (level) => level === 'off' || model.thinkingLevelMap?.[level] !== null
    );
}

/**
 * Picks the default reasoning level. A previously chosen non-off level wins
 * when the model still supports it; otherwise `medium` (or the closest
 * supported level) is suggested for reasoning models.
 */
export function resolveDefaultThinkingLevel(
    supported: readonly ThinkingLevel[],
    existing: string | undefined
): ThinkingLevel {
    const previous = supported.find((level) => level === existing);
    if (previous && previous !== 'off') return previous;
    if (supported.includes('medium')) return 'medium';
    return supported.find((level) => level !== 'off') ?? 'off';
}

export function buildThinkingLevelChoices(
    supported: readonly ThinkingLevel[]
): Array<{ name: string; value: ThinkingLevel }> {
    return supported.map((level) => ({
        name: `${level} ${chalk.dim(`— ${THINKING_LEVEL_DESCRIPTIONS[level]}`)}`,
        value: level
    }));
}

/**
 * Context window suggestion: keep the operator's value when the model is
 * unchanged, otherwise trust the catalog entry.
 */
export function resolveDefaultContextWindow(
    model: Pick<ModelSummary, 'id' | 'contextWindow'> | undefined,
    existing: ExistingModelConfig,
    fallback: number
): number {
    if (model && existing.piModel === model.id && existing.contextWindowTokens) {
        return existing.contextWindowTokens;
    }
    if (model?.contextWindow) return model.contextWindow;
    return existing.contextWindowTokens || fallback;
}

const ModelEntrySchema = z.object({ id: z.string().min(1) }).passthrough();
const ModelListSchema = z.union([
    z.object({ data: z.array(ModelEntrySchema) }).transform((value) => value.data),
    z.object({ models: z.array(ModelEntrySchema) }).transform((value) => value.models),
    z.array(ModelEntrySchema)
]);

/** Extracts model ids from an OpenAI-compatible `/models` response. */
export function parseModelListResponse(payload: unknown): string[] {
    const parsed = ModelListSchema.safeParse(payload);
    if (!parsed.success) return [];
    const ids = parsed.data.map((entry) => entry.id);
    return [...new Set(ids)].sort((left, right) => left.localeCompare(right));
}

/** Lists models from an OpenAI-compatible endpoint; failures yield an empty list. */
export async function discoverEndpointModels(
    baseUrl: string,
    apiKey: string,
    fetchImpl: typeof fetch = fetch,
    timeoutMs = ENDPOINT_DISCOVERY_TIMEOUT_MS
): Promise<string[]> {
    const url = `${baseUrl.replace(/\/+$/, '')}/models`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetchImpl(url, {
            headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
            signal: controller.signal
        });
        if (!response.ok) return [];
        return parseModelListResponse(await response.json());
    } catch {
        return [];
    } finally {
        clearTimeout(timeout);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// pi CLI credential import
// ─────────────────────────────────────────────────────────────────────────────

const StoredCredentialSchema = z.object({ type: z.enum(['oauth', 'api_key']) }).passthrough();

function expandTilde(value: string): string {
    return value.startsWith('~/') ? path.join(os.homedir(), value.slice(2)) : value;
}

/** Credential store of the standalone pi coding agent CLI. */
export function getPiAuthStoragePath(): string {
    const agentDir = process.env.PI_CODING_AGENT_DIR
        ? expandTilde(process.env.PI_CODING_AGENT_DIR)
        : path.join(os.homedir(), '.pi', 'agent');
    return path.join(agentDir, 'auth.json');
}

function readCredentialStore(storePath: string): Record<string, unknown> {
    if (!fsSync.existsSync(storePath)) return {};
    try {
        const parsed: unknown = JSON.parse(fsSync.readFileSync(storePath, 'utf-8'));
        return z.record(z.unknown()).parse(parsed);
    } catch {
        return {};
    }
}

/** Returns the pi CLI credential for a provider when one is stored locally. */
export function readPiCredential(
    providerId: string,
    storePath = getPiAuthStoragePath()
): Record<string, unknown> | undefined {
    const parsed = StoredCredentialSchema.safeParse(readCredentialStore(storePath)[providerId]);
    return parsed.success ? parsed.data : undefined;
}

/** Copies a credential into the Tars store without disturbing other providers. */
export async function importCredential(
    tarsAuthPath: string,
    providerId: string,
    credential: Record<string, unknown>
): Promise<void> {
    const current = readCredentialStore(tarsAuthPath);
    await writePrivateJson(tarsAuthPath, { ...current, [providerId]: credential });
}

// ─────────────────────────────────────────────────────────────────────────────
// Interactive flow
// ─────────────────────────────────────────────────────────────────────────────

function seedEnvironmentFromSecrets(secrets: Record<string, string>): void {
    // The pi runtime resolves API keys from the environment; keys stored by
    // earlier setups in ~/.tars/.env must be visible for auth status checks.
    for (const [key, value] of Object.entries(secrets)) {
        if (process.env[key] === undefined) process.env[key] = value;
    }
}

function summarizeRuntimeProviders(runtime: ModelRuntime): ProviderSummary[] {
    return runtime
        .getProviders()
        .map((provider) => summarizeProvider(provider, runtime.getProviderAuthStatus(provider.id)));
}

async function promptProvider(
    runtime: ModelRuntime,
    existing: ExistingModelConfig,
    preset: string | undefined
): Promise<string> {
    const summaries = summarizeRuntimeProviders(runtime);
    if (preset) {
        if (isEndpointProvider(preset) || summaries.some((summary) => summary.id === preset)) {
            return preset;
        }
        throw new Error(
            `Unknown provider "${preset}". Run \`tars model\` without --provider to pick from the list.`
        );
    }
    const answers = await inquirer.prompt<{ piProvider: string }>([
        {
            type: 'list',
            name: 'piProvider',
            message: 'Select the model provider:',
            pageSize: 14,
            loop: false,
            choices: buildProviderChoices(summaries),
            default: normalizeProviderId(existing.piProvider) ?? 'openai-codex'
        }
    ]);
    return answers.piProvider;
}

async function promptAuthAction(
    summary: ProviderSummary,
    importable: boolean,
    piAuthPath: string
): Promise<AuthAction> {
    const choices: Array<{ name: string; value: AuthAction }> = [];
    if (summary.status.configured) {
        choices.push({
            name: `Keep current credentials ${chalk.dim(`(${formatAuthStatus(summary.status)})`)}`,
            value: 'keep'
        });
    }
    if (summary.oauth) {
        choices.push({
            name: summary.oauthLabel
                ? `Sign in with ${summary.oauthLabel} ${chalk.dim('(OAuth in your browser)')}`
                : 'Sign in with OAuth',
            value: 'oauth'
        });
    }
    if (summary.apiKey) choices.push({ name: 'Enter an API key', value: 'api_key' });
    if (importable) {
        choices.push({
            name: `Import the pi CLI login ${chalk.dim(`(${piAuthPath})`)}`,
            value: 'import'
        });
    }
    if (!summary.status.configured) {
        choices.push({
            name: `Skip for now ${chalk.dim('(sign in later with `tars auth login`)')}`,
            value: 'skip'
        });
    }
    if (choices.length === 1) return choices[0].value;

    const answers = await inquirer.prompt<{ action: AuthAction }>([
        {
            type: 'list',
            name: 'action',
            message: `Credentials for ${summary.name}:`,
            choices
        }
    ]);
    return answers.action;
}

async function ensureRegistryCredentials(
    runtime: ModelRuntime,
    providerId: string,
    tarsHome: string
): Promise<ModelRuntime> {
    const provider = runtime.getProvider(providerId);
    if (!provider) throw new Error(`Provider ${providerId} is not in the model registry`);
    const summary = summarizeProvider(provider, runtime.getProviderAuthStatus(providerId));
    const piAuthPath = getPiAuthStoragePath();
    const piCredential = summary.status.configured
        ? undefined
        : readPiCredential(providerId, piAuthPath);

    if (summary.ambientOnly && !summary.status.configured) {
        console.log(
            chalk.yellow(
                `  ⚠ ${summary.name} reads credentials from your environment (for example cloud SDK profiles or provider environment variables). Configure them, then rerun \`tars model\`.`
            )
        );
    }

    const action = await promptAuthAction(summary, piCredential !== undefined, piAuthPath);
    switch (action) {
        case 'oauth':
        case 'api_key': {
            await runtime.login(providerId, action, createLoginInteraction());
            console.log(chalk.green(`  ✓ Signed in to ${summary.name}.`));
            return runtime;
        }
        case 'import': {
            if (!piCredential) return runtime;
            await importCredential(getAuthStoragePath(tarsHome), providerId, piCredential);
            console.log(chalk.green(`  ✓ Imported ${summary.name} credentials from the pi CLI.`));
            // A fresh runtime guarantees the imported credential is visible to
            // availability checks below.
            return createModelRuntime(tarsHome);
        }
        case 'skip':
            console.log(
                chalk.dim(
                    `  Showing the ${summary.name} catalog without credentials. Sign in later with \`tars auth login ${providerId}\`.`
                )
            );
            return runtime;
        default:
            return runtime;
    }
}

/**
 * Refreshes the provider catalog (pi.dev overlay and provider model
 * endpoints) and returns the models the current credentials can use, falling
 * back to the static catalog when availability cannot be determined.
 */
async function discoverRegistryModels(
    runtime: ModelRuntime,
    providerId: string
): Promise<{ models: readonly Model<Api>[]; verified: boolean }> {
    const spinner = ora('Discovering models...').start();
    try {
        await runtime.refresh({ allowNetwork: true, providers: [providerId], force: true });
    } catch {
        // Offline or blocked networks fall back to the bundled catalog.
    }
    let models: readonly Model<Api>[] = [];
    let verified = false;
    if (runtime.hasConfiguredAuth(providerId)) {
        try {
            models = await runtime.getAvailable(providerId);
            verified = models.length > 0;
        } catch {
            models = [];
        }
    }
    if (models.length === 0) models = runtime.getModels(providerId);
    if (models.length === 0) {
        spinner.warn('No models discovered; enter a model id manually.');
    } else if (verified) {
        spinner.succeed(`Discovered ${models.length} models available to your account.`);
    } else {
        spinner.succeed(`Loaded ${models.length} catalog models (availability not verified).`);
    }
    return { models, verified };
}

async function promptModel(
    models: readonly ModelSummary[],
    existing: ExistingModelConfig,
    sameProvider: boolean,
    preset: string | undefined
): Promise<string> {
    if (preset) return preset;
    const choices = buildModelChoices(models);
    const answers = await inquirer.prompt<{ piModel: string }>([
        {
            type: 'list',
            name: 'piModel',
            message: 'Select the chat model:',
            pageSize: 14,
            loop: false,
            choices,
            default:
                sameProvider && existing.piModel && models.some((m) => m.id === existing.piModel)
                    ? existing.piModel
                    : choices[0]?.value
        }
    ]);
    if (answers.piModel !== MANUAL_MODEL_CHOICE) return answers.piModel;
    const manual = await inquirer.prompt<{ piModel: string }>([
        {
            type: 'input',
            name: 'piModel',
            message: 'Model id:',
            default: sameProvider ? existing.piModel : undefined,
            validate: (input: string) => input.trim().length > 0 || 'Model id is required'
        }
    ]);
    return manual.piModel.trim();
}

async function promptThinkingLevel(
    model: ModelSummary | undefined,
    existing: ExistingModelConfig,
    preset: ThinkingLevel | undefined
): Promise<ThinkingLevel> {
    const supported = getSupportedThinkingLevels(model);
    if (preset) {
        if (!supported.includes(preset)) {
            throw new Error(
                `Thinking level "${preset}" is not supported by ${model?.id ?? 'this model'} (supported: ${supported.join(', ')})`
            );
        }
        return preset;
    }
    if (supported.length === 1) {
        console.log(chalk.dim('  This model does not expose a reasoning setting.'));
        return supported[0];
    }
    const answers = await inquirer.prompt<{ level: ThinkingLevel }>([
        {
            type: 'list',
            name: 'level',
            message: 'Reasoning (thinking) level:',
            choices: buildThinkingLevelChoices(supported),
            default: resolveDefaultThinkingLevel(supported, existing.piThinkingLevel)
        }
    ]);
    return answers.level;
}

async function promptContextWindow(defaultValue: number): Promise<number> {
    const answers = await inquirer.prompt<{ contextWindowTokens: number }>([
        {
            type: 'number',
            name: 'contextWindowTokens',
            message: 'Context window size (tokens):',
            default: defaultValue,
            validate: (input: unknown) =>
                RuntimeConfigSchema.shape.contextWindowTokens.safeParse(input).success ||
                'Must be an integer from 1 to 10000000'
        }
    ]);
    return answers.contextWindowTokens;
}

async function setupRegistryProvider(
    initialRuntime: ModelRuntime,
    providerId: string,
    options: ModelSetupOptions
): Promise<ModelSelection> {
    const { existing, tarsHome, answers = {} } = options;
    const runtime = await ensureRegistryCredentials(initialRuntime, providerId, tarsHome);
    const { models } = await discoverRegistryModels(runtime, providerId);
    const sameProvider = normalizeProviderId(existing.piProvider) === providerId;
    const piModel = await promptModel(models, existing, sameProvider, answers.model);
    const model = runtime.getModel(providerId, piModel) ?? models.find((m) => m.id === piModel);
    if (!model) {
        console.log(
            chalk.yellow(
                `  ⚠ ${piModel} is not in the ${providerId} catalog. Tars will refuse to start until it exists; add it to ~/.tars/models.json or pick a discovered model.`
            )
        );
    }
    const piThinkingLevel = await promptThinkingLevel(model, existing, answers.thinkingLevel);
    let contextWindowTokens: number;
    if (model) {
        contextWindowTokens = resolveDefaultContextWindow(model, existing, 128_000);
        console.log(
            chalk.dim(
                `  Context window: ${contextWindowTokens.toLocaleString()} tokens (from the model catalog).`
            )
        );
    } else {
        contextWindowTokens = await promptContextWindow(
            resolveDefaultContextWindow(undefined, existing, 128_000)
        );
    }
    return { piProvider: providerId, piModel, piBaseUrl: '', piThinkingLevel, contextWindowTokens };
}

async function setupEndpointProvider(
    providerId: EndpointProviderId,
    options: ModelSetupOptions
): Promise<ModelSelection> {
    const { existing, secretsManager, secrets, answers = {} } = options;
    const isLocal = providerId === 'local';
    const secretKey = isLocal ? 'LOCAL_API_KEY' : 'CUSTOM_API_KEY';
    const endpoint = await inquirer.prompt<{ baseUrl: string; apiKey: string }>([
        {
            type: 'input',
            name: 'baseUrl',
            message: isLocal ? 'Local endpoint URL:' : 'Custom endpoint base URL:',
            default: existing.piBaseUrl || 'http://localhost:8080/v1',
            validate: (input: string) =>
                RuntimeConfigSchema.shape.piBaseUrl.safeParse(input).success ||
                'Enter an HTTP or HTTPS URL'
        },
        {
            type: 'password',
            name: 'apiKey',
            message: `${isLocal ? 'Local' : 'Custom'} endpoint API key (press Enter to skip):`,
            default: secrets[secretKey] || (isLocal ? secrets.STARK_API_KEY : '') || ''
        }
    ]);
    const piBaseUrl = endpoint.baseUrl.trim();
    secretsManager.set(secretKey, endpoint.apiKey);
    process.env[secretKey] = endpoint.apiKey;

    const spinner = ora('Discovering models from the endpoint...').start();
    const discovered = await discoverEndpointModels(piBaseUrl, endpoint.apiKey);
    if (discovered.length > 0) {
        spinner.succeed(`Discovered ${discovered.length} models at ${piBaseUrl}.`);
    } else {
        spinner.warn('The endpoint did not list any models; enter the model id manually.');
    }
    // Endpoint listings carry ids only; capabilities stay unknown.
    const models: ModelSummary[] = discovered.map((id) => ({
        id,
        name: id,
        contextWindow: 0,
        reasoning: false,
        input: ['text']
    }));
    const sameProvider = normalizeProviderId(existing.piProvider) === providerId;
    const piModel =
        models.length > 0
            ? await promptModel(models, existing, sameProvider, answers.model)
            : (answers.model ??
              (
                  await inquirer.prompt<{ piModel: string }>([
                      {
                          type: 'input',
                          name: 'piModel',
                          message: 'Model id:',
                          default:
                              existing.piModel || (isLocal ? 'qwen2.5-coder-7b' : 'custom-model'),
                          validate: (input: string) =>
                              input.trim().length > 0 || 'Model id is required'
                      }
                  ])
              ).piModel.trim());
    // Endpoints do not advertise reasoning support, so every level is offered
    // and `off` stays the default unless the operator chose otherwise before.
    const piThinkingLevel = answers.thinkingLevel ?? (await promptEndpointThinkingLevel(existing));
    const contextWindowTokens = await promptContextWindow(
        existing.contextWindowTokens || (isLocal ? 8_192 : 128_000)
    );
    return { piProvider: providerId, piModel, piBaseUrl, piThinkingLevel, contextWindowTokens };
}

async function promptEndpointThinkingLevel(existing: ExistingModelConfig): Promise<ThinkingLevel> {
    const supported = getSupportedThinkingLevels(undefined);
    const previous = supported.find((level) => level === existing.piThinkingLevel);
    const answers = await inquirer.prompt<{ level: ThinkingLevel }>([
        {
            type: 'list',
            name: 'level',
            message: 'Reasoning (thinking) level, if the endpoint supports reasoning_effort:',
            choices: buildThinkingLevelChoices(supported),
            default: previous ?? 'off'
        }
    ]);
    return answers.level;
}

/**
 * Interactive provider → credentials → model → reasoning selection. Returns
 * the values to persist; callers own the config write.
 */
export async function runModelSetup(options: ModelSetupOptions): Promise<ModelSelection> {
    seedEnvironmentFromSecrets(options.secrets);
    const runtime = await createModelRuntime(options.tarsHome);
    const providerId = await promptProvider(runtime, options.existing, options.answers?.provider);
    if (isEndpointProvider(providerId)) return setupEndpointProvider(providerId, options);
    return setupRegistryProvider(runtime, providerId, options);
}

export function printModelSelection(selection: ModelSelection): void {
    console.log(chalk.dim(`  Provider:       ${selection.piProvider}`));
    console.log(chalk.dim(`  Model:          ${selection.piModel}`));
    console.log(chalk.dim(`  Thinking:       ${selection.piThinkingLevel}`));
    console.log(
        chalk.dim(`  Context window: ${selection.contextWindowTokens.toLocaleString()} tokens`)
    );
    if (selection.piBaseUrl) console.log(chalk.dim(`  Base URL:       ${selection.piBaseUrl}`));
}
