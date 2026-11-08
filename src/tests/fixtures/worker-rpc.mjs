import process from 'node:process';
// Test-only native RPC stand-in. No model, network, tools or external messages.
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
const config = JSON.parse(
    fs.readFileSync(path.join(process.env.PI_CODING_AGENT_DIR, 'models.json'), 'utf8')
);
const provider = config.providers['local-worker'];
const model = { ...provider.models[0], provider: 'local-worker', baseUrl: provider.baseUrl };
const sessionDirectory = path.join(path.dirname(process.env.PI_CODING_AGENT_DIR), 'sessions');
const saved = process.argv.indexOf('--session');
const sessionFile =
    saved < 0 ? path.join(sessionDirectory, 'fixture.jsonl') : process.argv[saved + 1];
const write = (value) => process.stdout.write(JSON.stringify(value) + '\n');
for await (const line of readline.createInterface({ input: process.stdin })) {
    const request = JSON.parse(line);
    let data = {};
    if (request.type === 'get_available_models') data = { models: [model] };
    if (request.type === 'get_state')
        data = {
            model,
            thinkingLevel: 'off',
            sessionFile,
            isStreaming: false,
            isCompacting: false,
            pendingMessageCount: 0
        };
    write({ type: 'response', id: request.id, success: true, data });
    if (request.type === 'prompt') {
        fs.appendFileSync(sessionFile, JSON.stringify({ text: request.message }) + '\n');
        write({ type: 'agent_start' });
        write({
            type: 'message_end',
            message: {
                role: 'assistant',
                stopReason: 'stop',
                content: [{ type: 'text', text: 'fixture complete' }]
            }
        });
        write({ type: 'agent_end' });
    }
}
