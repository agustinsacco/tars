import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { TaskStore, Task } from './store.js';
import { v4 as uuidv4 } from 'uuid';
import { CronExpressionParser } from 'cron-parser';

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
                name: 'create_task',
                description: 'Create a new scheduled task',
                inputSchema: {
                    type: 'object',
                    properties: {
                        title: { type: 'string', description: 'Task title' },
                        prompt: {
                            type: 'string',
                            description: 'The prompt for Gemini CLI to execute'
                        },
                        schedule: { type: 'string', description: 'Cron expression or ISO date' },
                        mode: { type: 'string', enum: ['notify', 'silent'], default: 'silent' }
                    },
                    required: ['title', 'prompt', 'schedule']
                }
            },
            {
                name: 'list_tasks',
                description: 'List all scheduled tasks',
                inputSchema: {
                    type: 'object',
                    properties: {
                        enabledOnly: { type: 'boolean', default: false }
                    }
                }
            },
            {
                name: 'delete_task',
                description: 'Delete a task by ID',
                inputSchema: {
                    type: 'object',
                    properties: {
                        id: { type: 'string' }
                    },
                    required: ['id']
                }
            },
            {
                name: 'toggle_task',
                description: 'Enable or disable a task',
                inputSchema: {
                    type: 'object',
                    properties: {
                        id: { type: 'string', description: 'Task ID' },
                        enabled: {
                            type: 'boolean',
                            description: 'Whether the task should be enabled'
                        }
                    },
                    required: ['id', 'enabled']
                }
            },
            {
                name: 'modify_task',
                description: 'Modify an existing task',
                inputSchema: {
                    type: 'object',
                    properties: {
                        id: { type: 'string', description: 'Task ID' },
                        title: { type: 'string', description: 'New title' },
                        prompt: { type: 'string', description: 'New prompt' },
                        schedule: { type: 'string', description: 'New cron or ISO date' }
                    },
                    required: ['id']
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
            case 'create_task': {
                const { title, prompt, schedule, mode = 'silent' } = args as any;

                // Calculate next run
                let nextRun: string;
                try {
                    const next = CronExpressionParser.parse(schedule).next();
                    const iso = next.toISOString();
                    if (!iso) {
                        throw new Error('Could not calculate next run time from cron expression.');
                    }
                    nextRun = iso;
                } catch (error: any) {
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
                    mode,
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

            case 'list_tasks': {
                const { enabledOnly } = args as any;
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

            case 'delete_task': {
                const { id } = args as any;
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

            case 'toggle_task': {
                const { id, enabled } = args as any;
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

            case 'modify_task': {
                const { id, title, prompt, schedule } = args as any;
                const updates: any = {};
                if (title) updates.title = title;
                if (prompt) updates.prompt = prompt;
                if (schedule) {
                    updates.schedule = schedule;
                    try {
                        const next = CronExpressionParser.parse(schedule).next();
                        updates.nextRun = next.toISOString();
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
                throw new Error(`Unknown tool: ${name}`);
        }
    } catch (error: any) {
        return {
            content: [{ type: 'text', text: `❌ Error: ${error.message}` }],
            isError: true
        };
    }
});

/**
 * Start Server
 */
async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error('Tars Tasks MCP Server running on stdio');
}

main().catch((error) => {
    console.error('Server error:', error);
    process.exit(1);
});
