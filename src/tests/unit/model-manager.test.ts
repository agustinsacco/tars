import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getModels } from '@earendil-works/pi-ai';
import { AuthStorage, ModelRegistry } from '@earendil-works/pi-coding-agent';

import {
    ModelManager,
    parseModelReference,
    type ModelManagerConfig
} from '../../supervisor/model-manager.js';

const anthropicModel = getModels('anthropic')[0];
const codexModel = getModels('openai-codex')[0];

function createManager(
    overrides: Partial<ModelManagerConfig> = {},
    authStorage: AuthStorage = AuthStorage.inMemory()
): ModelManager {
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
    return new ModelManager(config, ModelRegistry.inMemory(authStorage));
}

const MANAGED_ENV_KEYS = [
    'TARS_API_KEY',
    'LOCAL_API_KEY',
    'STARK_API_KEY',
    'CUSTOM_API_KEY',
    'ANTHROPIC_API_KEY',
    'ANTHROPIC_OAUTH_TOKEN'
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
    it('resolves chat models from the registry for any known provider', () => {
        // ARRANGE
        const manager = createManager();

        // ACT
        const model = manager.getModel('chat');

        // ASSERT
        expect(model.provider).toBe('anthropic');
        expect(model.id).toBe(anthropicModel.id);
        expect(model.api).toBe(anthropicModel.api);
    });

    it('resolves OAuth-only providers such as openai-codex from the registry', () => {
        // ARRANGE
        const manager = createManager({
            piProvider: 'openai-codex',
            piModel: codexModel.id
        });

        // ACT
        const model = manager.getModel('chat');

        // ASSERT
        expect(model.provider).toBe('openai-codex');
        expect(model.id).toBe(codexModel.id);
    });

    it('rejects unknown model ids for providers present in the registry', () => {
        // ARRANGE
        const manager = createManager({ piModel: 'not-a-real-model' });

        // ACT / ASSERT
        expect(() => manager.getModel('chat')).toThrow(/Unknown anthropic model/);
    });

    it('builds a custom model for providers outside the registry', () => {
        // ARRANGE
        const manager = createManager({
            piProvider: 'local',
            piModel: 'qwen3-30b',
            contextWindowTokens: 32000
        });

        // ACT
        const model = manager.getModel('chat');

        // ASSERT
        expect(model).toMatchObject({
            id: 'qwen3-30b',
            provider: 'local',
            api: 'openai-completions',
            contextWindow: 32000
        });
    });

    it('honors piBaseUrl and the configured API shape for custom endpoints', () => {
        // ARRANGE
        const manager = createManager({
            piBaseUrl: 'https://llm.internal.example/v1',
            piApi: 'anthropic-messages'
        });

        // ACT
        const model = manager.getModel('chat');

        // ASSERT
        expect(model.baseUrl).toBe('https://llm.internal.example/v1');
        expect(model.api).toBe('anthropic-messages');
        expect(model.id).toBe(anthropicModel.id);
    });

    it('falls back to the chat model when no role model is configured', () => {
        // ARRANGE
        const manager = createManager();

        // ACT / ASSERT
        expect(manager.getModel('summarizer')).toEqual(manager.getModel('chat'));
        expect(manager.getModel('background')).toEqual(manager.getModel('chat'));
    });

    it('resolves configured role models from the registry', () => {
        // ARRANGE
        const manager = createManager({
            piProvider: 'openai-codex',
            piModel: codexModel.id,
            models: { background: `anthropic/${anthropicModel.id}` }
        });

        // ACT
        const model = manager.getModel('background');

        // ASSERT
        expect(model.provider).toBe('anthropic');
        expect(model.id).toBe(anthropicModel.id);
    });

    it('falls back to the chat model when a role reference cannot be resolved', () => {
        // ARRANGE
        const manager = createManager({
            models: { summarizer: 'anthropic/not-a-real-model' }
        });

        // ACT
        const model = manager.getModel('summarizer');

        // ASSERT
        expect(model.id).toBe(anthropicModel.id);
    });
});

describe('ModelManager.getApiKey', () => {
    it('keeps the legacy TARS_API_KEY precedence for google', async () => {
        // ARRANGE
        process.env.TARS_API_KEY = 'legacy-google-key';
        const manager = createManager();

        // ACT / ASSERT
        expect(await manager.getApiKey('google')).toBe('legacy-google-key');
    });

    it('returns placeholder keys for local and custom endpoints', async () => {
        // ARRANGE
        const manager = createManager();

        // ACT / ASSERT
        expect(await manager.getApiKey('local')).toBe('none');
        expect(await manager.getApiKey('local-stark')).toBe('none');
        expect(await manager.getApiKey('custom')).toBe('none');
    });

    it('prefers stored auth.json credentials over environment variables', async () => {
        // ARRANGE
        process.env.ANTHROPIC_API_KEY = 'env-key';
        const authStorage = AuthStorage.inMemory({
            anthropic: { type: 'api_key', key: 'stored-key' }
        });
        const manager = createManager({}, authStorage);

        // ACT / ASSERT
        expect(await manager.getApiKey('anthropic')).toBe('stored-key');
    });

    it('falls back to standard provider environment variables', async () => {
        // ARRANGE
        process.env.ANTHROPIC_API_KEY = 'env-only-key';
        const manager = createManager();

        // ACT / ASSERT
        expect(await manager.getApiKey('anthropic')).toBe('env-only-key');
    });

    it('returns undefined when a provider has no credentials anywhere', async () => {
        // ARRANGE
        const manager = createManager();

        // ACT / ASSERT
        expect(await manager.getApiKey('anthropic')).toBeUndefined();
    });
});
