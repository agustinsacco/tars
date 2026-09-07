import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { type Credential, type CredentialStore } from '@earendil-works/pi-ai';
import { getBuiltinModels } from '@earendil-works/pi-ai/providers/all';
import { ModelRuntime } from '@earendil-works/pi-coding-agent';

import {
    ModelManager,
    parseModelReference,
    type ModelManagerConfig
} from '../../supervisor/model-manager.js';

const anthropicModel = getBuiltinModels('anthropic')[0];
const codexModel = getBuiltinModels('openai-codex')[0];

function createMemoryCredentialStore(initial: Record<string, Credential> = {}): CredentialStore {
    const store = new Map<string, Credential>(Object.entries(initial));
    return {
        read: async (providerId) => store.get(providerId),
        list: async () =>
            [...store.entries()].map(([providerId, credential]) => ({
                providerId,
                type: credential.type
            })),
        modify: async (providerId, fn) => {
            const next = await fn(store.get(providerId));
            if (next !== undefined) store.set(providerId, next);
            return store.get(providerId);
        },
        delete: async (providerId) => {
            store.delete(providerId);
        }
    };
}

async function createManager(
    overrides: Partial<ModelManagerConfig> = {},
    credentials: Record<string, Credential> = {}
): Promise<{ manager: ModelManager; runtime: ModelRuntime }> {
    const runtime = await ModelRuntime.create({
        credentials: createMemoryCredentialStore(credentials),
        modelsPath: null
    });
    const config: ModelManagerConfig = {
        homeDir: '/tmp/tars-model-manager-test',
        piProvider: 'anthropic',
        piModel: anthropicModel.id,
        piBaseUrl: '',
        piApi: '',
        models: {},
        contextWindowTokens: 128000,
        ...overrides
    };
    return { manager: new ModelManager(config, runtime), runtime };
}

const MANAGED_ENV_KEYS = [
    'TARS_API_KEY',
    'LOCAL_API_KEY',
    'STARK_API_KEY',
    'CUSTOM_API_KEY',
    'ANTHROPIC_API_KEY',
    'ANTHROPIC_OAUTH_TOKEN',
    'GEMINI_API_KEY'
] as const;
let savedEnvironment: Record<string, string | undefined>;

beforeEach(() => {
    savedEnvironment = {};
    for (const key of MANAGED_ENV_KEYS) {
        savedEnvironment[key] = process.env[key];
        delete process.env[key];
    }
});

afterEach(() => {
    for (const key of MANAGED_ENV_KEYS) {
        const value = savedEnvironment[key];
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
    }
});

describe('parseModelReference', () => {
    it('parses provider and model id', () => {
        expect(parseModelReference('anthropic/claude-sonnet-4')).toEqual({
            provider: 'anthropic',
            model: 'claude-sonnet-4'
        });
    });

    it('keeps slashes inside the model id', () => {
        expect(parseModelReference('openrouter/anthropic/claude-sonnet-4')).toEqual({
            provider: 'openrouter',
            model: 'anthropic/claude-sonnet-4'
        });
    });

    it('rejects references without a provider or model id', () => {
        expect(parseModelReference('claude-sonnet-4')).toBeNull();
        expect(parseModelReference('/claude-sonnet-4')).toBeNull();
        expect(parseModelReference('anthropic/')).toBeNull();
    });
});

describe('ModelManager.getModel', () => {
    it('resolves chat models from the catalog for any known provider', async () => {
        // ARRANGE
        const { manager } = await createManager();

        // ACT
        const model = await manager.getModel('chat');

        // ASSERT
        expect(model.provider).toBe('anthropic');
        expect(model.id).toBe(anthropicModel.id);
        expect(model.api).toBe(anthropicModel.api);
    });

    it('resolves OAuth-only providers such as openai-codex from the catalog', async () => {
        // ARRANGE
        const { manager } = await createManager({
            piProvider: 'openai-codex',
            piModel: codexModel.id
        });

        // ACT
        const model = await manager.getModel('chat');

        // ASSERT
        expect(model.provider).toBe('openai-codex');
        expect(model.id).toBe(codexModel.id);
    });

    it('rejects unknown model ids for providers present in the catalog', async () => {
        // ARRANGE
        const { manager } = await createManager({ piModel: 'not-a-real-model' });

        // ACT / ASSERT
        await expect(manager.getModel('chat')).rejects.toThrow(/Unknown anthropic model/);
    });

    it('registers a custom provider for endpoints outside the catalog', async () => {
        // ARRANGE
        const { manager } = await createManager({
            piProvider: 'local',
            piModel: 'qwen3-30b',
            piBaseUrl: 'http://localhost:8080/v1',
            contextWindowTokens: 32000
        });

        // ACT
        const model = await manager.getModel('chat');

        // ASSERT
        expect(model).toMatchObject({
            id: 'qwen3-30b',
            provider: 'local',
            api: 'openai-completions',
            baseUrl: 'http://localhost:8080/v1',
            contextWindow: 32000
        });
    });

    it('honors piBaseUrl and the configured API shape for catalog models', async () => {
        // ARRANGE
        const { manager } = await createManager({
            piBaseUrl: 'https://llm.internal.example/v1',
            piApi: 'anthropic-messages'
        });

        // ACT
        const model = await manager.getModel('chat');

        // ASSERT
        expect(model.baseUrl).toBe('https://llm.internal.example/v1');
        expect(model.api).toBe('anthropic-messages');
        expect(model.id).toBe(anthropicModel.id);
    });

    it('falls back to the chat model when no role model is configured', async () => {
        // ARRANGE
        const { manager } = await createManager();

        // ACT / ASSERT
        expect(await manager.getModel('summarizer')).toEqual(await manager.getModel('chat'));
        expect(await manager.getModel('background')).toEqual(await manager.getModel('chat'));
    });

    it('resolves configured role models from the catalog', async () => {
        // ARRANGE
        const { manager } = await createManager({
            piProvider: 'openai-codex',
            piModel: codexModel.id,
            models: { background: `anthropic/${anthropicModel.id}` }
        });

        // ACT
        const model = await manager.getModel('background');

        // ASSERT
        expect(model.provider).toBe('anthropic');
        expect(model.id).toBe(anthropicModel.id);
    });

    it('falls back to the chat model when a role reference cannot be resolved', async () => {
        // ARRANGE
        const { manager } = await createManager({
            models: { summarizer: 'anthropic/not-a-real-model' }
        });

        // ACT
        const model = await manager.getModel('summarizer');

        // ASSERT
        expect(model.id).toBe(anthropicModel.id);
    });
});

describe('ModelManager credential wiring', () => {
    it('keeps the legacy TARS_API_KEY precedence for google', async () => {
        // ARRANGE
        process.env.TARS_API_KEY = 'legacy-google-key';
        const { manager, runtime } = await createManager();
        await manager.getModel('chat');

        // ACT
        const auth = await runtime.getAuth('google');

        // ASSERT
        expect(auth?.auth.apiKey).toBe('legacy-google-key');
    });

    it('keeps the placeholder key for local endpoints without credentials', async () => {
        // ARRANGE
        const { manager, runtime } = await createManager({
            piProvider: 'local',
            piModel: 'qwen3-30b',
            piBaseUrl: 'http://localhost:8080/v1'
        });
        await manager.getModel('chat');

        // ACT
        const auth = await runtime.getAuth('local');

        // ASSERT
        expect(auth?.auth.apiKey).toBe('none');
    });

    it('prefers stored auth.json credentials over environment variables', async () => {
        // ARRANGE
        process.env.ANTHROPIC_API_KEY = 'env-key';
        const { manager, runtime } = await createManager(
            {},
            { anthropic: { type: 'api_key', key: 'stored-key' } }
        );
        await manager.getModel('chat');

        // ACT
        const auth = await runtime.getAuth('anthropic');

        // ASSERT
        expect(auth?.auth.apiKey).toBe('stored-key');
    });

    it('falls back to standard provider environment variables', async () => {
        // ARRANGE
        process.env.ANTHROPIC_API_KEY = 'env-only-key';
        const { manager, runtime } = await createManager();
        await manager.getModel('chat');

        // ACT
        const auth = await runtime.getAuth('anthropic');

        // ASSERT
        expect(auth?.auth.apiKey).toBe('env-only-key');
    });

    it('reports providers without credentials as unconfigured', async () => {
        // ARRANGE
        const { manager, runtime } = await createManager();
        await manager.getModel('chat');

        // ACT / ASSERT
        expect(await runtime.getAuth('anthropic')).toBeUndefined();
        expect(runtime.getProviderAuthStatus('anthropic').configured).toBe(false);
    });
});
