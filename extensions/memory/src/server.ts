import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { MemoryStore } from './store.js';

const ManageFactsArgumentsSchema = z.discriminatedUnion('action', [
    z.object({
        action: z.literal('store'),
        key: z.string().trim().min(1),
        value: z.string().trim().min(1)
    }),
    z.object({ action: z.literal('delete'), key: z.string().trim().min(1) }),
    z.object({ action: z.literal('list') })
]);
const ManageNotesArgumentsSchema = z.object({
    action: z.enum(['add', 'search']),
    queryOrContent: z.string().trim().min(1)
});

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
                const parsed = ManageFactsArgumentsSchema.parse(args);

                if (parsed.action === 'store') {
                    const fact = await store.storeFact(parsed.key, parsed.value);
                    return {
                        content: [
                            {
                                type: 'text',
                                text: `✅ Stored fact: "${fact.key}" = "${fact.value}"`
                            }
                        ]
                    };
                } else if (parsed.action === 'delete') {
                    const deleted = await store.deleteFact(parsed.key);
                    return {
                        content: [
                            {
                                type: 'text',
                                text: deleted
                                    ? `✅ Deleted fact: "${parsed.key}"`
                                    : `❌ Fact "${parsed.key}" not found.`
                            }
                        ]
                    };
                } else {
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
            }

            case 'manage_notes': {
                const parsed = ManageNotesArgumentsSchema.parse(args);

                if (parsed.action === 'add') {
                    const fileName = await store.addNote(parsed.queryOrContent);
                    return {
                        content: [
                            {
                                type: 'text',
                                text: `✅ Note added to ${fileName}`
                            }
                        ]
                    };
                } else {
                    const results = await store.search(parsed.queryOrContent);
                    if (results.length === 0) {
                        return {
                            content: [
                                {
                                    type: 'text',
                                    text: `No results found for "${parsed.queryOrContent}".`
                                }
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
                }
            }

            default:
                throw new Error(`Unknown tool: ${name}`);
        }
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        return {
            content: [{ type: 'text', text: `❌ Error: ${message}` }],
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
