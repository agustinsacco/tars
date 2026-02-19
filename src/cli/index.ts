#!/usr/bin/env node
import { Command } from 'commander';
import { setup } from './commands/setup.js';
import { start } from './commands/start.js';
import { stop } from './commands/stop.js';
import { restart } from './commands/restart.js';
import { status } from './commands/status.js';
import { exportBrain } from './commands/export.js';
import { importBrain } from './commands/import.js';
import { logs } from './commands/logs.js';
import { discord } from './commands/discord.js';
import { secret } from './commands/secret.js';
import { memory } from './commands/memory.js';
import { uninstall } from './commands/uninstall.js';

import { versionString } from '../utils/version.js';

const program = new Command();

program.name('tars').description('Tars — Personal AI Assistant').version(versionString);

program
    .command('setup')
    .description('Interactive onboarding wizard to configure Tars')
    .action(setup);

program.command('start').description('Start Tars supervisor in the background').action(start);

program.command('stop').description('Stop the Tars supervisor').action(stop);

program
    .command('restart')
    .description('Check for updates and restart Tars')
    .action(restart);

program.command('status').description('Check the status of Tars supervisor').action(status);

program
    .command('export')
    .description('Export your brain (memories, tasks, extensions)')
    .option('-o, --output <path>', 'Output path for the archive')
    .action(exportBrain);

program
    .command('import')
    .description('Import a brain from an archive')
    .argument('<path>', 'Path to the brain archive (.tar.gz)')
    .action(importBrain);

program.command('logs').description('View real-time logs from the Tars supervisor').action(logs);

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
    .action((action, queryArgs) => memory(action, ...queryArgs));

program.command('uninstall').description('Uninstall Tars and remove all data').action(uninstall);

program.parse();
