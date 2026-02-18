import chalk from 'chalk';
import inquirer from 'inquirer';
import ora from 'ora';
import { execSync, spawnSync } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { Client, GatewayIntentBits } from 'discord.js';

import { existsSync } from 'fs';

/**
 * Check if gemini CLI is installed and user is authenticated
 */
function checkGeminiAuth(): { installed: boolean; loggedIn: boolean } {
    try {
        // First check if gemini is installed
        execSync('which gemini', { encoding: 'utf-8' });

        // Check for credentials file directly (faster/reliable)
        const credsPath = path.join(os.homedir(), '.gemini', 'oauth_creds.json');
        if (existsSync(credsPath)) {
            return { installed: true, loggedIn: true };
        }

        // Fallback to CLI command if file check fails
        const result = execSync('gemini auth print-access-token 2>&1', {
            encoding: 'utf-8',
            timeout: 3000
        });
        if (result && !result.includes('error') && !result.includes('not logged in')) {
            return { installed: true, loggedIn: true };
        }
        return { installed: true, loggedIn: false };
    } catch (err: any) {
        return { installed: false, loggedIn: false };
    }
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

    // Check Gemini CLI
    const geminiStatus = checkGeminiAuth();
    if (!geminiStatus.installed) {
        spinner.fail('Gemini CLI not found. Install with: npm i -g @google/gemini-cli');
        process.exit(1);
    }

    spinner.succeed(`Prerequisites met (Node ${nodeVersion}, Gemini CLI installed)`);

    // ── Step 1: Google OAuth ───────────────────────────────
    console.log(chalk.bold('\nStep 1/4: Google Authentication'));
    console.log(chalk.dim('────────────────────────────────'));

    let performAuth = false;

    if (geminiStatus.loggedIn) {
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
                message: 'Tars requires Google OAuth. Open browser to authenticate?',
                default: true
            }
        ]);
        performAuth = authNow;
    }

    if (performAuth) {
        console.log(chalk.cyan('\n  Running Google Authentication...'));
        console.log(chalk.dim('  1. A browser window will open.'));
        console.log(chalk.dim('  2. Sign in with your Google account.'));
        console.log(chalk.dim('  3. Return here when done.'));
        console.log(chalk.dim('  -----------------------------------'));

        try {
            // Run auth login. We use spawnSync to let it take over IO.
            spawnSync('gemini', ['auth', 'login'], {
                stdio: 'inherit',
                shell: true
            });

            // Re-check auth after the process exits
            const freshStatus = checkGeminiAuth();
            if (freshStatus.loggedIn) {
                console.log(chalk.green('  ✓ Authentication successful!'));
            } else {
                console.log(chalk.yellow('  ⚠ Warning: Could not verify authentication.'));
                console.log(
                    chalk.yellow('  You may need to run `gemini auth login` manually after setup.')
                );
            }
        } catch (err) {
            console.error(chalk.red('  Failed to run auth command.'));
        }
    } else if (!geminiStatus.loggedIn) {
        console.log(
            chalk.yellow('  Skipped. Run `gemini auth login` manually before starting Tars.')
        );
    }

    // ── Step 2: Discord Bot ───────────────────────────────
    const tarsHome = path.join(os.homedir(), '.tars');
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
                { name: 'Auto (Highly Recommended)', value: 'auto' },
                { name: 'Gemini 2.0 Flash (Fastest)', value: 'gemini-2.0-flash' },
                { name: 'Gemini 2.0 Flash Lite (Ultra-fast)', value: 'gemini-2.0-flash-lite' },
                { name: 'Gemini 2.0 Pro (Most Powerful, Preview)', value: 'gemini-2.0-pro-exp-02-05' },
                { name: 'Gemini 1.5 Pro (Balanced)', value: 'gemini-1.5-pro' },
                { name: 'Gemini 1.5 Flash (Efficient)', value: 'gemini-1.5-flash' },
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
            type: 'input',
            name: 'heartbeatInterval',
            message: 'Heartbeat interval (seconds):',
            default: existingConfig.heartbeatIntervalSec
                ? String(existingConfig.heartbeatIntervalSec)
                : '60'
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

    // ── Copy Auth Credentials (Portability) ────────────────
    const authSpinner = ora('Migrating auth credentials...').start();
    try {
        const globalGemini = path.join(os.homedir(), '.gemini');
        const filesToCopy = [
            'oauth_creds.json',
            'google_accounts.json',
            'installation_id',
            'trustedFolders.json',
            'state.json'
        ];

        for (const file of filesToCopy) {
            try {
                const src = path.join(globalGemini, file);
                const dest = path.join(geminiDir, file);
                const data = await fs.readFile(src);
                await fs.writeFile(dest, data);
            } catch (err) {
                /* ignore missing files */
            }
        }
        authSpinner.succeed('Auth credentials mirrored to Tars.');
    } catch (err) {
        authSpinner.warn('Could not mirror auth. You may need to run `gemini auth login` again.');
    }

    // ── Write Gemini CLI settings.json ─────────────────────
    const settingsSpinner = ora('Configuring Gemini CLI settings...').start();
    try {
        const geminiSettings = {
            model: {
                compressionThreshold: 0.2,
                summarizeToolOutput: {
                    run_shell_command: { tokenBudget: 2000 }
                }
            },
            security: {
                auth: {
                    selectedType: 'oauth-personal'
                }
            }
        };

        await fs.writeFile(
            path.join(geminiDir, 'settings.json'),
            JSON.stringify(geminiSettings, null, 2)
        );
        settingsSpinner.succeed('Gemini CLI settings configured (compression @ 20%).');
    } catch (err: any) {
        settingsSpinner.warn(`Could not write settings: ${err.message}`);
    }

    // ── Initialize GEMINI.md (Brain) ───────────────────────
    const brainSpinner = ora('Initializing Brain (GEMINI.md)...').start();
    try {
        const contextSrc = path.resolve(
            path.dirname(new URL(import.meta.url).pathname),
            '../../../context/GEMINI.md'
        );
        const brainDest = path.join(geminiDir, 'GEMINI.md');

        // Only copy if not exists (preserve user memory)
        try {
            await fs.access(brainDest);
            brainSpinner.info('Brain already exists (skipping overwrite).');
        } catch {
            await fs.copyFile(contextSrc, brainDest);
            brainSpinner.succeed('Brain initialized with Tars personality.');
        }
    } catch (err: any) {
        brainSpinner.warn(`Could not init GEMINI.md: ${err.message}`);
    }

    // Save Tars configuration
    const saveSpinner = ora('Saving configuration...').start();
    const finalModel = config.geminiModel === 'custom' ? config.customModel : config.geminiModel;
    const configData = {
        discordToken,
        geminiModel: finalModel,
        heartbeatIntervalSec: parseInt(config.heartbeatInterval, 10)
    };

    await fs.writeFile(path.join(tarsHome, 'config.json'), JSON.stringify(configData, null, 2));
    saveSpinner.succeed('Configuration saved.');

    // Symlink built-in tasks extension (to ISOLATED env)
    const extSpinner = ora('Installing tasks extension...').start();
    try {
        const linkTarget = path.join(geminiDir, 'extensions', 'tars-tasks');
        const extensionSrc = path.resolve(
            path.dirname(new URL(import.meta.url).pathname),
            '../../../extensions/tasks'
        );

        try {
            await fs.unlink(linkTarget);
        } catch {
            /* ignore */
        }

        await fs.symlink(extensionSrc, linkTarget, 'dir');
        extSpinner.succeed('Tasks extension installed.');
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
