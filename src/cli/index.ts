#!/usr/bin/env node
import { Command } from 'commander';
import { setup } from './commands/setup.js';
import { start } from './commands/start.js';
import { stop } from './commands/stop.js';
import { restart } from './commands/restart.js';
import { update } from './commands/update.js';
import { status } from './commands/status.js';
import { logs } from './commands/logs.js';
import { discord } from './commands/discord.js';
import { secret } from './commands/secret.js';
import { quota } from './commands/quota.js';
import { uninstall } from './commands/uninstall.js';

import { versionString } from '../utils/version.js';

const program = new Command();

program.name('tars').description('Your Personal AI Assistant').version(versionString);

program
    .command('setup')
    .description('Interactive onboarding wizard to configure your assistant')
    .action(setup);

program
    .command('start')
    .description('Start the assistant supervisor in the background')
    .action(start);

program.command('stop').description('Stop the assistant supervisor').action(stop);

program
    .command('restart')
    .description('Check for updates and restart the assistant')
    .action(restart);

program
    .command('update')
    .description('Force check and install the latest version of Tars')
    .action(update);

program
    .command('status')
    .description('Check the status of the assistant supervisor')
    .action(status);

program
    .command('quota')
    .description('Check current Gemini API rate limits and quotas')
    .action(quota);

program
    .command('export')
    .description('Export your brain (memories, tasks, extensions)')
    .option('-o, --output <path>', 'Output path for the archive')
    .action(async (options) => {
        const { exportBrain } = await import('./commands/export.js');
        return exportBrain(options);
    });

program
    .command('import')
    .description('Import a brain from an archive')
    .argument('<path>', 'Path to the brain archive (.tar.gz)')
    .action(async (path) => {
        const { importBrain } = await import('./commands/import.js');
        return importBrain(path);
    });

program
    .command('logs')
    .description('View real-time logs from the assistant supervisor')
    .action(logs);

program
    .command('discord')
    .description('View instructions for Discord bot setup and invitation')
    .action(discord);

program
    .command('secret')
    .description('Manage secure environment variables for extensions')
    .argument('<action>', 'Action to perform (set, list, remove)')
    .argument('[key]', 'Secret key')
    .argument('[value]', 'Secret value (required for set)')
    .action(secret);

program
    .command('memory')
    .description('Search or sync your brain knowledge')
    .argument('<action>', 'Action to perform (search, sync)')
    .argument('[query...]', 'Search query')
    .action(async (action, queryArgs) => {
        const { memory } = await import('./commands/memory.js');
        return memory(action, ...queryArgs);
    });

program
    .command('swarm')
    .description('Manage Swarm peers (remote A2A agents)')
    .argument('<action>', 'Action to perform (status, add, remove, list)')
    .argument('[args...]', 'Additional arguments')
    .action(async (action, args) => {
        const { swarm } = await import('./commands/swarm.js');
        return swarm(action, ...args);
    });

program
    .command('uninstall')
    .description('Uninstall the assistant and remove all data')
    .action(uninstall);

program.parse();
