import { ContentGenerator } from '@google/gemini-cli-core';
import {
    type CountTokensResponse,
    type GenerateContentResponse,
    type GenerateContentParameters,
    type CountTokensParameters,
    type EmbedContentResponse,
    type EmbedContentParameters,
    type Content,
    type Part,
    type Tool
} from '@google/genai';
import logger from '../utils/logger.js';

/**
 * LlamaCppGenerator - Implementation of ContentGenerator for local inference backends (llamacpp, etc.)
 * that provide an OpenAI-compatible API.
 */
export class LlamaCppGenerator implements ContentGenerator {
    constructor(private readonly baseUrl: string = 'http://localhost:8080') {}

    private resolveEndpoint(): string {
        let endpoint = this.baseUrl.replace(/\/$/, '');
        if (!endpoint.endsWith('/chat/completions')) {
            if (!endpoint.endsWith('/v1')) {
                endpoint += '/v1';
            }
            endpoint += '/chat/completions';
        }
        return endpoint;
    }

    async generateContent(
        request: GenerateContentParameters,
        userPromptId: string
    ): Promise<GenerateContentResponse> {
        logger.debug(`[LlamaCppGenerator] Generating content for model: ${request.model}`);

        const openAiRequest = this.mapToOpenAi(request);

        try {
            const response = await fetch(this.resolveEndpoint(), {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(openAiRequest),
                signal: (request.config as any)?.abortSignal
            });

            if (!response.ok) {
                const error = await response.text();
                throw new Error(`Local inference failed: ${response.status} ${error}`);
            }

            const data = (await response.json()) as any;
            return this.mapFromOpenAi(data);
        } catch (error: any) {
            logger.error(`[LlamaCppGenerator] API Error: ${error.message}`);
            throw error;
        }
    }

    async generateContentStream(
        request: GenerateContentParameters,
        userPromptId: string
    ): Promise<AsyncGenerator<GenerateContentResponse>> {
        logger.debug(`[LlamaCppGenerator] Generating content stream for model: ${request.model}`);

        const openAiRequest = {
            ...this.mapToOpenAi(request),
            stream: true
        };

        const self = this;
        async function* streamGenerator() {
            const pendingToolCalls: Map<number, { name: string; arguments: string }> = new Map();

            try {
                const response = await fetch(self.resolveEndpoint(), {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(openAiRequest),
                    signal: (request.config as any)?.abortSignal
                });

                if (!response.ok) {
                    const error = await response.text();
                    throw new Error(`Local inference failed: ${response.status} ${error}`);
                }

                if (!response.body) {
                    throw new Error('Response body is empty');
                }

                const reader = response.body.getReader();
                const decoder = new TextDecoder();
                let buffer = '';

                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;

                    buffer += decoder.decode(value, { stream: true });
                    const lines = buffer.split('\n');
                    buffer = lines.pop() || '';

                    for (const line of lines) {
                        const cleanLine = line.trim();
                        if (!cleanLine || cleanLine === 'data: [DONE]') continue;
                        if (cleanLine.startsWith('data: ')) {
                            try {
                                const data = JSON.parse(cleanLine.slice(6));
                                const choice = data.choices && data.choices[0];

                                // 1. Aggregate partial tool calls from OpenAI stream format
                                if (choice && choice.delta && choice.delta.tool_calls) {
                                    for (const tc of choice.delta.tool_calls) {
                                        let pending = pendingToolCalls.get(tc.index);
                                        if (!pending) {
                                            pending = {
                                                name: tc.function?.name || '',
                                                arguments: ''
                                            };
                                            pendingToolCalls.set(tc.index, pending);
                                        }
                                        if (tc.function?.arguments) {
                                            pending.arguments += tc.function.arguments;
                                        }
                                    }
                                    // Strip partial tool calls so we don't accidentally parse/yield them yet
                                    delete choice.delta.tool_calls;
                                }

                                // 2. When the turn finishes, inject fully assembled tool calls into the payload
                                if (choice && choice.finish_reason) {
                                    if (pendingToolCalls.size > 0) {
                                        choice.delta.tool_calls = Array.from(
                                            pendingToolCalls.entries()
                                        ).map(([_, tc]) => ({
                                            function: {
                                                name: tc.name,
                                                arguments: tc.arguments
                                            }
                                        }));
                                        pendingToolCalls.clear();
                                    }
                                }

                                const mapped = self.mapFromOpenAiStream(data);
                                if (mapped) yield mapped;
                            } catch (e: any) {
                                logger.debug(
                                    `Failed to parse/map SSE line: ${cleanLine} - ${e.message}`
                                );
                            }
                        }
                    }
                }

                // Cleanup in case stream ended without finish_reason
                if (pendingToolCalls.size > 0) {
                    const finalData = {
                        choices: [
                            {
                                delta: {
                                    tool_calls: Array.from(pendingToolCalls.entries()).map(
                                        ([_, tc]) => ({
                                            function: { name: tc.name, arguments: tc.arguments }
                                        })
                                    )
                                },
                                finish_reason: 'tool_calls'
                            }
                        ]
                    };
                    const mapped = self.mapFromOpenAiStream(finalData);
                    if (mapped) yield mapped;
                    pendingToolCalls.clear();
                }
            } catch (error: any) {
                logger.error(`[LlamaCppGenerator] Stream Error: ${error.message}`);
                throw error;
            }
        }

        return streamGenerator();
    }

    async countTokens(request: CountTokensParameters): Promise<CountTokensResponse> {
        // Simple character-based estimation if local backend doesn't support token counting
        let text = '';
        if (typeof request.contents === 'string') {
            text = request.contents;
        } else if (Array.isArray(request.contents)) {
            text = (request.contents as Content[])
                .map((c) => c.parts?.map((p) => p.text || '').join(''))
                .join('');
        }

        return {
            totalTokens: Math.ceil(text.length / 4)
        };
    }

    async embedContent(request: EmbedContentParameters): Promise<EmbedContentResponse> {
        throw new Error('Embeddings not yet supported for LlamaCppGenerator');
    }

    /**
     * Maps Gemini parameters to OpenAI Chat Completion format.
     */
    private mapToOpenAi(request: GenerateContentParameters): any {
        const contents = Array.isArray(request.contents)
            ? request.contents
            : [{ role: 'user', parts: [{ text: request.contents }] }];

        const messages = (contents as Content[]).map((content) => {
            const role = content.role === 'model' ? 'assistant' : content.role || 'user';

            // Map parts to content
            let messageContent: any;
            const textParts = content.parts?.filter((p) => p.text).map((p) => p.text);

            if (textParts && textParts.length > 0) {
                messageContent = textParts.join('\n');
            }

            // Handle tool calls/responses
            const toolCalls = content.parts
                ?.filter((p) => p.functionCall)
                .map((p) => ({
                    id: (p as any).callId || 'call_' + Math.random().toString(36).slice(2),
                    type: 'function',
                    function: {
                        name: p.functionCall!.name,
                        arguments: JSON.stringify(p.functionCall!.args)
                    }
                }));

            const toolOutputs = content.parts
                ?.filter((p) => p.functionResponse)
                .map((p) => ({
                    tool_call_id: (p as any).callId,
                    role: 'tool',
                    name: p.functionResponse!.name,
                    content: JSON.stringify(p.functionResponse!.response)
                }));

            if (toolOutputs && toolOutputs.length > 0) {
                return toolOutputs[0];
            }

            return {
                role,
                content: messageContent,
                ...(toolCalls && toolCalls.length > 0 ? { tool_calls: toolCalls } : {})
            };
        });

        // Add system instruction if present
        if (request.config?.systemInstruction) {
            const sysInstr =
                typeof request.config.systemInstruction === 'string'
                    ? request.config.systemInstruction
                    : (request.config.systemInstruction as any).parts?.[0]?.text;

            if (sysInstr) {
                messages.unshift({ role: 'system', content: sysInstr });
            }
        }

        // Map tools
        const tools = (request.config?.tools as Tool[])?.flatMap((t) =>
            t.functionDeclarations?.map((fd) => ({
                type: 'function',
                function: {
                    name: fd.name,
                    description: fd.description,
                    parameters: fd.parameters
                }
            }))
        );

        return {
            model: request.model,
            messages,
            tools: tools && tools.length > 0 ? tools : undefined,
            temperature: request.config?.temperature ?? 0.7,
            max_tokens: request.config?.maxOutputTokens
        };
    }

    /**
     * Maps OpenAI response to Gemini GenerateContentResponse format.
     */
    private mapFromOpenAi(data: any): GenerateContentResponse {
        const choice = data.choices[0];
        const message = choice.message;

        const parts: Part[] = [];
        if (message.content) {
            parts.push({ text: message.content });
        }

        if (message.tool_calls) {
            for (const tc of message.tool_calls) {
                parts.push({
                    functionCall: {
                        name: tc.function.name,
                        args: JSON.parse(tc.function.arguments)
                    }
                } as any);
            }
        }

        return {
            candidates: [
                {
                    content: {
                        role: 'model',
                        parts
                    },
                    finishReason: this.mapFinishReason(
                        choice.finish_reason || choice.finishReason
                    ) as any
                }
            ],
            usageMetadata: {
                promptTokenCount: data.usage?.prompt_tokens,
                candidatesTokenCount: data.usage?.completion_tokens,
                totalTokenCount: data.usage?.total_tokens
            }
        } as GenerateContentResponse;
    }

    private mapFromOpenAiStream(data: any): GenerateContentResponse | null {
        const choice = data.choices && data.choices[0];
        if (!choice) return null;

        const delta = choice.delta || {};

        const parts: Part[] = [];
        if (delta.content) {
            parts.push({ text: delta.content });
        }

        if (delta.tool_calls) {
            for (const tc of delta.tool_calls) {
                if (tc.function) {
                    try {
                        const parsedArgs = tc.function.arguments
                            ? JSON.parse(tc.function.arguments)
                            : {};
                        parts.push({
                            functionCall: {
                                name: tc.function.name,
                                args: parsedArgs
                            }
                        } as any);
                    } catch (err) {
                        logger.warn(
                            `Invalid tool call JSON arguments format: ${tc.function.arguments}`
                        );
                    }
                }
            }
        }

        if (parts.length === 0 && !choice.finish_reason) {
            return null; // Don't yield empty chunks unless it carries the finish_reason
        }

        return {
            candidates: [
                {
                    content: {
                        role: 'model',
                        parts
                    },
                    finishReason: this.mapFinishReason(
                        choice.finish_reason || choice.finishReason
                    ) as any
                }
            ]
        } as GenerateContentResponse;
    }

    private mapFinishReason(reason: string | null | undefined): string | undefined {
        if (!reason) {
            return undefined; // Must return undefined for incomplete stream chunks, not 'OTHER'!
        }

        switch (reason) {
            case 'stop':
                return 'STOP';
            case 'length':
                return 'MAX_TOKENS';
            case 'tool_calls':
                return 'STOP'; // Gemini uses STOP for tool calls often
            case 'content_filter':
                return 'SAFETY';
            default:
                return 'OTHER';
        }
    }
}
