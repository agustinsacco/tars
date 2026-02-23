import chalk from 'chalk';
import inquirer from 'inquirer';
import ora from 'ora';
import { execSync, spawnSync } from 'child_process';
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import os from 'os';
import { Client, GatewayIntentBits } from 'discord.js';

import { existsSync } from 'fs';
import { TarsOAuthService } from '../../auth/oauth-service.js';

/**
 * Check if the isolated tars environment is authenticated
 */
async function checkTarsAuth(tarsHome: string): Promise<boolean> {
    const oauthService = new TarsOAuthService(tarsHome);
    return await oauthService.isAuthenticated();
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

    const tarsHome = path.join(os.homedir(), '.tars');
    const isAuthed = await checkTarsAuth(tarsHome);

    spinner.succeed(`Prerequisites met (Node ${nodeVersion})`);

    // ── Step 1: Google OAuth ───────────────────────────────
    console.log(chalk.bold('\nStep 1/4: Google Authentication'));
    console.log(chalk.dim('────────────────────────────────'));

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
                message: 'Tars requires Google OAuth. Continue with authentication?',
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
            await oauthService.login();

            // Re-check auth after login
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

    // ── Step 2: Discord Bot ───────────────────────────────
    let existingConfig: any = {};
    try {
        const data = await fs.readFile(path.join(tarsHome, 'config.json'), 'utf-8');
        existingConfig = JSON.parse(data);
    } catch {
        /* ignore */
    }

    let discordToken = existingConfig.discordToken || '';
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
        if (!reAuthDiscord) {
            skipDiscord = true;
        }
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

        const validateSpinner = ora('Validating token & intents...').start();
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
            validateSpinner.succeed(`Token & Intents valid! Bot: ${chalk.bold(botName)}`);
        } catch (err: any) {
            if (err.message.includes('disallowed intents')) {
                validateSpinner.fail(chalk.red.bold('DISALLOWED INTENTS ERROR'));
                console.log(
                    chalk.red(
                        '\n  The token is valid, but your bot lacks the "Message Content Intent".'
                    )
                );
                console.log(
                    chalk.red('  Please go to the Discord Developer Portal and enable it:')
                );
                console.log(chalk.red('  1. Select your Bot -> "Bot" section.'));
                console.log(chalk.red('  2. Scroll to "Privileged Gateway Intents".'));
                console.log(chalk.red('  3. Enable "Message Content Intent" and SAVE CHANGES.\n'));
            } else {
                validateSpinner.fail('Invalid Discord token. Check your token and try again.');
            }
            process.exit(1);
        }
    }

    // ── Step 3: Configuration ─────────────────────────────
    console.log(chalk.bold('\nStep 3/4: Configuration'));
    console.log(chalk.dim('────────────────────────'));

    const config = await inquirer.prompt([
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
        },
        {
            type: 'number',
            name: 'customHeartbeat',
            message: 'Enter heartbeat interval in minutes (Minimum 30):',
            when: (answers) => answers.heartbeatMinutes === 'custom',
            validate: (input) => {
                if (input < 30) return 'Minimum heartbeat interval is 30 minutes.';
                return true;
            }
        }
    ]);

    // ── Step 4: Installation ──────────────────────────────
    console.log(chalk.bold('\nStep 4/4: Installing'));
    console.log(chalk.dim('─────────────────────'));

    // Provision isolated environment
    // GEMINI_CLI_HOME=~/.tars → Gemini CLI looks for ~/.tars/.gemini/
    const installSpinner = ora('Provisioning environment...').start();
    const geminiDir = path.join(tarsHome, '.gemini');

    await fs.mkdir(path.join(tarsHome, 'data'), { recursive: true });
    await fs.mkdir(path.join(tarsHome, 'logs'), { recursive: true });
    await fs.mkdir(path.join(geminiDir, 'extensions'), { recursive: true });
    await fs.mkdir(path.join(geminiDir, 'tmp'), { recursive: true });
    await fs.mkdir(path.join(geminiDir, 'history'), { recursive: true });

    installSpinner.succeed('Directories created (~/.tars/.gemini/)');

    // ── Auth Credentials (Handled natively) ────────────────
    // Credentials are now created or verified directly in ~/.tars/.gemini/
    // during the setup process, so no migration from host is needed.

    // ── Write Gemini CLI settings.json ─────────────────────
    const settingsSpinner = ora('Configuring Gemini CLI settings...').start();
    try {
        const settingsTemplatePath = path.resolve(
            path.dirname(new URL(import.meta.url).pathname),
            '../../../context/config/settings.json-template'
        );

        let geminiSettings: any = {};
        try {
            const templateData = await fs.readFile(settingsTemplatePath, 'utf-8');
            geminiSettings = JSON.parse(templateData);
        } catch {
            // Fallback
            geminiSettings = {
                model: {
                    compressionThreshold: 0.2,
                    summarizeToolOutput: {
                        run_shell_command: { tokenBudget: 2000 }
                    }
                },
                experimental: {
                    enableAgents: true
                }
            };
        }

        if (!geminiSettings.security) geminiSettings.security = {};
        if (!geminiSettings.security.auth) geminiSettings.security.auth = {};
        geminiSettings.security.auth.selectedType = 'oauth-personal';

        await fs.writeFile(
            path.join(geminiDir, 'settings.json'),
            JSON.stringify(geminiSettings, null, 2)
        );
        settingsSpinner.succeed('Gemini CLI settings configured from template.');
    } catch (err: any) {
        settingsSpinner.warn(`Could not write settings: ${err.message}`);
    }

    // Save Tars configuration
    const saveSpinner = ora('Saving configuration...').start();
    const finalModel = config.geminiModel === 'custom' ? config.customModel : config.geminiModel;

    // Convert minutes to seconds
    const minutes =
        config.heartbeatMinutes === 'custom' ? config.customHeartbeat : config.heartbeatMinutes;
    const intervalSec = minutes * 60;

    const configData = {
        discordToken,
        geminiModel: finalModel,
        heartbeatIntervalSec: intervalSec
    };

    await fs.writeFile(path.join(tarsHome, 'config.json'), JSON.stringify(configData, null, 2));
    saveSpinner.succeed('Configuration saved.');

    // Copy built-in tasks extension (to ISOLATED env)
    // We use copy instead of symlink to satisfy workspace safety rules
    const extSpinner = ora('Installing tasks extension...').start();
    try {
        const linkTarget = path.join(geminiDir, 'extensions', 'tars-tasks');
        const extensionSrc = path.resolve(
            path.dirname(new URL(import.meta.url).pathname),
            '../../../extensions/tasks'
        );

        // Remove existing (symlink or dir)
        try {
            await fs.rm(linkTarget, { recursive: true, force: true });
        } catch {
            /* ignore */
        }

        await fs.cp(extensionSrc, linkTarget, { recursive: true });

        // Hydrate dependencies
        extSpinner.text = `Installing dependencies for tars-tasks...`;

        try {
            execSync('npm ci --production', {
                cwd: linkTarget,
                stdio: 'pipe' // Capture output to throw on error
            });

            // Verify node_modules exists
            if (!fsSync.existsSync(path.join(linkTarget, 'node_modules'))) {
                throw new Error('npm install finished but node_modules is missing');
            }
        } catch (installError: any) {
            // Log the actual stdout/stderr if available
            const output =
                installError.stdout?.toString() ||
                installError.stderr?.toString() ||
                installError.message;
            throw new Error(`Dependency install failed: ${output}`);
        }

        extSpinner.succeed(`tars-tasks extension installed.`);
    } catch (err: any) {
        extSpinner.warn(`Extension install failed: ${err.message}`);
    }

    // ── Done ──────────────────────────────────────────────
    console.log(chalk.green.bold('\n✅ Tars is ready!'));
    console.log(`\n  Start Tars:     ${chalk.cyan('tars start')}`);
    console.log(`  Check status:   ${chalk.cyan('tars status')}`);
    console.log(`  View logs:      ${chalk.cyan('tars logs')}`);
    console.log(`  Invite Bot:     ${chalk.cyan('tars discord')}\n`);
}
