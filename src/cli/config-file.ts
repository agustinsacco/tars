import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

/**
 * Loose view of `config.json` used by the CLI wizards. Unknown keys pass
 * through untouched so a rerun never drops settings it does not manage.
 */
export const ExistingSetupConfigSchema = z
    .object({
        assistantName: z.string().optional(),
        contextWindowTokens: z.coerce.number().optional(),
        discordOwnerId: z.string().nullable().optional(),
        discordToken: z.string().optional(),
        heartbeatIntervalSec: z.coerce.number().optional(),
        piBaseUrl: z.string().optional(),
        piModel: z.string().optional(),
        piProvider: z.string().optional(),
        piThinkingLevel: z.string().optional(),
        channels: z.record(z.unknown()).optional()
    })
    .passthrough();

export type ExistingSetupConfig = z.infer<typeof ExistingSetupConfigSchema>;

export function getConfigFilePath(tarsHome: string): string {
    return path.join(tarsHome, 'config.json');
}

/** Reads `config.json`; a missing file yields an empty configuration. */
export async function readExistingConfig(tarsHome: string): Promise<ExistingSetupConfig> {
    const configPath = getConfigFilePath(tarsHome);
    if (!fsSync.existsSync(configPath)) return {};
    const parsed: unknown = JSON.parse(await fs.readFile(configPath, 'utf-8'));
    return ExistingSetupConfigSchema.parse(parsed);
}

/** Writes JSON atomically with owner-only permissions. */
export async function writePrivateJson(filePath: string, value: unknown): Promise<void> {
    const temporaryPath = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
    try {
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
            encoding: 'utf8',
            flag: 'wx',
            mode: 0o600
        });
        await fs.rename(temporaryPath, filePath);
    } catch (error: unknown) {
        await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
        throw error;
    }
}
