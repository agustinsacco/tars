import { describe, expect, it, vi } from 'vitest';

import type { ChannelManager } from '../../channels/channel-manager.js';
import { deliverStatusUpdateBestEffort, type LiveStatusState } from '../../supervisor/bootstrap.js';

type StatusChannel = Pick<ChannelManager, 'editStatus' | 'sendStatus'>;

function createStatusChannel(): StatusChannel {
    return {
        editStatus: vi.fn<StatusChannel['editStatus']>().mockResolvedValue(true),
        sendStatus: vi.fn<StatusChannel['sendStatus']>().mockResolvedValue(undefined)
    };
}

describe('best-effort live status delivery', () => {
    it('does not abort a healthy turn when the initial notification rejects', async () => {
        // ARRANGE
        const channel = createStatusChannel();
        vi.mocked(channel.sendStatus).mockRejectedValue(new Error('Discord unavailable'));
        const state: LiveStatusState = { initialized: false };

        const completeHealthyTurn = async (): Promise<string> => {
            await deliverStatusUpdateBestEffort(channel, state, 'Tool started');
            return 'healthy result';
        };

        // ACT / ASSERT
        await expect(completeHealthyTurn()).resolves.toBe('healthy result');
        expect(channel.sendStatus).toHaveBeenCalledOnce();
        expect(state.initialized).toBe(false);
    });

    it('recovers from an edit rejection by retrying a fresh notification later', async () => {
        // ARRANGE
        const channel = createStatusChannel();
        vi.mocked(channel.editStatus).mockRejectedValueOnce(new Error('status message deleted'));
        const state: LiveStatusState = { initialized: true };

        // ACT
        await deliverStatusUpdateBestEffort(channel, state, 'Tool running');
        await deliverStatusUpdateBestEffort(channel, state, 'Tool completed');

        // ASSERT
        expect(channel.editStatus).toHaveBeenCalledOnce();
        expect(channel.sendStatus).toHaveBeenCalledWith('Tool completed');
        expect(state.initialized).toBe(true);
    });
});
