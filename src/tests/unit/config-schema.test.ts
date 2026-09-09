import { describe, expect, it } from 'vitest';

import { RuntimeConfigSchema } from '../../config/schema.js';

describe('RuntimeConfigSchema', () => {
    it('normalizes supported legacy backend aliases', () => {
        // ARRANGE / ACT
        const piConfig = RuntimeConfigSchema.parse({ inferenceBackend: 'pi' });
        const geminiConfig = RuntimeConfigSchema.parse({ inferenceBackend: 'gemini' });

        // ASSERT
        expect(piConfig.inferenceBackend).toBe('tars');
        expect(geminiConfig.inferenceBackend).toBe('tars');
    });

    it('rejects misspelled inference backends', () => {
        // ARRANGE / ACT / ASSERT
        expect(() => RuntimeConfigSchema.parse({ inferenceBackend: 'local-lama' })).toThrow();
    });

    it('accepts only HTTP-based provider URLs', () => {
        // ARRANGE / ACT / ASSERT
        expect(() => RuntimeConfigSchema.parse({ piBaseUrl: 'file:///tmp/provider' })).toThrow();
        expect(() =>
            RuntimeConfigSchema.parse({ localInferenceUrl: 'javascript:alert(1)' })
        ).toThrow();
        expect(
            RuntimeConfigSchema.parse({ piBaseUrl: 'https://api.example.com/v1' }).piBaseUrl
        ).toBe('https://api.example.com/v1');
    });

    it('rejects unsafe scheduler and context limits', () => {
        // ARRANGE / ACT / ASSERT
        expect(() => RuntimeConfigSchema.parse({ heartbeatIntervalSec: 0 })).toThrow();
        expect(() => RuntimeConfigSchema.parse({ contextWindowTokens: 10_000_001 })).toThrow();
        expect(() => RuntimeConfigSchema.parse({ compressionThreshold: 1 })).toThrow();
        expect(() => RuntimeConfigSchema.parse({ maxRPM: 0 })).toThrow();
    });

    it('defaults piApi to inference and accepts only supported API shapes', () => {
        // ARRANGE / ACT / ASSERT
        expect(RuntimeConfigSchema.parse({}).piApi).toBe('');
        expect(RuntimeConfigSchema.parse({ piApi: 'Anthropic-Messages' }).piApi).toBe(
            'anthropic-messages'
        );
        expect(() => RuntimeConfigSchema.parse({ piApi: 'grpc' })).toThrow();
    });

    it('treats endpoint image input as opt-in', () => {
        // ARRANGE / ACT / ASSERT
        expect(RuntimeConfigSchema.parse({}).piSupportsImages).toBe(false);
        expect(RuntimeConfigSchema.parse({ piSupportsImages: 'true' }).piSupportsImages).toBe(true);
        expect(RuntimeConfigSchema.parse({ piSupportsImages: '1' }).piSupportsImages).toBe(true);
        expect(() => RuntimeConfigSchema.parse({ piSupportsImages: 'yes' })).toThrow();
    });

    it('validates role model references as provider/model-id', () => {
        // ARRANGE / ACT
        const parsed = RuntimeConfigSchema.parse({
            models: {
                background: 'anthropic/claude-haiku-4-5',
                summarizer: 'openrouter/anthropic/claude-haiku-4-5'
            }
        });

        // ASSERT
        expect(parsed.models.background).toBe('anthropic/claude-haiku-4-5');
        expect(parsed.models.summarizer).toBe('openrouter/anthropic/claude-haiku-4-5');
        expect(RuntimeConfigSchema.parse({}).models).toEqual({});
        expect(() =>
            RuntimeConfigSchema.parse({ models: { background: 'claude-haiku-4-5' } })
        ).toThrow();
        expect(() => RuntimeConfigSchema.parse({ models: { summarizer: '/model' } })).toThrow();
    });
});
