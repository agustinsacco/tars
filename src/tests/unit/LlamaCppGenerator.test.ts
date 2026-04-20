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
            const finishChunk = responses.find((r) => r.candidates?.[0]?.finishReason === 'STOP');
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
            const finishChunk = responses.find((r) => r.candidates?.[0]?.finishReason === 'STOP');
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
            const textChunks = responses.filter((r) =>
                r.candidates?.[0]?.content?.parts?.some((p: any) => p.text)
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
            const finishChunk = responses.find((r) => r.candidates?.[0]?.finishReason === 'STOP');
            expect(finishChunk).toBeDefined();
            expect(finishChunk.usageMetadata).toBeUndefined();
        });

        /**
         * Reproduces the exact failure from production: Qwen 3.6 with --reasoning on
         * emits <think> in content field, then </think>, then \n\n, then tool_calls.
         * The tool call has ID + args that must survive aggregation to resp.functionCalls.
         */
        it('should preserve tool call ID and args through thinking+tool_call stream (production repro)', async () => {
            // This is the exact SSE sequence captured from llama-server on stark
            const sseLines = [
                // Initial role chunk
                'data: {"choices":[{"finish_reason":null,"index":0,"delta":{"role":"assistant","content":null}}]}',
                // Think tag in content field (reasoning on mode still emits this)
                'data: {"choices":[{"finish_reason":null,"index":0,"delta":{"content":"<think>\\nThe user wants me to read a file."}}]}',
                // More thinking
                'data: {"choices":[{"finish_reason":null,"index":0,"delta":{"content":" Let me use read_file."}}]}',
                // End think + whitespace
                'data: {"choices":[{"finish_reason":null,"index":0,"delta":{"content":"</think>"}}]}',
                'data: {"choices":[{"finish_reason":null,"index":0,"delta":{"content":"\\n\\n"}}]}',
                // Tool call chunks with ID on first chunk
                'data: {"choices":[{"finish_reason":null,"index":0,"delta":{"tool_calls":[{"index":0,"id":"KYu2gneRtckrtMjG","type":"function","function":{"name":"read_file","arguments":"{"}}]}}]}',
                'data: {"choices":[{"finish_reason":null,"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"file_path\\":\\""}}]}}]}',
                'data: {"choices":[{"finish_reason":null,"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"/home/vim1/.tars/apps/sudoku/index.html"}}]}}]}',
                'data: {"choices":[{"finish_reason":null,"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\""}}]}}]}',
                'data: {"choices":[{"finish_reason":null,"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"}"}}]}}]}',
                // Finish with tool_calls reason
                'data: {"choices":[{"finish_reason":"tool_calls","index":0,"delta":{}}],"timings":{"prompt_n":283,"predicted_n":163}}',
                'data: [DONE]'
            ];

            (global.fetch as any).mockResolvedValue({
                ok: true,
                body: createSSEStream(sseLines)
            });

            const request: any = {
                model: 'Qwen3.6-35B-A3B-Q8_0.gguf',
                contents: [{ role: 'user', parts: [{ text: 'Review the sudoku game' }] }],
                config: {}
            };

            const stream = await generator.generateContentStream(request, 'prompt-id');
            const responses: any[] = [];
            for await (const chunk of stream) {
                responses.push(chunk);
            }

            // Must have a function call response
            const toolChunk = responses.find((r) => r.functionCalls?.length > 0);
            expect(toolChunk).toBeDefined();

            // The function call must have the correct name and POPULATED args
            const fc = toolChunk.functionCalls[0];
            expect(fc.name).toBe('read_file');
            expect(fc.args).toEqual({
                file_path: '/home/vim1/.tars/apps/sudoku/index.html'
            });

            // Must use `id` property (not `callId`) matching the model-generated ID
            expect(fc.id).toBe('KYu2gneRtckrtMjG');

            // Think content must NOT appear in the text output
            const textChunks = responses.filter((r) =>
                r.candidates?.[0]?.content?.parts?.some((p: any) => p.text)
            );
            const allText = textChunks
                .flatMap((r: any) => r.candidates[0].content.parts)
                .map((p: any) => p.text)
                .join('');
            expect(allText).not.toContain('<think>');
            expect(allText).not.toContain('read_file');
        });

        it('should set functionCall.id (not callId) for SDK compatibility', async () => {
            const sseLines = [
                'data: {"choices":[{"finish_reason":null,"index":0,"delta":{"tool_calls":[{"index":0,"id":"abc123","type":"function","function":{"name":"list_dir","arguments":"{"}}]}}]}',
                'data: {"choices":[{"finish_reason":null,"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"path\\":\\"/tmp\\""}}]}}]}',
                'data: {"choices":[{"finish_reason":null,"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"}"}}]}}]}',
                'data: {"choices":[{"finish_reason":"tool_calls","index":0,"delta":{}}]}',
                'data: [DONE]'
            ];

            (global.fetch as any).mockResolvedValue({
                ok: true,
                body: createSSEStream(sseLines)
            });

            const request: any = {
                model: 'test-model',
                contents: [{ role: 'user', parts: [{ text: 'list files' }] }],
                config: {}
            };

            const stream = await generator.generateContentStream(request, 'prompt-id');
            const responses: any[] = [];
            for await (const chunk of stream) {
                responses.push(chunk);
            }

            const toolChunk = responses.find((r) => r.functionCalls?.length > 0);
            expect(toolChunk).toBeDefined();

            const fc = toolChunk.functionCalls[0];
            // Must use `id` property — this is what turn.js reads via fnCall.id
            expect(fc.id).toBe('abc123');
            // `callId` must NOT be set (it causes turn.js to miss the ID)
            expect(fc.callId).toBeUndefined();
            expect(fc.args).toEqual({ path: '/tmp' });
        });

        it('should map tool call ID roundtrip through mapToOpenAi for tool responses', async () => {
            // Simulate a conversation where the model made a tool call with id="model-id-xyz",
            // and we're sending the response back
            const request: any = {
                model: 'test-model',
                contents: [
                    { role: 'user', parts: [{ text: 'read a file' }] },
                    {
                        role: 'model',
                        parts: [
                            {
                                functionCall: {
                                    name: 'read_file',
                                    args: { file_path: '/test.txt' },
                                    id: 'model-id-xyz'
                                }
                            }
                        ]
                    },
                    {
                        role: 'user',
                        parts: [
                            {
                                functionResponse: {
                                    name: 'read_file',
                                    id: 'model-id-xyz',
                                    response: { content: 'file contents here' }
                                }
                            }
                        ]
                    }
                ],
                config: {}
            };

            // We test mapToOpenAi indirectly via generateContent
            const mockResponse = {
                choices: [
                    {
                        message: { content: 'I read the file.', tool_calls: null },
                        finish_reason: 'stop'
                    }
                ],
                usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }
            };

            (global.fetch as any).mockResolvedValue({
                ok: true,
                json: async () => mockResponse
            });

            await generator.generateContent(request, 'prompt-id');

            // Verify the request body sent to fetch
            const fetchCall = (global.fetch as any).mock.calls[0];
            const sentBody = JSON.parse(fetchCall[1].body);

            // The assistant message should have tool_calls with the model ID
            const assistantMsg = sentBody.messages.find(
                (m: any) => m.role === 'assistant' && m.tool_calls
            );
            expect(assistantMsg).toBeDefined();
            expect(assistantMsg.tool_calls[0].id).toBe('model-id-xyz');

            // The tool response should have the matching tool_call_id
            const toolMsg = sentBody.messages.find((m: any) => m.role === 'tool');
            expect(toolMsg).toBeDefined();
            expect(toolMsg.tool_call_id).toBe('model-id-xyz');
        });

        it('should handle malformed tool call arguments gracefully', async () => {
            const sseLines = [
                'data: {"choices":[{"finish_reason":null,"index":0,"delta":{"tool_calls":[{"index":0,"id":"bad-json-id","type":"function","function":{"name":"read_file","arguments":"{"}}]}}]}',
                'data: {"choices":[{"finish_reason":null,"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"not valid json"}}]}}]}',
                'data: {"choices":[{"finish_reason":"tool_calls","index":0,"delta":{}}]}',
                'data: [DONE]'
            ];

            (global.fetch as any).mockResolvedValue({
                ok: true,
                body: createSSEStream(sseLines)
            });

            const request: any = {
                model: 'test-model',
                contents: [{ role: 'user', parts: [{ text: 'test' }] }],
                config: {}
            };

            const stream = await generator.generateContentStream(request, 'prompt-id');
            const responses: any[] = [];
            for await (const chunk of stream) {
                responses.push(chunk);
            }

            // Should still yield a function call, but with error info in args
            const toolChunk = responses.find((r) => r.functionCalls?.length > 0);
            expect(toolChunk).toBeDefined();
            expect(toolChunk.functionCalls[0].name).toBe('read_file');
            expect(toolChunk.functionCalls[0].args._error).toBeDefined();
        });

        it('should handle multiple parallel tool calls with separate IDs', async () => {
            const sseLines = [
                // First tool call
                'data: {"choices":[{"finish_reason":null,"index":0,"delta":{"tool_calls":[{"index":0,"id":"call-1","type":"function","function":{"name":"read_file","arguments":"{\\"file_path\\":\\"/a.txt\\"}"}}]}}]}',
                // Second tool call
                'data: {"choices":[{"finish_reason":null,"index":0,"delta":{"tool_calls":[{"index":1,"id":"call-2","type":"function","function":{"name":"read_file","arguments":"{\\"file_path\\":\\"/b.txt\\"}"}}]}}]}',
                'data: {"choices":[{"finish_reason":"tool_calls","index":0,"delta":{}}]}',
                'data: [DONE]'
            ];

            (global.fetch as any).mockResolvedValue({
                ok: true,
                body: createSSEStream(sseLines)
            });

            const request: any = {
                model: 'test-model',
                contents: [{ role: 'user', parts: [{ text: 'read two files' }] }],
                config: {}
            };

            const stream = await generator.generateContentStream(request, 'prompt-id');
            const responses: any[] = [];
            for await (const chunk of stream) {
                responses.push(chunk);
            }

            const toolChunk = responses.find((r) => r.functionCalls?.length > 0);
            expect(toolChunk).toBeDefined();
            expect(toolChunk.functionCalls).toHaveLength(2);

            // Each call must preserve its own ID and args
            expect(toolChunk.functionCalls[0].name).toBe('read_file');
            expect(toolChunk.functionCalls[0].id).toBe('call-1');
            expect(toolChunk.functionCalls[0].args).toEqual({ file_path: '/a.txt' });

            expect(toolChunk.functionCalls[1].name).toBe('read_file');
            expect(toolChunk.functionCalls[1].id).toBe('call-2');
            expect(toolChunk.functionCalls[1].args).toEqual({ file_path: '/b.txt' });
        });
    });
});
