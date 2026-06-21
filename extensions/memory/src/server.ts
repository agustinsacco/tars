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
                name: 'manage_facts',
                description:
                    'Manage core facts about the user. Facts are persistent key-value pairs representing preferences, rules, identity, and durable information.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        action: {
                            type: 'string',
                            enum: ['store', 'delete', 'list'],
                            description: 'The operation to perform: store, delete, or list facts'
                        },
                        key: {
                            type: 'string',
                            description:
                                'A unique, snake_case identifier for the fact (e.g. "favorite_color", "timezone"). Required for store and delete actions.'
                        },
                        value: {
                            type: 'string',
                            description: 'The value of the fact. Required for store action.'
                        }
                    },
                    required: ['action']
                }
            },
            {
                name: 'manage_notes',
                description:
                    'Append timestamped notes to the daily journal or search across all facts, daily notes, and past sessions.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        action: {
                            type: 'string',
                            enum: ['add', 'search'],
                            description: 'The operation to perform: add a note, or search memory'
                        },
                        queryOrContent: {
                            type: 'string',
                            description:
                                'The content of the note to add, or the keyword search query.'
                        }
                    },
                    required: ['action', 'queryOrContent']
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
            case 'manage_facts': {
                const { action, key, value } = args as any;
                if (!action) throw new Error('Action is required.');

                if (action === 'store') {
                    if (!key || !value)
                        throw new Error('Both key and value are required to store a fact.');
                    const fact = await store.storeFact(key.trim(), value.trim());
                    return {
                        content: [
                            {
                                type: 'text',
                                text: `✅ Stored fact: "${fact.key}" = "${fact.value}"`
                            }
                        ]
                    };
                } else if (action === 'delete') {
                    if (!key) throw new Error('Key is required to delete a fact.');
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
                } else if (action === 'list') {
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
                } else {
                    throw new Error(`Unknown action: ${action}`);
                }
            }

            case 'manage_notes': {
                const { action, queryOrContent } = args as any;
                if (!action) throw new Error('Action is required.');
                if (!queryOrContent) throw new Error('queryOrContent is required.');

                if (action === 'add') {
                    const fileName = await store.addNote(queryOrContent.trim());
                    return {
                        content: [
                            {
                                type: 'text',
                                text: `✅ Note added to ${fileName}`
                            }
                        ]
                    };
                } else if (action === 'search') {
                    const results = await store.search(queryOrContent.trim());
                    if (results.length === 0) {
                        return {
                            content: [
                                { type: 'text', text: `No results found for "${queryOrContent}".` }
                            ]
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
                } else {
                    throw new Error(`Unknown action: ${action}`);
                }
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
