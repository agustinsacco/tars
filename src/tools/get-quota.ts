import { AgentTool } from '@earendil-works/pi-agent-core';
import { SessionManager, SessionData } from '../supervisor/session-manager.js';
import { Type, Static } from 'typebox';

const GetQuotaParamsSchema = Type.Object({
    modelId: Type.Optional(
        Type.String({
            description:
                'Optional: Filter for a specific model ID (e.g. "gemini-2.5-flash"). If omitted, returns all relevant quotas or session usage for local models.'
        })
    )
});

type GetQuotaParams = Static<typeof GetQuotaParamsSchema>;

/**
 * Tool to retrieve resource usage and quota metrics
 */
export class GetQuotaTool implements AgentTool<typeof GetQuotaParamsSchema> {
    public readonly name = 'get_model_quota';
    public readonly label = 'Get Model Quota';
    public readonly description =
        'Retrieve the current rate limit, remaining quota, and reset times for the models being used. For local models, returns session-tracked token usage and context window utilization.';
    public readonly parameters = GetQuotaParamsSchema;

    constructor(
        private sessionManager?: SessionManager,
        private tarsConfig?: {
            inferenceBackend: string;
            contextWindowTokens: number;
            geminiModel: string;
            localInferenceUrl: string;
        }
    ) {}

    async execute(toolCallId: string, params: GetQuotaParams) {
        try {
            if (this.sessionManager) {
                return {
                    content: [{ type: 'text' as const, text: this.getLocalUsage() }],
                    details: {}
                };
            }

            return {
                content: [
                    {
                        type: 'text' as const,
                        text: '⚠️ No quota information available. This may be because the current authentication method does not support quota tracking.'
                    }
                ],
                details: {}
            };
        } catch (error: any) {
            return {
                content: [
                    { type: 'text' as const, text: `❌ Failed to retrieve quota: ${error.message}` }
                ],
                details: { error: error.message }
            };
        }
    }

    private getLocalUsage(): string {
        const stats: SessionData | null = this.sessionManager?.getStats() || null;
        const contextWindow = this.tarsConfig?.contextWindowTokens || 128000;
        const model = this.tarsConfig?.geminiModel || 'unknown';
        const endpoint = this.tarsConfig?.localInferenceUrl || 'unknown';

        let resultText = '### Session Resource Usage\n\n';
        resultText += `- **Backend**: Pi Coding Agent\n`;
        resultText += `- **Model**: \`${model}\`\n`;
        resultText += `- **Endpoint**: \`${endpoint}\`\n`;
        resultText += `- **Context Window**: ${contextWindow.toLocaleString()} tokens\n\n`;

        if (stats) {
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

        resultText += '\n> **Note**: Usage shown is tracked from session history.';

        return resultText;
    }
}
