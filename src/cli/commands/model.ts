import chalk from 'chalk';

import {
    RuntimeConfigSchema,
    ThinkingLevelSchema,
    type ThinkingLevel
} from '../../config/schema.js';
import { getTarsHome } from '../../utils/paths.js';
import { SecretsManager } from '../../utils/secrets-manager.js';
import { withTarsHomeMutationLease } from '../../utils/tars-home-lease.js';
import { getConfigFilePath, readExistingConfig, writePrivateJson } from '../config-file.js';
import { printModelSelection, runModelSetup, type ModelSetupAnswers } from '../model-setup.js';

export interface ModelCommandOptions {
    readonly provider?: string;
    readonly model?: string;
    readonly thinking?: string;
}

/** Validates CLI flags into wizard pre-answers; unknown levels fail fast. */
export function parseModelCommandOptions(options: ModelCommandOptions): ModelSetupAnswers {
    let thinkingLevel: ThinkingLevel | undefined;
    if (options.thinking !== undefined) {
        const parsed = ThinkingLevelSchema.safeParse(options.thinking);
        if (!parsed.success) {
            throw new Error(
                `Invalid thinking level "${options.thinking}". Use one of: off, minimal, low, medium, high, xhigh, max.`
            );
        }
        thinkingLevel = parsed.data;
    }
    if (options.model && !options.provider) {
        throw new Error('--model requires --provider so the model id can be validated.');
    }
    return {
        provider: options.provider?.trim() || undefined,
        model: options.model?.trim() || undefined,
        thinkingLevel
    };
}

/**
 * tars model [--provider id] [--model id] [--thinking level]
 *
 * Switches the chat provider and model without rerunning the full setup
 * wizard: sign in (OAuth or API key), discover the models the credentials can
 * use, pick one, and choose the reasoning level.
 */
export async function model(options: ModelCommandOptions = {}): Promise<boolean> {
    const tarsHome = getTarsHome();
    try {
        const answers = parseModelCommandOptions(options);
        return await withTarsHomeMutationLease(tarsHome, 'change the Tars model', async () => {
            const existing = await readExistingConfig(tarsHome);
            if (!existing.piProvider) {
                console.log(
                    chalk.yellow('No configuration found. Run `tars setup` first to create one.')
                );
                return false;
            }

            console.log(chalk.cyan.bold('\n🧠 Tars model selection'));
            console.log(chalk.cyan('───────────────────────\n'));

            const secretsManager = new SecretsManager(tarsHome);
            const selection = await runModelSetup({
                tarsHome,
                existing,
                secretsManager,
                secrets: secretsManager.load(),
                answers
            });

            const nextConfig = { ...existing, ...selection };
            RuntimeConfigSchema.parse(nextConfig);
            await writePrivateJson(getConfigFilePath(tarsHome), nextConfig);

            console.log(chalk.green.bold('\n✅ Model configuration saved.'));
            printModelSelection(selection);
            console.log(`\n  Apply it with:  ${chalk.cyan('tars restart')}`);
            return true;
        });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        console.log(chalk.red(`❌ Model selection failed: ${message}`));
        return false;
    }
}
