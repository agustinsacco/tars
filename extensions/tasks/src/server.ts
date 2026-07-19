import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { TaskStore, type Task } from './store.js';
import { v4 as uuidv4 } from 'uuid';
import { CronExpressionParser } from 'cron-parser';
import { z } from 'zod';

const ManageTaskInputSchema = z
    .object({
        action: z.enum(['create', 'list', 'delete', 'toggle', 'modify']),
        id: z.string().min(1).optional(),
        title: z.string().min(1).optional(),
        prompt: z.string().min(1).optional(),
        schedule: z.string().min(1).optional(),
        enabled: z.boolean().optional(),
        mode: z.enum(['notify', 'silent']).optional(),
        enabledOnly: z.boolean().default(false)
    })
    .strict();

function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

const store = new TaskStore();
const server = new Server(
    {
        name: 'tars-tasks',
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
                name: 'manage_tasks',
                description:
                    'Manage scheduled tasks. Supports creating, listing, modifying, toggling, and deleting tasks.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        action: {
                            type: 'string',
                            enum: ['create', 'list', 'delete', 'toggle', 'modify'],
                            description: 'The task management operation to perform'
                        },
                        id: {
                            type: 'string',
                            description: 'Task ID. Required for delete, toggle, and modify actions.'
                        },
                        title: {
                            type: 'string',
                            description: 'Task title. Required for create.'
                        },
                        prompt: {
                            type: 'string',
                            description:
                                'The prompt instructions for Tars to execute on schedule. Required for create.'
                        },
                        schedule: {
                            type: 'string',
                            description:
                                'Cron expression or ISO date/time string. Required for create.'
                        },
                        enabled: {
                            type: 'boolean',
                            description: 'Whether the task is enabled. Required for toggle.'
                        },
                        mode: {
                            type: 'string',
                            enum: ['notify', 'silent'],
                            default: 'silent',
                            description: 'Notification mode for task execution results'
                        },
                        enabledOnly: {
                            type: 'boolean',
                            default: false,
                            description: 'When action is list, filter to enabled tasks only.'
                        }
                    },
                    required: ['action']
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
        if (name !== 'manage_tasks') {
            throw new Error(`Unknown tool: ${name}`);
        }

        const { action, id, title, prompt, schedule, enabled, mode, enabledOnly } =
            ManageTaskInputSchema.parse(args);

        switch (action) {
            case 'create': {
                if (!title || !prompt || !schedule) {
                    throw new Error('title, prompt, and schedule are required for create action.');
                }

                // Calculate next run
                let nextRun: string;
                try {
                    const next = CronExpressionParser.parse(schedule).next();
                    const iso = next.toISOString();
                    if (!iso) {
                        throw new Error('Could not calculate next run time from cron expression.');
                    }
                    nextRun = iso;
                } catch {
                    // If it's not a valid cron, try parsing as ISO date
                    const date = new Date(schedule);
                    if (!isNaN(date.getTime()) && schedule.includes('-')) {
                        nextRun = date.toISOString();
                    } else {
                        throw new Error(
                            `Invalid schedule: "${schedule}". Must be a valid cron expression or ISO date string (e.g., "YYYY-MM-DDTHH:mm:ssZ").`
                        );
                    }
                }

                const task: Task = {
                    id: uuidv4(),
                    title,
                    prompt,
                    schedule,
                    nextRun,
                    enabled: true,
                    mode: mode ?? 'silent',
                    source: 'user',
                    failedCount: 0,
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString()
                };

                await store.addTask(task);
                return {
                    content: [
                        {
                            type: 'text',
                            text: `✅ Task created: ${task.title} (ID: ${task.id})\nNext run: ${task.nextRun}`
                        }
                    ]
                };
            }

            case 'list': {
                const tasks = await store.loadTasks();
                const filtered = enabledOnly ? tasks.filter((t) => t.enabled) : tasks;

                if (filtered.length === 0) {
                    return { content: [{ type: 'text', text: 'No tasks found.' }] };
                }

                const text = filtered
                    .map((t) => {
                        const status = t.enabled ? 'ON' : 'OFF';
                        let info = `- [${status}] **${t.title}** (\`${t.id}\`)\n  Schedule: \`${t.schedule}\`\n  Next run: ${t.nextRun}`;
                        if (t.failedCount > 0) {
                            info += `\n  ⚠️ Failures: ${t.failedCount}`;
                        }
                        if (t.lastRun) {
                            info += `\n  Last run: ${t.lastRun}`;
                        }
                        return info;
                    })
                    .join('\n\n');

                return { content: [{ type: 'text', text }] };
            }

            case 'delete': {
                if (!id) throw new Error('Task ID is required for delete action.');
                const success = await store.deleteTask(id);
                return {
                    content: [
                        {
                            type: 'text',
                            text: success ? `✅ Task ${id} deleted.` : `❌ Task ${id} not found.`
                        }
                    ]
                };
            }

            case 'toggle': {
                if (!id || enabled === undefined) {
                    throw new Error('Task ID and enabled boolean are required for toggle action.');
                }
                const task = await store.updateTask(id, { enabled });
                return {
                    content: [
                        {
                            type: 'text',
                            text: task
                                ? `✅ Task "${task.title}" is now ${enabled ? 'enabled' : 'disabled'}.`
                                : `❌ Task ${id} not found.`
                        }
                    ]
                };
            }

            case 'modify': {
                if (!id) throw new Error('Task ID is required for modify action.');
                const updates: Partial<Task> = {};
                if (title) updates.title = title;
                if (prompt) updates.prompt = prompt;
                if (mode) updates.mode = mode;
                if (schedule) {
                    updates.schedule = schedule;
                    try {
                        const next = CronExpressionParser.parse(schedule).next();
                        const iso = next.toISOString();
                        if (!iso) throw new Error('Could not calculate the next run time.');
                        updates.nextRun = iso;
                    } catch {
                        const date = new Date(schedule);
                        if (!isNaN(date.getTime()) && schedule.includes('-')) {
                            updates.nextRun = date.toISOString();
                        } else {
                            throw new Error(`Invalid schedule: ${schedule}`);
                        }
                    }
                }

                const task = await store.updateTask(id, updates);
                return {
                    content: [
                        {
                            type: 'text',
                            text: task
                                ? `✅ Task "${task.title}" updated.`
                                : `❌ Task ${id} not found.`
                        }
                    ]
                };
            }

            default:
                throw new Error(`Unknown action: ${action}`);
        }
    } catch (error: unknown) {
        return {
            content: [{ type: 'text', text: `❌ Error: ${getErrorMessage(error)}` }],
            isError: true
        };
    }
});

/**
 * Start Server
 */
async function main(): Promise<void> {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error('Tars Tasks MCP Server running on stdio');
}

main().catch((error) => {
    console.error('Server error:', error);
    process.exit(1);
});
