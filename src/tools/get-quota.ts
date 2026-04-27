import {
    BaseDeclarativeTool,
    ToolInvocation,
    BaseToolInvocation,
    ToolResult,
    Kind,
    Config as CoreConfig
} from '@google/gemini-cli-core';
import type { MessageBus } from '@google/gemini-cli-core/dist/src/confirmation-bus/message-bus.js';
import { SessionManager, SessionData } from '../supervisor/session-manager.js';

interface GetQuotaParams {
    modelId?: string;
}

class GetQuotaInvocation extends BaseToolInvocation<GetQuotaParams, ToolResult> {
    constructor(
        params: GetQuotaParams,
        private coreConfig: CoreConfig,
        private sessionManager?: SessionManager,
        private tarsConfig?: {
            inferenceBackend: string;
            contextWindowTokens: number;
            geminiModel: string;
            localInferenceUrl: string;
        }
    ) {
        super(params, null as unknown as MessageBus, 'get_model_quota', 'Get Model Quota');
    }

    getDescription(): string {
        return `Retrieving current rate limit and quota information for ${this.params.modelId || 'all active models'}.`;
    }

    async execute(signal: AbortSignal): Promise<ToolResult> {
        try {
            // For local models, return session-tracked data instead of calling the Google quota API
            if (this.tarsConfig?.inferenceBackend === 'llamacpp') {
                return this.getLocalUsage();
            }

            const quota = await this.coreConfig.refreshUserQuota();
            if (!quota || !quota.buckets) {
                // Fallback to session-tracked data even for Gemini if quota API is unavailable
                if (this.sessionManager) {
                    return this.getLocalUsage();
                }

                return {
                    llmContent: [
                        {
                            text: '⚠️ No quota information available. This may be because the current authentication method does not support quota tracking (e.g. legacy auth) or the Code Assist server is not reachable.'
                        }
                    ],
                    returnDisplay: 'No quota info available.'
                };
            }

            const activeModel = this.coreConfig.getActiveModel();
            const buckets = quota.buckets;

            let resultText = '### Current Model Quotas\n\n';

            // Filter buckets if a specific modelId was requested, otherwise show all relevant ones
            const relevantBuckets = this.params.modelId
                ? buckets.filter((b) => b.modelId?.includes(this.params.modelId!))
                : buckets.filter(
                      (b) =>
                          b.modelId && (b.modelId === activeModel || b.modelId.includes('gemini'))
                  );

            if (relevantBuckets.length === 0) {
                resultText += `No buckets found matching "${this.params.modelId || 'Gemini models'}".\n`;
            } else {
                for (const bucket of relevantBuckets) {
                    const is_active = bucket.modelId === activeModel ? ' (Active)' : '';
                    const remaining =
                        bucket.remainingFraction != null
                            ? `${(bucket.remainingFraction * 100).toFixed(1)}%`
                            : 'Unknown';

                    resultText += `- **${bucket.modelId}**${is_active}\n`;
                    resultText += `  - **Remaining**: ${remaining}\n`;
                    if (bucket.resetTime) {
                        resultText += `  - **Resets At**: ${bucket.resetTime}\n`;
                    }
                    if (bucket.tokenType) {
                        resultText += `  - **Type**: ${bucket.tokenType}\n`;
                    }
                    resultText += '\n';
                }
            }

            return {
                llmContent: [{ text: resultText }],
                returnDisplay: `Quota retrieved: ${relevantBuckets.length} buckets found.`
            };
        } catch (error: any) {
            return {
                llmContent: [{ text: `❌ Failed to retrieve quota: ${error.message}` }],
                returnDisplay: `Error: ${error.message}`
            };
        }
    }

    private getLocalUsage(): ToolResult {
        const stats: SessionData | null = this.sessionManager?.getStats() || null;
        const contextWindow = this.tarsConfig?.contextWindowTokens || 0;
        const model = this.tarsConfig?.geminiModel || 'unknown';
        const endpoint = this.tarsConfig?.localInferenceUrl || 'unknown';

        let resultText = '### Session Resource Usage\n\n';
        resultText += `- **Backend**: Local Inference (${this.tarsConfig?.inferenceBackend})\n`;
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
            const contextPercent =
                contextWindow > 0
                    ? ((stats.lastInputTokens / contextWindow) * 100).toFixed(1)
                    : 'N/A';
            resultText += `- **Context Size (Current)**: ${stats.lastInputTokens.toLocaleString()} / ${contextWindow.toLocaleString()} (${contextPercent}%)\n`;
            resultText += `- **Output Tokens (Cumulative)**: ${stats.totalOutputTokens.toLocaleString()}\n`;
            resultText += `- **Cached Tokens (Current)**: ${stats.totalCachedTokens.toLocaleString()}\n`;
            resultText += `- **Net Input Tokens (Cumulative)**: ${stats.totalNetTokens.toLocaleString()}\n`;
            resultText += `- **Total Input Tokens (Cumulative)**: ${stats.totalInputTokens.toLocaleString()}\n`;
            resultText += `- **Compressions**: ${stats.compressionCount}\n`;
            resultText += `- **Last Interaction**: ${stats.lastInteractionAt}\n`;
        } else {
            resultText += '*No active session data available.*\n';
        }

        resultText +=
            '\n> **Note**: Local models do not use Google quota. Usage shown is tracked from session history.';

        return {
            llmContent: [{ text: resultText }],
            returnDisplay: `Local usage: ${stats?.interactionCount || 0} interactions, ${stats?.totalInputTokens || 0} context tokens.`
        };
    }
}

export class GetQuotaTool extends BaseDeclarativeTool<GetQuotaParams, ToolResult> {
    constructor(
        private coreConfig: CoreConfig,
        private sessionManager?: SessionManager,
        private tarsConfig?: {
            inferenceBackend: string;
            contextWindowTokens: number;
            geminiModel: string;
            localInferenceUrl: string;
        }
    ) {
        super(
            'get_model_quota',
            'Get Model Quota',
            'Retrieve the current rate limit, remaining quota, and reset times for the models being used. For local models, returns session-tracked token usage and context window utilization.',
            Kind.Read,
            {
                type: 'object',
                properties: {
                    modelId: {
                        type: 'string',
                        description:
                            'Optional: Filter for a specific model ID (e.g. "gemini-2.5-flash"). If omitted, returns all relevant quotas or session usage for local models.'
                    }
                }
            },
            null as unknown as MessageBus,
            true, // isOutputMarkdown
            false // canUpdateOutput
        );
    }

    protected createInvocation(
        params: GetQuotaParams,
        _messageBus: MessageBus
    ): ToolInvocation<GetQuotaParams, ToolResult> {
        return new GetQuotaInvocation(
            params,
            this.coreConfig,
            this.sessionManager,
            this.tarsConfig
        );
    }
}
