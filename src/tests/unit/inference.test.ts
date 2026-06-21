import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GetQuotaTool } from '../../tools/get-quota.js';

describe('GetQuotaTool - Local Model Support', () => {
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
            lastInputTokens: number;
        } | null,
        tarsConfig: {
            piProvider: string;
            contextWindowTokens: number;
            piModel: string;
            piBaseUrl: string;
        }
    ) {
        const sessionManager = {
            getStats: () => stats
        } as any;
        const tool = new GetQuotaTool(sessionManager, tarsConfig);
        return tool.getLocalUsage();
    }

    it('should include model name and endpoint in local usage report', () => {
        const result = formatLocalUsage(null, {
            piProvider: 'google',
            contextWindowTokens: 262144,
            piModel: 'gemini-2.5-flash',
            piBaseUrl: 'https://generativelanguage.googleapis.com'
        });

        expect(result).toContain('google');
        expect(result).toContain('gemini-2.5-flash');
        expect(result).toContain('https://generativelanguage.googleapis.com');
        expect(result).toContain('262,144');
    });

    it('should display session stats with correct context percentage', () => {
        const result = formatLocalUsage(
            {
                sessionId: 'test-session-123',
                createdAt: '2026-04-18T00:00:00Z',
                totalInputTokens: 131072,
                lastInputTokens: 131072, // 50% of 262144
                totalOutputTokens: 5000,
                totalCachedTokens: 0,
                interactionCount: 25,
                lastInteractionAt: '2026-04-18T12:00:00Z',
                totalNetTokens: 200000,
                compressionCount: 2
            },
            {
                piProvider: 'google',
                contextWindowTokens: 262144,
                piModel: 'gemini-2.5-flash',
                piBaseUrl: 'https://generativelanguage.googleapis.com'
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
            piProvider: 'openai',
            contextWindowTokens: 8192,
            piModel: 'gpt-4o',
            piBaseUrl: 'https://api.openai.com/v1'
        });

        expect(result).toContain('No active session data available');
        expect(result).toContain('gpt-4o');
    });

    it('should handle zero context window without division error', () => {
        const result = formatLocalUsage(
            {
                sessionId: 'test',
                createdAt: '2026-01-01T00:00:00Z',
                totalInputTokens: 1000,
                lastInputTokens: 1000,
                totalOutputTokens: 500,
                totalCachedTokens: 0,
                interactionCount: 5,
                lastInteractionAt: '2026-01-01T01:00:00Z',
                totalNetTokens: 1000,
                compressionCount: 0
            },
            {
                piProvider: 'google',
                contextWindowTokens: 0,
                piModel: 'gemini-2.5-flash',
                piBaseUrl: 'https://generativelanguage.googleapis.com'
            }
        );

        expect(result).toContain('N/A');
        expect(result).not.toContain('NaN');
        expect(result).not.toContain('Infinity');
    });
});

describe('Session-Aware Usage Accumulation', () => {
    // Test the accumulation logic that lives in tars-engine.ts run loop
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

        // This simulates the ternary in tars-engine.ts done event emission
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
        // Simulate the compaction logic from tars-engine.ts
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
- **Provider**: {{PROVIDER}}
- **Model**: {{MODEL_NAME}}
- **Context Window**: {{CONTEXT_WINDOW}} tokens
`;
        const config = {
            piProvider: 'google',
            piModel: 'gemini-2.5-flash',
            contextWindowTokens: 262144
        };

        template = template.replace(/{{PROVIDER}}/g, config.piProvider);
        template = template.replace(/{{MODEL_NAME}}/g, config.piModel);
        template = template.replace(
            /{{CONTEXT_WINDOW}}/g,
            config.contextWindowTokens.toLocaleString()
        );

        expect(template).toContain('google');
        expect(template).toContain('gemini-2.5-flash');
        expect(template).toContain('262,144');
        expect(template).not.toContain('{{');
    });
});
