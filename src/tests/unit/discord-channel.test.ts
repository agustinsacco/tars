import type { Message } from 'discord.js';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import { DiscordChannel } from '../../channels/discord/discord-channel.js';
import type { ChannelMessage } from '../../channels/types.js';
import { Config } from '../../config/config.js';

const discordMocks = vi.hoisted(() => {
    const client = {
        on: vi.fn(),
        once: vi.fn(),
        login: vi.fn(),
        destroy: vi.fn(),
        user: null as { id: string } | null,
        users: { fetch: vi.fn() },
        channels: {
            cache: new Map<string, unknown>(),
            fetch: vi.fn()
        }
    };

    return {
        client,
        Client: vi.fn(function ClientMock() {
            return client;
        })
    };
});

vi.mock('discord.js', () => ({
    Client: discordMocks.Client,
    GatewayIntentBits: {
        Guilds: 1,
        GuildMessages: 2,
        MessageContent: 3,
        DirectMessages: 4
    },
    Partials: {
        Channel: 1,
        Message: 2,
        User: 3
    }
}));

interface TestConfig {
    readonly discordToken: string;
    readonly assistantName: string;
    discordOwnerId: string | null;
    readonly homeDir: string;
    readonly channels: {
        discord: {
            enabled: boolean;
            ownerId?: string;
        };
    };
    readonly saveSettings: ReturnType<typeof vi.fn>;
}

interface DiscordChannelHarness {
    readonly client: typeof discordMocks.client;
    readonly processedMessages: Set<string>;
    handleIncomingMessage(message: Message): Promise<void>;
}

interface MessageOptions {
    readonly id?: string;
    readonly content?: string;
    readonly authorId?: string;
    readonly username?: string;
    readonly guildId?: string | null;
    readonly channelId?: string;
    readonly bot?: boolean;
}

function createMessage(options: MessageOptions = {}): Message {
    const username = options.username ?? 'test-user';

    return {
        id: options.id ?? 'message-id',
        content: options.content ?? 'Hello Tars',
        author: {
            id: options.authorId ?? 'owner-id',
            username,
            tag: `${username}#0001`,
            bot: options.bot ?? false
        },
        guildId: options.guildId ?? null,
        channelId: options.channelId ?? 'dm-channel',
        attachments: new Map(),
        mentions: { has: vi.fn(() => false) },
        reply: vi.fn(),
        channel: { sendTyping: vi.fn().mockResolvedValue(undefined) }
    } as unknown as Message;
}

function asHarness(channel: DiscordChannel): DiscordChannelHarness {
    return channel as unknown as DiscordChannelHarness;
}

describe('DiscordChannel trust boundary', () => {
    let config: TestConfig;
    let channel: DiscordChannel;
    let harness: DiscordChannelHarness;
    let handler: Mock<(message: ChannelMessage) => Promise<void>>;

    beforeEach(() => {
        vi.useFakeTimers();
        discordMocks.Client.mockImplementation(function ClientMock() {
            return discordMocks.client;
        });
        discordMocks.client.channels.cache.clear();
        discordMocks.client.user = null;

        config = {
            discordToken: 'test-token',
            assistantName: 'Tars',
            discordOwnerId: 'owner-id',
            homeDir: '/tmp/tars-test',
            channels: { discord: { enabled: true, ownerId: 'owner-id' } },
            saveSettings: vi.fn()
        };
        vi.spyOn(Config, 'getInstance').mockReturnValue(config as unknown as Config);

        channel = new DiscordChannel();
        harness = asHarness(channel);
        handler = vi.fn(async (_message: ChannelMessage): Promise<void> => undefined);
        channel.onMessage(handler);
    });

    afterEach(() => {
        vi.clearAllTimers();
        vi.useRealTimers();
        vi.resetAllMocks();
        vi.restoreAllMocks();
    });

    it('processes a direct message from the configured owner only once', async () => {
        // ARRANGE
        const message = createMessage({ id: 'owner-message' });

        // ACT
        await harness.handleIncomingMessage(message);
        await harness.handleIncomingMessage(message);

        // ASSERT
        expect(handler).toHaveBeenCalledOnce();
    });

    it('honors an explicit Discord channel disable even when a token exists', () => {
        // ARRANGE
        config.channels.discord.enabled = false;

        // ACT / ASSERT
        expect(channel.isEnabled).toBe(false);
    });

    it('uses the resolved owner ID when legacy and structured fields are stale', async () => {
        // ARRANGE
        config.channels.discord.ownerId = 'stale-owner-id';
        const message = createMessage({ id: 'resolved-owner-message' });

        // ACT
        await harness.handleIncomingMessage(message);

        // ASSERT
        expect(handler).toHaveBeenCalledOnce();
    });

    it('ignores an unauthorized direct message without mutating routing or dedupe state', async () => {
        // ARRANGE
        const message = createMessage({ id: 'intruder-dm', authorId: 'intruder-id' });

        // ACT
        await harness.handleIncomingMessage(message);

        // ASSERT
        expect(handler).not.toHaveBeenCalled();
        expect(config.saveSettings).not.toHaveBeenCalled();
        expect(harness.processedMessages.has('intruder-dm')).toBe(false);
    });

    it('ignores an addressed guild message from an unauthorized user', async () => {
        // ARRANGE
        const message = createMessage({
            id: 'intruder-guild',
            content: '!tars mutate state',
            authorId: 'intruder-id',
            guildId: 'guild-id',
            channelId: 'guild-channel'
        });

        // ACT
        await harness.handleIncomingMessage(message);

        // ASSERT
        expect(handler).not.toHaveBeenCalled();
        expect(harness.processedMessages.has('intruder-guild')).toBe(false);
    });

    it('does not treat ordinary guild chatter as owner activity', async () => {
        // ARRANGE
        const message = createMessage({
            id: 'guild-chatter',
            content: 'A conversation between humans',
            guildId: 'guild-id',
            channelId: 'guild-channel'
        });

        // ACT
        await harness.handleIncomingMessage(message);

        // ASSERT
        expect(handler).not.toHaveBeenCalled();
        expect(harness.processedMessages.has('guild-chatter')).toBe(false);
    });

    it('never lets the first direct message claim an unconfigured instance', async () => {
        // ARRANGE
        config.discordOwnerId = null;
        config.channels.discord.ownerId = undefined;
        const message = createMessage({
            id: 'first-message',
            authorId: 'first-user',
            channelId: 'first-channel'
        });

        // ACT
        await harness.handleIncomingMessage(message);

        // ASSERT
        expect(config.discordOwnerId).toBeNull();
        expect(config.channels.discord.ownerId).toBeUndefined();
        expect(config.saveSettings).not.toHaveBeenCalled();
        expect(handler).not.toHaveBeenCalled();
        expect(harness.processedMessages.has('first-message')).toBe(false);
    });

    it('also rejects guild messages while ownership is unconfigured', async () => {
        // ARRANGE
        config.discordOwnerId = null;
        config.channels.discord.ownerId = undefined;
        const guildMessage = createMessage({
            id: 'guild-binding-attempt',
            content: '!tars bind me',
            authorId: 'guild-user',
            guildId: 'guild-id',
            channelId: 'guild-channel'
        });

        // ACT
        await harness.handleIncomingMessage(guildMessage);

        // ASSERT
        expect(config.discordOwnerId).toBeNull();
        expect(config.saveSettings).not.toHaveBeenCalled();
        expect(handler).not.toHaveBeenCalled();
        expect(harness.processedMessages.has('guild-binding-attempt')).toBe(false);
    });

    it('always sends proactive notifications by DM to the configured owner', async () => {
        // ARRANGE
        await harness.handleIncomingMessage(
            createMessage({
                id: 'owner-activity',
                content: '!tars status',
                guildId: 'guild-id',
                channelId: 'shared-guild-channel'
            })
        );
        const send = vi.fn().mockResolvedValue({
            id: 'sent-message',
            channelId: 'owner-dm-channel'
        });
        discordMocks.client.users.fetch.mockResolvedValue({ send });

        // ACT
        await channel.notify('Owner-only notification');

        // ASSERT
        expect(discordMocks.client.users.fetch).toHaveBeenCalledWith('owner-id');
        expect(discordMocks.client.channels.fetch).not.toHaveBeenCalled();
        expect(send).toHaveBeenCalledWith(
            expect.objectContaining({ content: expect.stringContaining('Owner-only notification') })
        );
    });

    it('does not replace the editable status target with an ordinary notification', async () => {
        // ARRANGE
        const send = vi
            .fn()
            .mockResolvedValueOnce({ id: 'status-message', channelId: 'owner-dm-channel' })
            .mockResolvedValueOnce({ id: 'durable-message', channelId: 'owner-dm-channel' });
        const edit = vi.fn().mockResolvedValue(undefined);
        const fetchMessage = vi.fn().mockResolvedValue({ edit });
        discordMocks.client.users.fetch.mockResolvedValue({ send });
        discordMocks.client.channels.fetch.mockResolvedValue({
            isTextBased: () => true,
            messages: { fetch: fetchMessage }
        });

        // ACT
        await channel.sendStatus('Working');
        await channel.notify('Important tool notification');
        const edited = await channel.editStatus('Still working');

        // ASSERT
        expect(edited).toBe(true);
        expect(fetchMessage).toHaveBeenCalledWith('status-message');
        expect(fetchMessage).not.toHaveBeenCalledWith('durable-message');
        expect(edit).toHaveBeenCalledWith(expect.stringContaining('Still working'));
    });

    it('reports notification failure when no owner is configured', async () => {
        // ARRANGE
        config.discordOwnerId = null;
        config.channels.discord.ownerId = undefined;

        // ACT / ASSERT
        await expect(channel.notify('Important update')).rejects.toThrow(/owner ID/);
    });

    it('reports Discord API delivery failures to the caller', async () => {
        // ARRANGE
        discordMocks.client.users.fetch.mockRejectedValue(new Error('API unavailable'));

        // ACT / ASSERT
        await expect(channel.notify('Important update')).rejects.toThrow(/API unavailable/);
    });
});
