import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { z } from 'zod';

import { findMcpPolicyViolations } from '../supervisor/mcp-bridge.js';

export const UPDATE_PREFLIGHT_CONTRACT_VERSION = 1;

const UpdatePreflightResultSchema = z.object({
    contractVersion: z.literal(UPDATE_PREFLIGHT_CONTRACT_VERSION),
    blockers: z.array(
        z.object({
            code: z.enum(['external-working-directory', 'missing-environment-policy']),
            extension: z.string(),
            manifestPath: z.string(),
            reason: z.string(),
            server: z.string(),
            suggestedEnvironmentVariables: z.array(z.string()),
            suggestionScanTruncated: z.boolean()
        })
    )
});

export type UpdatePreflightResult = z.infer<typeof UpdatePreflightResultSchema>;

export function runUpdatePreflight(tarsHome: string): UpdatePreflightResult {
    return UpdatePreflightResultSchema.parse({
        contractVersion: UPDATE_PREFLIGHT_CONTRACT_VERSION,
        blockers: findMcpPolicyViolations(tarsHome)
    });
}

function isDirectExecution(): boolean {
    const invokedPath = process.argv[1];
    if (!invokedPath) return false;
    return path.resolve(invokedPath) === fileURLToPath(import.meta.url);
}

if (isDirectExecution()) {
    const tarsHome = z.string().trim().min(1).parse(process.argv[2]);
    process.stdout.write(`${JSON.stringify(runUpdatePreflight(tarsHome))}\n`);
}
