import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    parseAgentHistory,
    resolveSessionHistoryPath,
    TarsEngine
} from '../../supervisor/tars-engine.js';
import { type Config as TarsConfig } from '../../config/config.js';
import fs from 'fs';
import path from 'path';
import { loadSkills, formatSkillsForPrompt } from '@earendil-works/pi-coding-agent';
import { Agent, type AgentOptions } from '@earendil-works/pi-agent-core';

vi.mock('fs');
vi.mock('@earendil-works/pi-coding-agent', async (importOriginal) => {
    const original = await importOriginal<any>();
    return {
        ...original,
        loadSkills: vi.fn(),
        formatSkillsForPrompt: vi.fn()
    };
});

describe('TarsEngine', () => {
    let engine: TarsEngine;
    let mockTarsConfig: TarsConfig;

    beforeEach(() => {
        vi.clearAllMocks();
        mockTarsConfig = {
            homeDir: '/mock/home',
            geminiModel: 'gemini-pro',
            piProvider: 'openai',
            piModel: 'gpt-4o',
            systemPromptPath: '/mock/home/system.md'
        } as any;
        engine = new TarsEngine(mockTarsConfig);
    });

    describe('session history paths', () => {
        it('keeps safe IDs inside the chats directory and rejects traversal', () => {
            // ARRANGE
            const chatsDir = '/mock/home/chats';

            // ACT / ASSERT
            expect(resolveSessionHistoryPath(chatsDir, 'session-123')).toBe(
                path.join(chatsDir, 'session-123.json')
            );
            expect(() => resolveSessionHistoryPath(chatsDir, '../../outside')).toThrow(
                /Session ID/
            );
        });

        it('rejects a mixed or future history instead of silently dropping it', () => {
            // ARRANGE
            const history = [
                { role: 'user', content: 'preserve me', timestamp: 1 },
                { role: 'future-role', content: 'unsupported' }
            ];

            // ACT / ASSERT
            expect(() => parseAgentHistory(history)).toThrow();
            expect(() => parseAgentHistory('{not-json}')).toThrow();
        });

        it('preserves complete pi-ai message variants and supported metadata', () => {
            // ARRANGE
            const history = [
                {
                    role: 'user',
                    content: [
                        { type: 'text', text: 'hello', textSignature: 'signed' },
                        { type: 'image', data: 'aW1hZ2U=', mimeType: 'image/png' }
                    ],
                    timestamp: 1
                },
                {
                    role: 'assistant',
                    content: [
                        { type: 'text', text: 'working' },
                        { type: 'thinking', thinking: 'reasoning', redacted: false },
                        {
                            type: 'toolCall',
                            id: 'call-1',
                            name: 'lookup',
                            arguments: { query: 'value' }
                        }
                    ],
                    api: 'openai-responses',
                    provider: 'openai',
                    model: 'gpt-test',
                    responseModel: 'gpt-test-2026',
                    responseId: 'response-1',
                    diagnostics: [
                        {
                            type: 'transport_retry',
                            timestamp: 2,
                            error: { message: 'retrying', code: 'ETIMEDOUT' },
                            details: { attempt: 1 }
                        }
                    ],
                    usage: {
                        input: 10,
                        output: 5,
                        cacheRead: 2,
                        cacheWrite: 1,
                        cacheWrite1h: 1,
                        totalTokens: 18,
                        cost: {
                            input: 0.1,
                            output: 0.2,
                            cacheRead: 0.01,
                            cacheWrite: 0.02,
                            total: 0.33
                        }
                    },
                    stopReason: 'toolUse',
                    timestamp: 2,
                    providerMetadata: { preserved: true }
                },
                {
                    role: 'toolResult',
                    toolCallId: 'call-1',
                    toolName: 'lookup',
                    content: [{ type: 'text', text: 'result' }],
                    details: { source: 'fixture' },
                    isError: false,
                    timestamp: 3
                }
            ];

            // ACT
            const parsed = parseAgentHistory(history);

            // ASSERT
            expect(parsed).toEqual(history);
        });

        it('rejects malformed content for every persisted message role', () => {
            // ARRANGE
            const assistantBase = {
                role: 'assistant',
                api: 'openai-responses',
                provider: 'openai',
                model: 'gpt-test',
                usage: {
                    input: 0,
                    output: 0,
                    cacheRead: 0,
                    cacheWrite: 0,
                    totalTokens: 0,
                    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
                },
                stopReason: 'stop',
                timestamp: 1
            };
            const malformedHistories = [
                [{ role: 'user', content: 42, timestamp: 1 }],
                [{ ...assistantBase, content: null }],
                [
                    {
                        role: 'toolResult',
                        toolCallId: 'call-1',
                        toolName: 'lookup',
                        content: [{ type: 'thinking', thinking: 'not valid in a tool result' }],
                        isError: false,
                        timestamp: 1
                    }
                ],
                [
                    {
                        ...assistantBase,
                        content: [
                            {
                                type: 'toolCall',
                                id: 'call-1',
                                name: 'lookup',
                                arguments: 'not an object'
                            }
                        ]
                    }
                ]
            ];

            // ACT / ASSERT
            for (const history of malformedHistories) {
                expect(() => parseAgentHistory(history)).toThrow();
            }
        });

        it('rejects persisted messages with missing required fields', () => {
            // ARRANGE
            const incompleteHistories = [
                [{ role: 'user', content: 'missing timestamp' }],
                [
                    {
                        role: 'assistant',
                        content: [{ type: 'text', text: 'missing usage' }],
                        api: 'openai-responses',
                        provider: 'openai',
                        model: 'gpt-test',
                        stopReason: 'stop',
                        timestamp: 1
                    }
                ],
                [
                    {
                        role: 'toolResult',
                        toolCallId: 'call-1',
                        toolName: 'lookup',
                        content: [{ type: 'text', text: 'missing isError' }],
                        timestamp: 1
                    }
                ]
            ];

            // ACT / ASSERT
            for (const history of incompleteHistories) {
                expect(() => parseAgentHistory(history)).toThrow();
            }
        });
    });

    describe('provider errors', () => {
        it('rejects a failed agent turn without saving history or emitting done', async () => {
            // ARRANGE
            const secret = 'sk-proj-1234567890abcdefghijklmnopqrstuvwxyz';
            const agentFactory = (options: AgentOptions): Agent => {
                const agent = new Agent(options);
                vi.spyOn(agent, 'prompt').mockImplementation(async () => {
                    Object.defineProperty(agent.state, 'errorMessage', {
                        configurable: true,
                        value: `Provider failed with ${secret}`
                    });
                });
                return agent;
            };
            const failingEngine = new TarsEngine(mockTarsConfig, agentFactory);
            Reflect.set(failingEngine, 'initialized', true);
            const saveHistory = vi.fn();
            Reflect.set(failingEngine, 'saveHistory', saveHistory);
            const onEvent = vi.fn();
            vi.mocked(loadSkills).mockReturnValue({ skills: [], diagnostics: [] });

            let caughtError: unknown;

            // ACT
            try {
                await failingEngine.run('hello', onEvent, 'session-123');
            } catch (error: unknown) {
                caughtError = error;
            }

            // ASSERT
            expect(caughtError).toBeInstanceOf(Error);
            if (!(caughtError instanceof Error)) throw new Error('Expected run to reject');
            expect(caughtError.message).toContain('Provider failed');
            expect(caughtError.message).not.toContain(secret);
            expect(onEvent).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'done' }));
            expect(saveHistory).not.toHaveBeenCalled();
        });
    });

    describe('migrateLegacyConversation', () => {
        it('should convert user and assistant messages', () => {
            const conversation = {
                messages: [
                    { type: 'user', content: 'Hello' },
                    { type: 'gemini', content: 'Hi there' }
                ]
            };

            const history = (engine as any).migrateLegacyConversation(conversation);

            expect(history).toHaveLength(2);
            expect(history[0]).toMatchObject({
                role: 'user',
                content: 'Hello'
            });
            expect(history[1]).toMatchObject({
                role: 'assistant',
                content: [{ type: 'text', text: 'Hi there' }]
            });
        });

        it('should convert tool calls and generate tool result messages', () => {
            const conversation = {
                messages: [
                    {
                        type: 'gemini',
                        content: '',
                        toolCalls: [
                            {
                                id: 'call-1',
                                name: 'get_weather',
                                args: { location: 'London' },
                                status: 'done',
                                result: { temperature: 20 }
                            }
                        ]
                    }
                ]
            };

            const history = (engine as any).migrateLegacyConversation(conversation);

            expect(history).toHaveLength(2);
            expect(history[0].role).toBe('assistant');
            expect(history[0].content[0]).toEqual({
                type: 'toolCall',
                id: 'call-1',
                name: 'get_weather',
                arguments: { location: 'London' }
            });

            expect(history[1].role).toBe('toolResult');
            expect(history[1].toolCallId).toBe('call-1');
            expect(history[1].toolName).toBe('get_weather');
            expect(history[1].details).toEqual({ temperature: 20 });
        });

        it('should handle string results and parse them if possible', () => {
            const conversation = {
                messages: [
                    {
                        type: 'gemini',
                        content: '',
                        toolCalls: [
                            {
                                id: 'call-1',
                                name: 'get_weather',
                                args: { location: 'London' },
                                status: 'done',
                                result: '{"temperature":20}'
                            }
                        ]
                    }
                ]
            };

            const history = (engine as any).migrateLegacyConversation(conversation);

            expect(history[1].details).toEqual({ temperature: 20 });
        });

        it('should skip malformed legacy entries without dropping valid messages', () => {
            const conversation = {
                messages: [
                    { type: 'user', content: 'Before' },
                    { type: 'unsupported', content: 'Ignore me' },
                    null,
                    { type: 'gemini', content: 'After' }
                ]
            };

            const history = (engine as any).migrateLegacyConversation(conversation);

            expect(history).toHaveLength(2);
            expect(history[0]).toMatchObject({ role: 'user', content: 'Before' });
            expect(history[1]).toMatchObject({
                role: 'assistant',
                content: [{ type: 'text', text: 'After' }]
            });
        });
    });

    describe('getSystemPrompt', () => {
        beforeEach(() => {
            vi.mocked(loadSkills).mockReset();
            vi.mocked(formatSkillsForPrompt).mockReset();
        });

        it('should return base system prompt when no skills are available', () => {
            vi.mocked(fs.existsSync).mockReturnValue(true);
            vi.mocked(fs.readFileSync).mockReturnValue('Base system prompt content');
            vi.mocked(loadSkills).mockReturnValue({ skills: [], diagnostics: [] });

            const systemPrompt = (engine as any).getSystemPrompt();

            expect(systemPrompt).toBe('Base system prompt content');
            expect(loadSkills).toHaveBeenCalledWith(
                expect.objectContaining({
                    agentDir: '/mock/home',
                    includeDefaults: true
                })
            );
        });

        it('should append formatted skills when skills are loaded', () => {
            vi.mocked(fs.existsSync).mockReturnValue(true);
            vi.mocked(fs.readFileSync).mockReturnValue('Base system prompt content');

            const mockSkill = {
                name: 'test-skill',
                description: 'test description',
                filePath: '/mock/home/skills/test-skill/SKILL.md',
                baseDir: '/mock/home/skills/test-skill',
                sourceInfo: {} as any,
                disableModelInvocation: false
            };
            vi.mocked(loadSkills).mockReturnValue({ skills: [mockSkill], diagnostics: [] });
            vi.mocked(formatSkillsForPrompt).mockReturnValue('\n\nAvailable skills:\n- test-skill');

            const systemPrompt = (engine as any).getSystemPrompt();

            expect(systemPrompt).toBe(
                'Base system prompt content\n\nAvailable skills:\n- test-skill'
            );
            expect(formatSkillsForPrompt).toHaveBeenCalledWith([mockSkill]);
        });

        it('should handle errors when loading skills and return base prompt', () => {
            vi.mocked(fs.existsSync).mockReturnValue(true);
            vi.mocked(fs.readFileSync).mockReturnValue('Base system prompt content');
            vi.mocked(loadSkills).mockImplementation(() => {
                throw new Error('Disk error');
            });

            const systemPrompt = (engine as any).getSystemPrompt();

            expect(systemPrompt).toBe('Base system prompt content');
            expect(formatSkillsForPrompt).not.toHaveBeenCalled();
        });
    });
});
