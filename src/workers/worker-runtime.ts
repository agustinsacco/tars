import { fork, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs/promises';
import net from 'node:net';
import { BrokerClient } from './broker-client.js';
import {
    WorkerEventDispatcher,
    type WorkerNotifier,
    type WorkerSupervisor
} from './event-dispatcher.js';

/** Package-owned broker lifecycle. Starting this service never launches a worker. */
export class WorkerRuntime {
    readonly client: BrokerClient;
    private readonly dispatcher: WorkerEventDispatcher;
    private child?: ChildProcess;
    private stopped = true;
    private retry?: NodeJS.Timeout;
    private failures = 0;
    constructor(
        private readonly home: string,
        supervisor: WorkerSupervisor,
        notifier: WorkerNotifier,
        private readonly warn: (message: string) => void
    ) {
        this.client = new BrokerClient(path.join(home, 'run', 'workers', 'broker.sock'));
        this.dispatcher = new WorkerEventDispatcher(this.client, supervisor, notifier);
    }
    async start(): Promise<void> {
        if (!this.stopped) return;
        this.stopped = false;
        try {
            await this.spawn();
            this.dispatcher.start();
        } catch (error) {
            this.stopped = true;
            this.child?.kill();
            throw error;
        }
    }
    async stop(): Promise<void> {
        this.stopped = true;
        if (this.retry) clearTimeout(this.retry);
        this.dispatcher.stop();
        this.client.close();
        const child = this.child;
        this.child = undefined;
        if (child && child.exitCode === null && child.signalCode === null) {
            await new Promise<void>((resolve) => {
                const timer = setTimeout(() => {
                    child.kill('SIGKILL');
                }, 3000);
                child.once('exit', () => {
                    clearTimeout(timer);
                    resolve();
                });
                child.kill('SIGTERM');
            });
        }
    }
    private async removeStaleSocket(): Promise<void> {
        const socketPath = this.client.socketPath;
        const stat = await fs.lstat(socketPath).catch((error: NodeJS.ErrnoException) => {
            if (error.code === 'ENOENT') return null;
            throw error;
        });
        if (!stat) return;
        if (!stat.isSocket() || (process.getuid && stat.uid !== process.getuid()))
            throw new Error('Unsafe worker socket path');
        const alive = await new Promise<boolean>((resolve, reject) => {
            const probe = net.createConnection(socketPath);
            const timer = setTimeout(() => {
                probe.destroy();
                reject(new Error('Existing worker socket did not respond'));
            }, 1000);
            probe.once('connect', () => {
                clearTimeout(timer);
                probe.destroy();
                resolve(true);
            });
            probe.once('error', (error: NodeJS.ErrnoException) => {
                clearTimeout(timer);
                if (error.code === 'ECONNREFUSED' || error.code === 'ENOENT') resolve(false);
                else reject(error);
            });
        });
        if (alive) throw new Error('A worker broker already owns this Tars home');
        const after = await fs.lstat(socketPath).catch(() => null);
        if (after && after.ino === stat.ino && after.dev === stat.dev && after.isSocket())
            await fs.unlink(socketPath);
    }
    private async spawn(): Promise<void> {
        if (this.stopped) return;
        await this.removeStaleSocket();
        if (this.stopped) return;
        const child = fork(
            fileURLToPath(new URL('./broker-main.js', import.meta.url)),
            [this.home],
            {
                env: { PATH: process.env.PATH ?? '/usr/bin:/bin', LANG: 'C.UTF-8' },
                stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
                execArgv: []
            }
        );
        this.child = child;
        const ready = new Promise<void>((resolve, reject) => {
            const timer = setTimeout(
                () => reject(new Error('Worker broker startup deadline exceeded')),
                5000
            );
            child.once('message', (message: unknown) => {
                clearTimeout(timer);
                if (
                    typeof message === 'object' &&
                    message !== null &&
                    Reflect.get(message, 'type') === 'ready'
                )
                    resolve();
                else reject(new Error('Invalid worker broker readiness'));
            });
            child.once('error', (error) => {
                clearTimeout(timer);
                reject(error);
            });
            child.once('exit', () => {
                clearTimeout(timer);
                reject(new Error('Worker broker exited before ready'));
            });
        });
        child.on('exit', () => {
            this.client.close();
            if (this.stopped) return;
            this.warn(
                'Worker broker disconnected; events remain durable. No worker task is automatically rerun.'
            );
            this.retry = setTimeout(
                () => {
                    this.retry = undefined;
                    void this.spawn().catch(() =>
                        this.warn(
                            'Worker broker restart failed; worker management requires attention.'
                        )
                    );
                },
                Math.min(60_000, 1000 * 2 ** Math.min(this.failures++, 6))
            );
        });
        await ready;
        await this.client.connect(true);
    }
}
