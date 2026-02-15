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

    constructor() {
        const tarsHome = process.env.TARS_HOME || path.join(os.homedir(), '.tars');
        this.filePath = path.join(tarsHome, 'data', 'tasks.json');
    }

    public async loadTasks(): Promise<Task[]> {
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

    public async saveTasks(tasks: Task[]): Promise<void> {
        // Ensure directory exists
        await fs.mkdir(path.dirname(this.filePath), { recursive: true });
        const data = JSON.stringify(tasks, null, 2);
        await fs.writeFile(this.filePath, data, 'utf-8');
    }

    public async addTask(task: Task): Promise<void> {
        const tasks = await this.loadTasks();
        tasks.push(task);
        await this.saveTasks(tasks);
    }

    public async updateTask(id: string, updates: Partial<Task>): Promise<Task | null> {
        const tasks = await this.loadTasks();
        const index = tasks.findIndex((t) => t.id === id);
        if (index === -1) return null;

        tasks[index] = { ...tasks[index], ...updates, updatedAt: new Date().toISOString() };
        await this.saveTasks(tasks);
        return tasks[index];
    }

    public async deleteTask(id: string): Promise<boolean> {
        const tasks = await this.loadTasks();
        const initialLength = tasks.length;
        const filteredTasks = tasks.filter((t) => t.id !== id);

        if (filteredTasks.length === initialLength) return false;

        await this.saveTasks(filteredTasks);
        return true;
    }
}
