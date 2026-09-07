import path from 'node:path';

import { AuthStorage, ModelRegistry } from '@earendil-works/pi-coding-agent';
import { type Api, type Model } from '@earendil-works/pi-ai';

import logger from '../utils/logger.js';
import { DLPService } from '../utils/dlp-service.js';

/** Which part of the runtime a model serves. */
export type ModelRole = 'chat' | 'background' | 'summarizer';

export interface ModelReference {
    readonly provider: string;
    readonly model: string;
}

/** Narrow view of the runtime configuration consumed by the model manager. */
export interface ModelManagerConfig {
    readonly homeDir: string;
    readonly piProvider: string;
    readonly piModel: string;
    readonly piBaseUrl: string;
    readonly piApi: '' | 'openai-completions' | 'anthropic-messages' | 'google-generative-ai';
    readonly models: { readonly background?: string; readonly summarizer?: string };
    readonly contextWindowTokens: number;
}

/** Minimal surface the engine depends on; kept small so tests can stub it. */
export interface ModelSource {
    getModel(role: ModelRole): Model<Api>;
    getApiKey(providerName: string): Promise<string | undefined>;
    reload(): void;
}

function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

/**
 * Parses a `provider/model-id` reference. The model id keeps any further
 * slashes (OpenRouter ids such as `openrouter/anthropic/claude-sonnet-4`).
 */
export function parseModelReference(reference: string): ModelReference | null {
    const separatorIndex = reference.indexOf('/');
    if (separatorIndex <= 0 || separatorIndex === reference.length - 1) return null;
    return {
        provider: reference.slice(0, separatorIndex),
        model: reference.slice(separatorIndex + 1)
    };
}

/** Path of the pi credential store inside a Tars home directory. */
export function getAuthStoragePath(homeDir: string): string {
    return path.join(homeDir, 'auth.json');
}

/** Path of the optional pi custom-model catalog inside a Tars home directory. */
export function getModelsJsonPath(homeDir: string): string {
    return path.join(homeDir, 'models.json');
}

/** Creates the shared credential store used by the supervisor and the CLI. */
export function createAuthStorage(homeDir: string): AuthStorage {
    return AuthStorage.create(getAuthStoragePath(homeDir));
}

/**
 * ModelManager - resolves models per role and API keys per provider.
 *
 * Wraps pi's AuthStorage (API keys and OAuth credentials in `~/.tars/auth.json`,
 * with file-locked refresh) and ModelRegistry (built-in catalog for every known
 * provider plus custom models from `~/.tars/models.json`, with OAuth model
 * adjustments applied automatically).
 */
export class ModelManager implements ModelSource {
    private registryInstance: ModelRegistry | null = null;

    constructor(
        private readonly config: ModelManagerConfig,
        registry?: ModelRegistry
    ) {
        this.registryInstance = registry ?? null;
    }

    /**
     * The registry reads `auth.json` and `models.json` at creation time, so it is
     * built lazily to keep construction free of filesystem side effects.
     */
    private get registry(): ModelRegistry {
        if (!this.registryInstance) {
            const authStorage = createAuthStorage(this.config.homeDir);
            this.registryInstance = ModelRegistry.create(
                authStorage,
                getModelsJsonPath(this.config.homeDir)
            );
        }
        return this.registryInstance;
    }

    /**
     * Re-reads credentials and the model catalog so `tars auth login` and
     * models.json edits apply without a supervisor restart.
     */
    public reload(): void {
        if (!this.registryInstance) return;
        try {
            this.registryInstance.authStorage.reload();
            this.registryInstance.refresh();
        } catch (error: unknown) {
            logger.warn(`⚠️ Failed to reload model credentials: ${getErrorMessage(error)}`);
        }
    }

    /**
     * Resolves the model for a role. Role models must exist in the registry
     * (built-in catalog or models.json); an unresolvable role reference falls
     * back to the chat model so background work keeps running.
     */
    public getModel(role: ModelRole): Model<Api> {
        const roleReference = role === 'chat' ? undefined : this.config.models[role];
        if (roleReference) {
            const parsed = parseModelReference(roleReference);
            const model = parsed ? this.registry.find(parsed.provider, parsed.model) : undefined;
            if (model) return model;
            logger.warn(
                `⚠️ Configured ${role} model "${roleReference}" was not found in the model registry; using the chat model instead.`
            );
        }
        return this.getChatModel();
    }

    private getChatModel(): Model<Api> {
        const { piBaseUrl, piModel, piProvider } = this.config;
        if (!piBaseUrl) {
            const model = this.registry.find(piProvider, piModel);
            if (model) return model;

            const providerIsKnown = this.registry
                .getAll()
                .some((candidate) => candidate.provider === piProvider);
            if (providerIsKnown) {
                throw new Error(`Unknown ${piProvider} model: ${piModel}`);
            }
        }
        return this.buildCustomModel();
    }

    /**
     * Builds a model definition for custom OpenAI-compatible endpoints and
     * providers outside the registry (for example `local`).
     */
    private buildCustomModel(): Model<Api> {
        const provider = this.config.piProvider;
        const api =
            this.config.piApi ||
            (provider === 'google' ? 'google-generative-ai' : 'openai-completions');
        return {
            id: this.config.piModel,
            name: this.config.piModel,
            api,
            provider: provider || 'custom',
            baseUrl:
                this.config.piBaseUrl ||
                (provider === 'google'
                    ? 'https://generativelanguage.googleapis.com'
                    : 'https://api.openai.com/v1'),
            reasoning: false,
            input: ['text'],
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            contextWindow: this.config.contextWindowTokens || 128000,
            maxTokens: 32000
        };
    }

    /**
     * Returns the API key for a provider. Tars-specific environment variables
     * keep their historical precedence; everything else resolves through
     * AuthStorage (stored keys, then OAuth tokens with automatic refresh, then
     * standard environment variables such as ANTHROPIC_API_KEY).
     */
    public async getApiKey(providerName: string): Promise<string | undefined> {
        const legacyKey = this.getLegacyEnvironmentKey(providerName);
        if (legacyKey) return legacyKey;

        try {
            return await this.registry.getApiKeyForProvider(providerName);
        } catch (error: unknown) {
            logger.warn(
                `⚠️ Failed to resolve credentials for provider ${providerName}: ${DLPService.scrub(getErrorMessage(error))}`
            );
            return undefined;
        }
    }

    private getLegacyEnvironmentKey(providerName: string): string | undefined {
        if (providerName === 'google') return process.env.TARS_API_KEY || undefined;
        if (providerName === 'local' || providerName === 'local-stark') {
            return process.env.LOCAL_API_KEY || process.env.STARK_API_KEY || 'none';
        }
        if (providerName === 'custom') return process.env.CUSTOM_API_KEY || 'none';
        return undefined;
    }
}
