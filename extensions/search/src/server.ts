import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { performWebSearch, fetchWebPage } from './search-helper.js';

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
                description: 'Search the web using Tavily Search and return a list of matches.',
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
                const { query, limit = 5 } = args as { query: string; limit?: number };
                if (!query) throw new Error('Query is required.');

                const results = await performWebSearch(query, limit);

                return {
                    content: [
                        {
                            type: 'text',
                            text: JSON.stringify(results, null, 2)
                        }
                    ]
                };
            }

            case 'web_fetch': {
                const { url } = args as { url: string };
                if (!url) throw new Error('URL is required.');

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
    } catch (error: any) {
        return {
            content: [{ type: 'text', text: `❌ Error: ${error.message}` }],
            isError: true
        };
    }
});

// Start Server
async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error('tars-search MCP server running on stdio');
}

main().catch((error) => {
    console.error('Server error:', error);
    process.exit(1);
});
