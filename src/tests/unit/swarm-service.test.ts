/**
 * Unit tests for the Tars Swarm feature.
 * Tests the agent card builder, RPC handler, and auth middleware.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { buildAgentCard } from '../../swarm/agent-card.js';
import {
    parseRPCRequest,
    handleRPCRequest,
    clearTaskStore,
    getTaskStoreSize
} from '../../swarm/rpc-handler.js';
import type { Config } from '../../config/config.js';

/**
 * Creates a minimal mock Config for testing.
 */
function createMockConfig(overrides: Partial<any> = {}): Config {
    return {
        assistantName: 'Tars',
        instanceName: 'tars-supervisor',
        homeDir: '/tmp/test-tars',
        swarm: {
            enabled: true,
            port: 3100,
            description: 'Test Tars instance',
            skills: [],
            apiKey: 'test-api-key-12345'
        },
        ...overrides
    } as unknown as Config;
}

/**
 * Creates a mock Supervisor for testing.
 */
function createMockSupervisor(options: { busy?: boolean; result?: string; error?: Error } = {}) {
    return {
        isBusy: vi.fn().mockReturnValue(options.busy || false),
        run: vi
            .fn()
            .mockImplementation(async (_prompt: string, onEvent: any, _sessionId?: string) => {
                if (options.error) throw options.error;

                const text = options.result || 'Mock response from Tars';
                await onEvent({ type: 'text', content: text, role: 'assistant' });
                await onEvent({ type: 'done' });
            }),
        executeTask: vi.fn().mockResolvedValue(options.result || 'Mock response')
    } as any;
}

// ─── Agent Card Tests ────────────────────────────────────────

describe('buildAgentCard', () => {
    it('should generate a valid agent card with default skills', () => {
        const config = createMockConfig();
        const card = buildAgentCard(config);

        expect(card.name).toBe('tars');
        expect(card.description).toBe('Test Tars instance');
        expect(card.supportedInterfaces).toHaveLength(1);
        expect(card.supportedInterfaces[0].protocolBinding).toBe('JSONRPC');
        expect(card.skills.length).toBeGreaterThanOrEqual(3);
        expect(card.securitySchemes).toHaveProperty('apiKey');
        expect(card.security).toEqual([{ apiKey: [] }]);
    });

    it('should use custom description from config', () => {
        const config = createMockConfig({
            swarm: {
                enabled: true,
                port: 3100,
                description: 'My custom agent',
                skills: [],
                apiKey: 'test'
            }
        });
        const card = buildAgentCard(config);
        expect(card.description).toBe('My custom agent');
    });

    it('should include custom skills alongside defaults', () => {
        const config = createMockConfig({
            swarm: {
                enabled: true,
                port: 3100,
                description: '',
                skills: ['kubernetes', 'terraform'],
                apiKey: 'test'
            }
        });
        const card = buildAgentCard(config);

        const skillIds = card.skills.map((s) => s.id);
        expect(skillIds).toContain('general');
        expect(skillIds).toContain('coding');
        expect(skillIds).toContain('devops');
        expect(skillIds).toContain('kubernetes');
        expect(skillIds).toContain('terraform');
    });

    it('should respect custom URL override', () => {
        const config = createMockConfig();
        const card = buildAgentCard(config, 'https://my-tars.example.com');

        expect(card.supportedInterfaces[0].url).toBe('https://my-tars.example.com/a2a');
    });
});

// ─── RPC Parser Tests ────────────────────────────────────────

describe('parseRPCRequest', () => {
    it('should parse a valid JSON-RPC request', () => {
        const result = parseRPCRequest(
            JSON.stringify({
                jsonrpc: '2.0',
                id: 1,
                method: 'tasks/send',
                params: {}
            })
        );

        expect('request' in result).toBe(true);
        if ('request' in result) {
            expect(result.request.method).toBe('tasks/send');
        }
    });

    it('should reject invalid JSON', () => {
        const result = parseRPCRequest('not json');
        expect('error' in result).toBe(true);
        if ('error' in result) {
            expect(result.error.error?.code).toBe(-32700);
        }
    });

    it('should reject missing method', () => {
        const result = parseRPCRequest(JSON.stringify({ jsonrpc: '2.0', id: 1 }));
        expect('error' in result).toBe(true);
    });

    it('should reject wrong jsonrpc version', () => {
        const result = parseRPCRequest(JSON.stringify({ jsonrpc: '1.0', id: 1, method: 'test' }));
        expect('error' in result).toBe(true);
    });
});

// ─── RPC Handler Tests ───────────────────────────────────────

describe('handleRPCRequest', () => {
    beforeEach(() => {
        clearTaskStore();
    });

    it('should handle tasks/send successfully', async () => {
        const supervisor = createMockSupervisor({ result: 'Hello from Tars!' });

        const response = await handleRPCRequest(
            {
                jsonrpc: '2.0',
                id: 1,
                method: 'tasks/send',
                params: {
                    message: {
                        role: 'user',
                        parts: [{ text: 'What is 2+2?' }]
                    }
                }
            },
            supervisor
        );

        expect(response.error).toBeUndefined();
        expect(response.result).toBeDefined();

        const task = response.result as any;
        expect(task.status.state).toBe('completed');
        expect(task.artifacts).toHaveLength(1);
        expect(task.artifacts[0].parts[0].text).toBe('Hello from Tars!');
    });

    it('should reject when supervisor is busy', async () => {
        const supervisor = createMockSupervisor({ busy: true });

        const response = await handleRPCRequest(
            {
                jsonrpc: '2.0',
                id: 1,
                method: 'tasks/send',
                params: {
                    message: {
                        role: 'user',
                        parts: [{ text: 'test' }]
                    }
                }
            },
            supervisor
        );

        const task = response.result as any;
        expect(task.status.state).toBe('rejected');
    });

    it('should handle execution errors gracefully', async () => {
        const supervisor = createMockSupervisor({ error: new Error('Model exploded') });

        const response = await handleRPCRequest(
            {
                jsonrpc: '2.0',
                id: 1,
                method: 'tasks/send',
                params: {
                    message: {
                        role: 'user',
                        parts: [{ text: 'test' }]
                    }
                }
            },
            supervisor
        );

        const task = response.result as any;
        expect(task.status.state).toBe('failed');
    });

    it('should reject tasks/send with no message parts', async () => {
        const supervisor = createMockSupervisor();

        const response = await handleRPCRequest(
            {
                jsonrpc: '2.0',
                id: 1,
                method: 'tasks/send',
                params: {
                    message: { role: 'user', parts: [] }
                }
            },
            supervisor
        );

        expect(response.error).toBeDefined();
        expect(response.error?.code).toBe(-32600);
    });

    it('should store and retrieve tasks via tasks/get', async () => {
        const supervisor = createMockSupervisor({ result: 'Stored result' });

        // Create a task
        const sendResponse = await handleRPCRequest(
            {
                jsonrpc: '2.0',
                id: 1,
                method: 'tasks/send',
                params: {
                    message: {
                        role: 'user',
                        parts: [{ text: 'store this' }]
                    },
                    metadata: { taskId: 'test-task-123' }
                }
            },
            supervisor
        );

        const sentTask = sendResponse.result as any;
        expect(sentTask.id).toBe('test-task-123');

        // Retrieve the task
        const getResponse = await handleRPCRequest(
            {
                jsonrpc: '2.0',
                id: 2,
                method: 'tasks/get',
                params: { id: 'test-task-123' }
            },
            supervisor
        );

        expect(getResponse.error).toBeUndefined();
        const retrievedTask = getResponse.result as any;
        expect(retrievedTask.id).toBe('test-task-123');
        expect(retrievedTask.status.state).toBe('completed');
    });

    it('should return error for unknown task in tasks/get', async () => {
        const supervisor = createMockSupervisor();

        const response = await handleRPCRequest(
            {
                jsonrpc: '2.0',
                id: 1,
                method: 'tasks/get',
                params: { id: 'nonexistent' }
            },
            supervisor
        );

        expect(response.error).toBeDefined();
        expect(response.error?.code).toBe(-32001);
    });

    it('should handle tasks/cancel', async () => {
        const supervisor = createMockSupervisor({ result: 'done' });

        // Create task
        await handleRPCRequest(
            {
                jsonrpc: '2.0',
                id: 1,
                method: 'tasks/send',
                params: {
                    message: { role: 'user', parts: [{ text: 'test' }] },
                    metadata: { taskId: 'cancel-me' }
                }
            },
            supervisor
        );

        // Cancel it (already completed, so should be a no-op)
        const cancelResponse = await handleRPCRequest(
            {
                jsonrpc: '2.0',
                id: 2,
                method: 'tasks/cancel',
                params: { id: 'cancel-me' }
            },
            supervisor
        );

        expect(cancelResponse.error).toBeUndefined();
        const task = cancelResponse.result as any;
        // Already completed, so cancel is a no-op
        expect(task.status.state).toBe('completed');
    });

    it('should return error for unknown method', async () => {
        const supervisor = createMockSupervisor();

        const response = await handleRPCRequest(
            {
                jsonrpc: '2.0',
                id: 1,
                method: 'unknown/method'
            },
            supervisor
        );

        expect(response.error).toBeDefined();
        expect(response.error?.code).toBe(-32601);
    });

    it('should track tasks in the store', async () => {
        const supervisor = createMockSupervisor({ result: 'ok' });

        expect(getTaskStoreSize()).toBe(0);

        await handleRPCRequest(
            {
                jsonrpc: '2.0',
                id: 1,
                method: 'tasks/send',
                params: {
                    message: { role: 'user', parts: [{ text: 'test' }] }
                }
            },
            supervisor
        );

        expect(getTaskStoreSize()).toBe(1);
    });
});
