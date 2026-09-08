import { describe, expect, it } from 'vitest';

import {
    formatAuthStatusLine,
    resolveOAuthProvider,
    type OAuthProviderChoice
} from '../../cli/commands/auth.js';

const providers: OAuthProviderChoice[] = [
    { id: 'anthropic', name: 'Anthropic (Claude Pro/Max)' },
    { id: 'openai-codex', name: 'OpenAI (ChatGPT)' }
];

describe('resolveOAuthProvider', () => {
    it('finds providers by exact id', () => {
        expect(resolveOAuthProvider(providers, 'openai-codex')?.name).toBe('OpenAI (ChatGPT)');
    });

    it('returns undefined for missing or unknown ids', () => {
        expect(resolveOAuthProvider(providers, undefined)).toBeUndefined();
        expect(resolveOAuthProvider(providers, 'copilot')).toBeUndefined();
    });
});

describe('formatAuthStatusLine', () => {
    it('reports unconfigured providers', () => {
        expect(formatAuthStatusLine('anthropic', 'Anthropic', { configured: false })).toBe(
            '- Anthropic (anthropic): not configured'
        );
    });

    it('reports the credential source without exposing values', () => {
        const line = formatAuthStatusLine('anthropic', 'Anthropic', {
            configured: true,
            source: 'stored',
            label: 'OAuth'
        });
        expect(line).toBe('- Anthropic (anthropic): configured (OAuth)');
        expect(line).not.toContain('sk-');
    });
});
