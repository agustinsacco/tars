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

    describe('Streaming with Deferred Usage', () => {
        /**
         * Helper to create a mock SSE ReadableStream from an array of SSE data lines.
         * Simulates the real OpenAI streaming protocol.
         */
        function createSSEStream(chunks: string[]): ReadableStream<Uint8Array> {
            const encoder = new TextEncoder();
            let index = 0;
            return new ReadableStream({
                pull(controller) {
                    if (index < chunks.length) {
                        controller.enqueue(encoder.encode(chunks[index] + '\n'));
                        index++;
                    } else {
                        controller.close();
                    }
                }
            });
        }

        it('should carry deferred usage from a separate final SSE chunk to the finishReason chunk', async () => {
            // OpenAI protocol: finishReason chunk comes first WITHOUT usage,
            // then a usage-only chunk follows with choices=[]
            const sseLines = [
                'data: {"choices":[{"delta":{"content":"Hello"},"finish_reason":null}]}',
                'data: {"choices":[{"delta":{"content":" world"},"finish_reason":"stop"}]}',
                'data: {"choices":[],"usage":{"prompt_tokens":100,"completion_tokens":20,"total_tokens":120}}',
                'data: [DONE]'
            ];

            (global.fetch as any).mockResolvedValue({
                ok: true,
                body: createSSEStream(sseLines)
            });

            const request: any = {
                model: 'qwen35',
                contents: [{ role: 'user', parts: [{ text: 'Hi' }] }],
                config: { temperature: 0.5 }
            };

            const stream = await generator.generateContentStream(request, 'prompt-id');
            const responses: any[] = [];
            for await (const chunk of stream) {
                responses.push(chunk);
            }

            // Should have yielded chunks for content + finish + usage
            expect(responses.length).toBeGreaterThanOrEqual(2);

            // The finish chunk should exist
            const finishChunk = responses.find(
                (r) => r.candidates?.[0]?.finishReason === 'STOP'
            );
            expect(finishChunk).toBeDefined();

            // Usage should appear in the stream (may be on finishReason chunk
            // if it arrived before, or as a separate chunk if it arrived after).
            // The engine's accumulator captures it from ANY chunk.
            const usageChunk = responses.find((r) => r.usageMetadata);
            expect(usageChunk).toBeDefined();
            expect(usageChunk.usageMetadata.promptTokenCount).toBe(100);
            expect(usageChunk.usageMetadata.candidatesTokenCount).toBe(20);
        });

        it('should handle usage arriving BEFORE finishReason (some servers)', async () => {
            // Some servers send usage on intermediate chunks
            const sseLines = [
                'data: {"choices":[{"delta":{"content":"Hi"},"finish_reason":null}],"usage":{"prompt_tokens":50,"completion_tokens":5}}',
                'data: {"choices":[{"delta":{"content":"!"},"finish_reason":"stop"}]}',
                'data: [DONE]'
            ];

            (global.fetch as any).mockResolvedValue({
                ok: true,
                body: createSSEStream(sseLines)
            });

            const request: any = {
                model: 'llama3',
                contents: [{ role: 'user', parts: [{ text: 'Hi' }] }],
                config: {}
            };

            const stream = await generator.generateContentStream(request, 'prompt-id');
            const responses: any[] = [];
            for await (const chunk of stream) {
                responses.push(chunk);
            }

            // The finish chunk should have the deferred usage injected
            const finishChunk = responses.find(
                (r) => r.candidates?.[0]?.finishReason === 'STOP'
            );
            expect(finishChunk).toBeDefined();
            expect(finishChunk.usageMetadata).toBeDefined();
            expect(finishChunk.usageMetadata.promptTokenCount).toBe(50);
        });

        it('should aggregate tool calls across multiple stream chunks with usage', async () => {
            const sseLines = [
                'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"name":"get_weather","arguments":""}}]},"finish_reason":null}]}',
                'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"city\\":"}}]},"finish_reason":null}]}',
                'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"London\\"}"}}]},"finish_reason":"tool_calls"}]}',
                'data: {"choices":[],"usage":{"prompt_tokens":200,"completion_tokens":30,"total_tokens":230}}',
                'data: [DONE]'
            ];

            (global.fetch as any).mockResolvedValue({
                ok: true,
                body: createSSEStream(sseLines)
            });

            const request: any = {
                model: 'qwen35',
                contents: [{ role: 'user', parts: [{ text: 'weather?' }] }],
                config: {}
            };

            const stream = await generator.generateContentStream(request, 'prompt-id');
            const responses: any[] = [];
            for await (const chunk of stream) {
                responses.push(chunk);
            }

            // Should have a response with the assembled tool call
            const toolChunk = responses.find((r) => r.functionCalls?.length > 0);
            expect(toolChunk).toBeDefined();
            expect(toolChunk.functionCalls[0].name).toBe('get_weather');
            expect(toolChunk.functionCalls[0].args).toEqual({ city: 'London' });

            // Usage should appear somewhere in the stream
            const usageChunk = responses.find((r) => r.usageMetadata);
            expect(usageChunk).toBeDefined();
            expect(usageChunk.usageMetadata.promptTokenCount).toBe(200);
        });

        it('should filter <think> tags from streamed content', async () => {
            const sseLines = [
                'data: {"choices":[{"delta":{"content":"<think>internal reasoning</think>Visible text"},"finish_reason":null}]}',
                'data: {"choices":[{"delta":{"content":""},"finish_reason":"stop"}]}',
                'data: [DONE]'
            ];

            (global.fetch as any).mockResolvedValue({
                ok: true,
                body: createSSEStream(sseLines)
            });

            const request: any = {
                model: 'qwen35',
                contents: [{ role: 'user', parts: [{ text: 'test' }] }],
                config: {}
            };

            const stream = await generator.generateContentStream(request, 'prompt-id');
            const responses: any[] = [];
            for await (const chunk of stream) {
                responses.push(chunk);
            }

            // Should only have visible text, not the think content
            const textChunks = responses.filter(
                (r) => r.candidates?.[0]?.content?.parts?.some((p: any) => p.text)
            );
            const allText = textChunks
                .flatMap((r: any) => r.candidates[0].content.parts)
                .map((p: any) => p.text)
                .join('');
            expect(allText).toBe('Visible text');
            expect(allText).not.toContain('<think>');
        });

        it('should handle stream with no usage data at all', async () => {
            const sseLines = [
                'data: {"choices":[{"delta":{"content":"Hello"},"finish_reason":"stop"}]}',
                'data: [DONE]'
            ];

            (global.fetch as any).mockResolvedValue({
                ok: true,
                body: createSSEStream(sseLines)
            });

            const request: any = {
                model: 'basic-model',
                contents: [{ role: 'user', parts: [{ text: 'Hi' }] }],
                config: {}
            };

            const stream = await generator.generateContentStream(request, 'prompt-id');
            const responses: any[] = [];
            for await (const chunk of stream) {
                responses.push(chunk);
            }

            // Should still work, just without usage metadata
            expect(responses.length).toBeGreaterThanOrEqual(1);
            const finishChunk = responses.find(
                (r) => r.candidates?.[0]?.finishReason === 'STOP'
            );
            expect(finishChunk).toBeDefined();
            expect(finishChunk.usageMetadata).toBeUndefined();
        });
    });
});
