import { z } from 'zod';

const ModelsResponseSchema = z.object({
    data: z.array(z.object({ id: z.string().optional() }).passthrough()).optional()
});
const PropsResponseSchema = z.object({
    default_generation_settings: z.object({ n_ctx: z.number().positive() }).optional()
});

function getErrorProperty(error: unknown, property: string): unknown {
    if (typeof error !== 'object' || error === null) return undefined;
    return Reflect.get(error, property);
}

/**
 * Result of probing a local inference endpoint.
 */
export interface EndpointProbeResult {
    reachable: boolean;
    models: string[];
    contextWindow?: number;
    error?: string;
}

/**
 * Model info returned from the /v1/models endpoint.
 */
export interface LocalModelInfo {
    id: string;
    object?: string;
    owned_by?: string;
}

/**
 * Probes a local inference endpoint by checking /v1/models and optionally
 * the /v1/chat/completions health endpoint.
 *
 * @param baseUrl - The base URL of the OpenAI-compatible endpoint
 * @param timeoutMs - Timeout in milliseconds (default: 5000)
 * @returns Probe result with reachability and available models
 */
export async function probeEndpoint(
    baseUrl: string,
    timeoutMs: number = 5000
): Promise<EndpointProbeResult> {
    const normalizedUrl = baseUrl.replace(/\/+$/, '');

    // Try /v1/models first
    try {
        const modelsUrl = normalizedUrl.endsWith('/v1')
            ? `${normalizedUrl}/models`
            : `${normalizedUrl}/v1/models`;

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);

        try {
            const response = await fetch(modelsUrl, {
                method: 'GET',
                signal: controller.signal
            });

            clearTimeout(timeout);

            if (response.ok) {
                const data = ModelsResponseSchema.parse(await response.json());
                const models = (data.data ?? [])
                    .map((model) => model.id)
                    .filter((id): id is string => Boolean(id));

                let contextWindow: number | undefined;

                // Try to fetch active context window from llama.cpp /props endpoint
                try {
                    const propsUrl = normalizedUrl.endsWith('/v1')
                        ? normalizedUrl.replace(/\/v1$/, '/props')
                        : `${normalizedUrl}/props`;
                    const propsRes = await fetch(propsUrl, { method: 'GET' });
                    if (propsRes.ok) {
                        const propsData = PropsResponseSchema.parse(await propsRes.json());
                        contextWindow = propsData.default_generation_settings?.n_ctx;
                    }
                } catch {
                    // Ignore failures, just a best-effort auto-detection
                }

                return { reachable: true, models, contextWindow };
            }

            // Server reachable but /v1/models not supported — still valid
            return { reachable: true, models: [] };
        } finally {
            clearTimeout(timeout);
        }
    } catch (error: unknown) {
        // If /v1/models failed, try a simpler connectivity check
        try {
            const healthUrl = normalizedUrl.endsWith('/v1')
                ? normalizedUrl.replace(/\/v1$/, '/health')
                : `${normalizedUrl}/health`;

            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), timeoutMs);

            try {
                const response = await fetch(healthUrl, {
                    method: 'GET',
                    signal: controller.signal
                });

                clearTimeout(timeout);

                if (response.ok) {
                    return { reachable: true, models: [] };
                }
            } finally {
                clearTimeout(timeout);
            }
        } catch {
            // Both /v1/models and /health failed
        }

        const cause = getErrorProperty(error, 'cause');
        const causeCode = getErrorProperty(cause, 'code');
        const errorName = getErrorProperty(error, 'name');
        const errorMessageValue = getErrorProperty(error, 'message');
        const errorMessage =
            causeCode === 'ECONNREFUSED'
                ? `Connection refused at ${normalizedUrl}`
                : errorName === 'AbortError'
                  ? `Connection timed out after ${timeoutMs}ms`
                  : typeof errorMessageValue === 'string'
                    ? errorMessageValue
                    : 'Unknown error';

        return {
            reachable: false,
            models: [],
            error: errorMessage
        };
    }
}
