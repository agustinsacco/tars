import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { AgentTool } from '@earendil-works/pi-agent-core';
import fs from 'fs';
import path from 'path';
import logger from '../utils/logger.js';

export interface McpExtension {
    name: string;
    path: string;
    mcpServers: Record<
        string,
        {
            command: string;
            args?: string[];
            env?: Record<string, string>;
            cwd?: string;
        }
    >;
}

export class McpBridge {
    private clients: Map<string, Client> = new Map();
    private transports: Map<string, StdioClientTransport> = new Map();

    constructor(private readonly homeDir: string) {}

    /**
     * Discovers and starts all MCP servers, returning their tools mapped to AgentTools.
     */
    public async initialize(): Promise<AgentTool<any>[]> {
        const extensionsDir = path.join(this.homeDir, 'extensions');
        if (!fs.existsSync(extensionsDir)) return [];

        const extensions: McpExtension[] = [];
        try {
            const entries = fs.readdirSync(extensionsDir, { withFileTypes: true });

            for (const entry of entries) {
                if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
                const extPath = path.resolve(extensionsDir, entry.name);
                const configPath = path.join(extPath, 'gemini-extension.json');

                if (fs.existsSync(configPath)) {
                    try {
                        const content = fs.readFileSync(configPath, 'utf-8');
                        const config = JSON.parse(content);

                        if (config.mcpServers) {
                            extensions.push({
                                name: config.name,
                                path: extPath,
                                mcpServers: config.mcpServers
                            });
                        }
                        logger.info(`🔌 Discovered MCP extension: ${config.name}`);
                    } catch (e) {
                        logger.error(`Failed to parse extension at ${extPath}: ${e}`);
                    }
                }
            }
        } catch (error) {
            logger.error(`Error during extension discovery: ${error}`);
        }

        const allTools: AgentTool<any>[] = [];

        for (const ext of extensions) {
            for (const [serverName, serverConfig] of Object.entries(ext.mcpServers)) {
                try {
                    const extPath = ext.path;
                    const resolvedArgs =
                        serverConfig.args?.map((arg: string) =>
                            arg.replace(/\${extensionPath}/g, extPath)
                        ) || [];
                    const resolvedEnv: Record<string, string> = {};
                    for (const [k, v] of Object.entries(process.env)) {
                        if (v !== undefined) {
                            resolvedEnv[k] = v;
                        }
                    }
                    if (serverConfig.env) {
                        for (const [k, v] of Object.entries(serverConfig.env)) {
                            resolvedEnv[k] = v.replace(/\${extensionPath}/g, extPath);
                        }
                    }

                    logger.info(
                        `Starting MCP server ${serverName} via stdio: ${serverConfig.command} ${resolvedArgs.join(' ')}`
                    );

                    const transport = new StdioClientTransport({
                        command: serverConfig.command,
                        args: resolvedArgs,
                        env: resolvedEnv
                    });

                    const client = new Client(
                        {
                            name: `tars-${serverName}-client`,
                            version: '1.0.0'
                        },
                        {
                            capabilities: {}
                        }
                    );

                    await client.connect(transport);

                    const key = `${ext.name}:${serverName}`;
                    this.clients.set(key, client);
                    this.transports.set(key, transport);

                    const response = await client.listTools();
                    logger.info(
                        `Connected to MCP server ${serverName}, found ${response.tools?.length || 0} tools.`
                    );

                    if (response.tools) {
                        for (const mcpTool of response.tools) {
                            const agentTool: AgentTool<any> = {
                                name: mcpTool.name,
                                label: mcpTool.name,
                                description: mcpTool.description || '',
                                parameters: mcpTool.inputSchema as any,
                                execute: async (toolCallId, params) => {
                                    logger.debug(
                                        `Calling MCP tool ${mcpTool.name} with params:`,
                                        params
                                    );
                                    try {
                                        const result = (await client.callTool({
                                            name: mcpTool.name,
                                            arguments: params as Record<string, any>
                                        })) as any;

                                        const contentBlocks =
                                            result.content?.map((block: any) => {
                                                if (block.type === 'text') {
                                                    return { type: 'text', text: block.text };
                                                } else if (block.type === 'image') {
                                                    return {
                                                        type: 'image',
                                                        data: block.data,
                                                        mimeType: block.mimeType
                                                    };
                                                }
                                                return {
                                                    type: 'text',
                                                    text: JSON.stringify(block)
                                                };
                                            }) || [];

                                        return {
                                            content: contentBlocks,
                                            details: result
                                        };
                                    } catch (err: any) {
                                        logger.error(
                                            `Error calling MCP tool ${mcpTool.name}:`,
                                            err
                                        );
                                        throw err;
                                    }
                                }
                            };
                            allTools.push(agentTool);
                        }
                    }
                } catch (err: any) {
                    logger.error(
                        `Failed to start or query MCP server ${serverName}: ${err.message}`
                    );
                }
            }
        }

        return allTools;
    }

    /**
     * Disconnects all MCP clients and cleans up transports.
     */
    public async shutdown(): Promise<void> {
        for (const [key, client] of this.clients.entries()) {
            try {
                logger.info(`Shutting down MCP client: ${key}`);
                await client.close();
            } catch (err: any) {
                logger.error(`Error closing MCP client ${key}: ${err.message}`);
            }
        }
        this.clients.clear();
        this.transports.clear();
    }
}
