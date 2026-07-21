import { type AgentTool } from '@earendil-works/pi-agent-core';
import { Type, type Static } from 'typebox';

const DiscoverExtensionToolsParams = Type.Object({
    query: Type.String({
        description:
            'Capability or integration to find, such as browser automation, Questrade, Shopify, or Ultrahuman.'
    })
});

const InvokeExtensionToolParams = Type.Object({
    name: Type.String({ description: 'Exact tool name returned by discover_extension_tools.' }),
    arguments: Type.Record(Type.String(), Type.Unknown(), {
        description: 'Arguments matching the discovered input schema.'
    })
});

type DiscoverExtensionToolsInput = Static<typeof DiscoverExtensionToolsParams>;
type InvokeExtensionToolInput = Static<typeof InvokeExtensionToolParams>;

const CORE_MCP_TOOL_NAMES = new Set([
    'manage_facts',
    'manage_notes',
    'web_search',
    'fetch_page',
    'manage_tasks'
]);
const MAX_DISCOVERY_MATCHES = 8;

interface ScoredTool {
    readonly score: number;
    readonly tool: AgentTool;
}

export interface RoutedMcpTools {
    readonly directTools: readonly AgentTool[];
    readonly routerTools: readonly AgentTool[];
}

function tokenize(value: string): string[] {
    return value
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((token) => token.length > 1);
}

function scoreTool(tool: AgentTool, query: string): number {
    const normalizedQuery = query.trim().toLowerCase();
    const name = tool.name.toLowerCase();
    const description = tool.description.toLowerCase();
    if (!normalizedQuery) return 1;
    let score = name.includes(normalizedQuery)
        ? 20
        : description.includes(normalizedQuery)
          ? 10
          : 0;
    for (const term of tokenize(normalizedQuery)) {
        if (name.includes(term)) score += 5;
        if (description.includes(term)) score += 2;
    }
    return score;
}

function findTools(tools: readonly AgentTool[], query: string): readonly AgentTool[] {
    const scored: ScoredTool[] = tools.map((tool) => ({ score: scoreTool(tool, query), tool }));
    const positive = scored.filter(({ score }) => score > 0);
    const candidates = positive.length > 0 ? positive : scored;
    return candidates
        .sort(
            (left, right) =>
                right.score - left.score || left.tool.name.localeCompare(right.tool.name)
        )
        .slice(0, MAX_DISCOVERY_MATCHES)
        .map(({ tool }) => tool);
}

function createDiscoverTool(
    optionalTools: readonly AgentTool[]
): AgentTool<typeof DiscoverExtensionToolsParams> {
    const catalog = optionalTools
        .map(({ name }) => name)
        .sort()
        .join(', ');
    return {
        description: `Find optional MCP extension tools and their input schemas. Search before invoking a specialized integration. Available names: ${catalog}`,
        label: 'Discover Extension Tools',
        name: 'discover_extension_tools',
        parameters: DiscoverExtensionToolsParams,
        execute: async (_toolCallId: string, params: DiscoverExtensionToolsInput) => {
            const matches = findTools(optionalTools, params.query);
            const result = matches.map(({ description, name, parameters }) => ({
                description,
                inputSchema: parameters,
                name
            }));
            return {
                content: [{ type: 'text' as const, text: JSON.stringify(result) }],
                details: { matches: matches.map(({ name }) => name) }
            };
        }
    };
}

function createInvokeTool(
    optionalTools: readonly AgentTool[]
): AgentTool<typeof InvokeExtensionToolParams> {
    const toolsByName = new Map(optionalTools.map((tool) => [tool.name, tool]));
    return {
        description:
            'Invoke an optional MCP extension tool after discovering its exact name and input schema with discover_extension_tools.',
        label: 'Invoke Extension Tool',
        name: 'invoke_extension_tool',
        parameters: InvokeExtensionToolParams,
        execute: async (toolCallId: string, params: InvokeExtensionToolInput, signal, onUpdate) => {
            const tool = toolsByName.get(params.name);
            if (!tool) throw new Error(`Unknown optional extension tool: ${params.name}`);
            return tool.execute(toolCallId, params.arguments, signal, onUpdate);
        }
    };
}

export function routeMcpTools(tools: readonly AgentTool[]): RoutedMcpTools {
    const directTools = tools.filter(({ name }) => CORE_MCP_TOOL_NAMES.has(name));
    const optionalTools = tools.filter(({ name }) => !CORE_MCP_TOOL_NAMES.has(name));
    if (optionalTools.length === 0) return { directTools, routerTools: [] };
    return {
        directTools,
        routerTools: [createDiscoverTool(optionalTools), createInvokeTool(optionalTools)]
    };
}
