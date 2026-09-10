import { describe, expect, it } from 'vitest';

import {
    chooseLoginMethod,
    formatAuthStatusLine,
    resolveOAuthProvider,
    type LoginProviderChoice,
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

describe('chooseLoginMethod', () => {
    const oauthOnly: LoginProviderChoice = {
        id: 'github-copilot',
        name: 'GitHub Copilot',
        oauth: true,
        apiKey: false
    };
    const keyOnly: LoginProviderChoice = {
        id: 'openai',
        name: 'OpenAI',
        oauth: false,
        apiKey: true
    };
    const both: LoginProviderChoice = {
        id: 'anthropic',
        name: 'Anthropic',
        oauth: true,
        apiKey: true
    };

    it('uses the only available method without prompting', async () => {
        expect(await chooseLoginMethod(oauthOnly, undefined)).toBe('oauth');
        expect(await chooseLoginMethod(keyOnly, undefined)).toBe('api_key');
    });

    it('honors an explicit method and rejects unsupported ones', async () => {
        expect(await chooseLoginMethod(both, 'api_key')).toBe('api_key');
        await expect(chooseLoginMethod(oauthOnly, 'api_key')).rejects.toThrow(/does not support/);
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
