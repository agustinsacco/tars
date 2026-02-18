import { Config } from '../config/config.js';
import { GeminiCli } from '../supervisor/gemini-cli.js';
import logger from '../utils/logger.js';

import { execSync } from 'child_process';

async function main() {
    console.log('🔍 Starting Debug CLI...');
    console.log(`PATH: ${process.env.PATH}`);

    try {
        const geminiPath = execSync('which gemini').toString().trim();
        console.log(`✅ Found gemini at: ${geminiPath}`);
    } catch (e) {
        console.warn('⚠️ Could not find gemini in PATH');
    }

    const config = Config.getInstance();
    console.log(`🏠 Home Dir: ${config.homeDir}`);

    const cli = new GeminiCli(config);

    console.log('🚀 Running prompt: "write a haiku"');

    let capturedSessionId: string | undefined;

    try {
        await cli.run('write a haiku', (event) => {
            console.log('--------------------------------------------------');
            console.log(`📨 Event Type: ${event.type}`);
            console.log(`📝 Raw Event: ${JSON.stringify(event, null, 2)}`);

            if (event.sessionId) {
                console.log(`✅ Session ID found in event: ${event.sessionId}`);
                if (!capturedSessionId) capturedSessionId = event.sessionId;
            }

            if (event.type === 'init') {
                if (event.session_id) {
                    console.log(`✅ Session ID found in init (snake_case): ${event.session_id}`);
                } else {
                    console.warn('⚠️ No session_id in init event!');
                }
            }
        });

        console.log('--------------------------------------------------');
        console.log('✅ Run complete.');
        if (capturedSessionId) {
            console.log(`🎉 Final Session ID captured: ${capturedSessionId}`);
        } else {
            console.error('❌ NO SESSION ID CAPTURED during run.');
        }
    } catch (error) {
        console.error('❌ Error during run:', error);
    }
}

main().catch(console.error);
