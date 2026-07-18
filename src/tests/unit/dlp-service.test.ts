import { describe, expect, it } from 'vitest';

import { DLPService } from '../../utils/dlp-service.js';

describe('DLPService', () => {
    it('redacts current GitHub token formats', () => {
        // ARRANGE
        const token = `ghp_${'a'.repeat(82)}`;

        // ACT
        const result = DLPService.scrub(`token=${token}`);

        // ASSERT
        expect(result).not.toContain(token);
        expect(result).toContain('[REDACTED_SECRET_');
    });

    it('redacts current OpenAI project key formats', () => {
        // ARRANGE
        const token = `sk-proj-${'a'.repeat(48)}`;

        // ACT
        const result = DLPService.scrub(`provider error: ${token}`);

        // ASSERT
        expect(result).not.toContain(token);
        expect(result).toContain('[REDACTED_SECRET_');
    });

    it('redacts both generic PKCS#8 and named private-key blocks', () => {
        // ARRANGE
        const privateKeys = [
            '-----BEGIN PRIVATE KEY-----\nprivate-material\n-----END PRIVATE KEY-----',
            '-----BEGIN RSA PRIVATE KEY-----\nrsa-material\n-----END RSA PRIVATE KEY-----'
        ];

        // ACT / ASSERT
        for (const privateKey of privateKeys) {
            const result = DLPService.scrub(privateKey);
            expect(result).not.toContain('private-material');
            expect(result).not.toContain('rsa-material');
            expect(result).toContain('[REDACTED_SECRET_');
        }
    });

    it('redacts short secrets when their object key is sensitive', () => {
        // ARRANGE
        const input = {
            account: {
                password: 'short-value',
                apiKey: 'also-short',
                displayName: 'Tars'
            }
        };

        // ACT
        const result = DLPService.scrubDeep(input);

        // ASSERT
        expect(result).toEqual({
            account: {
                password: '[REDACTED_SECRET]',
                apiKey: '[REDACTED_SECRET]',
                displayName: 'Tars'
            }
        });
    });

    it('preserves token usage metrics while redacting credential tokens', () => {
        // ARRANGE
        const input = {
            discordToken: 'discord-secret',
            access_token: 'access-secret',
            totalInputTokens: 42_000,
            maxTokens: 8_192,
            tokenCount: 12
        };

        // ACT
        const result = DLPService.scrubDeep(input);

        // ASSERT
        expect(result).toEqual({
            discordToken: '[REDACTED_SECRET]',
            access_token: '[REDACTED_SECRET]',
            totalInputTokens: 42_000,
            maxTokens: 8_192,
            tokenCount: 12
        });
    });

    it('does not mutate the original object while redacting nested values', () => {
        // ARRANGE
        const input = { nested: { token: 'secret-value' } };

        // ACT
        const result = DLPService.scrubDeep(input);

        // ASSERT
        expect(result).not.toBe(input);
        expect(input.nested.token).toBe('secret-value');
    });
});
