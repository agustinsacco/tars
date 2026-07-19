import chalk from 'chalk';
import inquirer from 'inquirer';
import ora from 'ora';
import { refreshExtensions, refreshDashboard } from './refresh.js';
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { Client, GatewayIntentBits } from 'discord.js';
import { BrainAuditor } from '../../utils/brain-audit.js';
import { getTarsHome } from '../../utils/paths.js';
import { SecretsManager } from '../../utils/secrets-manager.js';
import { migrateLegacyConfig } from '../../utils/migration-manager.js';
import crypto from 'node:crypto';
import { z } from 'zod';
import { RuntimeConfigSchema } from '../../config/schema.js';
import { withTarsHomeMutationLease } from '../../utils/tars-home-lease.js';
import { migrateMcpPoliciesInteractively } from './extensions.js';

const ExistingSetupConfigSchema = z
    .object({
        assistantName: z.string().optional(),
        contextWindowTokens: z.coerce.number().optional(),
        discordOwnerId: z.string().nullable().optional(),
        discordToken: z.string().optional(),
        heartbeatIntervalSec: z.coerce.number().optional(),
        piBaseUrl: z.string().optional(),
        piModel: z.string().optional(),
        piProvider: z.string().optional(),
        channels: z.record(z.unknown()).optional()
    })
    .passthrough();

type ExistingSetupConfig = z.infer<typeof ExistingSetupConfigSchema>;

function getDiscordConfig(config: ExistingSetupConfig): Record<string, unknown> {
    const discord = config.channels?.discord;
    const parsed = z.record(z.unknown()).safeParse(discord);
    return parsed.success ? parsed.data : {};
}

export function removeLegacyDiscordToken(
    discordConfig: Record<string, unknown>
): Record<string, unknown> {
    const { token: _legacyToken, ...safeConfig } = discordConfig;
    return safeConfig;
}

async function writePrivateJson(filePath: string, value: unknown): Promise<void> {
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

/**
 * tars setup - The Onboarding Wizard
 */
export async function setup(): Promise<void> {
    const tarsHome = getTarsHome();
    await withTarsHomeMutationLease(tarsHome, 'configure Tars', () => setupWithLease(tarsHome));
}

async function setupWithLease(tarsHome: string): Promise<void> {
    console.log(chalk.cyan.bold('\n🤖 Welcome to Tars Setup! (Pi Agent SDK Edition)'));
    console.log(chalk.cyan('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n'));

    // ── Prerequisites ──────────────────────────────────────
    const spinner = ora('Checking prerequisites...').start();

    // Check Node version
    const nodeVersion = process.versions.node;
    const nodeMajor = parseInt(nodeVersion.split('.')[0], 10);
    if (nodeMajor < 22) {
        spinner.fail(`Node.js ≥ 22 required (found ${nodeVersion})`);
        process.exit(1);
    }

    spinner.succeed(`Prerequisites met (Node ${nodeVersion})`);

    // Run automated migration manager
    await migrateLegacyConfig(tarsHome);

    // Load existing config for defaults
    let existingConfig: ExistingSetupConfig = {};
    const existingConfigPath = path.join(tarsHome, 'config.json');
    if (fsSync.existsSync(existingConfigPath)) {
        const data = await fs.readFile(existingConfigPath, 'utf-8');
        const parsed: unknown = JSON.parse(data);
        existingConfig = ExistingSetupConfigSchema.parse(parsed);
    }

    const secretsManager = new SecretsManager(tarsHome);
    const secrets = secretsManager.load();

    // ══════════════════════════════════════════════════════════
    // ── Step 1: Model Provider ────────────────────────────────
    // ══════════════════════════════════════════════════════════
    console.log(chalk.bold('\nStep 1: Model Provider'));
    console.log(chalk.dim('──────────────────────'));
    console.log(chalk.dim('  Choose the AI provider and API configurations for Tars.'));

    const { piProvider } = await inquirer.prompt([
        {
            type: 'list',
            name: 'piProvider',
            message: 'Select AI Model Provider:',
            choices: [
                { name: 'Google (Gemini SDK / API Key)', value: 'google' },
                { name: 'OpenAI (GPT-4o, etc.)', value: 'openai' },
                { name: 'Anthropic (Claude 3.5 Sonnet, etc.)', value: 'anthropic' },
                { name: 'Local (Llama.cpp, Ollama, LM Studio, etc.)', value: 'local' },
                { name: 'Custom (OpenAI-compatible proxy/local endpoint)', value: 'custom' }
            ],
            default:
                existingConfig.piProvider === 'local-stark'
                    ? 'local'
                    : existingConfig.piProvider || 'google'
        }
    ]);

    // ══════════════════════════════════════════════════════════
    // ── Step 2: Credentials & Model Configuration ─────────────
    // ══════════════════════════════════════════════════════════
    console.log(chalk.bold('\nStep 2: Credentials & Model ID'));
    console.log(chalk.dim('──────────────────────────────'));

    let piBaseUrl = '';
    let piApiKey = '';
    let defaultModel = '';

    if (piProvider === 'google') {
        const answers = await inquirer.prompt([
            {
                type: 'password',
                name: 'apiKey',
                message: 'Enter TARS_API_KEY (Google Cloud API Key):',
                default:
                    secrets.TARS_API_KEY ||
                    secrets.GEMINI_API_KEY ||
                    process.env.TARS_API_KEY ||
                    process.env.GEMINI_API_KEY ||
                    '',
                validate: (input) => input.length > 0 || 'API Key is required'
            }
        ]);
        piApiKey = answers.apiKey;
        secretsManager.set('TARS_API_KEY', piApiKey);
        process.env.TARS_API_KEY = piApiKey;
        secretsManager.set('GEMINI_API_KEY', piApiKey);
        process.env.GEMINI_API_KEY = piApiKey;
        defaultModel = 'gemini-2.5-flash';
    } else if (piProvider === 'openai') {
        const answers = await inquirer.prompt([
            {
                type: 'password',
                name: 'apiKey',
                message: 'Enter OPENAI_API_KEY:',
                default: secrets.OPENAI_API_KEY || process.env.OPENAI_API_KEY || '',
                validate: (input) => input.length > 0 || 'API Key is required'
            }
        ]);
        piApiKey = answers.apiKey;
        secretsManager.set('OPENAI_API_KEY', piApiKey);
        process.env.OPENAI_API_KEY = piApiKey;
        defaultModel = 'gpt-4o';
    } else if (piProvider === 'anthropic') {
        const answers = await inquirer.prompt([
            {
                type: 'password',
                name: 'apiKey',
                message: 'Enter ANTHROPIC_API_KEY:',
                default: secrets.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY || '',
                validate: (input) => input.length > 0 || 'API Key is required'
            }
        ]);
        piApiKey = answers.apiKey;
        secretsManager.set('ANTHROPIC_API_KEY', piApiKey);
        process.env.ANTHROPIC_API_KEY = piApiKey;
        defaultModel = 'claude-3-5-sonnet-latest';
    } else if (piProvider === 'local' || piProvider === 'local-stark') {
        const answers = await inquirer.prompt([
            {
                type: 'input',
                name: 'baseUrl',
                message: 'Local Endpoint URL:',
                default: existingConfig.piBaseUrl || 'http://localhost:8080/v1',
                validate: (input) =>
                    RuntimeConfigSchema.shape.piBaseUrl.safeParse(input).success ||
                    'Enter an HTTP or HTTPS URL'
            },
            {
                type: 'password',
                name: 'apiKey',
                message: 'Local API Key (press Enter to skip):',
                default: secrets.LOCAL_API_KEY || secrets.STARK_API_KEY || ''
            }
        ]);
        piBaseUrl = answers.baseUrl;
        piApiKey = answers.apiKey;
        secretsManager.set('LOCAL_API_KEY', piApiKey);
        process.env.LOCAL_API_KEY = piApiKey;
        defaultModel = 'qwen2.5-coder-7b';
    } else {
        const answers = await inquirer.prompt([
            {
                type: 'input',
                name: 'baseUrl',
                message: 'Custom Endpoint Base URL:',
                default: existingConfig.piBaseUrl || 'http://localhost:8080/v1',
                validate: (input) =>
                    RuntimeConfigSchema.shape.piBaseUrl.safeParse(input).success ||
                    'Enter an HTTP or HTTPS URL'
            },
            {
                type: 'password',
                name: 'apiKey',
                message: 'Custom Endpoint API Key (press Enter to skip):',
                default: secrets.CUSTOM_API_KEY || ''
            }
        ]);
        piBaseUrl = answers.baseUrl;
        piApiKey = answers.apiKey;
        secretsManager.set('CUSTOM_API_KEY', piApiKey);
        process.env.CUSTOM_API_KEY = piApiKey;
        defaultModel = 'custom-model';
    }

    const { piModel } = await inquirer.prompt([
        {
            type: 'input',
            name: 'piModel',
            message: `Enter Model ID (default recommended: ${defaultModel}):`,
            default: existingConfig.piModel || defaultModel,
            validate: (input) => input.length > 0 || 'Model ID is required'
        }
    ]);

    // ══════════════════════════════════════════════════════════
    // ── Step 2.5: Context Window & Compaction Settings ───────
    // ══════════════════════════════════════════════════════════
    console.log(chalk.bold('\nStep 2.5: Context Window & Compaction'));
    console.log(chalk.dim('─────────────────────────────────────'));

    const isCloud = ['google', 'openai', 'anthropic'].includes(piProvider);
    const defaultContextWindow = isCloud ? 128000 : 8192;

    const limitAnswers = await inquirer.prompt([
        {
            type: 'number',
            name: 'contextWindowTokens',
            message: 'Context Window Size (in tokens):',
            default: existingConfig.contextWindowTokens || defaultContextWindow,
            validate: (input: unknown) =>
                RuntimeConfigSchema.shape.contextWindowTokens.safeParse(input).success ||
                'Must be an integer from 1 to 10000000'
        }
    ]);

    // ══════════════════════════════════════════════════════════
    // ── Step 3: Communication Channel ─────────────────────────
    // ══════════════════════════════════════════════════════════
    console.log(chalk.bold('\nStep 3: Communication Channel'));
    console.log(chalk.dim('─────────────────────────────'));

    const existingDiscord = getDiscordConfig(existingConfig);
    const preservedDiscord = removeLegacyDiscordToken(existingDiscord);
    let discordToken =
        existingConfig.discordToken ||
        (typeof existingDiscord.token === 'string' ? existingDiscord.token : '') ||
        secrets.DISCORD_TOKEN ||
        '';
    let skipDiscord = false;

    if (discordToken) {
        console.log(chalk.green('  ✓ Discord token already configured.'));
        const { reAuthDiscord } = await inquirer.prompt([
            {
                type: 'confirm',
                name: 'reAuthDiscord',
                message: 'Do you want to update the Discord Bot Token?',
                default: false
            }
        ]);
        if (!reAuthDiscord) skipDiscord = true;
    }

    if (!skipDiscord) {
        const answers = await inquirer.prompt([
            {
                type: 'password',
                name: 'discordToken',
                message: 'Enter Discord Bot Token:',
                validate: (input) =>
                    input.length > 50 ||
                    'Token too short — paste the full token from the Developer Portal'
            }
        ]);
        discordToken = answers.discordToken;

        const validateSpinner = ora('Validating Discord token...').start();
        try {
            const client = new Client({
                intents: [
                    GatewayIntentBits.Guilds,
                    GatewayIntentBits.GuildMessages,
                    GatewayIntentBits.MessageContent,
                    GatewayIntentBits.DirectMessages
                ]
            });
            await client.login(discordToken);
            const botName = client.user?.tag;
            client.destroy();
            validateSpinner.succeed(`Discord Token valid! Bot: ${chalk.bold(botName)}`);
        } catch {
            validateSpinner.fail('Invalid Discord token. Check your token and try again.');
            process.exit(1);
        }
    }

    secretsManager.set('DISCORD_TOKEN', discordToken);
    process.env.DISCORD_TOKEN = discordToken;

    const configuredOwnerId =
        existingConfig.discordOwnerId ||
        (typeof existingDiscord.ownerId === 'string' ? existingDiscord.ownerId : '');
    const { discordOwnerId } = await inquirer.prompt<{ discordOwnerId: string }>([
        {
            type: 'input',
            name: 'discordOwnerId',
            message: 'Discord owner user ID (enable Developer Mode, then Copy User ID):',
            default: configuredOwnerId,
            validate: (input: string) =>
                /^\d{17,20}$/.test(input.trim()) || 'Enter a valid 17-20 digit Discord user ID'
        }
    ]);

    // ══════════════════════════════════════════════════════════
    // ── Step 4: Identity ──────────────────────────────────────
    // ══════════════════════════════════════════════════════════
    console.log(chalk.bold('\nStep 4: Identity'));
    console.log(chalk.dim('────────────────'));

    const identityConfig = await inquirer.prompt([
        {
            type: 'input',
            name: 'assistantName',
            message: 'Assistant Name (Display identity):',
            default: existingConfig.assistantName || 'Tars',
            validate: (input: unknown) =>
                RuntimeConfigSchema.shape.assistantName.safeParse(input).success ||
                'Assistant name must contain 1-100 characters'
        },
        {
            type: 'list',
            name: 'heartbeatMinutes',
            message: 'Heartbeat Interval (How often Tars checks in):',
            choices: [
                { name: '30 Minutes (Recommended)', value: 30 },
                { name: '1 Hour', value: 60 },
                { name: '2 Hours', value: 120 },
                { name: '4 Hours', value: 240 },
                { name: 'Custom', value: 'custom' }
            ],
            default: existingConfig.heartbeatIntervalSec
                ? Math.floor(existingConfig.heartbeatIntervalSec / 60)
                : 30
        },
        {
            type: 'input',
            name: 'customHeartbeat',
            message: 'Enter custom heartbeat interval in minutes:',
            when: (answers) => answers.heartbeatMinutes === 'custom',
            validate: (input) => {
                const n = parseInt(input, 10);
                return (
                    (!isNaN(n) &&
                        RuntimeConfigSchema.shape.heartbeatIntervalSec.safeParse(n * 60).success) ||
                    'Must be between 1 and 1440 minutes'
                );
            }
        }
    ]);

    // ══════════════════════════════════════════════════════════
    // ── Step 5: Tars Dashboard ────────────────────────────────
    // ══════════════════════════════════════════════════════════
    console.log(chalk.bold('\nStep 5: Tars Dashboard'));
    console.log(chalk.dim('──────────────────────'));

    const generatedDashPassword = crypto.randomBytes(24).toString('base64url');
    const existingDashPassword = secrets.DASH_PASSWORD;
    const normalizedDashPassword = existingDashPassword?.trim().toLowerCase();
    const defaultDashPassword =
        existingDashPassword &&
        normalizedDashPassword &&
        normalizedDashPassword.length >= 16 &&
        !['changeme', 'tars123'].includes(normalizedDashPassword)
            ? existingDashPassword
            : generatedDashPassword;

    const dashConfig = await inquirer.prompt([
        {
            type: 'confirm',
            name: 'enableDash',
            message: 'Enable Tars Dashboard (Web UI)?',
            default: secrets.DASH_ENABLED === 'true'
        },
        {
            type: 'input',
            name: 'dashHost',
            message: 'Dashboard Host:',
            default: secrets.DASH_HOST || '127.0.0.1',
            when: (a) => a.enableDash,
            validate: (input) => input.trim().length > 0 || 'Host is required'
        },
        {
            type: 'input',
            name: 'dashPort',
            message: 'Dashboard Port:',
            default: secrets.DASH_PORT || '3000',
            when: (a) => a.enableDash,
            validate: (input) => {
                const value = Number(input);
                return (
                    (Number.isInteger(value) && value >= 1 && value <= 65_535) ||
                    'Port must be an integer between 1 and 65535'
                );
            }
        },
        {
            type: 'password',
            name: 'dashPassword',
            message: 'Set Dashboard Password:',
            default: defaultDashPassword,
            when: (a) => a.enableDash,
            validate: (input) => {
                if (['changeme', 'tars123'].includes(input.trim().toLowerCase())) {
                    return 'Choose a password other than a known default';
                }
                return input.trim().length >= 16 || 'Password must contain at least 16 characters';
            }
        },
        {
            type: 'confirm',
            name: 'updateDash',
            message: 'Dashboard already installed. Reinstall/overwrite with latest version?',
            default: false,
            when: (a) => a.enableDash && fsSync.existsSync(path.join(tarsHome, 'apps', 'dashboard'))
        }
    ]);

    if (dashConfig.enableDash) {
        secretsManager.set('DASH_ENABLED', 'true');
        secretsManager.set('DASH_HOST', dashConfig.dashHost.trim());
        secretsManager.set('DASH_PORT', dashConfig.dashPort);
        secretsManager.set('DASH_PASSWORD', dashConfig.dashPassword);
        console.log(chalk.green('  ✓ Dashboard configuration saved.'));
    } else {
        secretsManager.set('DASH_ENABLED', 'false');
    }

    // ══════════════════════════════════════════════════════════
    // ── Step 6: Installing ────────────────────────────────────
    // ══════════════════════════════════════════════════════════
    console.log(chalk.bold('\nStep 6: Installing'));
    console.log(chalk.dim('──────────────────'));

    // Provision isolated environment
    const installSpinner = ora('Provisioning environment...').start();

    await fs.mkdir(path.join(tarsHome, 'data', 'uploads'), { recursive: true });
    await fs.mkdir(path.join(tarsHome, 'logs'), { recursive: true });
    await fs.mkdir(path.join(tarsHome, 'apps'), { recursive: true });
    await fs.mkdir(path.join(tarsHome, 'extensions'), { recursive: true });
    await fs.mkdir(path.join(tarsHome, 'tmp'), { recursive: true });
    await fs.mkdir(path.join(tarsHome, 'chats'), { recursive: true });

    installSpinner.succeed('Directories created (~/.tars/)');

    // Audit and heal only after the workspace exists so metadata is always created.
    const auditor = new BrainAuditor(tarsHome);
    await auditor.audit({ silent: true });

    // Legacy Cleanup
    const cleanupSpinner = ora('Checking for legacy components...').start();
    const oldDash = path.join(tarsHome, 'dashboard');
    if (fsSync.existsSync(oldDash)) {
        await fs.rm(oldDash, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
        cleanupSpinner.text = 'Cleaned up legacy dashboard directory.';
    }
    cleanupSpinner.succeed('Cleanup complete.');

    // Save final configuration
    const saveSpinner = ora('Saving configuration...').start();
    const intervalSec =
        (identityConfig.heartbeatMinutes === 'custom'
            ? identityConfig.customHeartbeat
            : identityConfig.heartbeatMinutes) * 60;

    const { discordToken: _legacyDiscordToken, ...preservedConfig } = existingConfig;
    const configData = {
        ...preservedConfig,
        assistantName: identityConfig.assistantName,
        discordOwnerId: discordOwnerId.trim(),
        piProvider,
        piModel,
        piBaseUrl,
        heartbeatIntervalSec: intervalSec,
        inferenceBackend: 'tars',
        contextWindowTokens: limitAnswers.contextWindowTokens,
        channels: {
            ...(existingConfig.channels ?? {}),
            discord: {
                ...preservedDiscord,
                enabled: true,
                ownerId: discordOwnerId.trim()
            }
        },
        primaryChannel: existingConfig.primaryChannel ?? 'discord'
    };

    RuntimeConfigSchema.parse({ ...configData, discordToken });
    await writePrivateJson(path.join(tarsHome, 'config.json'), configData);
    saveSpinner.succeed('Configuration saved.');

    // Hydrate extensions
    const extensionsRefreshed = await refreshExtensions(tarsHome);
    if (!extensionsRefreshed) {
        throw new Error('Extension installation failed. Setup did not complete.');
    }
    const extensionPolicyMigration = await migrateMcpPoliciesInteractively(tarsHome);

    // Hydrate Dashboard if enabled
    if (dashConfig.enableDash) {
        const dashDest = path.join(tarsHome, 'apps', 'dashboard');
        const needsInstall = !fsSync.existsSync(dashDest) || dashConfig.updateDash;
        if (needsInstall) {
            const dashboardRefreshed = await refreshDashboard(tarsHome);
            if (!dashboardRefreshed) {
                throw new Error('Dashboard installation failed. Setup did not complete.');
            }
        } else {
            console.log(chalk.green('  ✓ Dashboard already installed. Skipping.'));
            console.log(chalk.dim('    Run "tars refresh" to force-update the dashboard.'));
        }
    }

    // Done
    if (extensionPolicyMigration.ready) {
        console.log(chalk.green.bold('\n✅ Tars is ready!'));
    } else {
        console.log(
            chalk.yellow.bold('\n⚠️ Core setup is complete; custom extensions need review.')
        );
    }
    console.log(chalk.dim(`\n  Provider:       ${piProvider}`));
    console.log(chalk.dim(`  Model:          ${piModel}`));
    if (piBaseUrl) {
        console.log(chalk.dim(`  Base URL:       ${piBaseUrl}`));
    }
    console.log(`\n  Start Tars:     ${chalk.cyan('tars start')}`);
    console.log(`  Check status:   ${chalk.cyan('tars status')}`);
    console.log(`  View logs:      ${chalk.cyan('tars logs')}`);
    if (!extensionPolicyMigration.ready) {
        console.log(
            chalk.yellow(
                `\n  Custom extensions remain disabled. Run: ${chalk.cyan('tars extensions migrate')}`
            )
        );
    }
}
