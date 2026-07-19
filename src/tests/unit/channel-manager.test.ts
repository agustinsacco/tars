import { Client } from 'discord.js';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { ChannelManager } from '../../channels/channel-manager.js';
import type { CommunicationChannel, ChannelMessage } from '../../channels/types.js';

// Mock discord.js to prevent actual Discord client initialization
vi.mock('discord.js', () => ({
    Client: vi.fn().mockImplementation(function ClientMock() {
        return {
            on: vi.fn(),
            once: vi.fn(),
            login: vi.fn(),
            destroy: vi.fn(),
            users: { fetch: vi.fn() },
            channels: { cache: new Map(), fetch: vi.fn() }
        };
    }),
    GatewayIntentBits: { Guilds: 1, GuildMessages: 2, MessageContent: 3, DirectMessages: 4 },
    Partials: { Channel: 1, Message: 2, User: 3 },
    ChannelType: { DM: 1, GuildText: 0 }
}));

// Mock Config — no Discord token so Discord channel is disabled
vi.mock('../../config/config.js', () => ({
    Config: {
        getInstance: vi.fn().mockReturnValue({
            discordToken: '',
            assistantName: 'Tars',
            discordOwnerId: null,
            homeDir: '/tmp/tars-test',
            channels: {},
            primaryChannel: 'discord',
            saveSettings: vi.fn()
        })
    }
}));

/**
 * Creates a mock CommunicationChannel for testing.
 */
function createMockChannel(id: string): CommunicationChannel & {
    mockNotify: ReturnType<typeof vi.fn>;
    mockSendStatus: ReturnType<typeof vi.fn>;
    mockEditStatus: ReturnType<typeof vi.fn>;
    mockClearStatus: ReturnType<typeof vi.fn>;
    mockStart: ReturnType<typeof vi.fn>;
    mockStop: ReturnType<typeof vi.fn>;
    triggerMessage: (msg: ChannelMessage) => Promise<void>;
} {
    let messageHandler: ((msg: ChannelMessage) => Promise<void>) | undefined;
    const mockNotify = vi.fn().mockResolvedValue(undefined);
    const mockSendStatus = vi.fn().mockResolvedValue(undefined);
    const mockEditStatus = vi.fn().mockResolvedValue(true);
    const mockClearStatus = vi.fn();
    const mockStart = vi.fn().mockResolvedValue(undefined);
    const mockStop = vi.fn().mockResolvedValue(undefined);

    return {
        id,
        isEnabled: true,
        start: mockStart,
        stop: mockStop,
        notify: mockNotify,
        sendStatus: mockSendStatus,
        editStatus: mockEditStatus,
        clearStatus: mockClearStatus,
        onMessage: (handler) => {
            messageHandler = handler;
        },
        mockNotify,
        mockSendStatus,
        mockEditStatus,
        mockClearStatus,
        mockStart,
        mockStop,
        triggerMessage: async (msg) => {
            if (messageHandler) await messageHandler(msg);
        }
    };
}

describe('ChannelManager', () => {
    let manager: ChannelManager;

    beforeEach(() => {
        vi.clearAllMocks();
        manager = new ChannelManager();
    });

    describe('registerChannel', () => {
        it('should register a new channel', () => {
            const tui = createMockChannel('tui');
            manager.registerChannel(tui);

            expect(manager.getChannel('tui')).toBe(tui);
        });

        it('should not affect existing channels', () => {
            const tui = createMockChannel('tui');
            const other = createMockChannel('other');

            manager.registerChannel(tui);
            manager.registerChannel(other);

            expect(manager.getChannel('tui')).toBe(tui);
            expect(manager.getChannel('other')).toBe(other);
        });
    });

    describe('Notification Routing', () => {
        it('should route notifications to the last active channel', async () => {
            const ch1 = createMockChannel('channel-a');
            const ch2 = createMockChannel('channel-b');

            manager.registerChannel(ch1);
            manager.registerChannel(ch2);

            // Simulate a message handler that tracks active channel
            const mockGlobalHandler = vi.fn().mockResolvedValue(undefined);
            manager.onMessage(mockGlobalHandler);

            await manager.start();

            // Simulate message from channel-b (it should become last active)
            const mockMsg: ChannelMessage = {
                content: 'hello',
                senderId: 'user-1',
                senderName: 'user',
                channelId: 'channel-b',
                reply: vi.fn(),
                startTyping: vi.fn(),
                stopTyping: vi.fn()
            };

            // Trigger through channel-b's handler
            await ch2.triggerMessage(mockMsg);

            // Now send a notification — should route to channel-b (last active)
            await manager.notify('notification content');

            expect(ch2.mockNotify).toHaveBeenCalledWith('notification content', undefined);
            expect(ch1.mockNotify).not.toHaveBeenCalled();
        });

        it('should fall back to first channel when no channel is active', async () => {
            const ch1 = createMockChannel('first');
            manager.registerChannel(ch1);

            // No message has been sent, so lastActiveChannelId is unset
            await manager.notify('fallback notification');

            expect(ch1.mockNotify).toHaveBeenCalledWith('fallback notification', undefined);
        });

        it('redacts structured secrets at the outbound channel boundary', async () => {
            // ARRANGE
            const channel = createMockChannel('first');
            manager.registerChannel(channel);

            // ACT
            await manager.notify(JSON.stringify({ token: 'short-secret', result: 'safe' }));

            // ASSERT
            expect(channel.mockNotify).toHaveBeenCalledWith(
                JSON.stringify({ token: '[REDACTED_SECRET]', result: 'safe' }),
                undefined
            );
        });

        it('reports notification failure when no channel can deliver it', async () => {
            // ACT / ASSERT
            await expect(manager.notify('important alert')).rejects.toThrow(/No active channels/);
        });
    });

    describe('Status Editing', () => {
        it('should route a new status to the last active channel', async () => {
            const tui = createMockChannel('tui');
            manager.registerChannel(tui);

            await manager.sendStatus('initial status');

            expect(tui.mockSendStatus).toHaveBeenCalledWith('initial status');
            expect(tui.mockNotify).not.toHaveBeenCalled();
        });

        it('should route editStatus to the last active channel', async () => {
            const tui = createMockChannel('tui');
            manager.registerChannel(tui);

            manager.onMessage(vi.fn());
            await manager.start();

            // Simulate TUI activity
            await tui.triggerMessage({
                content: 'test',
                senderId: 'user',
                senderName: 'user',
                channelId: 'tui',
                reply: vi.fn(),
                startTyping: vi.fn(),
                stopTyping: vi.fn()
            });

            await manager.editStatus('updated status');
            expect(tui.mockEditStatus).toHaveBeenCalledWith('updated status');
        });

        it('should route clearStatus to the active channel', async () => {
            const tui = createMockChannel('tui');
            manager.registerChannel(tui);

            manager.onMessage(vi.fn());
            await manager.start();

            await tui.triggerMessage({
                content: 'test',
                senderId: 'user',
                senderName: 'user',
                channelId: 'tui',
                reply: vi.fn(),
                startTyping: vi.fn(),
                stopTyping: vi.fn()
            });

            manager.clearStatus();
            expect(tui.mockClearStatus).toHaveBeenCalled();
        });
    });

    describe('Channel Isolation (Discord Regression)', () => {
        it('should skip constructing Discord when requested by a foreground client', () => {
            // ARRANGE
            vi.mocked(Client).mockClear();

            // ACT
            const foregroundManager = new ChannelManager({ skipDiscord: true });

            // ASSERT
            expect(Client).not.toHaveBeenCalled();
            expect(foregroundManager.getChannel('discord')).toBeUndefined();
        });

        it('should start all registered channels including dynamically added ones', async () => {
            const ch1 = createMockChannel('dynamic-1');
            const ch2 = createMockChannel('dynamic-2');

            manager.registerChannel(ch1);
            manager.registerChannel(ch2);

            await manager.start();

            expect(ch1.mockStart).toHaveBeenCalled();
            expect(ch2.mockStart).toHaveBeenCalled();
        });

        it('fails startup when every configured channel fails', async () => {
            // ARRANGE
            const channel = createMockChannel('revoked');
            channel.mockStart.mockRejectedValue(new Error('invalid token'));
            manager.registerChannel(channel);

            // ACT / ASSERT
            await expect(manager.start()).rejects.toThrow(/No configured communication channel/);
        });

        it('should stop all registered channels', async () => {
            const ch1 = createMockChannel('stop-1');
            const ch2 = createMockChannel('stop-2');

            manager.registerChannel(ch1);
            manager.registerChannel(ch2);

            await manager.stop();

            expect(ch1.mockStop).toHaveBeenCalled();
            expect(ch2.mockStop).toHaveBeenCalled();
        });

        it('should forward messages from the correct channel to the global handler', async () => {
            const tuiCh = createMockChannel('tui');
            const discordCh = createMockChannel('discord');

            manager.registerChannel(tuiCh);
            manager.registerChannel(discordCh);

            const globalHandler = vi.fn().mockResolvedValue(undefined);
            manager.onMessage(globalHandler);

            await manager.start();

            const tuiMsg: ChannelMessage = {
                content: 'from tui',
                senderId: 'tui-user',
                senderName: 'user',
                channelId: 'tui',
                reply: vi.fn(),
                startTyping: vi.fn(),
                stopTyping: vi.fn()
            };

            const discordMsg: ChannelMessage = {
                content: 'from discord',
                senderId: 'discord-user',
                senderName: 'user',
                channelId: 'discord-ch',
                reply: vi.fn(),
                startTyping: vi.fn(),
                stopTyping: vi.fn()
            };

            await tuiCh.triggerMessage(tuiMsg);
            await discordCh.triggerMessage(discordMsg);

            expect(globalHandler).toHaveBeenCalledTimes(2);
            expect(globalHandler.mock.calls[0][0].content).toBe('from tui');
            expect(globalHandler.mock.calls[1][0].content).toBe('from discord');
        });
    });
});
