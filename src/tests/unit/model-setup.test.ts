import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { getBuiltinModels } from '@earendil-works/pi-ai/providers/all';
import { ModelRuntime } from '@earendil-works/pi-coding-agent';

import {
    buildModelChoices,
    buildProviderChoices,
    discoverEndpointModels,
    formatAuthMethods,
    formatAuthStatus,
    getSupportedThinkingLevels,
    importCredential,
    isEndpointProvider,
    normalizeProviderId,
    parseModelListResponse,
    readPiCredential,
    resolveDefaultContextWindow,
    resolveDefaultThinkingLevel,
    sortProviders,
    summarizeProvider,
    type ProviderSummary
} from '../../cli/model-setup.js';
import { parseModelCommandOptions } from '../../cli/commands/model.js';

const temporaryDirectories: string[] = [];

function createTemporaryDirectory(): string {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tars-model-setup-'));
    temporaryDirectories.push(directory);
    return directory;
}

afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

function summary(overrides: Partial<ProviderSummary>): ProviderSummary {
    return {
        id: 'example',
        name: 'Example',
        oauth: false,
        apiKey: true,
        ambientOnly: false,
        status: { configured: false },
        modelCount: 1,
        ...overrides
    };
}

describe('provider summaries', () => {
    it('detects OAuth and API-key login methods from the pi registry', async () => {
        // ARRANGE
        const runtime = await ModelRuntime.create({ modelsPath: null });
        const codex = runtime.getProvider('openai-codex');
        const openai = runtime.getProvider('openai');
        if (!codex || !openai) throw new Error('Expected registry providers');

        // ACT
        const codexSummary = summarizeProvider(codex, { configured: false });
        const openaiSummary = summarizeProvider(openai, { configured: true, source: 'stored' });

        // ASSERT
        expect(codexSummary.oauth).toBe(true);
        expect(codexSummary.oauthLabel).toContain('ChatGPT');
        expect(codexSummary.modelCount).toBeGreaterThan(0);
        expect(formatAuthMethods(codexSummary)).toMatch(/OAuth/);
        expect(openaiSummary.oauth).toBe(false);
        expect(openaiSummary.apiKey).toBe(true);
        expect(formatAuthMethods(openaiSummary)).toBe('API key');
        expect(formatAuthStatus(openaiSummary.status)).toBe('signed in (stored)');
    });

    it('labels ambient-only providers and unconfigured status', () => {
        // ARRANGE
        const ambient = summary({ apiKey: false, ambientOnly: true });

        // ACT / ASSERT
        expect(formatAuthMethods(ambient)).toBe('environment credentials');
        expect(formatAuthStatus(ambient.status)).toBe('not signed in');
    });

    it('lists featured providers first and the rest alphabetically', () => {
        // ARRANGE
        const providers = [
            { id: 'zai', name: 'Z.AI' },
            { id: 'google', name: 'Google' },
            { id: 'openai-codex', name: 'OpenAI Codex' },
            { id: 'groq', name: 'Groq' },
            { id: 'anthropic', name: 'Anthropic' }
        ];

        // ACT
        const sorted = sortProviders(providers).map((provider) => provider.id);

        // ASSERT
        expect(sorted).toEqual(['openai-codex', 'anthropic', 'google', 'groq', 'zai']);
    });

    it('offers registry providers with models plus local and custom endpoints', () => {
        // ARRANGE
        const summaries = [
            summary({ id: 'empty', name: 'Empty', modelCount: 0 }),
            summary({ id: 'anthropic', name: 'Anthropic', oauth: true })
        ];

        // ACT
        const values = buildProviderChoices(summaries)
            .filter((choice): choice is { name: string; value: string } => 'value' in choice)
            .map((choice) => choice.value);

        // ASSERT
        expect(values).toEqual(['anthropic', 'local', 'custom']);
    });

    it('normalizes legacy provider ids and recognizes endpoint providers', () => {
        // ACT / ASSERT
        expect(normalizeProviderId('local-stark')).toBe('local');
        expect(normalizeProviderId('openai-codex')).toBe('openai-codex');
        expect(normalizeProviderId(undefined)).toBeUndefined();
        expect(isEndpointProvider('local')).toBe(true);
        expect(isEndpointProvider('custom')).toBe(true);
        expect(isEndpointProvider('openai')).toBe(false);
    });
});

describe('model and thinking-level choices', () => {
    const luna = getBuiltinModels('openai-codex').find((model) => model.id === 'gpt-5.6-luna');

    it('describes catalog models and appends a manual entry', () => {
        // ARRANGE
        if (!luna) throw new Error('Expected gpt-5.6-luna in the catalog');

        // ACT
        const choices = buildModelChoices([luna]);

        // ASSERT
        expect(choices).toHaveLength(2);
        expect(choices[0].value).toBe('gpt-5.6-luna');
        expect(choices[0].name).toContain('272k context');
        expect(choices[0].name).toContain('reasoning');
        expect(choices[0].name).toContain('vision');
        expect(choices[1].value).toBe('__manual__');
    });

    it('offers only supported thinking levels for reasoning models', () => {
        // ARRANGE
        if (!luna) throw new Error('Expected gpt-5.6-luna in the catalog');
        const restricted = { reasoning: true, thinkingLevelMap: { high: null, max: null } };

        // ACT / ASSERT
        expect(getSupportedThinkingLevels(luna)).toContain('medium');
        expect(getSupportedThinkingLevels(restricted)).toEqual([
            'off',
            'minimal',
            'low',
            'medium',
            'xhigh'
        ]);
        expect(getSupportedThinkingLevels({ reasoning: false })).toEqual(['off']);
        expect(getSupportedThinkingLevels(undefined)).toHaveLength(7);
    });

    it('defaults to medium unless a supported non-off level was configured', () => {
        // ACT / ASSERT
        expect(resolveDefaultThinkingLevel(['off', 'low', 'medium', 'high'], undefined)).toBe(
            'medium'
        );
        expect(resolveDefaultThinkingLevel(['off', 'low', 'medium', 'high'], 'high')).toBe('high');
        expect(resolveDefaultThinkingLevel(['off', 'low', 'medium', 'high'], 'off')).toBe('medium');
        expect(resolveDefaultThinkingLevel(['off', 'low'], 'max')).toBe('low');
        expect(resolveDefaultThinkingLevel(['off'], 'medium')).toBe('off');
    });

    it('keeps the configured context window only for the same model', () => {
        // ARRANGE
        if (!luna) throw new Error('Expected gpt-5.6-luna in the catalog');
        const existing = { piModel: 'gpt-5.6-luna', contextWindowTokens: 64_000 };

        // ACT / ASSERT
        expect(resolveDefaultContextWindow(luna, existing, 128_000)).toBe(64_000);
        expect(resolveDefaultContextWindow(luna, { piModel: 'gpt-5.5' }, 128_000)).toBe(272_000);
        expect(resolveDefaultContextWindow(undefined, existing, 128_000)).toBe(64_000);
        expect(resolveDefaultContextWindow(undefined, {}, 8_192)).toBe(8_192);
    });
});

describe('endpoint model discovery', () => {
    it('parses OpenAI, Ollama-style, and bare array listings', () => {
        // ACT / ASSERT
        expect(parseModelListResponse({ data: [{ id: 'b' }, { id: 'a' }, { id: 'a' }] })).toEqual([
            'a',
            'b'
        ]);
        expect(parseModelListResponse({ models: [{ id: 'llama' }] })).toEqual(['llama']);
        expect(parseModelListResponse([{ id: 'x' }])).toEqual(['x']);
        expect(parseModelListResponse({ unexpected: true })).toEqual([]);
        expect(parseModelListResponse('nope')).toEqual([]);
    });

    it('queries /models with a bearer token and tolerates failures', async () => {
        // ARRANGE
        const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
            expect(String(url)).toBe('http://localhost:8080/v1/models');
            expect(new Headers(init?.headers).get('authorization')).toBe('Bearer secret');
            return new Response(JSON.stringify({ data: [{ id: 'qwen' }] }), { status: 200 });
        });
        const failing = vi.fn(async () => {
            throw new Error('connection refused');
        });

        // ACT
        const discovered = await discoverEndpointModels(
            'http://localhost:8080/v1/',
            'secret',
            fetchImpl as unknown as typeof fetch
        );
        const empty = await discoverEndpointModels(
            'http://localhost:9',
            '',
            failing as unknown as typeof fetch
        );

        // ASSERT
        expect(discovered).toEqual(['qwen']);
        expect(empty).toEqual([]);
    });
});

describe('pi CLI credential import', () => {
    it('reads a stored pi credential and merges it into the Tars store', async () => {
        // ARRANGE
        const directory = createTemporaryDirectory();
        const piAuthPath = path.join(directory, 'pi-auth.json');
        const tarsAuthPath = path.join(directory, 'tars-auth.json');
        fs.writeFileSync(
            piAuthPath,
            JSON.stringify({
                'openai-codex': { type: 'oauth', access: 'a', refresh: 'r', expires: 1 },
                broken: { nope: true }
            })
        );
        fs.writeFileSync(
            tarsAuthPath,
            JSON.stringify({ anthropic: { type: 'api_key', key: 'k' } })
        );

        // ACT
        const credential = readPiCredential('openai-codex', piAuthPath);
        if (!credential) throw new Error('Expected a credential');
        await importCredential(tarsAuthPath, 'openai-codex', credential);
        const merged = JSON.parse(fs.readFileSync(tarsAuthPath, 'utf-8'));

        // ASSERT
        expect(readPiCredential('broken', piAuthPath)).toBeUndefined();
        expect(readPiCredential('missing', piAuthPath)).toBeUndefined();
        expect(
            readPiCredential('openai-codex', path.join(directory, 'absent.json'))
        ).toBeUndefined();
        expect(merged).toEqual({
            anthropic: { type: 'api_key', key: 'k' },
            'openai-codex': { type: 'oauth', access: 'a', refresh: 'r', expires: 1 }
        });
        expect(fs.statSync(tarsAuthPath).mode & 0o777).toBe(0o600);
    });
});

describe('tars model flags', () => {
    it('validates thinking levels and requires a provider alongside a model', () => {
        // ACT / ASSERT
        expect(
            parseModelCommandOptions({
                provider: 'openai-codex',
                model: 'gpt-5.6-luna',
                thinking: 'Medium'
            })
        ).toEqual({ provider: 'openai-codex', model: 'gpt-5.6-luna', thinkingLevel: 'medium' });
        expect(parseModelCommandOptions({})).toEqual({
            provider: undefined,
            model: undefined,
            thinkingLevel: undefined
        });
        expect(() => parseModelCommandOptions({ thinking: 'ultra' })).toThrow(/thinking level/);
        expect(() => parseModelCommandOptions({ model: 'gpt-5.6-luna' })).toThrow(/--provider/);
    });
});
