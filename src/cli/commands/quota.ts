import chalk from 'chalk';
import { Config } from '../../config/config.js';
import { GeminiEngine } from '../../supervisor/gemini-engine.js';
import ora from 'ora';

export async function quota() {
    const config = Config.getInstance();
    const engine = new GeminiEngine(config);
    
    const spinner = ora('Retrieving model quotas...').start();
    
    try {
        await engine.initialize();
        
        // @ts-ignore - access private coreConfig
        const coreConfig = engine.coreConfig;
        
        if (!coreConfig) {
            spinner.fail(chalk.red('Failed to initialize Gemini Core configuration.'));
            return;
        }

        const quotaResult = await coreConfig.refreshUserQuota();
        
        if (!quotaResult || !quotaResult.buckets) {
            spinner.info(chalk.yellow('No quota information available.'));
            console.log(chalk.dim('\nPossible reasons:'));
            console.log(chalk.dim('1. Current auth method does not support quota tracking (e.g. legacy auth).'));
            console.log(chalk.dim('2. Code Assist server is not reachable.'));
            console.log(chalk.dim('3. You are not using a Google Cloud project for authentication.\n'));
            return;
        }

        spinner.stop();
        
        const activeModel = coreConfig.getActiveModel();
        console.log(chalk.cyan.bold('\n📊 Gemini Model Quotas'));
        console.log(chalk.cyan('──────────────────────'));
        
        const buckets = quotaResult.buckets;
        const relevantBuckets = buckets.filter((b: any) => b.modelId && b.modelId.includes('gemini'));

        for (const bucket of relevantBuckets) {
            const isActive = bucket.modelId === activeModel;
            const modelLabel = isActive ? chalk.green.bold(bucket.modelId + ' (Active)') : chalk.white(bucket.modelId);
            
            console.log(`${chalk.green('•')} ${modelLabel}`);
            
            if (bucket.remainingFraction != null) {
                const fraction = bucket.remainingFraction;
                const percent = (fraction * 100).toFixed(1);
                let color = chalk.green;
                
                if (fraction < 0.2) color = chalk.red;
                else if (fraction < 0.5) color = chalk.yellow;
                
                console.log(`  ${chalk.dim('Remaining:')} ${color(percent + '%')}`);
            }
            
            if (bucket.remainingAmount) {
                console.log(`  ${chalk.dim('Amount:')}    ${bucket.remainingAmount}`);
            }

            if (bucket.resetTime) {
                const reset = new Date(bucket.resetTime);
                console.log(`  ${chalk.dim('Resets:')}    ${reset.toLocaleString()}`);
            }
            
            console.log('');
        }
        
    } catch (error: any) {
        spinner.fail(chalk.red(`Error retrieving quota: ${error.message}`));
    }
}
