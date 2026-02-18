import fs from 'fs/promises';
import path from 'path';
import os from 'os';

export interface Task {
    id: string;
    title: string;
    prompt: string;
    schedule: string;
    nextRun: string;
    lastRun?: string;
    enabled: boolean;
    mode: 'notify' | 'silent';
    source: 'user' | 'system';
    failedCount: number;
    createdAt: string;
    updatedAt: string;
}

export class TaskStore {
    private readonly filePath: string;
    private lock: Promise<void> = Promise.resolve();

    constructor() {
        const tarsHome = process.env.TARS_HOME || path.join(os.homedir(), '.tars');
        this.filePath = path.join(tarsHome, 'data', 'tasks.json');
    }

    private async withLock<T>(fn: () => Promise<T>): Promise<T> {
        const result = this.lock.then(fn);
        this.lock = result.then(
            () => {},
            () => {}
        );
        return result;
    }

    private async _load(): Promise<Task[]> {
        try {
            const data = await fs.readFile(this.filePath, 'utf-8');
            return JSON.parse(data);
        } catch (error: any) {
            if (error.code === 'ENOENT') {
                return [];
            }
            throw error;
        }
    }

    private async _save(tasks: Task[]): Promise<void> {
        await fs.mkdir(path.dirname(this.filePath), { recursive: true });
        const data = JSON.stringify(tasks, null, 2);
        await fs.writeFile(this.filePath, data, 'utf-8');
    }

    public async loadTasks(): Promise<Task[]> {
        return this.withLock(() => this._load());
    }

    public async addTask(task: Task): Promise<void> {
        return this.withLock(async () => {
            const tasks = await this._load();
            tasks.push(task);
            await this._save(tasks);
        });
    }

    public async updateTask(id: string, updates: Partial<Task>): Promise<Task | null> {
        return this.withLock(async () => {
            const tasks = await this._load();
            const index = tasks.findIndex((t) => t.id === id);
            if (index === -1) return null;

            tasks[index] = { ...tasks[index], ...updates, updatedAt: new Date().toISOString() };
            await this._save(tasks);
            return tasks[index];
        });
    }

    public async deleteTask(id: string): Promise<boolean> {
        return this.withLock(async () => {
            const tasks = await this._load();
            const initialLength = tasks.length;
            const filteredTasks = tasks.filter((t) => t.id !== id);

            if (filteredTasks.length === initialLength) return false;

            await this._save(filteredTasks);
            return true;
        });
    }
}
