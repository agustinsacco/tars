import { describe, it, expect, vi, beforeEach } from 'vitest';

// We need to test the GetQuotaTool's invocation logic directly.
// Since the tool uses a class hierarchy from the core SDK, we'll test
// the local usage logic by constructing the invocation manually.

describe('GetQuotaTool - Local Model Support', () => {
    // Simulate what GetQuotaInvocation.getLocalUsage() produces
    // by extracting the logic into a testable pure function.

    function formatLocalUsage(
        stats: {
            sessionId: string;
            createdAt: string;
            totalInputTokens: number;
            totalOutputTokens: number;
            totalCachedTokens: number;
            interactionCount: number;
            lastInteractionAt: string;
            totalNetTokens: number;
            compressionCount: number;
        } | null,
        tarsConfig: {
            inferenceBackend: string;
            contextWindowTokens: number;
            geminiModel: string;
            localInferenceUrl: string;
        }
    ) {
        const contextWindow = tarsConfig.contextWindowTokens || 0;
        const model = tarsConfig.geminiModel || 'unknown';
        const endpoint = tarsConfig.localInferenceUrl || 'unknown';

        let resultText = '### Session Resource Usage\n\n';
        resultText += `- **Backend**: Local Inference (${tarsConfig.inferenceBackend})\n`;
        resultText += `- **Model**: \`${model}\`\n`;
        resultText += `- **Endpoint**: \`${endpoint}\`\n`;
        resultText += `- **Context Window**: ${contextWindow.toLocaleString()} tokens\n\n`;

        if (stats) {
            const usagePercent =
                contextWindow > 0
                    ? ((stats.totalInputTokens / contextWindow) * 100).toFixed(1)
                    : 'N/A';

            resultText += '#### Current Session\n\n';
            resultText += `- **Session ID**: \`${stats.sessionId}\`\n`;
            resultText += `- **Created**: ${stats.createdAt}\n`;
            resultText += `- **Interactions**: ${stats.interactionCount}\n`;
            resultText += `- **Context Tokens (Last)**: ${stats.totalInputTokens.toLocaleString()} / ${contextWindow.toLocaleString()} (${usagePercent}%)\n`;
            resultText += `- **Output Tokens (Cumulative)**: ${stats.totalOutputTokens.toLocaleString()}\n`;
            resultText += `- **Cached Tokens**: ${stats.totalCachedTokens.toLocaleString()}\n`;
            resultText += `- **Net Input Tokens (Cumulative)**: ${stats.totalNetTokens.toLocaleString()}\n`;
            resultText += `- **Compressions**: ${stats.compressionCount}\n`;
            resultText += `- **Last Interaction**: ${stats.lastInteractionAt}\n`;
        } else {
            resultText += '*No active session data available.*\n';
        }

        return resultText;
    }

    it('should include model name and endpoint in local usage report', () => {
        const result = formatLocalUsage(null, {
            inferenceBackend: 'llamacpp',
            contextWindowTokens: 262144,
            geminiModel: 'qwen35_distilled',
            localInferenceUrl: 'http://stark:8086/v1'
        });

        expect(result).toContain('llamacpp');
        expect(result).toContain('qwen35_distilled');
        expect(result).toContain('http://stark:8086/v1');
        expect(result).toContain('262,144');
    });

    it('should display session stats with correct context percentage', () => {
        const result = formatLocalUsage(
            {
                sessionId: 'test-session-123',
                createdAt: '2026-04-18T00:00:00Z',
                totalInputTokens: 131072, // 50% of 262144
                totalOutputTokens: 5000,
                totalCachedTokens: 0,
                interactionCount: 25,
                lastInteractionAt: '2026-04-18T12:00:00Z',
                totalNetTokens: 200000,
                compressionCount: 2
            },
            {
                inferenceBackend: 'llamacpp',
                contextWindowTokens: 262144,
                geminiModel: 'qwen35_distilled',
                localInferenceUrl: 'http://localhost:8080'
            }
        );

        expect(result).toContain('test-session-123');
        expect(result).toContain('50.0%');
        expect(result).toContain('Interactions**: 25');
        expect(result).toContain('Compressions**: 2');
        expect(result).toContain('5,000');
    });

    it('should handle null session data gracefully', () => {
        const result = formatLocalUsage(null, {
            inferenceBackend: 'llamacpp',
            contextWindowTokens: 8192,
            geminiModel: 'llama3',
            localInferenceUrl: 'http://localhost:8080'
        });

        expect(result).toContain('No active session data available');
        expect(result).toContain('llama3');
    });

    it('should handle zero context window without division error', () => {
        const result = formatLocalUsage(
            {
                sessionId: 'test',
                createdAt: '2026-01-01T00:00:00Z',
                totalInputTokens: 1000,
                totalOutputTokens: 500,
                totalCachedTokens: 0,
                interactionCount: 5,
                lastInteractionAt: '2026-01-01T01:00:00Z',
                totalNetTokens: 1000,
                compressionCount: 0
            },
            {
                inferenceBackend: 'llamacpp',
                contextWindowTokens: 0,
                geminiModel: 'test-model',
                localInferenceUrl: 'http://localhost:8080'
            }
        );

        expect(result).toContain('N/A');
        expect(result).not.toContain('NaN');
        expect(result).not.toContain('Infinity');
    });
});

describe('Session-Aware Usage Accumulation', () => {
    // Test the accumulation logic that lives in gemini-engine.ts run loop
    // Extracted here as a pure-function test

    it('should accumulate multi-turn usage correctly', () => {
        let accumulatedInputTokens = 0;
        let accumulatedOutputTokens = 0;
        let accumulatedCachedTokens = 0;

        // Simulate 3 turns of usage
        const turns = [
            { promptTokenCount: 5000, candidatesTokenCount: 200, cachedContentTokenCount: 0 },
            { promptTokenCount: 8000, candidatesTokenCount: 350, cachedContentTokenCount: 0 },
            { promptTokenCount: 12000, candidatesTokenCount: 500, cachedContentTokenCount: 1000 }
        ];

        for (const usage of turns) {
            if (usage.promptTokenCount) {
                accumulatedInputTokens = Math.max(accumulatedInputTokens, usage.promptTokenCount);
            }
            if (usage.candidatesTokenCount) {
                accumulatedOutputTokens += usage.candidatesTokenCount;
            }
            if (usage.cachedContentTokenCount) {
                accumulatedCachedTokens = Math.max(
                    accumulatedCachedTokens,
                    usage.cachedContentTokenCount
                );
            }
        }

        // inputTokens should be the MAX (cumulative context size)
        expect(accumulatedInputTokens).toBe(12000);
        // outputTokens should be the SUM (total generated across turns)
        expect(accumulatedOutputTokens).toBe(1050);
        // cachedTokens should be the MAX
        expect(accumulatedCachedTokens).toBe(1000);
    });

    it('should prefer accumulated values over raw finalUsageStats in done event', () => {
        const accumulatedInputTokens = 15000;
        const accumulatedOutputTokens = 800;
        const accumulatedCachedTokens = 0;

        const finalUsageStats = {
            promptTokenCount: 5000,
            candidatesTokenCount: 200,
            cachedContentTokenCount: 0
        };

        // This simulates the ternary in gemini-engine.ts done event emission
        const usageStats =
            accumulatedInputTokens > 0 || accumulatedOutputTokens > 0
                ? {
                      inputTokens: accumulatedInputTokens,
                      outputTokens: accumulatedOutputTokens,
                      cachedTokens: accumulatedCachedTokens
                  }
                : finalUsageStats
                  ? {
                        inputTokens: finalUsageStats.promptTokenCount || 0,
                        outputTokens: finalUsageStats.candidatesTokenCount || 0,
                        cachedTokens: finalUsageStats.cachedContentTokenCount || 0
                    }
                  : undefined;

        expect(usageStats).toBeDefined();
        expect(usageStats!.inputTokens).toBe(15000);
        expect(usageStats!.outputTokens).toBe(800);
    });

    it('should fall back to finalUsageStats when accumulation is zero', () => {
        const accumulatedInputTokens = 0;
        const accumulatedOutputTokens = 0;

        const finalUsageStats = {
            promptTokenCount: 5000,
            candidatesTokenCount: 200,
            cachedContentTokenCount: 100
        };

        const usageStats =
            accumulatedInputTokens > 0 || accumulatedOutputTokens > 0
                ? {
                      inputTokens: accumulatedInputTokens,
                      outputTokens: accumulatedOutputTokens,
                      cachedTokens: 0
                  }
                : finalUsageStats
                  ? {
                        inputTokens: finalUsageStats.promptTokenCount || 0,
                        outputTokens: finalUsageStats.candidatesTokenCount || 0,
                        cachedTokens: finalUsageStats.cachedContentTokenCount || 0
                    }
                  : undefined;

        expect(usageStats).toBeDefined();
        expect(usageStats!.inputTokens).toBe(5000);
        expect(usageStats!.outputTokens).toBe(200);
        expect(usageStats!.cachedTokens).toBe(100);
    });

    it('should return undefined when both accumulation and finalUsageStats are empty', () => {
        const accumulatedInputTokens = 0;
        const accumulatedOutputTokens = 0;
        const finalUsageStats: any = undefined;

        const usageStats =
            accumulatedInputTokens > 0 || accumulatedOutputTokens > 0
                ? {
                      inputTokens: accumulatedInputTokens,
                      outputTokens: accumulatedOutputTokens,
                      cachedTokens: 0
                  }
                : finalUsageStats
                  ? {
                        inputTokens: finalUsageStats.promptTokenCount || 0,
                        outputTokens: finalUsageStats.candidatesTokenCount || 0,
                        cachedTokens: finalUsageStats.cachedContentTokenCount || 0
                    }
                  : undefined;

        expect(usageStats).toBeUndefined();
    });
});

describe('Local Compaction - Role Boundary Safety', () => {
    it('should find nearest user role boundary for truncation', () => {
        // Simulate the compaction logic from gemini-engine.ts
        const history = [
            { role: 'user' }, // 0
            { role: 'model' }, // 1
            { role: 'user' }, // 2
            { role: 'model' }, // 3 - function call
            { role: 'user' }, // 4 - function response
            { role: 'model' }, // 5
            { role: 'user' }, // 6
            { role: 'model' }, // 7
            { role: 'user' }, // 8
            { role: 'model' }, // 9
            { role: 'user' }, // 10
            { role: 'model' }, // 11
            { role: 'user' }, // 12
            { role: 'model' }, // 13
            { role: 'user' }, // 14
            { role: 'model' }, // 15
            { role: 'user' }, // 16
            { role: 'model' }, // 17
            { role: 'user' }, // 18
            { role: 'model' }, // 19
            { role: 'user' } // 20
        ];

        // history.length = 21, keepCount = ceil(21 * 0.6) = 13
        const keepCount = Math.ceil(history.length * 0.6);
        let cutIndex = history.length - keepCount; // 21 - 13 = 8

        // Walk forward to find user role boundary
        while (cutIndex < history.length && history[cutIndex]?.role !== 'user') {
            cutIndex++;
        }

        expect(cutIndex).toBe(8); // Index 8 is already 'user'
        expect(history.slice(cutIndex).length).toBe(13);
    });

    it('should walk forward past model entries to find user boundary', () => {
        const history = [
            { role: 'user' }, // 0
            { role: 'model' }, // 1
            { role: 'model' }, // 2 - model continuation
            { role: 'model' }, // 3 - model continuation
            { role: 'user' }, // 4
            { role: 'model' }, // 5
            { role: 'user' }, // 6
            { role: 'model' } // 7
        ];

        // history.length = 8, keepCount = ceil(8 * 0.6) = 5
        const keepCount = Math.ceil(history.length * 0.6);
        let cutIndex = history.length - keepCount; // 8 - 5 = 3

        // Index 3 is 'model', walk forward
        while (cutIndex < history.length && history[cutIndex]?.role !== 'user') {
            cutIndex++;
        }

        expect(cutIndex).toBe(4); // Should land on index 4 (first 'user' after cut point)
        const tail = history.slice(cutIndex);
        expect(tail[0].role).toBe('user'); // First entry must be user
    });

    it('should not truncate if history is 20 entries or fewer', () => {
        const history = Array.from({ length: 20 }, (_, i) => ({
            role: i % 2 === 0 ? 'user' : 'model'
        }));

        const shouldTruncate = history.length > 20;
        expect(shouldTruncate).toBe(false);
    });

    it('should truncate when history exceeds 20 entries', () => {
        const history = Array.from({ length: 30 }, (_, i) => ({
            role: i % 2 === 0 ? 'user' : 'model'
        }));

        const shouldTruncate = history.length > 20;
        expect(shouldTruncate).toBe(true);

        const keepCount = Math.ceil(history.length * 0.6);
        let cutIndex = history.length - keepCount;

        while (cutIndex < history.length && history[cutIndex]?.role !== 'user') {
            cutIndex++;
        }

        const tail = history.slice(cutIndex);
        expect(tail.length).toBeGreaterThan(0);
        expect(tail[0].role).toBe('user');
    });
});

describe('System Prompt Template Variables', () => {
    it('should hydrate all infrastructure template variables', () => {
        let template = `
- **Inference Backend**: {{INFERENCE_BACKEND}}
- **Model**: {{MODEL_NAME}}
- **Context Window**: {{CONTEXT_WINDOW}} tokens
- **Inference Endpoint**: {{INFERENCE_ENDPOINT}}
`;
        const config = {
            inferenceBackend: 'llamacpp',
            geminiModel: 'qwen35_distilled',
            contextWindowTokens: 262144,
            localInferenceUrl: 'http://stark:8086/v1'
        };

        template = template.replace(/{{INFERENCE_BACKEND}}/g, config.inferenceBackend);
        template = template.replace(/{{MODEL_NAME}}/g, config.geminiModel);
        template = template.replace(
            /{{CONTEXT_WINDOW}}/g,
            config.contextWindowTokens.toLocaleString()
        );
        template = template.replace(
            /{{INFERENCE_ENDPOINT}}/g,
            config.inferenceBackend === 'llamacpp' ? config.localInferenceUrl : 'Google AI API'
        );

        expect(template).toContain('llamacpp');
        expect(template).toContain('qwen35_distilled');
        expect(template).toContain('262,144');
        expect(template).toContain('http://stark:8086/v1');
        expect(template).not.toContain('{{');
    });

    it('should use Google AI API for non-local backends', () => {
        let template = '{{INFERENCE_ENDPOINT}}';
        const config = { inferenceBackend: 'gemini', localInferenceUrl: 'http://localhost:8080' };

        template = template.replace(
            /{{INFERENCE_ENDPOINT}}/g,
            config.inferenceBackend === 'llamacpp' ? config.localInferenceUrl : 'Google AI API'
        );

        expect(template).toBe('Google AI API');
    });
});
