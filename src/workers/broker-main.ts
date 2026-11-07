import path from 'node:path';
import fs from 'node:fs';
import { BrokerServer } from './broker-server.js';
import { WorkerStore } from './worker-store.js';

// Only spawned by the owning supervisor. Never a second supervisor/model service.
const home = process.argv[2];
if (!process.send || !home || !path.isAbsolute(home))
    throw new Error('Worker broker requires private supervisor IPC and an absolute home');
const directory = path.join(home, 'data', 'workers');
fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
const broker = new BrokerServer(
    path.join(home, 'run', 'workers', 'broker.sock'),
    new WorkerStore(path.join(directory, 'state.sqlite'))
);
let stopping = false;
async function stop(): Promise<void> {
    if (stopping) return;
    stopping = true;
    await broker.stop();
    process.exit(0);
}
process.on('disconnect', () => {
    void stop();
});
process.on('SIGTERM', () => {
    void stop();
});
process.on('SIGINT', () => {
    void stop();
});
try {
    await broker.start();
    process.send({ type: 'ready' });
} catch {
    process.exitCode = 1;
    process.disconnect();
}
