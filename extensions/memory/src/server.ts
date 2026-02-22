import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { MemoryStore } from './store.js';

const store = new MemoryStore();
const server = new Server(
    {
        name: 'tars-memory',
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
                name: 'memory_store_fact',
                description:
                    'Store or overwrite a core fact about the user. Facts are key-value pairs that persist across sessions. Use for preferences, identity, rules, and durable information. If the key already exists, the value is overwritten (not appended).',
                inputSchema: {
                    type: 'object',
                    properties: {
                        key: {
                            type: 'string',
                            description:
                                'A unique, snake_case identifier for the fact (e.g. "favorite_color", "employer", "timezone")'
                        },
                        value: {
                            type: 'string',
                            description: 'The value of the fact'
                        }
                    },
                    required: ['key', 'value']
                }
            },
            {
                name: 'memory_delete_fact',
                description: 'Delete a stored fact by its key.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        key: { type: 'string', description: 'The key of the fact to delete' }
                    },
                    required: ['key']
                }
            },
            {
                name: 'memory_list_facts',
                description:
                    'List all stored core facts. Use this to review what the user has asked you to remember.',
                inputSchema: {
                    type: 'object',
                    properties: {}
                }
            },
            {
                name: 'memory_add_note',
                description:
                    "Append a timestamped note to today's daily log. Use for project context, decisions, observations, and anything that does not need to be loaded into every session. Notes are searchable but not injected into the main context window.",
                inputSchema: {
                    type: 'object',
                    properties: {
                        content: {
                            type: 'string',
                            description: 'The note content to record'
                        }
                    },
                    required: ['content']
                }
            },
            {
                name: 'memory_search',
                description:
                    'Search across all stored facts and daily notes by keyword. Returns matching entries from both long-term facts and short-term daily notes.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        query: {
                            type: 'string',
                            description: 'The search query (keyword match)'
                        }
                    },
                    required: ['query']
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
            case 'memory_store_fact': {
                const { key, value } = args as any;
                if (!key || !value) throw new Error('Both key and value are required.');

                const fact = await store.storeFact(key.trim(), value.trim());
                return {
                    content: [
                        {
                            type: 'text',
                            text: `✅ Stored fact: "${fact.key}" = "${fact.value}"`
                        }
                    ]
                };
            }

            case 'memory_delete_fact': {
                const { key } = args as any;
                const deleted = await store.deleteFact(key);
                return {
                    content: [
                        {
                            type: 'text',
                            text: deleted
                                ? `✅ Deleted fact: "${key}"`
                                : `❌ Fact "${key}" not found.`
                        }
                    ]
                };
            }

            case 'memory_list_facts': {
                const facts = await store.listFacts();
                if (facts.length === 0) {
                    return {
                        content: [{ type: 'text', text: 'No facts stored yet.' }]
                    };
                }

                const text = facts
                    .map((f) => `• **${f.key}**: ${f.value} _(updated ${f.updatedAt})_`)
                    .join('\n');

                return { content: [{ type: 'text', text }] };
            }

            case 'memory_add_note': {
                const { content } = args as any;
                if (!content) throw new Error('Content is required.');

                const fileName = await store.addNote(content.trim());
                return {
                    content: [
                        {
                            type: 'text',
                            text: `✅ Note added to ${fileName}`
                        }
                    ]
                };
            }

            case 'memory_search': {
                const { query } = args as any;
                if (!query) throw new Error('Query is required.');

                const results = await store.search(query.trim());
                if (results.length === 0) {
                    return {
                        content: [{ type: 'text', text: `No results found for "${query}".` }]
                    };
                }

                const text = results.map((r) => `• ${r}`).join('\n');
                return {
                    content: [
                        {
                            type: 'text',
                            text: `Found ${results.length} result(s):\n${text}`
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
    console.error('tars-memory MCP server running on stdio');
}

main().catch((error) => {
    console.error('Server error:', error);
    process.exit(1);
});
