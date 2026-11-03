import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    findCompactionCutIndex,
    parseAgentHistory,
    repairToolCallPairing,
    resolveSessionHistoryPath,
    TarsEngine
} from '../../supervisor/tars-engine.js';
import { type Config as TarsConfig } from '../../config/config.js';
import { type ModelSource } from '../../supervisor/model-manager.js';
import fs from 'fs';
import path from 'path';
import { loadSkills, formatSkillsForPrompt } from '@earendil-works/pi-coding-agent';
import { Agent, type AgentMessage, type AgentOptions } from '@earendil-works/pi-agent-core';
import { type Api, type Model } from '@earendil-works/pi-ai';

const stubModel: Model<Api> = {
    id: 'gpt-4o',
    name: 'gpt-4o',
    api: 'openai-completions',
    provider: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    reasoning: false,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128000,
    maxTokens: 32000
};

const stubModelSource: ModelSource = {
    getModel: async () => stubModel,
    stream: async () => {
        throw new Error('stream is not expected in these tests');
    }
};

vi.mock('fs');
vi.mock('@earendil-works/pi-coding-agent', async (importOriginal) => {
    const original = await importOriginal<any>();
    return {
        ...original,
        loadSkills: vi.fn(),
        formatSkillsForPrompt: vi.fn()
    };
});

const user = (text: string): AgentMessage => ({ role: 'user', content: text, timestamp: 1 });
const assistantCall = (id: string): AgentMessage =>
    ({
        role: 'assistant',
        content: [{ type: 'toolCall', id, name: 'bash', arguments: {} }],
        api: 'openai-codex-responses',
        provider: 'openai-codex',
        model: 'stub',
        usage: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
        },
        stopReason: 'toolUse',
        timestamp: 1
    }) as AgentMessage;
const toolResult = (id: string): AgentMessage => ({
    role: 'toolResult',
    toolCallId: id,
    toolName: 'bash',
    content: [{ type: 'text', text: `output of ${id}` }],
    isError: false,
    timestamp: 1
});

/** A user turn followed by one long tool chain, the shape that broke compaction. */
function longToolChain(steps: number): AgentMessage[] {
    const history: AgentMessage[] = [user('install the model')];
    for (let i = 0; i < steps; i++)
        history.push(assistantCall(`call_${i}`), toolResult(`call_${i}`));
    return history;
}

function unpaired(history: AgentMessage[]): string[] {
    const calls = new Set(
        history.flatMap((m) =>
            m.role === 'assistant'
                ? m.content.flatMap((p) => (p.type === 'toolCall' ? [p.id] : []))
                : []
        )
    );
    const results = new Set(
        history.flatMap((m) => (m.role === 'toolResult' ? [m.toolCallId] : []))
    );
    return [
        ...[...results].filter((id) => !calls.has(id)),
        ...[...calls].filter((id) => !results.has(id))
    ];
}

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
            const failingEngine = new TarsEngine(mockTarsConfig, agentFactory, stubModelSource);
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

        it('keeps ephemeral background runs out of persisted chat history', async () => {
            // ARRANGE
            const agentFactory = (options: AgentOptions): Agent => {
                const agent = new Agent(options);
                vi.spyOn(agent, 'prompt').mockResolvedValue(undefined);
                return agent;
            };
            const backgroundEngine = new TarsEngine(mockTarsConfig, agentFactory, stubModelSource);
            Reflect.set(backgroundEngine, 'initialized', true);
            const loadHistory = vi.fn().mockResolvedValue([]);
            const saveHistory = vi.fn().mockResolvedValue(undefined);
            Reflect.set(backgroundEngine, 'loadHistory', loadHistory);
            Reflect.set(backgroundEngine, 'saveHistory', saveHistory);
            vi.mocked(loadSkills).mockReturnValue({ skills: [], diagnostics: [] });

            // ACT
            await backgroundEngine.run(
                'scheduled task',
                vi.fn(),
                '00000000-0000-4000-8000-000000000001',
                undefined,
                undefined,
                { allowNotifications: false, ephemeral: true }
            );

            // ASSERT
            expect(loadHistory).not.toHaveBeenCalled();
            expect(saveHistory).not.toHaveBeenCalled();
        });
    });

    describe('compaction tool pairing', () => {
        it('never starts the kept tail on a tool result during a long tool chain', () => {
            // ARRANGE
            const history = longToolChain(10); // no user message after index 0

            // ACT
            const cut = findCompactionCutIndex(history, Math.ceil(history.length * 0.6));

            // ASSERT
            expect(cut).toBeGreaterThan(0);
            expect(history[cut]?.role).toBe('assistant');
            expect(unpaired(history.slice(cut))).toEqual([]);
        });

        it('prefers a user boundary, then the next assistant turn', () => {
            // ARRANGE
            const history = [
                user('a'),
                assistantCall('c1'),
                toolResult('c1'),
                user('b'),
                assistantCall('c2'),
                toolResult('c2'),
                assistantCall('c3'),
                toolResult('c3')
            ];

            // ACT / ASSERT
            expect(findCompactionCutIndex(history, 6)).toBe(3); // user ahead of index 2
            expect(findCompactionCutIndex(history, 3)).toBe(6); // no user ahead of index 5
            expect(findCompactionCutIndex(history, 1)).toBe(6); // only results ahead of 7
        });

        it('turns an orphaned tool result into a user message that keeps its output', () => {
            // ARRANGE
            const history = [
                user('snapshot'),
                toolResult('gone'),
                assistantCall('c1'),
                toolResult('c1')
            ];

            // ACT
            const { history: repaired, repairs } = repairToolCallPairing(history);

            // ASSERT
            expect(repairs).toBe(1);
            expect(repaired[1]).toMatchObject({ role: 'user' });
            expect(repaired[1]?.role === 'user' && repaired[1].content).toContain('output of gone');
            expect(unpaired(repaired)).toEqual([]);
        });

        it('adds a placeholder result for a tool call that never got one', () => {
            // ARRANGE
            const history = [user('go'), assistantCall('c1')];

            // ACT
            const { history: repaired, repairs } = repairToolCallPairing(history);

            // ASSERT
            expect(repairs).toBe(1);
            expect(repaired[2]).toMatchObject({
                role: 'toolResult',
                toolCallId: 'c1',
                isError: true
            });
        });

        it('places placeholders after the results an assistant turn did receive', () => {
            // ARRANGE
            const multiCall: AgentMessage = {
                ...assistantCall('c1'),
                content: [
                    { type: 'toolCall', id: 'c1', name: 'bash', arguments: {} },
                    { type: 'toolCall', id: 'c2', name: 'bash', arguments: {} }
                ]
            } as AgentMessage;
            const history = [user('go'), multiCall, toolResult('c1'), user('next')];

            // ACT
            const { history: repaired, repairs } = repairToolCallPairing(history);

            // ASSERT
            expect(repairs).toBe(1);
            expect(
                repaired.map((m) => (m.role === 'toolResult' ? `result:${m.toolCallId}` : m.role))
            ).toEqual(['user', 'assistant', 'result:c1', 'result:c2', 'user']);
        });

        it.each(['error', 'aborted'] as const)(
            'leaves a %s assistant turn alone, since the Pi SDK drops it before sending',
            (stopReason) => {
                // ARRANGE: pi-ai's transformMessages strips errored/aborted turns
                // before the request is built, so a placeholder result for their
                // calls would reach the provider as an orphan.
                const failed = { ...assistantCall('c1'), stopReason } as AgentMessage;
                const history = [user('go'), failed, user('try again')];

                // ACT
                const { history: repaired, repairs } = repairToolCallPairing(history);

                // ASSERT
                expect(repairs).toBe(0);
                expect(repaired).toBe(history);
            }
        );

        it('returns well-formed history untouched', () => {
            const history = longToolChain(3);
            const result = repairToolCallPairing(history);
            expect(result.repairs).toBe(0);
            expect(result.history).toBe(history);
        });

        it('compresses a long tool chain into history with no unpaired tool calls', async () => {
            // ARRANGE
            const summarizerInputs: AgentMessage[][] = [];
            const modelSource: ModelSource = {
                getModel: async () => stubModel,
                stream: (async (_model: unknown, context: { messages: AgentMessage[] }) => {
                    summarizerInputs.push(context.messages);
                    return (async function* () {
                        yield { type: 'text_delta', delta: 'summary' };
                    })();
                }) as unknown as ModelSource['stream']
            };
            const compactingEngine = new TarsEngine(mockTarsConfig, undefined, modelSource);
            const history = [user('<state_snapshot>old</state_snapshot>'), ...longToolChain(36)];
            let saved: AgentMessage[] = [];
            Reflect.set(compactingEngine, 'loadHistory', vi.fn().mockResolvedValue(history));
            Reflect.set(
                compactingEngine,
                'saveHistory',
                vi.fn(async (_sid: string, messages: AgentMessage[]) => {
                    saved = messages;
                })
            );
            Reflect.set(compactingEngine, 'flushMemoryBeforeCompression', vi.fn());

            // ACT
            const compressed = await compactingEngine.compressSession(true, 'session-123');

            // ASSERT
            expect(compressed).toBe(true);
            expect(saved.length).toBeLessThan(history.length);
            expect(unpaired(saved)).toEqual([]);
            expect(summarizerInputs[0] && unpaired(summarizerInputs[0])).toEqual([]);
        });
    });

    describe('thinking level', () => {
        async function runWithThinkingLevel(
            level: string,
            reasoning: boolean
        ): Promise<AgentOptions['initialState']> {
            let captured: AgentOptions['initialState'];
            const agentFactory = (options: AgentOptions): Agent => {
                captured = options.initialState;
                const agent = new Agent(options);
                vi.spyOn(agent, 'prompt').mockResolvedValue(undefined);
                return agent;
            };
            const modelSource: ModelSource = {
                getModel: async () => ({ ...stubModel, reasoning }),
                stream: stubModelSource.stream
            };
            const thinkingEngine = new TarsEngine(
                { ...mockTarsConfig, piThinkingLevel: level } as any,
                agentFactory,
                modelSource
            );
            Reflect.set(thinkingEngine, 'initialized', true);
            Reflect.set(thinkingEngine, 'loadHistory', vi.fn().mockResolvedValue([]));
            Reflect.set(thinkingEngine, 'saveHistory', vi.fn().mockResolvedValue(undefined));
            vi.mocked(loadSkills).mockReturnValue({ skills: [], diagnostics: [] });
            await thinkingEngine.run('hello', vi.fn(), '00000000-0000-4000-8000-000000000002');
            return captured;
        }

        it('passes the configured level to reasoning models', async () => {
            // ACT
            const state = await runWithThinkingLevel('medium', true);

            // ASSERT
            expect(state?.thinkingLevel).toBe('medium');
        });

        it('keeps reasoning off for models without reasoning support', async () => {
            // ACT
            const state = await runWithThinkingLevel('medium', false);

            // ASSERT
            expect(state?.thinkingLevel).toBe('off');
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
