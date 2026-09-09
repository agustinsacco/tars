import path from 'node:path';

import { ModelRuntime } from '@earendil-works/pi-coding-agent';
import { type Api, type Model } from '@earendil-works/pi-ai';
import { type StreamFn } from '@earendil-works/pi-agent-core';

import logger from '../utils/logger.js';

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
    /**
     * Declares that the custom endpoint accepts image input. Pi drops image
     * blocks for models whose `input` list omits `"image"`, so multimodal
     * endpoints must advertise it explicitly.
     */
    readonly piSupportsImages: boolean;
    readonly models: { readonly background?: string; readonly summarizer?: string };
    readonly contextWindowTokens: number;
}

/** Minimal surface the engine depends on; kept small so tests can stub it. */
export interface ModelSource {
    getModel(role: ModelRole): Promise<Model<Api>>;
    /** Streams a model request with credentials resolved by the pi runtime. */
    stream: StreamFn;
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

/**
 * Creates the shared pi model/auth runtime used by the supervisor and the CLI.
 * Credentials live in `~/.tars/auth.json` (API keys and OAuth tokens with
 * file-locked refresh); optional custom models live in `~/.tars/models.json`.
 */
export async function createModelRuntime(homeDir: string): Promise<ModelRuntime> {
    return ModelRuntime.create({
        authPath: getAuthStoragePath(homeDir),
        modelsPath: getModelsJsonPath(homeDir)
    });
}

/**
 * ModelManager - resolves models per role and streams requests through pi.
 *
 * Wraps pi's ModelRuntime: the built-in catalog for every known provider,
 * custom models from `~/.tars/models.json`, credential resolution from
 * `~/.tars/auth.json` and standard environment variables, and OAuth token
 * refresh. Providers outside the catalog (`local`, `custom`, or any provider
 * with a `piBaseUrl` override) are registered as custom providers so their
 * requests flow through the same runtime.
 */
export class ModelManager implements ModelSource {
    private runtimePromise: Promise<ModelRuntime> | null = null;

    constructor(
        private readonly config: ModelManagerConfig,
        private readonly injectedRuntime?: ModelRuntime
    ) {}

    /**
     * The runtime reads `auth.json` and `models.json` at creation time, so it
     * is built lazily to keep construction free of filesystem side effects.
     */
    private ensureRuntime(): Promise<ModelRuntime> {
        if (!this.runtimePromise) this.runtimePromise = this.initializeRuntime();
        return this.runtimePromise;
    }

    private async initializeRuntime(): Promise<ModelRuntime> {
        const runtime = this.injectedRuntime ?? (await createModelRuntime(this.config.homeDir));
        await this.applyLegacyEnvironmentKeys(runtime);
        this.registerCustomChatProvider(runtime);
        return runtime;
    }

    /**
     * Preserves the historical Tars environment-variable precedence as
     * process-local runtime keys. Standard variables such as ANTHROPIC_API_KEY
     * and GEMINI_API_KEY are already resolved by the pi runtime itself.
     */
    private async applyLegacyEnvironmentKeys(runtime: ModelRuntime): Promise<void> {
        const seeds: Array<{ provider: string; key: string | undefined }> = [
            { provider: 'google', key: process.env.TARS_API_KEY },
            { provider: 'local', key: process.env.LOCAL_API_KEY || process.env.STARK_API_KEY },
            {
                provider: 'local-stark',
                key: process.env.LOCAL_API_KEY || process.env.STARK_API_KEY
            },
            { provider: 'custom', key: process.env.CUSTOM_API_KEY }
        ];
        for (const seed of seeds) {
            if (!seed.key) continue;
            try {
                await runtime.setRuntimeApiKey(seed.provider, seed.key);
            } catch (error: unknown) {
                logger.warn(
                    `⚠️ Failed to apply environment key for ${seed.provider}: ${getErrorMessage(error)}`
                );
            }
        }
    }

    /**
     * Registers the configured chat model as a custom provider when the
     * catalog does not serve it: providers such as `local`/`custom`, and
     * custom-endpoint model ids that only exist behind `piBaseUrl`. A known
     * provider with an unknown model id and no custom endpoint stays
     * unregistered so `getChatModel` reports the typo instead.
     */
    private registerCustomChatProvider(runtime: ModelRuntime): void {
        const { contextWindowTokens, piApi, piBaseUrl, piModel, piProvider, piSupportsImages } =
            this.config;
        if (runtime.getModel(piProvider, piModel)) return;
        const providerKnown = runtime.getProvider(piProvider) !== undefined;
        if (!piBaseUrl && providerKnown) return;

        const api =
            piApi || (piProvider === 'google' ? 'google-generative-ai' : 'openai-completions');
        const baseUrl =
            piBaseUrl ||
            (piProvider === 'google'
                ? 'https://generativelanguage.googleapis.com'
                : 'https://api.openai.com/v1');
        try {
            runtime.registerProvider(piProvider || 'custom', {
                name: piProvider || 'custom',
                api,
                baseUrl,
                // Keyless local endpoints keep the historical placeholder key;
                // known providers keep their normal credential resolution.
                ...(providerKnown ? {} : { apiKey: 'none' }),
                models: [
                    {
                        id: piModel,
                        name: piModel,
                        reasoning: false,
                        input: piSupportsImages ? ['text', 'image'] : ['text'],
                        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
                        contextWindow: contextWindowTokens || 128000,
                        maxTokens: 32000
                    }
                ]
            });
        } catch (error: unknown) {
            logger.warn(
                `⚠️ Failed to register custom provider ${piProvider}: ${getErrorMessage(error)}`
            );
        }
    }

    /**
     * Resolves the model for a role. Role models must exist in the runtime
     * (built-in catalog or models.json); an unresolvable role reference falls
     * back to the chat model so background work keeps running.
     */
    public async getModel(role: ModelRole): Promise<Model<Api>> {
        const runtime = await this.ensureRuntime();
        const roleReference = role === 'chat' ? undefined : this.config.models[role];
        if (roleReference) {
            const parsed = parseModelReference(roleReference);
            const model = parsed ? runtime.getModel(parsed.provider, parsed.model) : undefined;
            if (model) return model;
            logger.warn(
                `⚠️ Configured ${role} model "${roleReference}" was not found in the model registry; using the chat model instead.`
            );
        }
        return this.getChatModel(runtime);
    }

    private getChatModel(runtime: ModelRuntime): Model<Api> {
        const { piApi, piBaseUrl, piModel, piProvider } = this.config;
        const model = runtime.getModel(piProvider, piModel);
        if (!model) throw new Error(`Unknown ${piProvider} model: ${piModel}`);
        if (!piBaseUrl) return model;
        return { ...model, baseUrl: piBaseUrl, ...(piApi ? { api: piApi } : {}) };
    }

    /**
     * Streams a model request through the pi runtime, which resolves API keys,
     * OAuth tokens (refreshing when expired), and provider-specific headers.
     */
    public stream: StreamFn = async (model, context, options) => {
        const runtime = await this.ensureRuntime();
        return runtime.streamSimple(model, context, options);
    };
}
