import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GeminiEngine } from '../../supervisor/gemini-engine.js';
import { Config as TarsConfig } from '../../config/config.js';
import fs from 'fs';
import path from 'path';

vi.mock('fs');

describe('GeminiEngine', () => {
    let engine: GeminiEngine;
    let mockTarsConfig: TarsConfig;

    beforeEach(() => {
        vi.clearAllMocks();
        mockTarsConfig = {
            homeDir: '/mock/home',
            geminiModel: 'gemini-pro',
            piProvider: 'openai',
            piModel: 'gpt-4o',
            systemPromptPath: '/mock/home/.gemini/system.md'
        } as any;
        engine = new GeminiEngine(mockTarsConfig);
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
});
