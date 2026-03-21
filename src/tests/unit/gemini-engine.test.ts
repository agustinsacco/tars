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

    const mockModelConfigService = {
        registerRuntimeModelOverride: vi.fn()
    };

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
            getMessageBus: vi.fn().mockReturnValue({}),
            modelConfigService: mockModelConfigService
        })),
        SimpleExtensionLoader: vi.fn(),
        MCPServerConfig: vi
            .fn()
            .mockImplementation((cmd, args, env, cwd) => ({ cmd, args, env, cwd })),
        mockModelConfigService // Export for testing
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

    it('should register Gemini 3.1 thinking config during initialization', async () => {
        (fs.existsSync as any).mockReturnValue(true);
        (fs.readdirSync as any).mockReturnValue([]);
        (fs.readFileSync as any).mockReturnValue('mock-system-prompt');

        await engine.initialize();

        const { mockModelConfigService } = (await import('@google/gemini-cli-core')) as any;
        expect(mockModelConfigService.registerRuntimeModelOverride).toHaveBeenCalledWith(
            expect.objectContaining({
                match: { model: 'gemini-3.1-pro-preview' },
                modelConfig: expect.objectContaining({
                    generateContentConfig: expect.objectContaining({
                        thinkingConfig: expect.objectContaining({
                            thinkingLevel: 'HIGH'
                        })
                    })
                })
            })
        );

        expect(mockModelConfigService.registerRuntimeModelOverride).toHaveBeenCalledWith(
            expect.objectContaining({
                match: { model: 'gemini-3.1-flash-lite-preview' },
                modelConfig: expect.objectContaining({
                    generateContentConfig: expect.objectContaining({
                        thinkingConfig: expect.objectContaining({
                            thinkingLevel: 'LOW'
                        })
                    })
                })
            })
        );
    });
});
