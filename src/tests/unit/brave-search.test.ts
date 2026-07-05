import { vi } from 'vitest';

// Mock node:sqlite before importing bootstrap or other services that use it
vi.mock('node:sqlite', () => {
    return {
        DatabaseSync: vi.fn().mockImplementation(() => ({
            exec: vi.fn(),
            prepare: vi.fn().mockReturnValue({
                all: vi.fn().mockReturnValue([]),
                run: vi.fn()
            })
        }))
    };
});

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { performWebSearch } from '../../../extensions/search/src/search-helper.js';
import { wireMessageRouting } from '../../supervisor/bootstrap.js';
import { SecretsManager } from '../../utils/secrets-manager.js';
import fs from 'fs';
import path from 'path';

// Mock fs and SecretsManager
vi.mock('fs');
vi.mock('../../utils/secrets-manager.js', () => {
    return {
        SecretsManager: vi.fn().mockImplementation(() => ({
            set: vi.fn(),
            load: vi.fn().mockReturnValue({})
        }))
    };
});

describe('Brave Search Integration', () => {
    const originalEnv = process.env;

    beforeEach(() => {
        vi.clearAllMocks();
        process.env = { ...originalEnv };
        delete process.env.BRAVE_SEARCH_API_KEY;
    });

    afterEach(() => {
        process.env = originalEnv;
    });

    describe('performWebSearch Helper', () => {
        it('should throw an error if BRAVE_SEARCH_API_KEY is missing', async () => {
            await expect(performWebSearch('test query')).rejects.toThrow(
                /Brave Search API key is missing/
            );
        });

        it('should throw an error if BRAVE_SEARCH_API_KEY is invalid (401)', async () => {
            process.env.BRAVE_SEARCH_API_KEY = 'BSinvalidkey123456789012345678';

            const mockFetch = vi.fn().mockResolvedValue({
                status: 401,
                ok: false
            });
            global.fetch = mockFetch;

            await expect(performWebSearch('test query')).rejects.toThrow(
                /Brave Search API key is invalid/
            );
            expect(mockFetch).toHaveBeenCalled();
        });

        it('should return search results if the API call succeeds', async () => {
            process.env.BRAVE_SEARCH_API_KEY = 'BSvalidkey12345678901234567890';

            const mockResults = {
                web: {
                    results: [
                        {
                            title: 'Result 1',
                            url: 'https://example.com/1',
                            description: 'Snippet 1'
                        },
                        {
                            title: 'Result 2',
                            url: 'https://example.com/2',
                            description: 'Snippet 2'
                        }
                    ]
                }
            };
            const mockFetch = vi.fn().mockResolvedValue({
                status: 200,
                ok: true,
                json: async () => mockResults
            });
            global.fetch = mockFetch;

            const results = await performWebSearch('test query', 2);
            expect(results).toHaveLength(2);
            expect(results[0]).toEqual({
                title: 'Result 1',
                url: 'https://example.com/1',
                snippet: 'Snippet 1'
            });
        });
    });

    describe('Brave Search Key Interception in Message Routing', () => {
        it('should intercept a message containing a Brave API Key, save it, and reset session', async () => {
            const mockChannelManager = {
                onMessage: vi.fn(),
                clearStatus: vi.fn()
            };
            const mockSupervisor = {
                run: vi.fn()
            };
            const mockSessionManager = {
                getStats: vi.fn().mockReturnValue({ sessionId: 'session-123' }),
                clear: vi.fn()
            };
            const mockTarsEngine = {
                resetSession: vi.fn()
            };
            const mockConfig = {
                homeDir: '/mock/home'
            };

            // Wire routing to capture the message callback
            wireMessageRouting(
                mockChannelManager as any,
                mockSupervisor as any,
                mockSessionManager as any,
                mockTarsEngine as any,
                mockConfig as any
            );

            expect(mockChannelManager.onMessage).toHaveBeenCalled();
            const messageCallback = mockChannelManager.onMessage.mock.calls[0][0];

            const mockMessage = {
                content: '   BS123456789012345678901234567890   ', // Key with whitespaces
                reply: vi.fn(),
                stopTyping: vi.fn()
            };

            vi.mocked(fs.existsSync).mockReturnValue(true);

            await messageCallback(mockMessage);

            // Assertions
            expect(process.env.BRAVE_SEARCH_API_KEY).toBe('BS123456789012345678901234567890');
            expect(mockSessionManager.clear).toHaveBeenCalled();
            expect(mockTarsEngine.resetSession).toHaveBeenCalled();
            expect(mockMessage.reply).toHaveBeenCalledWith(
                expect.stringContaining('Brave Search API Key Configured')
            );
            expect(mockMessage.stopTyping).toHaveBeenCalled();
            expect(mockSupervisor.run).not.toHaveBeenCalled(); // Intercepted, so supervisor shouldn't run
        });
    });
});
