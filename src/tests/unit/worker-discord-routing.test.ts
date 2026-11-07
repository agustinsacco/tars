import { describe, it, expect, vi } from 'vitest';
import { ChannelManager } from '../../channels/channel-manager.js';
import type { CommunicationChannel } from '../../channels/types.js';

function channel(id: string): CommunicationChannel {
    return {
        id,
        isEnabled: true,
        start: vi.fn(async () => undefined),
        stop: vi.fn(async () => undefined),
        notify: vi.fn(async () => undefined),
        sendStatus: vi.fn(async () => undefined),
        editStatus: vi.fn(async () => true),
        clearStatus: vi.fn(),
        onMessage: vi.fn()
    };
}
describe('worker Discord routing', () => {
    it('targets Discord even when voice was last active', async () => {
        const manager = new ChannelManager({ skipDiscord: true }),
            discord = channel('discord'),
            voice = channel('voice-relay');
        manager.registerChannel(discord);
        manager.registerChannel(voice);
        Reflect.set(manager, 'lastActiveChannelId', 'voice-relay');
        await manager.notifyTo('discord', '📬 Relay — completed');
        expect(discord.notify).toHaveBeenCalledOnce();
        expect(voice.notify).not.toHaveBeenCalled();
    });
    it('fails closed instead of falling back to voice/TUI', async () => {
        const manager = new ChannelManager({ skipDiscord: true }),
            voice = channel('voice-relay');
        manager.registerChannel(voice);
        await expect(manager.notifyTo('discord', 'update')).rejects.toThrow('unavailable');
        expect(voice.notify).not.toHaveBeenCalled();
    });
});
