import fs from 'node:fs';
import path from 'node:path';

import type { AgentTool } from '@earendil-works/pi-agent-core';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import {
    getDefaultEnvironment,
    StdioClientTransport
} from '@modelcontextprotocol/sdk/client/stdio.js';
import { z } from 'zod';

import logger from '../utils/logger.js';
import { DLPService } from '../utils/dlp-service.js';
import { scanExtensionEnvironmentReferences } from '../utils/mcp-environment-audit.js';

const DEFAULT_STARTUP_TIMEOUT_MS = 30_000;
const DEFAULT_TOOL_TIMEOUT_MS = 60_000;
const MAX_TIMEOUT_MS = 10 * 60_000;
const BUNDLED_EXTENSION_DIRECTORIES = new Set(['tars-memory', 'tars-search', 'tars-tasks']);
const RESERVED_AGENT_TOOL_NAMES = ['read', 'bash', 'edit', 'write', 'send_notification'];

const TimeoutSchema = z.number().int().positive().max(MAX_TIMEOUT_MS);
const EnvironmentNameSchema = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/);
const EnvironmentSchema = z.record(EnvironmentNameSchema, z.string());
const JsonObjectSchema = z.record(z.string(), z.unknown());
const ToolNameSchema = z.string().trim().min(1);

const McpServerSchema = z
    .object({
        command: z.string().trim().min(1),
        args: z.array(z.string()).optional(),
        env: EnvironmentSchema.optional(),
        envAllowlist: z.array(EnvironmentNameSchema).optional(),
        cwd: z.string().trim().min(1).optional(),
        startupTimeoutMs: TimeoutSchema.optional(),
        toolTimeoutMs: TimeoutSchema.optional()
    })
    .passthrough();

const ExtensionManifestSchema = z
    .object({
        name: z.string().trim().min(1),
        envAllowlist: z.array(EnvironmentNameSchema).optional(),
        startupTimeoutMs: TimeoutSchema.optional(),
        toolTimeoutMs: TimeoutSchema.optional(),
        mcpServers: z.record(z.string().trim().min(1), McpServerSchema)
    })
    .passthrough();

const ExtensionEnablementEntrySchema = z.union([
    z.boolean().transform((enabled) => ({
        enabled,
        overrides: undefined,
        envAllowlist: undefined,
        startupTimeoutMs: undefined,
        toolTimeoutMs: undefined
    })),
    z
        .object({
            enabled: z.boolean().optional(),
            overrides: z.array(z.string()).optional(),
            envAllowlist: z.array(EnvironmentNameSchema).optional(),
            startupTimeoutMs: TimeoutSchema.optional(),
            toolTimeoutMs: TimeoutSchema.optional()
        })
        .passthrough()
]);

const ExtensionEnablementSchema = z.record(
    z.string().trim().min(1),
    ExtensionEnablementEntrySchema
);

const SupportedContentSchema = z.discriminatedUnion('type', [
    z.object({ type: z.literal('text'), text: z.string() }).passthrough(),
    z
        .object({
            type: z.literal('image'),
            data: z.string(),
            mimeType: z.string()
        })
        .passthrough()
]);

type McpManifest = z.infer<typeof ExtensionManifestSchema>;
type McpServerConfig = z.infer<typeof McpServerSchema>;
type ExtensionEnablement = z.infer<typeof ExtensionEnablementEntrySchema>;
type DynamicAgentTool = AgentTool<AgentTool['parameters'], unknown>;
type AgentContent =
    | { readonly type: 'text'; readonly text: string }
    | { readonly type: 'image'; readonly data: string; readonly mimeType: string };

export interface McpExtension {
    readonly directoryName: string;
    readonly name: string;
    readonly path: string;
    readonly manifest: McpManifest;
    readonly enablement: ExtensionEnablement;
}

export interface McpPolicyViolation {
    readonly code: 'external-working-directory' | 'missing-environment-policy';
    readonly extension: string;
    readonly manifestPath: string;
    readonly reason: string;
    readonly server: string;
    readonly suggestedEnvironmentVariables: readonly string[];
    readonly suggestionScanTruncated: boolean;
}

function formatError(error: unknown): string {
    return DLPService.scrub(error instanceof Error ? error.message : String(error));
}

function resolveTemplate(value: string, extensionPath: string, homeDir: string): string {
    return value.replace(/\${extensionPath}/g, extensionPath).replace(/\${tarsHome}/g, homeDir);
}

function isWithinDirectory(parent: string, candidate: string): boolean {
    const relative = path.relative(parent, candidate);
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function namespaceToken(value: string): string {
    const sanitized = value.replace(/[^A-Za-z0-9_-]/g, '_');
    return sanitized || 'extension';
}

function compareExtensionDirectories(left: string, right: string): number {
    const leftPriority = BUNDLED_EXTENSION_DIRECTORIES.has(left) ? 0 : 1;
    const rightPriority = BUNDLED_EXTENSION_DIRECTORIES.has(right) ? 0 : 1;
    return leftPriority - rightPriority || left.localeCompare(right);
}

function allocateToolName(
    requestedName: string,
    extensionName: string,
    usedNames: Set<string>
): string {
    if (!usedNames.has(requestedName)) {
        usedNames.add(requestedName);
        return requestedName;
    }

    const baseName = `${namespaceToken(extensionName)}__${requestedName}`;
    let candidate = baseName;
    let suffix = 2;

    while (usedNames.has(candidate)) {
        candidate = `${baseName}__${suffix}`;
        suffix += 1;
    }

    usedNames.add(candidate);
    return candidate;
}

function toAgentContent(block: unknown): AgentContent {
    const supported = SupportedContentSchema.safeParse(block);
    if (supported.success) {
        if (supported.data.type === 'text') {
            return { type: 'text', text: supported.data.text };
        }
        return {
            type: 'image',
            data: supported.data.data,
            mimeType: supported.data.mimeType
        };
    }

    return { type: 'text', text: JSON.stringify(block) ?? String(block) };
}

export function findMcpPolicyViolations(homeDir: string): McpPolicyViolation[] {
    const extensionsDir = path.join(homeDir, 'extensions');
    const enablementPath = path.join(extensionsDir, 'extension-enablement.json');
    if (!fs.existsSync(enablementPath)) return [];

    const rawEnablement: unknown = JSON.parse(fs.readFileSync(enablementPath, 'utf8'));
    const enablement = ExtensionEnablementSchema.parse(rawEnablement);
    const violations: McpPolicyViolation[] = [];
    for (const [directoryName, entry] of Object.entries(enablement)) {
        if (entry.enabled === false || BUNDLED_EXTENSION_DIRECTORIES.has(directoryName)) continue;
        const extensionPath = path.join(extensionsDir, directoryName);
        const tarsManifest = path.join(extensionPath, 'tars-extension.json');
        const legacyManifest = path.join(extensionPath, 'gemini-extension.json');
        const manifestPath = fs.existsSync(tarsManifest) ? tarsManifest : legacyManifest;
        if (!fs.existsSync(manifestPath)) continue;

        const rawManifest: unknown = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        const manifest = ExtensionManifestSchema.parse(rawManifest);
        const explicitEnvironmentNames = Object.values(manifest.mcpServers).flatMap((server) =>
            Object.keys(server.env ?? {})
        );
        let environmentScan: ReturnType<typeof scanExtensionEnvironmentReferences> | undefined;
        for (const [serverName, server] of Object.entries(manifest.mcpServers)) {
            if (
                entry.envAllowlist === undefined &&
                manifest.envAllowlist === undefined &&
                server.envAllowlist === undefined
            ) {
                environmentScan ??= scanExtensionEnvironmentReferences(
                    extensionPath,
                    explicitEnvironmentNames
                );
                violations.push({
                    code: 'missing-environment-policy',
                    extension: directoryName,
                    manifestPath,
                    server: serverName,
                    reason: 'missing an explicit envAllowlist',
                    suggestedEnvironmentVariables: environmentScan.names,
                    suggestionScanTruncated: environmentScan.truncated
                });
            }

            if (server.cwd) {
                const realExtensionPath = fs.realpathSync(extensionPath);
                const requestedPath = resolveTemplate(server.cwd, realExtensionPath, homeDir);
                const candidate = fs.realpathSync(path.resolve(realExtensionPath, requestedPath));
                if (!isWithinDirectory(realExtensionPath, candidate)) {
                    violations.push({
                        code: 'external-working-directory',
                        extension: directoryName,
                        manifestPath,
                        server: serverName,
                        reason: 'configures a cwd outside its extension directory',
                        suggestedEnvironmentVariables: [],
                        suggestionScanTruncated: false
                    });
                }
            }
        }
    }
    return violations;
}

export class McpBridge {
    private readonly clients: Map<string, Client> = new Map();
    private readonly transports: Map<string, StdioClientTransport> = new Map();

    constructor(private readonly homeDir: string) {}

    /**
     * Discovers and starts authorized MCP servers, returning their tools mapped to AgentTools.
     */
    public async initialize(): Promise<DynamicAgentTool[]> {
        const extensionsDir = path.join(this.homeDir, 'extensions');
        if (!fs.existsSync(extensionsDir)) return [];

        const enablement = this.readEnablement(extensionsDir);
        if (!enablement) return [];

        const extensions = this.discoverExtensions(extensionsDir, enablement);
        const allTools: DynamicAgentTool[] = [];
        const usedToolNames = new Set<string>(RESERVED_AGENT_TOOL_NAMES);

        for (const extension of extensions) {
            const servers = Object.entries(extension.manifest.mcpServers).sort(([left], [right]) =>
                left.localeCompare(right)
            );

            for (const [serverName, serverConfig] of servers) {
                const serverTools = await this.startServer(
                    extension,
                    serverName,
                    serverConfig,
                    usedToolNames
                );
                allTools.push(...serverTools);
            }
        }

        return allTools;
    }

    private readEnablement(extensionsDir: string): Record<string, ExtensionEnablement> | null {
        const enablementPath = path.join(extensionsDir, 'extension-enablement.json');
        if (!fs.existsSync(enablementPath)) {
            logger.warn(`MCP extensions are disabled because ${enablementPath} does not exist.`);
            return null;
        }

        try {
            const rawConfig: unknown = JSON.parse(fs.readFileSync(enablementPath, 'utf-8'));
            const parsed = ExtensionEnablementSchema.safeParse(rawConfig);
            if (!parsed.success) {
                logger.error(
                    `Invalid MCP extension enablement file ${enablementPath}: ${parsed.error.message}`
                );
                return null;
            }
            return parsed.data;
        } catch (error: unknown) {
            logger.error(
                `Failed to read MCP extension enablement file ${enablementPath}: ${formatError(error)}`
            );
            return null;
        }
    }

    private discoverExtensions(
        extensionsDir: string,
        enablement: Record<string, ExtensionEnablement>
    ): McpExtension[] {
        const extensions: McpExtension[] = [];

        try {
            const entries = fs
                .readdirSync(extensionsDir, { withFileTypes: true })
                .sort((left, right) => compareExtensionDirectories(left.name, right.name));

            for (const entry of entries) {
                if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;

                const extensionEnablement = enablement[entry.name];
                if (!extensionEnablement || extensionEnablement.enabled === false) {
                    logger.debug(`Skipping unauthorized MCP extension directory: ${entry.name}`);
                    continue;
                }

                const extension = this.readExtension(
                    extensionsDir,
                    entry.name,
                    extensionEnablement
                );
                if (extension) extensions.push(extension);
            }
        } catch (error: unknown) {
            logger.error(`Error during MCP extension discovery: ${formatError(error)}`);
        }

        return extensions;
    }

    private readExtension(
        extensionsDir: string,
        directoryName: string,
        enablement: ExtensionEnablement
    ): McpExtension | null {
        try {
            const extensionPath = fs.realpathSync(path.join(extensionsDir, directoryName));
            const tarsConfigPath = path.join(extensionPath, 'tars-extension.json');
            const legacyConfigPath = path.join(extensionPath, 'gemini-extension.json');
            const configPath = fs.existsSync(tarsConfigPath) ? tarsConfigPath : legacyConfigPath;

            if (!fs.existsSync(configPath)) return null;

            const rawManifest: unknown = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
            const parsed = ExtensionManifestSchema.safeParse(rawManifest);
            if (!parsed.success) {
                logger.error(
                    `Invalid MCP extension manifest at ${configPath}: ${parsed.error.message}`
                );
                return null;
            }

            if (!BUNDLED_EXTENSION_DIRECTORIES.has(directoryName)) {
                const unacknowledgedServers = Object.entries(parsed.data.mcpServers)
                    .filter(([, server]) => {
                        return (
                            enablement.envAllowlist === undefined &&
                            parsed.data.envAllowlist === undefined &&
                            server.envAllowlist === undefined
                        );
                    })
                    .map(([serverName]) => serverName);
                if (unacknowledgedServers.length > 0) {
                    logger.error(
                        `Custom MCP extension ${directoryName} is disabled pending a security-policy migration. Declare envAllowlist: [] (or explicit variable names) for server(s): ${unacknowledgedServers.join(', ')}. Working directories must also remain inside the extension directory.`
                    );
                    return null;
                }
            }

            logger.info(`🔌 Discovered authorized MCP extension: ${parsed.data.name}`);
            return {
                directoryName,
                name: parsed.data.name,
                path: extensionPath,
                manifest: parsed.data,
                enablement
            };
        } catch (error: unknown) {
            logger.error(
                `Failed to parse MCP extension in ${directoryName}: ${formatError(error)}`
            );
            return null;
        }
    }

    private async startServer(
        extension: McpExtension,
        serverName: string,
        serverConfig: McpServerConfig,
        usedToolNames: Set<string>
    ): Promise<DynamicAgentTool[]> {
        let client: Client | null = null;

        try {
            const resolvedArgs = (serverConfig.args ?? []).map((argument) =>
                resolveTemplate(argument, extension.path, this.homeDir)
            );
            const resolvedCommand = resolveTemplate(
                serverConfig.command,
                extension.path,
                this.homeDir
            );
            const resolvedEnvironment = this.resolveEnvironment(extension, serverConfig);
            const workingDirectory = this.resolveWorkingDirectory(extension.path, serverConfig.cwd);
            const startupTimeoutMs =
                extension.enablement.startupTimeoutMs ??
                serverConfig.startupTimeoutMs ??
                extension.manifest.startupTimeoutMs ??
                DEFAULT_STARTUP_TIMEOUT_MS;
            const toolTimeoutMs =
                extension.enablement.toolTimeoutMs ??
                serverConfig.toolTimeoutMs ??
                extension.manifest.toolTimeoutMs ??
                DEFAULT_TOOL_TIMEOUT_MS;

            logger.info(
                `Starting MCP server ${serverName} via stdio: ${resolvedCommand} (${resolvedArgs.length} argument${resolvedArgs.length === 1 ? '' : 's'})`
            );

            const transport = new StdioClientTransport({
                command: resolvedCommand,
                args: resolvedArgs,
                env: resolvedEnvironment,
                cwd: workingDirectory,
                stderr: 'pipe'
            });

            transport.stderr?.on('data', (chunk: Buffer | string) => {
                const output = chunk.toString().trim();
                for (const line of output.split('\n')) {
                    if (line.trim()) {
                        logger.info(`[MCP:${serverName}] ${DLPService.scrub(line.trim())}`);
                    }
                }
            });

            client = new Client(
                {
                    name: `tars-${namespaceToken(extension.name)}-${serverName}-client`,
                    version: '1.0.0'
                },
                { capabilities: {} }
            );

            const startupOptions = {
                timeout: startupTimeoutMs,
                maxTotalTimeout: startupTimeoutMs
            };
            await client.connect(transport, startupOptions);
            const response = await client.listTools(undefined, startupOptions);

            const key = `${extension.directoryName}:${serverName}`;
            this.clients.set(key, client);
            this.transports.set(key, transport);

            logger.info(
                `Connected to MCP server ${serverName}, found ${response.tools.length} tools.`
            );

            const tools: DynamicAgentTool[] = [];
            for (const mcpTool of response.tools) {
                try {
                    const originalName = ToolNameSchema.parse(mcpTool.name);
                    const exposedName = allocateToolName(
                        originalName,
                        extension.name,
                        usedToolNames
                    );
                    if (exposedName !== originalName) {
                        logger.warn(
                            `MCP tool name collision for ${originalName}; exposing ${extension.name}'s tool as ${exposedName}.`
                        );
                    }

                    const parameters = JsonObjectSchema.parse(mcpTool.inputSchema);
                    tools.push(
                        this.createAgentTool(
                            client,
                            exposedName,
                            originalName,
                            mcpTool.description ?? '',
                            parameters,
                            toolTimeoutMs
                        )
                    );
                } catch (error: unknown) {
                    logger.error(
                        `Skipping invalid MCP tool from ${serverName}: ${formatError(error)}`
                    );
                }
            }

            return tools;
        } catch (error: unknown) {
            logger.error(
                `Failed to start or query MCP server ${serverName}: ${formatError(error)}`
            );
            if (client) {
                try {
                    await client.close();
                } catch (closeError: unknown) {
                    logger.debug(
                        `Failed to clean up MCP server ${serverName}: ${formatError(closeError)}`
                    );
                }
            }
            return [];
        }
    }

    private resolveEnvironment(
        extension: McpExtension,
        serverConfig: McpServerConfig
    ): Record<string, string> {
        const environment = getDefaultEnvironment();
        const allowlist = new Set([
            ...(extension.manifest.envAllowlist ?? []),
            ...(serverConfig.envAllowlist ?? []),
            ...(extension.enablement.envAllowlist ?? [])
        ]);

        for (const variableName of allowlist) {
            const value = process.env[variableName];
            if (value !== undefined) environment[variableName] = value;
        }

        for (const [variableName, value] of Object.entries(serverConfig.env ?? {})) {
            environment[variableName] = resolveTemplate(value, extension.path, this.homeDir);
        }

        environment.TARS_HOME = this.homeDir;
        return environment;
    }

    private resolveWorkingDirectory(extensionPath: string, configuredCwd?: string): string {
        const requestedPath = configuredCwd
            ? resolveTemplate(configuredCwd, extensionPath, this.homeDir)
            : extensionPath;
        const candidate = path.resolve(extensionPath, requestedPath);
        const realCandidate = fs.realpathSync(candidate);

        if (!isWithinDirectory(extensionPath, realCandidate)) {
            throw new Error(`MCP working directory must remain inside ${extensionPath}`);
        }
        if (!fs.statSync(realCandidate).isDirectory()) {
            throw new Error(`MCP working directory is not a directory: ${realCandidate}`);
        }

        return realCandidate;
    }

    private createAgentTool(
        client: Client,
        exposedName: string,
        originalName: string,
        description: string,
        parameters: Record<string, unknown>,
        toolTimeoutMs: number
    ): DynamicAgentTool {
        return {
            name: exposedName,
            label: exposedName,
            description,
            parameters: parameters as DynamicAgentTool['parameters'],
            execute: async (_toolCallId, params, signal) => {
                logger.debug(`Calling MCP tool ${originalName}.`);
                const argumentsObject = JsonObjectSchema.parse(params);
                const result = await client.callTool(
                    { name: originalName, arguments: argumentsObject },
                    undefined,
                    {
                        signal,
                        timeout: toolTimeoutMs,
                        maxTotalTimeout: toolTimeoutMs
                    }
                );
                const resultObject = JsonObjectSchema.parse(result);
                const rawContent = Array.isArray(resultObject.content)
                    ? resultObject.content
                    : [resultObject];

                return {
                    content: rawContent.map(toAgentContent),
                    details: result
                };
            }
        };
    }

    /**
     * Disconnects all MCP clients and cleans up transports.
     */
    public async shutdown(): Promise<void> {
        for (const [key, client] of this.clients.entries()) {
            try {
                logger.info(`Shutting down MCP client: ${key}`);
                await client.close();
            } catch (error: unknown) {
                logger.error(`Error closing MCP client ${key}: ${formatError(error)}`);
            }
        }
        this.clients.clear();
        this.transports.clear();
    }
}
