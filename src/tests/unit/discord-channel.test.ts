import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DiscordChannel } from '../../channels/discord/discord-channel.js';
import { Config } from '../../config/config.js';
import { Message, Client, ChannelType } from 'discord.js';

// Mock discord.js
vi.mock('discord.js', () => {
    return {
        Client: vi.fn().mockImplementation(() => {
            return {
                on: vi.fn(),
                once: vi.fn(),
                login: vi.fn(),
                destroy: vi.fn(),
                users: { fetch: vi.fn() },
                channels: {
                    cache: new Map(),
                    fetch: vi.fn()
                }
            };
        }),
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
        },
        ChannelType: {
            DM: 1,
            GuildText: 0
        }
    };
});

describe('DiscordChannel', () => {
    let discordChannel: any; // using any to access private methods for testing
    let mockClient: any;

    beforeEach(() => {
        vi.clearAllMocks();
        // Setup minimal config instance config
        const configProto = {
            discordToken: 'test-token',
            assistantName: 'Tars',
            discordOwnerId: 'owner-id',
            homeDir: '/tmp/tars-test',
            channels: { discord: {} },
            saveSettings: vi.fn()
        };
        vi.spyOn(Config, 'getInstance').mockReturnValue(configProto as any);

        discordChannel = new DiscordChannel();
        mockClient = discordChannel.client;
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    describe('Message Deduplication', () => {
        it('should process a message only once if deduplicated (cache timeout)', async () => {
            let processedCount = 0;

            // Register a mock handler
            discordChannel.onMessage(async (msg: any) => {
                processedCount++;
            });

            // Create a mock discord.js Message object
            const mockMessage = {
                id: 'msg-123',
                content: 'Hello World',
                author: { id: 'user-1', tag: 'user#0001', bot: false },
                guildId: null,
                channelId: 'dm-1',
                attachments: new Map(),
                reply: vi.fn(),
                channel: {
                    sendTyping: vi.fn().mockResolvedValue({})
                }
            };

            // Call the incoming handler twice with the same message
            await discordChannel.handleIncomingMessage(mockMessage as any);
            await discordChannel.handleIncomingMessage(mockMessage as any);

            // Assert it only hit the handler once
            expect(processedCount).toBe(1);
        });

        it('should correctly deduplicate across raw event and standard messageCreate', async () => {
            // Retrieve the event listeners bound in the constructor
            const messageCreateHandler = mockClient.on.mock.calls.find(
                (c: any) => c[0] === 'messageCreate'
            )[1];

            const rawHandler = mockClient.on.mock.calls.find((c: any) => c[0] === 'raw')[1];

            let processedCount = 0;
            discordChannel.onMessage(async (msg: any) => {
                processedCount++;
            });

            const mockMessage = {
                id: 'msg-race',
                content: 'Race condition test',
                author: { id: 'user-1', username: 'user', bot: false },
                guildId: null, // Ensure DM
                channelId: 'dm-1',
                attachments: new Map()
            };

            // Mock the hydration process fetching
            mockClient.channels.cache.has = vi.fn().mockReturnValue(false); // Uncached channel
            mockClient.channels.fetch.mockResolvedValue({
                isTextBased: () => true,
                messages: {
                    fetch: vi.fn().mockResolvedValue(mockMessage)
                }
            });

            // Simulate the Discord WebSocket receiving packet first (raw event)
            const packet = {
                t: 'MESSAGE_CREATE',
                d: {
                    id: 'msg-race',
                    author: { username: 'user' },
                    channel_id: 'dm-1'
                }
            };

            // Fire both handlers as if discord.js triggered them at the same exact moment
            await Promise.all([rawHandler(packet), messageCreateHandler(mockMessage)]);

            // Deduplication logic prevents it from hitting the supervisor twice
            expect(processedCount).toBe(1);
        });
    });
});
