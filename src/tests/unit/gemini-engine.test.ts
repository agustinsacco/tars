import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GeminiEngine } from '../../supervisor/gemini-engine.js';
import { Config as TarsConfig } from '../../config/config.js';
import fs from 'fs';
import path from 'path';
import {
    Config as CoreConfig,
    SimpleExtensionLoader,
    MCPServerConfig
} from '@google/gemini-cli-core';

vi.mock('fs');
vi.mock('@google/gemini-cli-core', async () => {
    const actual = (await vi.importActual('@google/gemini-cli-core')) as any;
    return {
        ...actual,
        Config: vi.fn().mockImplementation(() => ({
            refreshAuth: vi.fn(),
            initialize: vi.fn(),
            getGeminiClient: vi.fn().mockReturnValue({}),
            getSessionId: vi.fn().mockReturnValue('mock-session-id'),
            getToolRegistry: vi.fn().mockReturnValue({
                registerTool: vi.fn()
            })
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
            geminiModel: 'gemini-pro'
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
        expect(SimpleExtensionLoader).toHaveBeenCalledWith([]);
    });
});
