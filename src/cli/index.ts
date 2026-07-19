#!/usr/bin/env node
import './suppress-warnings.js';
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
import { extensions } from './commands/extensions.js';

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
    .option('--name <name>', 'Instance name')
    .option('--role <role>', 'Instance role')
    .action(start);

program.command('stop').description('Stop the assistant supervisor').action(stop);

program
    .command('chat')
    .description('Start an interactive terminal chat session')
    .option('--no-discord', 'Disable Discord channel in chat mode')
    .action(async (options) => {
        const { chat } = await import('./commands/chat.js');
        return chat(options);
    });

program
    .command('restart')
    .description('Restart active assistant processes without installing updates')
    .action(async () => {
        if (!(await restart())) process.exitCode = 1;
    });

program
    .command('update')
    .description('Force check and install the latest version of Tars')
    .action(async () => {
        if (!(await update())) process.exitCode = 1;
    });

program
    .command('refresh')
    .description('Rebuild dashboard and extensions from the installed package')
    .option('--dashboard-only', 'Only refresh the dashboard')
    .option('--extensions-only', 'Only refresh extensions')
    .action(async (options) => {
        const { refresh } = await import('./commands/refresh.js');
        const refreshed = await refresh({
            dashboard: !options.extensionsOnly,
            extensions: !options.dashboardOnly
        });
        if (!refreshed) process.exitCode = 1;
    });

program
    .command('extensions')
    .description('Audit or migrate custom MCP extension security policies')
    .argument('<action>', 'Action to perform (audit or migrate)')
    .action(async (action: unknown) => {
        if (!(await extensions(action))) process.exitCode = 1;
    });

program
    .command('status')
    .description('Check the status of the assistant supervisor')
    .action(status);

program.command('quota').description('Check current model rate limits and quotas').action(quota);

program
    .command('export')
    .description('Export your brain (memories, tasks, extensions)')
    .option('-o, --output <path>', 'Output path for the archive')
    .option('--include-secrets', 'Include credentials and secrets in the archive')
    .action(async (options) => {
        const { exportBrain } = await import('./commands/export.js');
        await exportBrain(options);
    });

program
    .command('import')
    .description('Import a brain from an archive')
    .argument('<path>', 'Path to the brain archive (.tar.gz)')
    .action(async (path) => {
        const { importBrain } = await import('./commands/import.js');
        await importBrain(path);
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
    .argument('[value]', 'Secret value for set (stdin is safer for automation)')
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
    .command('uninstall')
    .description('Uninstall the assistant and remove all data')
    .action(async () => {
        await uninstall();
    });

program.parseAsync().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Tars command failed: ${message}`);
    process.exitCode = 1;
});
