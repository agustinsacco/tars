import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { type Agent, type AgentOptions } from '@earendil-works/pi-agent-core';
import { type Api, type Model } from '@earendil-works/pi-ai';

import { type Config as TarsConfig } from '../../config/config.js';
import { WorkspaceStore } from '../../memory/workspace-store.js';
import { type ModelSource } from '../../supervisor/model-manager.js';
import { TarsEngine } from '../../supervisor/tars-engine.js';

const stubModel: Model<Api> = {
    id: 'stub-model',
    name: 'stub-model',
    api: 'openai-completions',
    provider: 'stub',
    baseUrl: 'https://stub.invalid/v1',
    reasoning: false,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128000,
    maxTokens: 32000
};

const stubModelSource: ModelSource = {
    getModel: async () => stubModel,
    stream: async () => {
        throw new Error('stream is not expected in these tests');
    }
};

const temporaryDirectories: string[] = [];

interface Harness {
    engine: TarsEngine;
    store: WorkspaceStore;
    capturedOptions: AgentOptions[];
    prompts: string[];
    homeDir: string;
}

function createHarness(modelSource: ModelSource = stubModelSource): Harness {
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tars-engine-ws-'));
    temporaryDirectories.push(homeDir);
    const config = {
        homeDir,
        systemPromptPath: path.join(homeDir, 'system.md'),
        piProvider: 'stub',
        piModel: 'stub-model',
        contextWindowTokens: 128000,
        preflightCompressionThreshold: 0.75,
        compressionThreshold: 0.6,
        maxRPM: 100,
        maxTPM: 900000
    } as TarsConfig;
    fs.writeFileSync(config.systemPromptPath, 'BASE PROMPT');

    const capturedOptions: AgentOptions[] = [];
    const prompts: string[] = [];
    const agentFactory = (options: AgentOptions): Agent => {
        capturedOptions.push(options);
        return {
            state: {
                messages: options.initialState?.messages ?? [],
                errorMessage: undefined
            },
            subscribe: () => undefined,
            prompt: async (text: string) => {
                prompts.push(text);
            }
        } as unknown as Agent;
    };

    const engine = new TarsEngine(config, agentFactory, modelSource);
    return { engine, store: new WorkspaceStore(homeDir), capturedOptions, prompts, homeDir };
}

async function runOnce(
    harness: Harness,
    options: { ephemeral?: boolean; allowMemoryWrites?: boolean } = {}
): Promise<AgentOptions> {
    await harness.engine.run(
        'hello',
        () => undefined,
        '11111111-1111-4111-8111-111111111111',
        undefined,
        undefined,
        options
    );
    return harness.capturedOptions[harness.capturedOptions.length - 1];
}

afterEach(async () => {
    for (const directory of temporaryDirectories.splice(0)) {
        fs.rmSync(directory, { force: true, recursive: true });
    }
});

describe('TarsEngine workspace integration', () => {
    it('injects the frozen workspace snapshot into the system prompt', async () => {
        // ARRANGE
        const harness = createHarness();
        await harness.store.ensure();
        await harness.store.applyOperations('memory', [
            { action: 'add', text: 'Deploys happen on Mondays.' }
        ]);
        await harness.store.applyOperations('user', [{ action: 'add', text: 'Name: Agustin' }]);

        // ACT
        const options = await runOnce(harness);

        // ASSERT
        const systemPrompt = options.initialState?.systemPrompt ?? '';
        expect(systemPrompt).toContain('BASE PROMPT');
        expect(systemPrompt).toContain('Identity (workspace/SOUL.md)');
        expect(systemPrompt).toContain('Deploys happen on Mondays.');
        expect(systemPrompt).toContain('Name: Agustin');
        expect(systemPrompt).toContain('FIRST RUN (workspace/BOOTSTRAP.md)');
    });

    it('keeps the snapshot frozen across writes until the session boundary', async () => {
        // ARRANGE
        const harness = createHarness();
        await harness.store.ensure();
        await runOnce(harness);
        await harness.store.applyOperations('memory', [
            { action: 'add', text: 'A brand new fact.' }
        ]);

        // ACT: same session keeps the frozen prompt; reset rebuilds it
        const frozen = await runOnce(harness);
        harness.engine.resetSession();
        const refreshed = await runOnce(harness);

        // ASSERT
        expect(frozen.initialState?.systemPrompt).not.toContain('A brand new fact.');
        expect(refreshed.initialState?.systemPrompt).toContain('A brand new fact.');
    });

    it('flushes memory before compression and refreshes the snapshot after', async () => {
        // ARRANGE: a model source whose stream returns a canned summary
        const streamingSource: ModelSource = {
            getModel: async () => stubModel,
            stream: (async () => {
                async function* events() {
                    yield { type: 'text_delta', delta: 'Summary of older turns.' };
                }
                return events();
            }) as unknown as ModelSource['stream']
        };
        const harness = createHarness(streamingSource);
        await harness.store.ensure();
        const sessionId = '22222222-2222-4222-8222-222222222222';
        const usage = {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
        };
        const assistantMessage = (text: string) => ({
            role: 'assistant',
            content: [{ type: 'text', text }],
            api: 'openai-completions',
            provider: 'stub',
            model: 'stub-model',
            usage,
            stopReason: 'stop',
            timestamp: Date.now()
        });
        const history = [
            { role: 'user', content: 'My deploy day is Monday, remember that.', timestamp: 1 },
            assistantMessage('Noted: deploys on Monday.'),
            { role: 'user', content: 'What is 2+2?', timestamp: 2 },
            assistantMessage('4.')
        ];
        const chatsDir = path.join(harness.homeDir, 'chats');
        fs.mkdirSync(chatsDir, { recursive: true });
        fs.writeFileSync(path.join(chatsDir, `${sessionId}.json`), JSON.stringify(history));

        // ACT
        const compressed = await harness.engine.compressSession(true, sessionId);

        // ASSERT: the flush run saw the compressed-away turns as data
        expect(compressed).toBe(true);
        const flushPrompt = harness.prompts.find((prompt) => prompt.includes('Memory flush'));
        expect(flushPrompt).toBeDefined();
        expect(flushPrompt).toContain('OWNER: My deploy day is Monday, remember that.');
        expect(flushPrompt).toContain('[SILENT]');
        const compactedHistory = JSON.parse(
            fs.readFileSync(path.join(chatsDir, `${sessionId}.json`), 'utf-8')
        ) as Array<{ content: unknown }>;
        expect(JSON.stringify(compactedHistory[0].content)).toContain('state_snapshot');
    });

    it('exposes the memory tool to interactive runs but not background runs', async () => {
        // ARRANGE
        const harness = createHarness();
        await harness.store.ensure();

        // ACT
        const interactive = await runOnce(harness);
        const background = await runOnce(harness, { ephemeral: true });
        const flush = await runOnce(harness, { ephemeral: true, allowMemoryWrites: true });

        // ASSERT
        const names = (options: AgentOptions): string[] =>
            (options.initialState?.tools ?? []).map((tool) => tool.name);
        expect(names(interactive)).toContain('memory');
        expect(names(background)).not.toContain('memory');
        expect(names(flush)).toContain('memory');
    });
});
