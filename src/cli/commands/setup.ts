import chalk from 'chalk';
import inquirer from 'inquirer';
import ora from 'ora';
import { execSync, spawnSync } from 'child_process';
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

/**
 * tars setup - The Onboarding Wizard
 */
export async function setup() {
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

    const tarsHome = getTarsHome();
    spinner.succeed(`Prerequisites met (Node ${nodeVersion})`);

    // Run automated migration manager
    await migrateLegacyConfig(tarsHome);

    // Load existing config for defaults
    let existingConfig: any = {};
    try {
        const data = await fs.readFile(path.join(tarsHome, 'config.json'), 'utf-8');
        existingConfig = JSON.parse(data);
    } catch {
        /* ignore */
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
                { name: 'Local Stark (Qwen 3.6 @ stark:8086)', value: 'local-stark' },
                { name: 'Custom (OpenAI-compatible proxy/local endpoint)', value: 'custom' }
            ],
            default: existingConfig.piProvider || 'google'
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
                message: 'Enter GEMINI_API_KEY:',
                default: secrets.GEMINI_API_KEY || process.env.GEMINI_API_KEY || '',
                validate: (input) => input.length > 0 || 'API Key is required'
            }
        ]);
        piApiKey = answers.apiKey;
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
    } else if (piProvider === 'local-stark') {
        const answers = await inquirer.prompt([
            {
                type: 'input',
                name: 'baseUrl',
                message: 'Stark Endpoint URL:',
                default: existingConfig.piBaseUrl || 'http://stark:8086/v1'
            },
            {
                type: 'password',
                name: 'apiKey',
                message: 'Stark API Key:',
                default: secrets.STARK_API_KEY || 'dummy-key'
            }
        ]);
        piBaseUrl = answers.baseUrl;
        piApiKey = answers.apiKey;
        secretsManager.set('STARK_API_KEY', piApiKey);
        process.env.STARK_API_KEY = piApiKey;
        defaultModel = 'Qwen3.6-35B-A3B-Q8';
    } else {
        const answers = await inquirer.prompt([
            {
                type: 'input',
                name: 'baseUrl',
                message: 'Custom Endpoint Base URL:',
                default: existingConfig.piBaseUrl || 'http://localhost:8080/v1',
                validate: (input) => {
                    try {
                        new URL(input);
                        return true;
                    } catch {
                        return 'Invalid URL';
                    }
                }
            },
            {
                type: 'password',
                name: 'apiKey',
                message: 'Custom Endpoint API Key:',
                default: secrets.CUSTOM_API_KEY || 'dummy-key'
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
    // ── Step 3: Communication Channel ─────────────────────────
    // ══════════════════════════════════════════════════════════
    console.log(chalk.bold('\nStep 3: Communication Channel'));
    console.log(chalk.dim('─────────────────────────────'));

    let discordToken = existingConfig.discordToken || existingConfig.channels?.discord?.token || '';
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
        } catch (err: any) {
            validateSpinner.fail('Invalid Discord token. Check your token and try again.');
            process.exit(1);
        }
    }

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
            default: existingConfig.assistantName || 'Tars'
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
                return (!isNaN(n) && n > 0) || 'Must be a positive number';
            }
        }
    ]);

    // ══════════════════════════════════════════════════════════
    // ── Step 5: Integrations ──────────────────────────────────
    // ══════════════════════════════════════════════════════════
    console.log(chalk.bold('\nStep 5: Integrations'));
    console.log(chalk.dim('────────────────────'));
    console.log(chalk.dim('  Workspace integration has been deprecated. Skipping.'));

    // ══════════════════════════════════════════════════════════
    // ── Step 6: Tars Dashboard ────────────────────────────────
    // ══════════════════════════════════════════════════════════
    console.log(chalk.bold('\nStep 6: Tars Dashboard'));
    console.log(chalk.dim('──────────────────────'));

    const dashConfig = await inquirer.prompt([
        {
            type: 'confirm',
            name: 'enableDash',
            message: 'Enable Tars Dashboard (Web UI)?',
            default: true
        },
        {
            type: 'input',
            name: 'dashPort',
            message: 'Dashboard Port:',
            default: '3000',
            when: (a) => a.enableDash
        },
        {
            type: 'password',
            name: 'dashPassword',
            message: 'Set Dashboard Password:',
            default: secrets.DASH_PASSWORD || 'tars123',
            when: (a) => a.enableDash
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
        secretsManager.set('DASH_PORT', dashConfig.dashPort);
        secretsManager.set('DASH_PASSWORD', dashConfig.dashPassword);
        console.log(chalk.green('  ✓ Dashboard configuration saved.'));
    }

    // ══════════════════════════════════════════════════════════
    // ── Step 7: Swarm Mode ────────────────────────────────────
    // ══════════════════════════════════════════════════════════
    console.log(chalk.bold('\nStep 7: Swarm Mode (A2A)'));
    console.log(chalk.dim('────────────────────────'));
    console.log(chalk.dim('  Allow other Tars instances to discover and'));
    console.log(chalk.dim('  delegate tasks to this agent using the A2A protocol.'));

    const existingSwarm = existingConfig.swarm || {};
    const existingSwarmKey = secrets.SWARM_API_KEY || '';

    const swarmConfig = await inquirer.prompt([
        {
            type: 'confirm',
            name: 'enableSwarm',
            message: 'Enable Swarm Mode (allow other agents to connect)?',
            default: existingSwarm.enabled || false
        },
        {
            type: 'input',
            name: 'swarmPort',
            message: 'Swarm API Port:',
            default: String(existingSwarm.port || '3100'),
            when: (a) => a.enableSwarm,
            validate: (input: string) => {
                const n = parseInt(input, 10);
                if (isNaN(n) || n < 1024 || n > 65535) {
                    return 'Port must be a number between 1024 and 65535';
                }
                return true;
            }
        },
        {
            type: 'input',
            name: 'swarmDescription',
            message: 'Instance description (for other agents):',
            default:
                existingSwarm.description ||
                `${identityConfig.assistantName || 'Tars'} — Autonomous AI assistant`,
            when: (a) => a.enableSwarm
        }
    ]);

    if (swarmConfig.enableSwarm) {
        const apiKey = existingSwarmKey || `tars_swarm_${crypto.randomBytes(24).toString('hex')}`;
        secretsManager.set('SWARM_API_KEY', apiKey);

        console.log(chalk.green('  ✓ Swarm mode configured.'));
        console.log(chalk.dim(`  Port: ${swarmConfig.swarmPort}`));
        console.log(
            chalk.dim(
                `  API Key: ${apiKey.substring(0, 16)}...${apiKey.substring(apiKey.length - 4)}`
            )
        );
        console.log('');
        console.log(chalk.dim('  To register this instance on another Tars, run:'));
        console.log(
            chalk.cyan(
                `  tars swarm add --name ${(identityConfig.assistantName || 'tars').toLowerCase()} \\`
            )
        );
        console.log(
            chalk.cyan(
                `    --url http://<this-host>:${swarmConfig.swarmPort}/.well-known/agent.json \\`
            )
        );
        console.log(chalk.cyan(`    --key ${apiKey}`));
    }

    // ══════════════════════════════════════════════════════════
    // ── Step 8: Installing ────────────────────────────────────
    // ══════════════════════════════════════════════════════════
    console.log(chalk.bold('\nStep 8: Installing'));
    console.log(chalk.dim('──────────────────'));

    // Audit and Heal
    const auditor = new BrainAuditor(tarsHome);
    await auditor.audit({ silent: true });

    // Provision isolated environment
    const installSpinner = ora('Provisioning environment...').start();
    const geminiDir = path.join(tarsHome, '.gemini');

    await fs.mkdir(path.join(tarsHome, 'data', 'uploads'), { recursive: true });
    await fs.mkdir(path.join(tarsHome, 'logs'), { recursive: true });
    await fs.mkdir(path.join(tarsHome, 'apps'), { recursive: true });
    await fs.mkdir(path.join(geminiDir, 'extensions'), { recursive: true });
    await fs.mkdir(path.join(geminiDir, 'tmp'), { recursive: true });
    await fs.mkdir(path.join(geminiDir, 'history'), { recursive: true });

    installSpinner.succeed('Directories created (~/.tars/.gemini/)');

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

    const configData: any = {
        assistantName: identityConfig.assistantName,
        discordToken,
        discordOwnerId: existingConfig.discordOwnerId,
        piProvider,
        piModel,
        piBaseUrl,
        heartbeatIntervalSec: intervalSec,
        inferenceBackend: 'pi'
    };

    if (swarmConfig.enableSwarm) {
        configData.swarm = {
            enabled: true,
            port: parseInt(swarmConfig.swarmPort, 10),
            description: swarmConfig.swarmDescription || '',
            skills: existingSwarm.skills || []
        };
    }

    await fs.writeFile(path.join(tarsHome, 'config.json'), JSON.stringify(configData, null, 2));
    saveSpinner.succeed('Configuration saved.');

    // Hydrate extensions
    await refreshExtensions(tarsHome);

    // Hydrate Dashboard if enabled
    if (dashConfig.enableDash) {
        const dashDest = path.join(tarsHome, 'apps', 'dashboard');
        const needsInstall = !fsSync.existsSync(dashDest) || dashConfig.updateDash;
        if (needsInstall) {
            await refreshDashboard(tarsHome);
        } else {
            console.log(chalk.green('  ✓ Dashboard already installed. Skipping.'));
            console.log(chalk.dim('    Run "tars refresh" to force-update the dashboard.'));
        }
    }

    // Done
    console.log(chalk.green.bold('\n✅ Tars is ready!'));
    console.log(chalk.dim(`\n  Provider:       ${piProvider}`));
    console.log(chalk.dim(`  Model:          ${piModel}`));
    if (piBaseUrl) {
        console.log(chalk.dim(`  Base URL:       ${piBaseUrl}`));
    }
    console.log(`\n  Start Tars:     ${chalk.cyan('tars start')}`);
    console.log(`  Check status:   ${chalk.cyan('tars status')}`);
    console.log(`  View logs:      ${chalk.cyan('tars logs')}`);
}
