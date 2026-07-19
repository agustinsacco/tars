import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface MockMcpTool {
    readonly name: string;
    readonly description?: string;
    readonly inputSchema: Record<string, unknown>;
}

interface MockMcpClient {
    readonly connect: ReturnType<typeof vi.fn>;
    readonly listTools: ReturnType<typeof vi.fn>;
    readonly callTool: ReturnType<typeof vi.fn>;
    readonly close: ReturnType<typeof vi.fn>;
}

interface TransportOptions {
    readonly command: string;
    readonly args?: string[];
    readonly env?: Record<string, string>;
    readonly cwd?: string;
    readonly stderr?: string;
}

const mcpMocks = vi.hoisted(() => {
    const clientQueue: MockMcpClient[] = [];
    const clientInstances: MockMcpClient[] = [];
    const transportOptions: TransportOptions[] = [];

    return {
        clientQueue,
        clientInstances,
        transportOptions,
        Client: vi.fn(function ClientMock() {
            const client = clientQueue.shift();
            if (!client) throw new Error('No MCP client mock was queued.');
            clientInstances.push(client);
            return client;
        }),
        StdioClientTransport: vi.fn(function StdioClientTransportMock(options: TransportOptions) {
            transportOptions.push(options);
            return { stderr: null };
        }),
        getDefaultEnvironment: vi.fn(() => ({
            PATH: '/safe/bin',
            HOME: '/safe/home'
        }))
    };
});

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
    Client: mcpMocks.Client
}));

vi.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({
    StdioClientTransport: mcpMocks.StdioClientTransport,
    getDefaultEnvironment: mcpMocks.getDefaultEnvironment
}));

import { findMcpPolicyViolations, McpBridge } from '../../supervisor/mcp-bridge.js';

function createClient(tools: MockMcpTool[] = []): MockMcpClient {
    return {
        connect: vi.fn().mockResolvedValue(undefined),
        listTools: vi.fn().mockResolvedValue({ tools }),
        callTool: vi.fn().mockResolvedValue({
            content: [{ type: 'text', text: 'tool result' }]
        }),
        close: vi.fn().mockResolvedValue(undefined)
    };
}

function createHome(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'tars-mcp-bridge-'));
}

function installExtension(
    homeDir: string,
    directoryName: string,
    manifest: Record<string, unknown>
): string {
    const extensionPath = path.join(homeDir, 'extensions', directoryName);
    fs.mkdirSync(extensionPath, { recursive: true });
    fs.writeFileSync(
        path.join(extensionPath, 'tars-extension.json'),
        JSON.stringify(manifest, null, 2)
    );
    return extensionPath;
}

function writeEnablement(homeDir: string, enablement: Record<string, unknown>): void {
    const extensionsDir = path.join(homeDir, 'extensions');
    fs.mkdirSync(extensionsDir, { recursive: true });
    fs.writeFileSync(
        path.join(extensionsDir, 'extension-enablement.json'),
        JSON.stringify(enablement, null, 2)
    );
}

function manifest(
    name: string,
    serverOverrides: Record<string, unknown> = {},
    extensionOverrides: Record<string, unknown> = {}
): Record<string, unknown> {
    return {
        name,
        ...extensionOverrides,
        mcpServers: {
            primary: {
                command: 'node',
                args: ['${extensionPath}/server.js'],
                envAllowlist: [],
                ...serverOverrides
            }
        }
    };
}

describe('McpBridge trust boundary', () => {
    const temporaryHomes: string[] = [];

    beforeEach(() => {
        mcpMocks.Client.mockImplementation(function ClientMock() {
            const client = mcpMocks.clientQueue.shift();
            if (!client) throw new Error('No MCP client mock was queued.');
            mcpMocks.clientInstances.push(client);
            return client;
        });
        mcpMocks.StdioClientTransport.mockImplementation(function StdioClientTransportMock(
            options: TransportOptions
        ) {
            mcpMocks.transportOptions.push(options);
            return { stderr: null };
        });
        mcpMocks.getDefaultEnvironment.mockReturnValue({
            PATH: '/safe/bin',
            HOME: '/safe/home'
        });
    });

    afterEach(() => {
        for (const homeDir of temporaryHomes.splice(0)) {
            fs.rmSync(homeDir, { recursive: true, force: true });
        }
        vi.unstubAllEnvs();
        vi.resetAllMocks();
        mcpMocks.clientQueue.length = 0;
        mcpMocks.clientInstances.length = 0;
        mcpMocks.transportOptions.length = 0;
    });

    it('loads only extension directories authorized by the enablement file', async () => {
        // ARRANGE
        const homeDir = createHome();
        temporaryHomes.push(homeDir);
        installExtension(homeDir, 'authorized', manifest('authorized-extension'));
        installExtension(homeDir, 'unauthorized', manifest('unauthorized-extension'));
        installExtension(homeDir, 'disabled', manifest('disabled-extension'));
        writeEnablement(homeDir, {
            authorized: { overrides: [] },
            disabled: { enabled: false, overrides: [] }
        });
        mcpMocks.clientQueue.push(
            createClient([
                { name: 'authorized_tool', inputSchema: { type: 'object', properties: {} } }
            ])
        );

        // ACT
        const tools = await new McpBridge(homeDir).initialize();

        // ASSERT
        expect(mcpMocks.Client).toHaveBeenCalledOnce();
        expect(tools.map((tool) => tool.name)).toEqual(['authorized_tool']);
    });

    it('loads no extensions when the enablement file is absent', async () => {
        // ARRANGE
        const homeDir = createHome();
        temporaryHomes.push(homeDir);
        installExtension(homeDir, 'unapproved', manifest('unapproved-extension'));

        // ACT
        const tools = await new McpBridge(homeDir).initialize();

        // ASSERT
        expect(tools).toEqual([]);
        expect(mcpMocks.Client).not.toHaveBeenCalled();
        expect(mcpMocks.StdioClientTransport).not.toHaveBeenCalled();
    });

    it('blocks legacy custom extensions until their environment policy is explicit', async () => {
        // ARRANGE
        const homeDir = createHome();
        temporaryHomes.push(homeDir);
        installExtension(homeDir, 'legacy-custom', {
            name: 'legacy-custom',
            mcpServers: {
                primary: { command: 'node', args: ['${extensionPath}/server.js'] }
            }
        });
        fs.writeFileSync(
            path.join(homeDir, 'extensions', 'legacy-custom', 'server.js'),
            'const token = process.env.LEGACY_CUSTOM_TOKEN;\n'
        );
        writeEnablement(homeDir, { 'legacy-custom': true });

        // ACT
        const tools = await new McpBridge(homeDir).initialize();

        // ASSERT
        expect(tools).toEqual([]);
        expect(mcpMocks.StdioClientTransport).not.toHaveBeenCalled();
        expect(findMcpPolicyViolations(homeDir)).toEqual([
            expect.objectContaining({
                code: 'missing-environment-policy',
                extension: 'legacy-custom',
                server: 'primary',
                suggestedEnvironmentVariables: ['LEGACY_CUSTOM_TOKEN']
            })
        ]);
    });

    it('passes only safe, explicit, and allowlisted environment variables to a server', async () => {
        // ARRANGE
        const homeDir = createHome();
        temporaryHomes.push(homeDir);
        const extensionPath = installExtension(
            homeDir,
            'environment-test',
            manifest('environment-extension', {
                envAllowlist: ['MCP_ALLOWED'],
                env: { STATIC_PATH: '${extensionPath}/data' }
            })
        );
        writeEnablement(homeDir, {
            'environment-test': { overrides: [], startupTimeoutMs: 4_321, toolTimeoutMs: 7_654 }
        });
        vi.stubEnv('MCP_ALLOWED', 'visible-value');
        vi.stubEnv('MCP_SECRET', 'must-not-leak');
        const client = createClient([
            { name: 'environment_tool', inputSchema: { type: 'object', properties: {} } }
        ]);
        mcpMocks.clientQueue.push(client);

        // ACT
        const tools = await new McpBridge(homeDir).initialize();
        const result = await tools[0].execute('call-id', { query: 'hello' });

        // ASSERT
        const options = mcpMocks.transportOptions[0];
        expect(options.cwd).toBe(fs.realpathSync(extensionPath));
        expect(options.env).toMatchObject({
            PATH: '/safe/bin',
            HOME: '/safe/home',
            MCP_ALLOWED: 'visible-value',
            STATIC_PATH: `${fs.realpathSync(extensionPath)}/data`,
            TARS_HOME: homeDir
        });
        expect(options.env).not.toHaveProperty('MCP_SECRET');
        expect(client.connect).toHaveBeenCalledWith(expect.anything(), {
            timeout: 4_321,
            maxTotalTimeout: 4_321
        });
        expect(client.listTools).toHaveBeenCalledWith(undefined, {
            timeout: 4_321,
            maxTotalTimeout: 4_321
        });
        expect(client.callTool).toHaveBeenCalledWith(
            { name: 'environment_tool', arguments: { query: 'hello' } },
            undefined,
            expect.objectContaining({ timeout: 7_654, maxTotalTimeout: 7_654 })
        );
        expect(result.content).toEqual([{ type: 'text', text: 'tool result' }]);
    });

    it('keeps the first compatible tool name and namespaces later collisions', async () => {
        // ARRANGE
        const homeDir = createHome();
        temporaryHomes.push(homeDir);
        installExtension(homeDir, 'alpha', manifest('alpha-extension'));
        installExtension(homeDir, 'beta', manifest('beta-extension'));
        writeEnablement(homeDir, { alpha: true, beta: true });
        const alphaClient = createClient([
            { name: 'search', inputSchema: { type: 'object', properties: {} } }
        ]);
        const betaClient = createClient([
            { name: 'search', inputSchema: { type: 'object', properties: {} } }
        ]);
        mcpMocks.clientQueue.push(alphaClient, betaClient);

        // ACT
        const tools = await new McpBridge(homeDir).initialize();
        await tools[1].execute('collision-call', { query: 'test' });

        // ASSERT
        expect(tools.map((tool) => tool.name)).toEqual(['search', 'beta-extension__search']);
        expect(betaClient.callTool).toHaveBeenCalledWith(
            expect.objectContaining({ name: 'search' }),
            undefined,
            expect.anything()
        );
    });

    it('prioritizes bundled tool names and namespaces collisions with native tools', async () => {
        // ARRANGE
        const homeDir = createHome();
        temporaryHomes.push(homeDir);
        installExtension(homeDir, 'aaa-custom', manifest('custom-extension'));
        installExtension(homeDir, 'tars-memory', manifest('tars-memory'));
        writeEnablement(homeDir, { 'aaa-custom': true, 'tars-memory': true });
        const bundledClient = createClient([
            { name: 'manage_facts', inputSchema: { type: 'object', properties: {} } }
        ]);
        const customClient = createClient([
            { name: 'manage_facts', inputSchema: { type: 'object', properties: {} } },
            { name: 'bash', inputSchema: { type: 'object', properties: {} } }
        ]);
        mcpMocks.clientQueue.push(bundledClient, customClient);

        // ACT
        const tools = await new McpBridge(homeDir).initialize();

        // ASSERT
        expect(tools.map((tool) => tool.name)).toEqual([
            'manage_facts',
            'custom-extension__manage_facts',
            'custom-extension__bash'
        ]);
    });

    it('rejects a configured working directory that escapes the extension directory', async () => {
        // ARRANGE
        const homeDir = createHome();
        temporaryHomes.push(homeDir);
        installExtension(homeDir, 'cwd-escape', manifest('cwd-extension', { cwd: '..' }));
        writeEnablement(homeDir, { 'cwd-escape': true });

        // ACT
        const tools = await new McpBridge(homeDir).initialize();

        // ASSERT
        expect(tools).toEqual([]);
        expect(mcpMocks.StdioClientTransport).not.toHaveBeenCalled();
        expect(mcpMocks.Client).not.toHaveBeenCalled();
    });
});
