import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GeminiEngine } from '../../supervisor/gemini-engine.js';
import { Config as TarsConfig } from '../../config/config.js';
import fs from 'fs';
import path from 'path';

vi.mock('fs');

vi.mock('@google/gemini-cli-core', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@google/gemini-cli-core')>();

    // Define a base class for the mock inside the factory to avoid hoisting issues
    class MockNativeTool {
        constructor(
            public name: string,
            public description: string,
            public schema: any
        ) {}
    }

    return {
        ...actual,
        NativeTool: MockNativeTool,
        Config: vi.fn().mockImplementation(() => ({
            refreshAuth: vi.fn(),
            initialize: vi.fn(),
            getGeminiClient: vi.fn().mockReturnValue({
                isInitialized: vi.fn().mockReturnValue(false)
            }),
            getSessionId: vi.fn().mockReturnValue('mock-session-id'),
            getToolRegistry: vi.fn().mockReturnValue({
                registerTool: vi.fn()
            }),
            getMessageBus: vi.fn().mockReturnValue({})
        })),
        SimpleExtensionLoader: vi.fn(),
        MCPServerConfig: vi
            .fn()
            .mockImplementation((cmd, args, env, cwd) => ({ cmd, args, env, cwd }))
    };
});

describe('GeminiEngine', () => {
    let engine: GeminiEngine;
    let mockTarsConfig: TarsConfig;

    beforeEach(() => {
        vi.clearAllMocks();
        mockTarsConfig = {
            homeDir: '/mock/home',
            geminiModel: 'gemini-pro',
            systemPromptPath: '/mock/home/.gemini/system.md'
        } as any;
        engine = new GeminiEngine(mockTarsConfig);
    });

    it('should discover extensions from .gemini/extensions', async () => {
        const extensionsDir = '/mock/home/.gemini/extensions';
        const extName = 'test-extension';
        const extPath = path.join(extensionsDir, extName);
        const configPath = path.join(extPath, 'gemini-extension.json');

        const mockConfig = {
            name: extName,
            version: '1.0.0',
            mcpServers: {
                test: {
                    command: 'node',
                    args: ['${extensionPath}/dist/index.js'],
                    env: { EXT_DIR: '${extensionPath}' }
                }
            }
        };

        (fs.existsSync as any).mockImplementation((p: string) => {
            if (p === extensionsDir) return true;
            if (p === configPath) return true;
            if (p === '/mock/home') return true;
            if (p.includes('system.md')) return true;
            return false;
        });

        (fs.readdirSync as any).mockReturnValue([{ name: extName, isDirectory: () => true }]);

        (fs.readFileSync as any).mockReturnValue(JSON.stringify(mockConfig));

        await engine.initialize();

        const { SimpleExtensionLoader } = await import('@google/gemini-cli-core');
        expect(SimpleExtensionLoader).toHaveBeenCalled();
        const loaderArgs = (SimpleExtensionLoader as any).mock.calls[0][0];
        expect(loaderArgs).toHaveLength(1);
        expect(loaderArgs[0].name).toBe(extName);
        expect(loaderArgs[0].path).toBe(extPath);

        // Verify path resolution
        const mcpServer = loaderArgs[0].mcpServers.test;
        expect(mcpServer.args[0]).toBe(path.join(extPath, 'dist/index.js'));
        expect(mcpServer.env.EXT_DIR).toBe(extPath);
    });

    it('should handle no extensions directory', async () => {
        (fs.existsSync as any).mockReturnValue(false);
        await engine.initialize();
        const { SimpleExtensionLoader } = await import('@google/gemini-cli-core');
        expect(SimpleExtensionLoader).toHaveBeenCalledWith([]);
    });

    describe('buildToolResponseParts', () => {
        it('should correctly map tool responses using nested request.callId', () => {
            const toolRequests = [{ callId: 'call-1', name: 'my_tool' }];

            const completedCalls = [
                {
                    request: { callId: 'call-1' },
                    response: {
                        responseParts: [
                            { functionResponse: { name: 'my_tool', response: { result: 'ok' } } }
                        ]
                    }
                }
            ];

            const result = GeminiEngine.buildToolResponseParts(
                toolRequests,
                completedCalls,
                new Map(),
                new Set()
            );

            expect(result).toHaveLength(1);
            expect(result[0].functionResponse.response.result).toBe('ok');
        });

        it('should generate synthetic responses for blocked tool calls', () => {
            const toolRequests = [{ callId: 'call-2', name: 'blocked_tool' }];

            const blockedResponses = new Map([['call-2', 'Access restricted by DLP']]);

            const result = GeminiEngine.buildToolResponseParts(
                toolRequests,
                [],
                blockedResponses,
                new Set()
            );

            expect(result).toHaveLength(1);
            expect(result[0].functionResponse.response.error).toBe('Access restricted by DLP');
        });
    });
});
