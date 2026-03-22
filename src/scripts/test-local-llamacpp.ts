import { Config } from '../config/config.js';
import { GeminiEngine } from '../supervisor/gemini-engine.js';
import { GeminiEvent } from '../types/index.js';
import logger from '../utils/logger.js';

/**
 * End-to-End Integration Harness for Local Llama.cpp + Gemini Core SDK
 *
 * Objectives:
 * 1. Test local initialization bypassing the Gemini Core ClassifierStrategy.
 * 2. Connect to the local backend dynamically at 'http://stark:8086'.
 * 3. Validate tool-call stream aggregation and successful `undefined` mappings.
 */
async function runIntegrationTest() {
    console.log('🧪 Starting Local LlamaCpp Integration Test...\n');

    // 1. Manually build exactly the environment we want to test
    process.env.INFERENCE_BACKEND = 'llamacpp';
    process.env.LOCAL_INFERENCE_URL = 'http://stark:8086';
    process.env.DEBUG = '*';

    // CRITICAL DECOUPLING:
    // We override 'auto' with a concrete model alias to intentionally
    // force `@google/gemini-cli-core`'s OverrideStrategy to skip the ClassifierStrategy
    process.env.GEMINI_MODEL = 'gemini-3.1-pro-preview';

    process.env.GEMINI_API_KEY = 'dummy_llama_key_to_bypass_sdk_auth';

    const config = Config.getInstance();

    // Validate config correctly mapped our intentions
    console.log('📌 Config Verification:');
    console.log(` - Backend: ${config.inferenceBackend}`);
    console.log(` - Model:   ${config.geminiModel} (Must NOT be 'auto' for bypass)`);
    console.log(` - URL:     ${process.env.LOCAL_INFERENCE_URL}\n`);

    const engine = new GeminiEngine(config);

    // Mock the Discord Channel for Notification Tools
    engine.setChannelManager({
        config: config,
        notify: async (content: string) => {
            console.log(`\n\n📢 [MOCK DISCORD NOTIFICATION TOOL FIRED] -> ${content}\n\n`);
        }
    } as any);

    console.log('🚀 Initializing Gemini Engine...');
    // We pass a mock session string to mimic the new preservation fix
    await engine.initialize('mock-integration-uuid-1234');

    // The test prompt intentionally asks the agent to use a specific tool
    const prompt =
        process.argv[2] ||
        `You must strictly use the send_notification tool to broadcast the exact message "Test Notification". Do not say anything else.`;
    console.log(`\n🗣️  Prompt: "${prompt}"\n`);

    console.log('--------------------------------------------------');
    let chunkCount = 0;

    try {
        await engine.run(
            prompt,
            (event) => {
                console.log(`\n\n=== EVENT ===\n`, JSON.stringify(event, null, 2));
                switch (event.type) {
                    case 'text':
                        process.stdout.write(event.content || '');
                        chunkCount++;
                        break;
                    case 'tool_call':
                        console.log(`\n\n🛠️  -> TOOL REQUESTED: ${event.toolName}`);
                        console.log(`📥 -> ARGUMENTS: ${JSON.stringify(event.toolArgs)}`);
                        break;
                    case 'tool_response':
                        console.log(`\n✅ -> TOOL COMPLETED: ${event.toolName}`);
                        break;
                    case 'done':
                        console.log(`\n\n🏁 -> TURN FINISHED (Reason: ${'none'})`);
                        console.log(`📈 -> Chunks Streamed: ${chunkCount}`);
                        break;
                    default:
                        console.log(`\n[Unhandled Event]: `, event);
                }
            },
            'mock-integration-uuid-1234'
        );

        console.log('--------------------------------------------------');
        console.log('✅ Integration Test Complete.');
    } catch (error) {
        console.error('\n❌ Error during execution:');
        console.error(error);
    }
}

runIntegrationTest().catch(console.dir);
