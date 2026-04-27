import chalk from 'chalk';
import inquirer from 'inquirer';
import ora from 'ora';
import { execSync, spawnSync } from 'child_process';
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { Client, GatewayIntentBits } from 'discord.js';
import { TarsOAuthService } from '../../auth/oauth-service.js';
import { WorkspaceOAuthService } from '../../auth/workspace-auth-service.js';
import { BrainAuditor } from '../../utils/brain-audit.js';
import { getTarsHome } from '../../utils/paths.js';
import { SecretsManager } from '../../utils/secrets-manager.js';
import crypto from 'node:crypto';

/**
 * Check if the isolated tars environment is authenticated
 */
async function checkTarsAuth(tarsHome: string): Promise<boolean> {
    const oauthService = new TarsOAuthService(tarsHome);
    return await oauthService.isAuthenticated();
}

/**
 * Helper to setup Workspace Auth
 */
async function setupWorkspaceAuth(tarsHome: string, wsService: WorkspaceOAuthService) {
    const secretsManager = new SecretsManager(tarsHome);
    const secrets = secretsManager.load();

    if (!secrets.GOOGLE_WORKSPACE_CLIENT_ID || !secrets.GOOGLE_WORKSPACE_CLIENT_SECRET) {
        console.log(
            chalk.yellow('\n  Workspace integration requires an OAuth Client ID and Secret.')
        );
        console.log(chalk.dim('  Create one in the Google Cloud Console (Desktop App type).'));

        const answers = await inquirer.prompt([
            {
                type: 'input',
                name: 'clientId',
                message: '  Enter Google Workspace Client ID:',
                default: secrets.GOOGLE_WORKSPACE_CLIENT_ID,
                validate: (i) => i.length > 10 || 'Required'
            },
            {
                type: 'password',
                name: 'clientSecret',
                message: '  Enter Google Workspace Client Secret:',
                default: secrets.GOOGLE_WORKSPACE_CLIENT_SECRET,
                validate: (i) => i.length > 5 || 'Required'
            }
        ]);

        secretsManager.set('GOOGLE_WORKSPACE_CLIENT_ID', answers.clientId);
        secretsManager.set('GOOGLE_WORKSPACE_CLIENT_SECRET', answers.clientSecret);

        // Refresh env for the service
        process.env.GOOGLE_WORKSPACE_CLIENT_ID = answers.clientId;
        process.env.GOOGLE_WORKSPACE_CLIENT_SECRET = answers.clientSecret;
    }

    await wsService.login();
}

/**
 * tars setup - The Onboarding Wizard
 */
export async function setup() {
    console.log(chalk.cyan.bold('\n🤖 Welcome to Tars Setup!'));
    console.log(chalk.cyan('━━━━━━━━━━━━━━━━━━━━━━━━\n'));

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

    // Load existing config for defaults
    let existingConfig: any = {};
    try {
        const data = await fs.readFile(path.join(tarsHome, 'config.json'), 'utf-8');
        existingConfig = JSON.parse(data);
    } catch {
        /* ignore */
    }

    // ══════════════════════════════════════════════════════════
    // ── Step 1: Inference Backend ─────────────────────────────
    // This is asked FIRST because it determines the entire flow.
    // ══════════════════════════════════════════════════════════
    console.log(chalk.bold('\nStep 1: Inference Backend'));
    console.log(chalk.dim('─────────────────────────'));
    console.log(chalk.dim("  Choose how Tars will think. Gemini uses Google's cloud"));
    console.log(chalk.dim('  models (free tier included). Local runs your own model.'));

    const { inferenceBackend } = await inquirer.prompt([
        {
            type: 'list',
            name: 'inferenceBackend',
            message: 'How should Tars run inference?',
            choices: [
                {
                    name: `☁️  Gemini Cloud ${chalk.dim('— Google AI, free tier, tool-calling, no GPU needed')}`,
                    value: 'gemini'
                },
                {
                    name: `🖥️  Local Model ${chalk.dim('— LlamaCpp / OpenAI-compatible endpoint, runs on your hardware')}`,
                    value: 'llamacpp'
                }
            ],
            default: existingConfig.inferenceBackend || 'gemini'
        }
    ]);

    const isLocal = inferenceBackend === 'llamacpp';

    // ══════════════════════════════════════════════════════════
    // ── Step 2: Authentication ────────────────────────────────
    // Gemini: Google OAuth required. Local: skipped entirely.
    // ══════════════════════════════════════════════════════════
    console.log(chalk.bold('\nStep 2: Authentication'));
    console.log(chalk.dim('──────────────────────'));

    if (isLocal) {
        console.log(chalk.green('  ✓ Local inference selected — no cloud authentication needed.'));
        console.log(chalk.dim('  Tars will connect directly to your local model endpoint.'));
    } else {
        const isAuthed = await checkTarsAuth(tarsHome);
        let performAuth = false;

        if (isAuthed) {
            console.log(chalk.green('  ✓ Already authenticated with Google.'));
            const { reAuth } = await inquirer.prompt([
                {
                    type: 'confirm',
                    name: 'reAuth',
                    message: 'Do you want to re-authenticate with a different account?',
                    default: false
                }
            ]);
            performAuth = reAuth;
        } else {
            const { authNow } = await inquirer.prompt([
                {
                    type: 'confirm',
                    name: 'authNow',
                    message:
                        'Gemini requires Google OAuth for inference. Continue with authentication?',
                    default: true
                }
            ]);
            performAuth = authNow;
        }

        if (performAuth) {
            console.log(chalk.cyan('\n  Running Google Authentication...'));
            console.log(chalk.dim('  1. Copy the URL provided below into Chrome.'));
            console.log(chalk.dim('  2. Sign in and copy the authorization code.'));
            console.log(chalk.dim('  3. Paste the code back here.'));
            console.log(chalk.dim('  -----------------------------------'));

            try {
                const oauthService = new TarsOAuthService(tarsHome);
                await oauthService.login(isAuthed);

                const freshStatus = await oauthService.isAuthenticated();
                if (freshStatus) {
                    console.log(chalk.green('  ✓ Authentication successful!'));
                } else {
                    console.log(chalk.yellow('  ⚠ Warning: Could not verify authentication.'));
                }
            } catch (err: any) {
                console.error(chalk.red(`  Failed to authenticate: ${err.message}`));
            }
        } else if (!isAuthed) {
            console.log(
                chalk.yellow(
                    '  Skipped. Tars will not be able to communicate with Gemini without auth.'
                )
            );
        }
    }

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
    // ── Step 4: Identity & Engine ─────────────────────────────
    // The questions differ based on inference backend.
    // ══════════════════════════════════════════════════════════
    console.log(chalk.bold('\nStep 4: Identity & Engine'));
    console.log(chalk.dim('─────────────────────────'));

    let config: any = {};

    if (isLocal) {
        console.log(chalk.dim('  Configure your local inference endpoint and context limits.'));
        console.log(
            chalk.dim('  Use a model with tool-calling support (Qwen 3.5, Llama 3.1, etc.).')
        );

        // Step 4a: Collect basic identity + endpoint URL
        const basicConfig = await inquirer.prompt([
            {
                type: 'input',
                name: 'assistantName',
                message: 'Assistant Name (Display identity):',
                default: existingConfig.assistantName || 'Tars'
            },
            {
                type: 'input',
                name: 'localInferenceUrl',
                message: 'Local Inference URL (OpenAI-compatible endpoint):',
                default: existingConfig.localInferenceUrl || 'http://localhost:8080',
                validate: (input: string) => {
                    try {
                        new URL(input);
                        return true;
                    } catch {
                        return 'Please enter a valid URL (e.g., http://localhost:8080)';
                    }
                }
            }
        ]);

        // Step 4b: Probe the endpoint for health + available models
        const { probeEndpoint } = await import('../../utils/endpoint-probe.js');
        const probeSpinner = ora(`Testing endpoint ${basicConfig.localInferenceUrl}...`).start();
        const probe = await probeEndpoint(basicConfig.localInferenceUrl);

        let selectedModel = existingConfig.geminiModel || 'auto';

        if (probe.reachable) {
            if (probe.models.length > 0) {
                probeSpinner.succeed(`Endpoint reachable! Found ${probe.models.length} model(s).`);

                // Build choices from discovered models + custom option
                const modelChoices = probe.models.map((m) => ({
                    name: `${m}`,
                    value: m
                }));
                modelChoices.push({
                    name: chalk.dim('Custom (enter manually)'),
                    value: '__custom__'
                });

                const { modelChoice } = await inquirer.prompt([
                    {
                        type: 'list',
                        name: 'modelChoice',
                        message: 'Which model should Tars use?',
                        choices: modelChoices,
                        default: probe.models.includes(selectedModel)
                            ? selectedModel
                            : probe.models[0]
                    }
                ]);

                if (modelChoice === '__custom__') {
                    const { customModel } = await inquirer.prompt([
                        {
                            type: 'input',
                            name: 'customModel',
                            message: 'Enter model name:',
                            default: selectedModel,
                            validate: (input: string) =>
                                input.length > 0 || 'Model name is required'
                        }
                    ]);
                    selectedModel = customModel;
                } else {
                    selectedModel = modelChoice;
                }
            } else {
                probeSpinner.succeed('Endpoint reachable! (no model list available)');
                const { manualModel } = await inquirer.prompt([
                    {
                        type: 'input',
                        name: 'manualModel',
                        message:
                            'Model Name (sent in the OpenAI `model` field — use the name your server expects):',
                        default: selectedModel,
                        validate: (input: string) => input.length > 0 || 'Model name is required'
                    }
                ]);
                selectedModel = manualModel;
            }
        } else {
            probeSpinner.warn(`Could not reach endpoint: ${probe.error || 'unknown error'}`);
            console.log(
                chalk.yellow(
                    '  ⚠ The endpoint is not responding. Configuration will continue but\n' +
                        '    make sure the server is running when you start Tars.'
                )
            );
            const { manualModel } = await inquirer.prompt([
                {
                    type: 'input',
                    name: 'manualModel',
                    message: 'Model Name (enter manually):',
                    default: selectedModel,
                    validate: (input: string) => input.length > 0 || 'Model name is required'
                }
            ]);
            selectedModel = manualModel;
        }

        // Step 4c: Context window + heartbeat
        const cwChoices: any[] = [];
        if (probe.contextWindow) {
            cwChoices.push({
                name: `🤖 Auto-Detect (${probe.contextWindow} tokens from server)`,
                value: probe.contextWindow
            });
        }
        cwChoices.push(
            { name: '4K tokens  — Small models (TinyLlama)', value: 4096 },
            { name: '8K tokens  — Standard (Llama 3 8B)', value: 8192 },
            { name: '16K tokens — Extended (Mistral 7B)', value: 16384 },
            { name: '32K tokens — Large context (Qwen 3.5)', value: 32768 },
            { name: '128K tokens — Very large context (Llama 3.1 70B)', value: 131072 },
            { name: 'Custom', value: 'custom' }
        );

        const advancedConfig = await inquirer.prompt([
            {
                type: 'list',
                name: 'contextWindowTokens',
                message: 'Context Window Size (depends on your model):',
                choices: cwChoices,
                default: probe.contextWindow
                    ? probe.contextWindow
                    : existingConfig.contextWindowTokens || 8192
            },
            {
                type: 'input',
                name: 'customContextWindow',
                message: 'Enter context window size (number of tokens):',
                when: (answers) => answers.contextWindowTokens === 'custom',
                validate: (input: string) => {
                    const n = parseInt(input, 10);
                    return (!isNaN(n) && n > 0) || 'Must be a positive number';
                }
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
            }
        ]);

        config = {
            ...basicConfig,
            ...advancedConfig,
            geminiModel: selectedModel,
            inferenceBackend: 'llamacpp'
        };
    } else {
        console.log(chalk.dim('  Tars is your personal assistant and sidekick.'));
        console.log(chalk.dim('  Every Google account includes free Gemini inference!'));

        config = await inquirer.prompt([
            {
                type: 'input',
                name: 'assistantName',
                message: 'Assistant Name (Display identity):',
                default: existingConfig.assistantName || 'Tars'
            },
            {
                type: 'list',
                name: 'geminiModel',
                message: 'Select Gemini Model:',
                choices: [
                    { name: 'Auto (Recommended - High IQ)', value: 'auto' },
                    { name: 'Auto (Gemini 2.5 Path)', value: 'auto-gemini-2.5' },
                    { name: 'Gemini 2.0 Flash (Fastest)', value: 'gemini-2.0-flash' },
                    { name: 'Gemini 2.5 Flash', value: 'gemini-2.5-flash' },
                    { name: 'Gemini 2.5 Pro (Balanced)', value: 'gemini-2.5-pro' },
                    { name: 'Gemini 3 Flash (Preview)', value: 'gemini-3-flash-preview' },
                    { name: 'Gemini 3 Pro (Preview)', value: 'gemini-3-pro-preview' },
                    { name: 'Custom (Advanced)', value: 'custom' }
                ],
                default: existingConfig.geminiModel || 'auto'
            },
            {
                type: 'input',
                name: 'customModel',
                message: 'Enter custom model name:',
                when: (answers) => answers.geminiModel === 'custom'
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
            }
        ]);

        config.inferenceBackend = 'gemini';
    }

    // ══════════════════════════════════════════════════════════
    // ── Step 5: Integrations ──────────────────────────────────
    // Google Workspace is only relevant for Gemini backend.
    // ══════════════════════════════════════════════════════════
    console.log(chalk.bold('\nStep 5: Integrations'));
    console.log(chalk.dim('────────────────────'));

    if (isLocal) {
        console.log(
            chalk.dim(
                '  Google Workspace integration requires cloud auth and is not available with local inference.'
            )
        );
        console.log(chalk.dim('  Skipping.'));
    } else {
        console.log(chalk.dim('  Enables Tars to read verification emails, manage'));
        console.log(chalk.dim('  your calendar, and interact with your files.'));

        const wsService = new WorkspaceOAuthService(tarsHome);
        const isWsAuthed = await wsService.isAuthenticated();

        if (isWsAuthed) {
            console.log(chalk.green('  ✓ Google Workspace already authenticated.'));
            const { reAuthWs } = await inquirer.prompt([
                {
                    type: 'confirm',
                    name: 'reAuthWs',
                    message: 'Do you want to re-authenticate Workspace access?',
                    default: false
                }
            ]);
            if (reAuthWs) await setupWorkspaceAuth(tarsHome, wsService);
        } else {
            const { setupWs } = await inquirer.prompt([
                {
                    type: 'confirm',
                    name: 'setupWs',
                    message: 'Enable Google Workspace integration (Gmail, Drive, Calendar)?',
                    default: true
                }
            ]);
            if (setupWs) await setupWorkspaceAuth(tarsHome, wsService);
        }
    }

    // ══════════════════════════════════════════════════════════
    // ── Step 6: Tars Dashboard ────────────────────────────────
    // ══════════════════════════════════════════════════════════
    console.log(chalk.bold('\nStep 6: Tars Dashboard'));
    console.log(chalk.dim('────────────────────────────'));

    const secretsManager = new SecretsManager(tarsHome);
    const secrets = secretsManager.load();

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
    // Allows other Tars instances to delegate tasks to this one.
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
                `${config.assistantName || existingConfig.assistantName || 'Tars'} — Autonomous AI assistant`,
            when: (a) => a.enableSwarm
        }
    ]);

    if (swarmConfig.enableSwarm) {
        // Auto-generate API key if one doesn't exist
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
                `  tars swarm add --name ${(config.assistantName || 'tars').toLowerCase()} \\`
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

    // 1. Audit and Heal
    const auditor = new BrainAuditor(tarsHome);
    await auditor.audit({ silent: true });

    // 2. Provision isolated environment
    const installSpinner = ora('Provisioning environment...').start();
    const geminiDir = path.join(tarsHome, '.gemini');

    await fs.mkdir(path.join(tarsHome, 'data', 'uploads'), { recursive: true });
    await fs.mkdir(path.join(tarsHome, 'logs'), { recursive: true });
    await fs.mkdir(path.join(tarsHome, 'apps'), { recursive: true });
    await fs.mkdir(path.join(geminiDir, 'extensions'), { recursive: true });
    await fs.mkdir(path.join(geminiDir, 'tmp'), { recursive: true });
    await fs.mkdir(path.join(geminiDir, 'history'), { recursive: true });

    installSpinner.succeed('Directories created (~/.tars/.gemini/)');

    // ── Legacy Cleanup ──────────────────────────────
    const cleanupSpinner = ora('Checking for legacy components...').start();
    const oldDash = path.join(tarsHome, 'dashboard');
    if (fsSync.existsSync(oldDash)) {
        await fs.rm(oldDash, { recursive: true, force: true });
        cleanupSpinner.text = 'Cleaned up legacy dashboard directory.';
    }
    const oldStandaloneDash = path.resolve(tarsHome, '..', 'apps', 'tars-dash');
    if (fsSync.existsSync(oldStandaloneDash)) {
        await fs.rm(oldStandaloneDash, { recursive: true, force: true });
        cleanupSpinner.text = 'Cleaned up legacy standalone dashboard.';
    }
    cleanupSpinner.succeed('Cleanup complete.');

    // ── Write Tars configuration ─────────────────────
    const saveSpinner = ora('Saving configuration...').start();
    const finalModel = config.geminiModel === 'custom' ? config.customModel : config.geminiModel;
    const intervalSec =
        (config.heartbeatMinutes === 'custom' ? config.customHeartbeat : config.heartbeatMinutes) *
        60;

    const contextTokens =
        config.contextWindowTokens === 'custom'
            ? parseInt(config.customContextWindow, 10)
            : config.contextWindowTokens;

    const configData: any = {
        assistantName: config.assistantName,
        discordToken,
        discordOwnerId: existingConfig.discordOwnerId,
        geminiModel: finalModel,
        inferenceBackend: config.inferenceBackend,
        heartbeatIntervalSec: intervalSec
    };

    // Backend-specific config
    if (isLocal) {
        configData.localInferenceUrl = config.localInferenceUrl;
        configData.contextWindowTokens = contextTokens;
    }

    // Swarm config (only written if enabled)
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

    // Hydrate extensions (Scan extensions directory)
    const extensionsBaseSrc = path.resolve(
        path.dirname(new URL(import.meta.url).pathname),
        '../../../extensions'
    );
    if (fsSync.existsSync(extensionsBaseSrc)) {
        const extensions = fsSync.readdirSync(extensionsBaseSrc);
        for (const extName of extensions) {
            const extSrc = path.join(extensionsBaseSrc, extName);
            if (!fsSync.statSync(extSrc).isDirectory()) continue;

            const finalExtName =
                extName === 'tasks' ? 'tars-tasks' : extName === 'memory' ? 'tars-memory' : extName;
            const linkTarget = path.join(geminiDir, 'extensions', finalExtName);
            const extSpinner = ora(`Installing extension: ${finalExtName}...`).start();

            try {
                if (fsSync.existsSync(linkTarget))
                    await fs.rm(linkTarget, { recursive: true, force: true });
                await fs.cp(extSrc, linkTarget, { recursive: true });
                extSpinner.text = `Hydrating ${finalExtName}...`;
                execSync('npm install', { cwd: linkTarget, stdio: 'pipe' });
                execSync('npm run build', { cwd: linkTarget, stdio: 'pipe' });
                extSpinner.succeed(`Extension ready: ${finalExtName}`);
            } catch (err: any) {
                extSpinner.warn(`Extension ${finalExtName} failed: ${err.message}`);
            }
        }
    }

    // Hydrate Dashboard if enabled
    if (dashConfig.enableDash) {
        const dashSrc = path.resolve(
            path.dirname(new URL(import.meta.url).pathname),
            '../../../dash'
        );
        const dashDest = path.join(tarsHome, 'apps', 'dashboard');

        if (fsSync.existsSync(dashSrc)) {
            const dashSpinner = ora('Installing Tars Dashboard...').start();
            try {
                // If updating, remove existing dashboard first
                if (dashConfig.updateDash && fsSync.existsSync(dashDest)) {
                    dashSpinner.text = 'Removing existing dashboard...';
                    await fs.rm(dashDest, { recursive: true, force: true });
                }

                await fs.cp(dashSrc, dashDest, { recursive: true });

                dashSpinner.text = 'Hydrating Dashboard dependencies...';
                // We need devDependencies for npm run build (tailwind, etc.)
                execSync('npm install', { cwd: dashDest, stdio: 'pipe' });

                dashSpinner.text = 'Building Dashboard...';
                execSync('npm run build', { cwd: dashDest, stdio: 'pipe' });

                dashSpinner.succeed(
                    dashConfig.updateDash
                        ? 'Dashboard updated to latest version.'
                        : 'Dashboard ready.'
                );
            } catch (err: any) {
                const out = err.stdout?.toString() || err.stderr?.toString() || err.message;
                dashSpinner.fail(`Dashboard installation failed: ${out}`);
            }
        }
    }

    // ── Done ──────────────────────────────────────────────
    console.log(chalk.green.bold('\n✅ Tars is ready!'));
    if (isLocal) {
        console.log(chalk.dim(`\n  Backend:        Local Model @ ${config.localInferenceUrl}`));
        console.log(
            chalk.dim(`  Context Window: ${(contextTokens || 8192).toLocaleString()} tokens`)
        );
    } else {
        console.log(chalk.dim(`\n  Backend:        Gemini Cloud (${finalModel})`));
    }
    console.log(`\n  Start Tars:     ${chalk.cyan('tars start')}`);
    console.log(`  Check status:   ${chalk.cyan('tars status')}`);
    console.log(`  View logs:      ${chalk.cyan('tars logs')}`);
}
