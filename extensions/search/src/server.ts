import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { performWebSearch, fetchWebPage } from './search-helper.js';
import { z } from 'zod';

const WebSearchInputSchema = z
    .object({
        query: z.string().trim().min(1).max(500),
        limit: z.number().int().min(1).max(10).default(5)
    })
    .strict();

const WebFetchInputSchema = z
    .object({
        url: z.string().url()
    })
    .strict();

function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

const server = new Server(
    {
        name: 'tars-search',
        version: '1.0.0'
    },
    {
        capabilities: {
            tools: {}
        }
    }
);

/**
 * Tool Definitions
 */
server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
        tools: [
            {
                name: 'web_search',
                description:
                    'Search the web using DuckDuckGo (free, keyless) and return a list of matches.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        query: {
                            type: 'string',
                            description:
                                'The search query to execute (e.g. "latest version of Node.js")'
                        },
                        limit: {
                            type: 'number',
                            description:
                                'Maximum number of results to return (default: 5, max: 10)',
                            minimum: 1,
                            maximum: 10
                        }
                    },
                    required: ['query']
                }
            },
            {
                name: 'web_fetch',
                description:
                    'Fetch the text/Markdown content of a specific web URL, stripped of header/footer boilerplate.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        url: {
                            type: 'string',
                            description: 'The URL to fetch content from'
                        }
                    },
                    required: ['url']
                }
            }
        ]
    };
});

/**
 * Tool Handlers
 */
server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
        switch (name) {
            case 'web_search': {
                const { query, limit } = WebSearchInputSchema.parse(args);

                const results = await performWebSearch(query, limit);

                return {
                    content: [
                        {
                            type: 'text',
                            text: `<untrusted_web_search_results>\n${JSON.stringify(results, null, 2)}\n</untrusted_web_search_results>`
                        }
                    ]
                };
            }

            case 'web_fetch': {
                const { url } = WebFetchInputSchema.parse(args);

                const markdown = await fetchWebPage(url);

                return {
                    content: [
                        {
                            type: 'text',
                            text: markdown
                        }
                    ]
                };
            }

            default:
                throw new Error(`Unknown tool: ${name}`);
        }
    } catch (error: unknown) {
        return {
            content: [{ type: 'text', text: `❌ Error: ${getErrorMessage(error)}` }],
            isError: true
        };
    }
});

// Start Server
async function main(): Promise<void> {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error('tars-search MCP server running on stdio');
}

main().catch((error) => {
    console.error('Server error:', error);
    process.exit(1);
});
