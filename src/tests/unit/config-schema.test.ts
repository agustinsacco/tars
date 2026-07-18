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
});
