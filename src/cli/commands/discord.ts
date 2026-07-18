import fs from 'node:fs';
import path from 'node:path';

import chalk from 'chalk';
import { z } from 'zod';

import { getTarsHome } from '../../utils/paths.js';
import { SecretsManager } from '../../utils/secrets-manager.js';

const DiscordGuideConfigSchema = z
    .object({
        assistantName: z.string().trim().min(1).optional(),
        discordOwnerId: z.string().trim().min(1).nullable().optional(),
        channels: z
            .object({
                discord: z
                    .object({
                        ownerId: z.string().trim().min(1).optional()
                    })
                    .passthrough()
                    .optional()
            })
            .passthrough()
            .optional()
    })
    .passthrough();

const DiscordOwnerIdSchema = z
    .string()
    .trim()
    .regex(/^\d{17,20}$/);

type DiscordGuideConfig = z.infer<typeof DiscordGuideConfigSchema>;

interface OwnerIdResolution {
    readonly value: string | null;
    readonly source: string | null;
    readonly valid: boolean;
}

interface GuideState {
    readonly assistantName: string;
    readonly owner: OwnerIdResolution;
    readonly configWarning: string | null;
}

function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function readGuideConfig(tarsHome: string): DiscordGuideConfig {
    const configPath = path.join(tarsHome, 'config.json');
    if (!fs.existsSync(configPath)) return {};

    const parsed: unknown = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    return DiscordGuideConfigSchema.parse(parsed);
}

function resolveOwnerId(
    config: DiscordGuideConfig,
    secrets: Readonly<Record<string, string>>
): OwnerIdResolution {
    const candidates: readonly (readonly [string | null | undefined, string])[] = [
        [process.env.DISCORD_OWNER_ID, 'exported DISCORD_OWNER_ID'],
        [secrets.DISCORD_OWNER_ID, 'workspace .env'],
        [config.discordOwnerId, 'config.json discordOwnerId'],
        [config.channels?.discord?.ownerId, 'config.json channels.discord.ownerId']
    ];

    for (const [candidate, source] of candidates) {
        const value = candidate?.trim();
        if (!value) continue;
        return { value, source, valid: DiscordOwnerIdSchema.safeParse(value).success };
    }

    return { value: null, source: null, valid: false };
}

function loadGuideState(tarsHome: string): GuideState {
    let config: DiscordGuideConfig = {};
    let configWarning: string | null = null;
    try {
        config = readGuideConfig(tarsHome);
    } catch (error: unknown) {
        configWarning = getErrorMessage(error);
    }

    const secrets = new SecretsManager(tarsHome).load();
    return {
        assistantName: config.assistantName ?? 'Tars',
        owner: resolveOwnerId(config, secrets),
        configWarning
    };
}

function printOwnerDiagnostic(state: GuideState): void {
    console.log(chalk.bold('\nOwner authorization status'));
    if (state.configWarning) {
        console.log(chalk.yellow(`   ⚠ Could not validate config.json: ${state.configWarning}`));
    }

    if (state.owner.valid && state.owner.value) {
        console.log(
            chalk.green(`   ✓ Authorized Discord owner: ${state.owner.value}`) +
                chalk.dim(` (${state.owner.source})`)
        );
        return;
    }

    if (state.owner.value) {
        console.log(
            chalk.yellow(
                `   ⚠ The owner ID from ${state.owner.source} is invalid; use a 17–20 digit Discord user ID.`
            )
        );
        return;
    }

    console.log(
        chalk.yellow(
            '   ⚠ No Discord owner ID is configured. All incoming Discord messages will be ignored.'
        )
    );
}

/**
 * tars discord - Display Discord setup, owner authorization, and invitation instructions.
 */
export function discord(): void {
    const state = loadGuideState(getTarsHome());
    const { assistantName } = state;

    console.log(chalk.bold.cyan(`\n💬 Discord Setup & Invitation Guide (${assistantName})`));
    console.log(chalk.cyan('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
    printOwnerDiagnostic(state);

    console.log(chalk.bold('\n1. 🛠️ Configure your Bot Application'));
    console.log(
        chalk.white('   • Go to: ') + chalk.blue('https://discord.com/developers/applications')
    );
    console.log(chalk.white(`   • Select your ${assistantName} application.`));
    console.log(chalk.white('   • Click ') + chalk.bold('Bot') + chalk.white(' in the sidebar.'));
    console.log(
        chalk.white('   • Toggle ') +
            chalk.bold.red('Message Content Intent') +
            chalk.white(' to ON, then save the change.')
    );

    console.log(chalk.bold('\n2. 👤 Preconfigure the Authorized Owner'));
    console.log(
        chalk.white('   • In Discord, open User Settings → Advanced and enable Developer Mode.')
    );
    console.log(chalk.white('   • Right-click your own profile and select Copy User ID.'));
    console.log(
        chalk.white('   • Run ') +
            chalk.cyan('tars setup') +
            chalk.white(' and enter that 17–20 digit ID when prompted.')
    );
    console.log(
        chalk.white('   • For non-interactive deployments, set ') +
            chalk.cyan('DISCORD_OWNER_ID') +
            chalk.white(' before restarting Tars.')
    );
    console.log(
        chalk.dim(
            '   Discord messages never establish ownership; a missing owner ID denies all messages.'
        )
    );

    console.log(chalk.bold('\n3. 🔗 Generate Invitation Link'));
    console.log(
        chalk.white('   • Click ') +
            chalk.bold('OAuth2') +
            chalk.white(' → ') +
            chalk.bold('URL Generator') +
            chalk.white(' in the sidebar.')
    );
    console.log(chalk.white('   • Scopes: Check ') + chalk.green('bot') + chalk.white('.'));
    console.log(
        chalk.white('   • Bot Permissions: Check ') +
            chalk.green('Send Messages') +
            chalk.white(', ') +
            chalk.green('Read Message History') +
            chalk.white(', and ') +
            chalk.green('View Channels') +
            chalk.white('.')
    );
    console.log(chalk.white('   • Copy the generated URL and open it in a browser.'));

    console.log(chalk.bold('\n4. 🏰 Add to Server'));
    console.log(
        chalk.white('   • Select your server, then click ') + chalk.bold('Authorize') + '.'
    );

    console.log(chalk.bold('\n5. ✅ Verify Installation'));
    console.log(chalk.white(`   • ${assistantName} should appear in your member list.`));
    console.log(
        chalk.white(`   • Once ${assistantName} is running (via `) +
            chalk.cyan('tars start') +
            chalk.white('), send ') +
            chalk.bold(`!${assistantName.toLowerCase()} hello`) +
            chalk.white(' from the configured owner account.')
    );
    console.log('');
}
