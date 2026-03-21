import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LlamaCppGenerator } from '../../inference/LlamaCppGenerator.js';

describe('LlamaCppGenerator', () => {
    let generator: LlamaCppGenerator;
    const baseUrl = 'http://localhost:8080';

    beforeEach(() => {
        generator = new LlamaCppGenerator(baseUrl);
        // Mock global fetch
        global.fetch = vi.fn();
    });

    it('should map Gemini request to OpenAI format and return mapped response', async () => {
        const mockResponse = {
            choices: [
                {
                    message: {
                        content: 'Hello from local Llama!',
                        tool_calls: null
                    },
                    finish_reason: 'stop'
                }
            ],
            usage: {
                prompt_tokens: 10,
                completion_tokens: 5,
                total_tokens: 15
            }
        };

        (global.fetch as any).mockResolvedValue({
            ok: true,
            json: async () => mockResponse
        });

        const request: any = {
            model: 'llama3',
            contents: [{ role: 'user', parts: [{ text: 'Hi' }] }],
            config: { temperature: 0.5 }
        };

        const result = await generator.generateContent(request, 'prompt-id');

        expect(global.fetch).toHaveBeenCalledWith(
            `${baseUrl}/v1/chat/completions`,
            expect.objectContaining({
                method: 'POST',
                body: expect.stringContaining('"model":"llama3"')
            })
        );

        expect(result.candidates?.[0]?.content?.parts?.[0]?.text).toBe('Hello from local Llama!');
        expect(result.usageMetadata?.totalTokenCount).toBe(15);
    });

    it('should handle tool calls in mapping', async () => {
        const mockResponse = {
            choices: [
                {
                    message: {
                        content: null,
                        tool_calls: [
                            {
                                function: {
                                    name: 'get_weather',
                                    arguments: '{"location":"London"}'
                                }
                            }
                        ]
                    },
                    finish_reason: 'tool_calls'
                }
            ]
        };

        (global.fetch as any).mockResolvedValue({
            ok: true,
            json: async () => mockResponse
        });

        const request: any = {
            model: 'llama3',
            contents: [{ role: 'user', parts: [{ text: 'What is the weather?' }] }],
            config: {
                tools: [
                    {
                        functionDeclarations: [
                            {
                                name: 'get_weather',
                                description: 'Get weather',
                                parameters: {}
                            }
                        ]
                    }
                ]
            }
        };

        const result = await generator.generateContent(request, 'prompt-id');

        const functionCall = result.candidates?.[0]?.content?.parts?.[0]?.functionCall;
        expect(functionCall?.name).toBe('get_weather');
        expect(functionCall?.args).toEqual({ location: 'London' });
    });

    it('should estimate tokens correctly', async () => {
        const request: any = {
            contents: [{ parts: [{ text: 'Hello world' }] }]
        };
        const result = await generator.countTokens(request);
        // "Hello world" is 11 chars, 11/4 = 2.75 -> 3
        expect(result.totalTokens).toBe(3);
    });
});
