import chalk from 'chalk';
import inquirer from 'inquirer';
import ora from 'ora';
import { execSync, spawnSync } from 'child_process';
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { Client, GatewayIntentBits } from 'discord.js';
import { TarsOAuthService } from '../../auth/oauth-service.js';
import { BrainAuditor } from '../../utils/brain-audit.js';
import { getTarsHome } from '../../utils/paths.js';

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

    const tarsHome = getTarsHome();
    const isAuthed = await checkTarsAuth(tarsHome);

    spinner.succeed(`Prerequisites met (Node ${nodeVersion})`);

    // ── Step 1: Google OAuth ───────────────────────────────
    console.log(chalk.bold('\nStep 1/5: Google Authentication'));
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

    // ── Step 2: Discord Configuration ─────────────────────
    console.log(chalk.bold('\nStep 2/5: Discord Bot Setup'));
    console.log(chalk.dim('───────────────────────────'));

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

    // ── Step 3: Configuration ─────────────────────────────
    console.log(chalk.bold('\nStep 3/5: Identity & Engine'));
    console.log(chalk.dim('────────────────────────────'));

    const config = await inquirer.prompt([
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

    // ── Step 4: Installation ──────────────────────────────
    console.log(chalk.bold('\nStep 4/5: Installing'));
    console.log(chalk.dim('─────────────────────'));

    // 1. Audit and Heal
    const auditor = new BrainAuditor(tarsHome);
    await auditor.audit({ silent: true });

    // 2. Provision isolated environment
    const installSpinner = ora('Provisioning environment...').start();
    const geminiDir = path.join(tarsHome, '.gemini');

    await fs.mkdir(path.join(tarsHome, 'data', 'uploads'), { recursive: true });
    await fs.mkdir(path.join(tarsHome, 'logs'), { recursive: true });
    await fs.mkdir(path.join(geminiDir, 'extensions'), { recursive: true });
    await fs.mkdir(path.join(geminiDir, 'tmp'), { recursive: true });
    await fs.mkdir(path.join(geminiDir, 'history'), { recursive: true });

    installSpinner.succeed('Directories created (~/.tars/.gemini/)');

    // ── Write Tars configuration ─────────────────────
    const saveSpinner = ora('Saving configuration...').start();
    const finalModel = config.geminiModel === 'custom' ? config.customModel : config.geminiModel;
    const intervalSec =
        (config.heartbeatMinutes === 'custom' ? config.customHeartbeat : config.heartbeatMinutes) *
        60;

    const configData = {
        assistantName: config.assistantName,
        discordToken,
        discordOwnerId: existingConfig.discordOwnerId,
        geminiModel: finalModel,
        heartbeatIntervalSec: intervalSec
    };

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
                execSync('npm install --production', { cwd: linkTarget, stdio: 'pipe' });
                extSpinner.succeed(`Extension ready: ${finalExtName}`);
            } catch (err: any) {
                extSpinner.warn(`Extension ${finalExtName} failed: ${err.message}`);
            }
        }
    }

    // ── Done ──────────────────────────────────────────────
    console.log(chalk.green.bold('\n✅ Tars is ready!'));
    console.log(`\n  Start Tars:     ${chalk.cyan('tars start')}`);
    console.log(`  Check status:   ${chalk.cyan('tars status')}`);
    console.log(`  View logs:      ${chalk.cyan('tars logs')}`);
}
