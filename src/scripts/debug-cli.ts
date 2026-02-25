import { Config } from '../config/config.js';
import { GeminiEngine } from '../supervisor/gemini-engine.js';
import logger from '../utils/logger.js';

async function main() {
    console.log('🔍 Starting Debug CLI (Native)...');

    const config = Config.getInstance();
    console.log(`🏠 Home Dir: ${config.homeDir}`);

    const engine = new GeminiEngine(config);

    // Provide a mocked DiscordBot so the send_discord_message tool is injected
    engine.setDiscordBot({
        config: config,
        notify: async (content: string) => {
            console.log(`\n\n📢 [MOCK DISCORD NOTIFICATION] -> ${content}\n\n`);
        }
    } as any);

    await engine.initialize();

    const prompt = process.argv[2] || 'write a haiku';
    console.log(`🚀 Running prompt: "${prompt}"`);

    try {
        await engine.run(prompt, (event) => {
            console.log('--------------------------------------------------');
            console.log(`📨 Event Type: ${event.type}`);
            console.log(`📝 Raw Event: ${JSON.stringify(event, null, 2)}`);
        });

        console.log('--------------------------------------------------');
        console.log('✅ Run complete.');
    } catch (error) {
        console.error('❌ Error during run:', error);
    }
}

main().catch(console.error);
