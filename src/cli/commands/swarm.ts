/**
 * tars swarm — Manage Swarm peers (remote A2A agents).
 *
 * Subcommands:
 *   tars swarm status              Show swarm mode configuration
 *   tars swarm add                 Register a remote Tars peer
 *   tars swarm remove <name>       Remove a registered peer
 *   tars swarm list                List all registered peers
 */

import chalk from 'chalk';
import inquirer from 'inquirer';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { getTarsHome } from '../../utils/paths.js';
import { SecretsManager } from '../../utils/secrets-manager.js';

/**
 * Returns the agents directory path for swarm peer registration.
 */
function getAgentsDir(): string {
    return path.join(getTarsHome(), 'agents');
}

/**
 * Read config.json to get swarm settings.
 */
function loadConfig(): any {
    const configPath = path.join(getTarsHome(), 'config.json');
    try {
        return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    } catch {
        return {};
    }
}

/**
 * tars swarm — Route to subcommands.
 */
export async function swarm(action: string, ...args: string[]): Promise<void> {
    switch (action) {
        case 'status':
            return swarmStatus();
        case 'add':
            return swarmAdd();
        case 'remove':
            return swarmRemove(args[0]);
        case 'list':
            return swarmList();
        default:
            console.log(chalk.yellow(`Unknown swarm action: ${action}`));
            console.log(chalk.dim('\nAvailable actions:'));
            console.log(chalk.dim('  tars swarm status   — Show swarm mode configuration'));
            console.log(chalk.dim('  tars swarm add      — Register a remote Tars peer'));
            console.log(chalk.dim('  tars swarm remove   — Remove a registered peer'));
            console.log(chalk.dim('  tars swarm list     — List all registered peers'));
    }
}

/**
 * Show swarm mode status.
 */
async function swarmStatus(): Promise<void> {
    const config = loadConfig();
    const swarmConfig = config.swarm || {};
    const tarsHome = getTarsHome();
    const secretsManager = new SecretsManager(tarsHome);
    const secrets = secretsManager.load();

    console.log(chalk.cyan.bold('\n🌐 Tars Swarm Status'));
    console.log(chalk.cyan('━━━━━━━━━━━━━━━━━━━━\n'));

    if (!swarmConfig.enabled) {
        console.log(chalk.yellow('  ⚠ Swarm mode is disabled.'));
        console.log(chalk.dim('  Run `tars setup` to enable swarm mode.\n'));
        return;
    }

    console.log(chalk.green('  ✓ Swarm mode is enabled'));
    console.log(chalk.dim(`  Port:        ${swarmConfig.port || 3100}`));
    console.log(chalk.dim(`  Description: ${swarmConfig.description || '(none)'}`));
    console.log(
        chalk.dim(`  Skills:      ${(swarmConfig.skills || []).join(', ') || '(default)'}`)
    );

    const hasKey = !!(secrets.SWARM_API_KEY || process.env.SWARM_API_KEY);
    if (hasKey) {
        const key = secrets.SWARM_API_KEY || process.env.SWARM_API_KEY || '';
        console.log(
            chalk.dim(`  API Key:     ${key.substring(0, 12)}...${key.substring(key.length - 4)}`)
        );
    } else {
        console.log(chalk.yellow('  API Key:     ⚠ NOT SET — run `tars setup` to generate one'));
    }

    console.log('');

    // Count registered peers
    const peers = listPeerFiles();
    if (peers.length > 0) {
        console.log(chalk.dim(`  Registered Peers: ${peers.length}`));
        for (const p of peers) {
            console.log(chalk.dim(`    • ${p.name} → ${p.url}`));
        }
    } else {
        console.log(chalk.dim('  Registered Peers: 0'));
        console.log(chalk.dim('  Use `tars swarm add` to register a peer.'));
    }

    console.log('');
}

/**
 * Interactive peer registration.
 */
async function swarmAdd(): Promise<void> {
    console.log(chalk.cyan.bold('\n🌐 Register a Swarm Peer'));
    console.log(chalk.cyan('────────────────────────\n'));
    console.log(
        chalk.dim('  Register another Tars instance so this agent can delegate tasks to it.')
    );
    console.log(chalk.dim("  You'll need the peer's Agent Card URL and API key.\n"));

    const answers = await inquirer.prompt([
        {
            type: 'input',
            name: 'name',
            message: 'Peer name (lowercase, no spaces):',
            validate: (input: string) => {
                if (!/^[a-z][a-z0-9-]*$/.test(input)) {
                    return 'Must start with a letter and contain only lowercase letters, numbers, hyphens';
                }
                return true;
            }
        },
        {
            type: 'input',
            name: 'url',
            message: 'Agent Card URL:',
            validate: (input: string) => {
                try {
                    new URL(input);
                    if (!input.includes('agent.json') && !input.includes('.well-known')) {
                        return 'URL should point to the agent card (e.g., http://host:3100/.well-known/agent.json)';
                    }
                    return true;
                } catch {
                    return 'Please enter a valid URL';
                }
            }
        },
        {
            type: 'password',
            name: 'apiKey',
            message: 'Peer API Key:',
            validate: (input: string) => input.length >= 10 || 'API key is too short'
        }
    ]);

    const tarsHome = getTarsHome();
    const agentsDir = getAgentsDir();

    // Ensure agents directory exists
    if (!fs.existsSync(agentsDir)) {
        fs.mkdirSync(agentsDir, { recursive: true });
    }

    // Store the API key in secrets
    const secretKey = `SWARM_PEER_${answers.name.toUpperCase().replace(/-/g, '_')}_KEY`;
    const secretsManager = new SecretsManager(tarsHome);
    secretsManager.set(secretKey, answers.apiKey);

    // Write the remote agent .md file
    const agentFile = path.join(agentsDir, `${answers.name}.md`);
    const content = [
        '---',
        'kind: remote',
        `name: ${answers.name}`,
        `agent_card_url: ${answers.url}`,
        'auth:',
        '  type: apiKey',
        `  key: $${secretKey}`,
        '---',
        ''
    ].join('\n');

    fs.writeFileSync(agentFile, content);

    console.log(chalk.green(`\n  ✓ Peer "${answers.name}" registered successfully!`));
    console.log(chalk.dim(`  Agent file:  ${agentFile}`));
    console.log(chalk.dim(`  Secret:      ${secretKey}`));
    console.log(chalk.dim('\n  Restart Tars for the peer to become available: tars restart\n'));
}

/**
 * Remove a registered peer.
 */
async function swarmRemove(name?: string): Promise<void> {
    if (!name) {
        console.log(chalk.yellow('Usage: tars swarm remove <peer-name>'));
        return;
    }

    const agentsDir = getAgentsDir();
    const agentFile = path.join(agentsDir, `${name}.md`);
    const tarsHome = getTarsHome();

    if (!fs.existsSync(agentFile)) {
        console.log(chalk.yellow(`  Peer "${name}" not found.`));
        return;
    }

    // Check if it's a remote agent (don't delete local agents)
    const content = fs.readFileSync(agentFile, 'utf-8');
    if (!content.includes('kind: remote')) {
        console.log(chalk.yellow(`  "${name}" is a local agent, not a swarm peer. Skipping.`));
        return;
    }

    // Remove the file
    fs.unlinkSync(agentFile);

    // Remove the secret
    const secretKey = `SWARM_PEER_${name.toUpperCase().replace(/-/g, '_')}_KEY`;
    const secretsManager = new SecretsManager(tarsHome);
    secretsManager.remove(secretKey);

    console.log(chalk.green(`  ✓ Peer "${name}" removed.`));
    console.log(chalk.dim('  Restart Tars for the change to take effect: tars restart\n'));
}

/**
 * List all registered swarm peers.
 */
async function swarmList(): Promise<void> {
    const peers = listPeerFiles();

    console.log(chalk.cyan.bold('\n🌐 Swarm Peers'));
    console.log(chalk.cyan('──────────────\n'));

    if (peers.length === 0) {
        console.log(chalk.dim('  No peers registered.'));
        console.log(chalk.dim('  Use `tars swarm add` to register one.\n'));
        return;
    }

    for (const peer of peers) {
        console.log(`  ${chalk.bold(peer.name)} → ${chalk.dim(peer.url)}`);
    }

    console.log(chalk.dim(`\n  Total: ${peers.length} peer(s)\n`));
}

/**
 * Helper: Read all remote agent .md files from the agents directory.
 */
function listPeerFiles(): Array<{ name: string; url: string; file: string }> {
    const agentsDir = getAgentsDir();
    if (!fs.existsSync(agentsDir)) return [];

    const peers: Array<{ name: string; url: string; file: string }> = [];

    try {
        const files = fs.readdirSync(agentsDir).filter((f) => f.endsWith('.md'));

        for (const file of files) {
            const content = fs.readFileSync(path.join(agentsDir, file), 'utf-8');
            if (!content.includes('kind: remote')) continue;

            // Extract name and url from frontmatter
            const nameMatch = content.match(/^name:\s*(.+)$/m);
            const urlMatch = content.match(/^agent_card_url:\s*(.+)$/m);

            if (nameMatch && urlMatch) {
                peers.push({
                    name: nameMatch[1].trim(),
                    url: urlMatch[1].trim(),
                    file
                });
            }
        }
    } catch {
        // Ignore errors
    }

    return peers;
}
