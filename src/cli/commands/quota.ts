import chalk from 'chalk';
import { Config } from '../../config/config.js';
import { SessionManager } from '../../supervisor/session-manager.js';
import { GetQuotaTool } from '../../tools/get-quota.js';
import ora from 'ora';

export async function quota() {
    const config = Config.getInstance();
    const sessionManager = new SessionManager(config.sessionFilePath);

    const spinner = ora('Retrieving model quotas...').start();

    try {
        await sessionManager.load();

        const quotaTool = new GetQuotaTool(sessionManager, {
            piProvider: config.piProvider,
            contextWindowTokens: config.contextWindowTokens,
            piModel: config.piModel,
            piBaseUrl: config.piBaseUrl
        });

        const usageText = quotaTool.getLocalUsage();

        spinner.stop();
        console.log('\n' + usageText + '\n');
    } catch (error: any) {
        spinner.fail(chalk.red(`Error retrieving quota: ${error.message}`));
    }
}
