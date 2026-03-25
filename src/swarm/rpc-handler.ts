/**
 * JSON-RPC request handler for the Tars Swarm A2A endpoint.
 * Maps A2A protocol operations to the Tars Supervisor.
 */

import { v4 as uuidv4 } from 'uuid';
import logger from '../utils/logger.js';
import type { Supervisor } from '../supervisor/supervisor.js';
import type {
    JSONRPCRequest,
    JSONRPCResponse,
    JSONRPCError,
    SendMessageParams,
    TaskQueryParams,
    TaskCancelParams,
    Task,
    TaskState
} from './types.js';
import {
    RPC_PARSE_ERROR,
    RPC_INVALID_REQUEST,
    RPC_METHOD_NOT_FOUND,
    RPC_INTERNAL_ERROR,
    A2A_TASK_NOT_FOUND
} from './types.js';

/**
 * In-memory task store for tracking active/completed tasks.
 * Tasks expire after 1 hour to prevent unbounded memory growth.
 */
const taskStore = new Map<string, Task>();
const TASK_TTL_MS = 60 * 60 * 1000; // 1 hour

function cleanExpiredTasks(): void {
    const now = Date.now();
    for (const [id, task] of taskStore) {
        const timestamp = task.status.timestamp;
        if (timestamp && now - new Date(timestamp).getTime() > TASK_TTL_MS) {
            taskStore.delete(id);
        }
    }
}

/**
 * Extracts plain text from A2A message parts.
 */
function extractTextFromParts(parts: Array<{ text?: string }>): string {
    return parts
        .filter((p) => p.text)
        .map((p) => p.text!)
        .join('\n');
}

/**
 * Creates a JSON-RPC error response.
 */
function errorResponse(id: string | number, code: number, message: string): JSONRPCResponse {
    return {
        jsonrpc: '2.0',
        id,
        error: { code, message }
    };
}

/**
 * Creates a JSON-RPC success response.
 */
function successResponse(id: string | number, result: unknown): JSONRPCResponse {
    return {
        jsonrpc: '2.0',
        id,
        result
    };
}

/**
 * Parse and validate a raw JSON body into a JSONRPCRequest.
 * Returns the parsed request or an error response.
 */
export function parseRPCRequest(
    body: string
): { request: JSONRPCRequest } | { error: JSONRPCResponse } {
    let parsed: any;
    try {
        parsed = JSON.parse(body);
    } catch {
        return { error: errorResponse(0, RPC_PARSE_ERROR, 'Parse error: invalid JSON') };
    }

    if (!parsed.jsonrpc || parsed.jsonrpc !== '2.0' || !parsed.method || parsed.id == null) {
        return {
            error: errorResponse(
                parsed.id || 0,
                RPC_INVALID_REQUEST,
                'Invalid JSON-RPC 2.0 request'
            )
        };
    }

    return { request: parsed as JSONRPCRequest };
}

/**
 * Handles a validated JSON-RPC request by dispatching to the appropriate A2A method.
 */
export async function handleRPCRequest(
    request: JSONRPCRequest,
    supervisor: Supervisor
): Promise<JSONRPCResponse> {
    // Periodic cleanup
    cleanExpiredTasks();

    logger.info(`🌐 [Swarm] A2A RPC: ${request.method} (id=${request.id})`);

    switch (request.method) {
        case 'tasks/send':
            return handleTasksSend(request, supervisor);

        case 'tasks/get':
            return handleTasksGet(request);

        case 'tasks/cancel':
            return handleTasksCancel(request);

        default:
            return errorResponse(
                request.id,
                RPC_METHOD_NOT_FOUND,
                `Method not found: ${request.method}`
            );
    }
}

/**
 * Handle tasks/send — the primary A2A operation.
 * Receives a message, executes it through the Supervisor, returns the result.
 */
async function handleTasksSend(
    request: JSONRPCRequest,
    supervisor: Supervisor
): Promise<JSONRPCResponse> {
    const params = request.params as unknown as SendMessageParams;

    if (!params?.message?.parts || params.message.parts.length === 0) {
        return errorResponse(request.id, RPC_INVALID_REQUEST, 'Message with parts is required');
    }

    const query = extractTextFromParts(params.message.parts);
    if (!query.trim()) {
        return errorResponse(request.id, RPC_INVALID_REQUEST, 'Message contains no text content');
    }

    const taskId = (params.metadata?.taskId as string) || uuidv4();
    const contextId = params.metadata?.contextId as string | undefined;

    // Create task in submitted state
    const task: Task = {
        id: taskId,
        contextId,
        status: {
            state: 'submitted',
            timestamp: new Date().toISOString()
        },
        history: [params.message]
    };
    taskStore.set(taskId, task);

    // Transition to working
    task.status = { state: 'working', timestamp: new Date().toISOString() };

    try {
        // Check if supervisor is busy
        if (supervisor.isBusy()) {
            task.status = {
                state: 'rejected',
                message: {
                    role: 'agent',
                    parts: [
                        {
                            text: 'This Tars instance is currently processing another request. Please retry later.'
                        }
                    ]
                },
                timestamp: new Date().toISOString()
            };
            return successResponse(request.id, task);
        }

        // Execute through supervisor (synchronous — blocking)
        let resultText = '';

        await supervisor.run(
            query,
            async (event) => {
                if (event.type === 'text' && event.content && event.role !== 'user') {
                    resultText += event.content;
                }
            },
            taskId
        );

        // If no content was generated, provide a fallback
        if (!resultText.trim()) {
            resultText = 'Task completed but no text output was generated.';
        }

        // Transition to completed
        task.status = {
            state: 'completed',
            timestamp: new Date().toISOString()
        };
        task.artifacts = [
            {
                parts: [{ text: resultText }],
                index: 0
            }
        ];

        // Add agent response to history
        task.history?.push({
            role: 'agent',
            parts: [{ text: resultText }]
        });

        logger.info(`✅ [Swarm] Task ${taskId} completed (${resultText.length} chars)`);

        return successResponse(request.id, task);
    } catch (error: any) {
        const errorMsg = error.message || String(error);
        logger.error(`❌ [Swarm] Task ${taskId} failed: ${errorMsg}`);

        task.status = {
            state: 'failed',
            message: {
                role: 'agent',
                parts: [{ text: `Task execution failed: ${errorMsg}` }]
            },
            timestamp: new Date().toISOString()
        };

        return successResponse(request.id, task);
    }
}

/**
 * Handle tasks/get — retrieve task status and result.
 */
function handleTasksGet(request: JSONRPCRequest): JSONRPCResponse {
    const params = request.params as unknown as TaskQueryParams;

    if (!params?.id) {
        return errorResponse(request.id, RPC_INVALID_REQUEST, 'Task id is required');
    }

    const task = taskStore.get(params.id);
    if (!task) {
        return errorResponse(request.id, A2A_TASK_NOT_FOUND, `Task not found: ${params.id}`);
    }

    // Apply historyLength limit if specified
    if (params.historyLength != null && task.history) {
        const limited = { ...task };
        limited.history = task.history.slice(-params.historyLength);
        return successResponse(request.id, limited);
    }

    return successResponse(request.id, task);
}

/**
 * Handle tasks/cancel — cancel a running task.
 * Note: Current implementation can only mark future tasks as canceled.
 * Active supervisor runs cannot be interrupted mid-execution.
 */
function handleTasksCancel(request: JSONRPCRequest): JSONRPCResponse {
    const params = request.params as unknown as TaskCancelParams;

    if (!params?.id) {
        return errorResponse(request.id, RPC_INVALID_REQUEST, 'Task id is required');
    }

    const task = taskStore.get(params.id);
    if (!task) {
        return errorResponse(request.id, A2A_TASK_NOT_FOUND, `Task not found: ${params.id}`);
    }

    const terminalStates: TaskState[] = ['completed', 'canceled', 'failed', 'rejected'];
    if (terminalStates.includes(task.status.state)) {
        return successResponse(request.id, task); // Already terminal, no-op
    }

    task.status = {
        state: 'canceled',
        timestamp: new Date().toISOString()
    };

    logger.info(`🚫 [Swarm] Task ${params.id} canceled`);
    return successResponse(request.id, task);
}

/**
 * Returns the number of tasks currently in the store (for testing/monitoring).
 */
export function getTaskStoreSize(): number {
    return taskStore.size;
}

/**
 * Clears the task store (for testing).
 */
export function clearTaskStore(): void {
    taskStore.clear();
}
