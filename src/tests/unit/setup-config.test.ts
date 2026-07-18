import { describe, expect, it } from 'vitest';

import { removeLegacyDiscordToken } from '../../cli/commands/setup.js';

describe('setup configuration migration', () => {
    it('removes a legacy structured Discord token while preserving other channel settings', () => {
        // ARRANGE
        const legacyConfig = {
            enabled: true,
            ownerId: '12345678901234567',
            token: 'plaintext-token',
            customSetting: 'preserve-me'
        };

        // ACT
        const migrated = removeLegacyDiscordToken(legacyConfig);

        // ASSERT
        expect(migrated).toEqual({
            enabled: true,
            ownerId: '12345678901234567',
            customSetting: 'preserve-me'
        });
        expect(migrated).not.toHaveProperty('token');
    });
});
