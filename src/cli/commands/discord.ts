import chalk from 'chalk';
import path from 'path';
import fs from 'fs';
import { getTarsHome } from '../../utils/paths.js';

/**
 * tars discord - Display Discord setup and invitation instructions
 */
export async function discord() {
    const tarsHome = getTarsHome();
    let assistantName = 'Tars';
    try {
        const configPath = path.join(tarsHome, 'config.json');
        if (fs.existsSync(configPath)) {
            const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
            if (config.assistantName) {
                assistantName = config.assistantName;
            }
        }
    } catch (e) {}

    console.log(chalk.bold.cyan(`\n💬 Discord Setup & Invitation Guide (${assistantName})`));
    console.log(chalk.cyan('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));

    console.log(chalk.bold('\n1. 🛠️ Configure your Bot Application'));
    console.log(
        chalk.white('   • Go to: ') + chalk.blue('https://discord.com/developers/applications')
    );
    console.log(chalk.white(`   • Select your ${assistantName} application.`));
    console.log(chalk.white('   • Click ') + chalk.bold('Bot') + chalk.white(' in the sidebar.'));
    console.log(
        chalk.white('   • Toggle ') +
            chalk.bold.red('Message Content Intent') +
            chalk.white(' to ON.')
    );
    console.log(
        chalk.white('   • ') +
            chalk.italic('Note: A green "Save Changes" bar will pop up at the bottom — click it!')
    );

    console.log(chalk.bold('\n2. 🔗 Generate Invitation Link'));
    console.log(
        chalk.white('   • Click ') +
            chalk.bold('OAuth2') +
            chalk.white(' -> ') +
            chalk.bold('URL Generator') +
            chalk.white(' in the sidebar.')
    );
    console.log(chalk.white('   • Scopes: Check ') + chalk.green('bot') + chalk.white('.'));
    console.log(
        chalk.white('   • Bot Permissions: Check ') +
            chalk.green('Send Messages') +
            chalk.white(', ') +
            chalk.green('Read Message History') +
            chalk.white(', and ') +
            chalk.green('View Channels') +
            chalk.white('.')
    );
    console.log(
        chalk.white('   • ') +
            chalk.italic('No save required here!') +
            chalk.white(' Just copy the generated URL at the bottom and open it in a new tab.')
    );

    console.log(chalk.bold('\n3. 🏰 Add to Server'));
    console.log(chalk.white('   • Select your server from the dropdown.'));
    console.log(
        chalk.white('     ') +
            chalk.italic(
                "(Don't have a server? Create one in Discord first by clicking the [+] icon in your server list)"
            )
    );
    console.log(chalk.white('   • Click ') + chalk.bold('Authorize') + chalk.white('.'));

    console.log(chalk.bold('\n4. ✅ Verify Installation'));
    console.log(chalk.white(`   • ${assistantName} should appear in your member list.`));
    console.log(
        chalk.white(`   • Once ${assistantName} is running (via `) +
            chalk.cyan('tars start') +
            chalk.white('), type ') +
            chalk.bold(`!${assistantName.toLowerCase()} hello`) +
            chalk.white(' to test.')
    );
    console.log('\n');
}
