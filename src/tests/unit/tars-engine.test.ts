import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TarsEngine } from '../../supervisor/tars-engine.js';
import { Config as TarsConfig } from '../../config/config.js';
import fs from 'fs';
import path from 'path';
import { loadSkills, formatSkillsForPrompt } from '@earendil-works/pi-coding-agent';

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
