import {
    BaseDeclarativeTool,
    ToolInvocation,
    BaseToolInvocation,
    ToolResult,
    Kind,
    Config as CoreConfig
} from '@google/gemini-cli-core';
import type { MessageBus } from '@google/gemini-cli-core/dist/src/confirmation-bus/message-bus.js';

interface GetQuotaParams {
    modelId?: string;
}

class GetQuotaInvocation extends BaseToolInvocation<GetQuotaParams, ToolResult> {
    constructor(
        params: GetQuotaParams,
        private coreConfig: CoreConfig
    ) {
        super(params, null as unknown as MessageBus, 'get_model_quota', 'Get Model Quota');
    }

    getDescription(): string {
        return `Retrieving current rate limit and quota information for ${this.params.modelId || 'all active models'}.`;
    }

    async execute(signal: AbortSignal): Promise<ToolResult> {
        try {
            const quota = await this.coreConfig.refreshUserQuota();
            if (!quota || !quota.buckets) {
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
}

export class GetQuotaTool extends BaseDeclarativeTool<GetQuotaParams, ToolResult> {
    constructor(private coreConfig: CoreConfig) {
        super(
            'get_model_quota',
            'Get Model Quota',
            'Retrieve the current rate limit, remaining quota, and reset times for the Gemini models being used. Use this to check if you are approaching limits or if capacity issues are expected.',
            Kind.Read,
            {
                type: 'object',
                properties: {
                    modelId: {
                        type: 'string',
                        description:
                            'Optional: Filter for a specific model ID (e.g. "gemini-2.5-flash"). If omitted, returns all relevant Gemini quotas.'
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
        return new GetQuotaInvocation(params, this.coreConfig);
    }
}
