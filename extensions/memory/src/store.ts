import { randomUUID } from 'crypto';
import type { Stats } from 'fs';
import fs, { type FileHandle } from 'fs/promises';
import fs_sync from 'fs';
import path from 'path';
import os from 'os';
import { z } from 'zod';

// ── Types ──────────────────────────────────────────────

export interface Fact {
    key: string;
    value: string;
    updatedAt: string;
}

export interface FactsFile {
    facts: Record<string, Fact>;
}

const FactSchema = z.object({
    key: z.string().min(1),
    value: z.string(),
    updatedAt: z.string().datetime()
});
const FactsFileSchema = z.object({ facts: z.record(z.string(), FactSchema) });
const KnowledgeSearchRowSchema = z.object({
    path: z.string(),
    content: z.string(),
    score: z.number()
});
const LOCK_RETRY_MS = 25;
const LOCK_TIMEOUT_MS = 5_000;
const STALE_LOCK_MS = 30_000;
const LockOwnerSchema = z.object({
    token: z.string().uuid(),
    pid: z.number().int().positive(),
    createdAt: z.number().int().nonnegative()
});

type LockOwner = z.infer<typeof LockOwnerSchema>;

interface AcquiredLock {
    readonly handle: FileHandle;
    readonly token: string;
}

function getErrorCode(error: unknown): string | undefined {
    if (typeof error !== 'object' || error === null) return undefined;
    const code = Reflect.get(error, 'code');
    return typeof code === 'string' ? code : undefined;
}

function isProcessAlive(owner: LockOwner): boolean {
    try {
        process.kill(owner.pid, 0);
        return true;
    } catch (error: unknown) {
        return getErrorCode(error) !== 'ESRCH';
    }
}

function parseLockOwner(contents: string): LockOwner | null {
    const lines = contents.trimEnd().split(/\r?\n/);
    if (lines.length !== 3) return null;

    const owner = LockOwnerSchema.safeParse({
        token: lines[0],
        pid: Number(lines[1]),
        createdAt: Number(lines[2])
    });
    return owner.success ? owner.data : null;
}

function statsMatch(first: Stats, second: Stats): boolean {
    return (
        first.dev === second.dev &&
        first.ino === second.ino &&
        first.mtimeMs === second.mtimeMs &&
        first.size === second.size
    );
}

async function wait(milliseconds: number): Promise<void> {
    await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

// ── Store ──────────────────────────────────────────────

export class MemoryStore {
    private readonly dataDir: string;
    private readonly factsPath: string;
    private readonly notesDir: string;
    private readonly lockPath: string;
    private queue: Promise<void> = Promise.resolve();

    constructor(tarsHome = process.env.TARS_HOME || path.join(os.homedir(), '.tars')) {
        this.dataDir = path.join(tarsHome, 'data', 'memory');
        this.factsPath = path.join(this.dataDir, 'facts.json');
        this.notesDir = path.join(this.dataDir, 'notes');
        this.lockPath = path.join(this.dataDir, '.store.lock');
    }

    private async serialize<T>(operation: () => Promise<T>): Promise<T> {
        const result = this.queue.then(operation);
        this.queue = result.then(
            () => undefined,
            () => undefined
        );
        return result;
    }

    private async acquireFileLock(): Promise<AcquiredLock> {
        await fs.mkdir(this.dataDir, { recursive: true });
        const deadline = Date.now() + LOCK_TIMEOUT_MS;
        while (Date.now() < deadline) {
            try {
                const handle = await fs.open(this.lockPath, 'wx', 0o600);
                const token = randomUUID();
                try {
                    await handle.writeFile(`${token}\n${process.pid}\n${Date.now()}\n`, 'utf8');
                    return { handle, token };
                } catch (error: unknown) {
                    await handle.close().catch(() => undefined);
                    await fs.unlink(this.lockPath).catch(() => undefined);
                    throw error;
                }
            } catch (error: unknown) {
                if (getErrorCode(error) !== 'EEXIST') throw error;
                await this.removeStaleLock();
                await wait(LOCK_RETRY_MS);
            }
        }
        throw new Error('Timed out waiting for the memory store lock');
    }

    private async removeStaleLock(): Promise<void> {
        try {
            const initialStats = await fs.lstat(this.lockPath);
            if (Date.now() - initialStats.mtimeMs <= STALE_LOCK_MS) return;

            const owner =
                initialStats.isFile() && !initialStats.isSymbolicLink()
                    ? parseLockOwner(await fs.readFile(this.lockPath, 'utf8'))
                    : null;
            if (owner && isProcessAlive(owner)) return;

            const currentStats = await fs.lstat(this.lockPath);
            if (statsMatch(initialStats, currentStats)) await fs.unlink(this.lockPath);
        } catch (error: unknown) {
            if (getErrorCode(error) !== 'ENOENT') throw error;
        }
    }

    private async releaseFileLock(lock: AcquiredLock): Promise<void> {
        await lock.handle.close();
        try {
            const token = (await fs.readFile(this.lockPath, 'utf8')).split('\n')[0];
            if (token === lock.token) await fs.unlink(this.lockPath);
        } catch (error: unknown) {
            if (getErrorCode(error) !== 'ENOENT') throw error;
        }
    }

    private async withFileLock<T>(operation: () => Promise<T>): Promise<T> {
        const lock = await this.acquireFileLock();
        try {
            return await operation();
        } finally {
            await this.releaseFileLock(lock);
        }
    }

    // ── Facts (Key-Value) ─────────────────────────────

    private async _loadFacts(): Promise<FactsFile> {
        try {
            const data = await fs.readFile(this.factsPath, 'utf-8');
            const parsed: unknown = JSON.parse(data);
            return FactsFileSchema.parse(parsed);
        } catch (error: unknown) {
            if (getErrorCode(error) === 'ENOENT') return { facts: {} };
            throw error;
        }
    }

    private async _saveFacts(file: FactsFile): Promise<void> {
        await fs.mkdir(path.dirname(this.factsPath), { recursive: true });
        const validated = FactsFileSchema.parse(file);
        const temporaryPath = `${this.factsPath}.${process.pid}.${randomUUID()}.tmp`;
        try {
            await fs.writeFile(temporaryPath, `${JSON.stringify(validated, null, 2)}\n`, {
                encoding: 'utf8',
                mode: 0o600
            });
            await fs.rename(temporaryPath, this.factsPath);
        } catch (error: unknown) {
            await fs.unlink(temporaryPath).catch(() => undefined);
            throw error;
        }
    }

    public async storeFact(key: string, value: string): Promise<Fact> {
        return this.serialize(() =>
            this.withFileLock(async () => {
                const file = await this._loadFacts();
                const fact = FactSchema.parse({
                    key,
                    value,
                    updatedAt: new Date().toISOString()
                });
                file.facts[key] = fact;
                await this._saveFacts(file);
                return fact;
            })
        );
    }

    public async deleteFact(key: string): Promise<boolean> {
        return this.serialize(() =>
            this.withFileLock(async () => {
                const file = await this._loadFacts();
                if (!(key in file.facts)) return false;
                delete file.facts[key];
                await this._saveFacts(file);
                return true;
            })
        );
    }

    public async listFacts(): Promise<Fact[]> {
        return this.serialize(async () => Object.values((await this._loadFacts()).facts));
    }

    // ── Notes (Daily Append-Only) ─────────────────────

    private getTodayFileName(): string {
        const now = new Date();
        const yyyy = now.getFullYear();
        const mm = String(now.getMonth() + 1).padStart(2, '0');
        const dd = String(now.getDate()).padStart(2, '0');
        return `${yyyy}-${mm}-${dd}.md`;
    }

    private getTimestamp(): string {
        const now = new Date();
        const hh = String(now.getHours()).padStart(2, '0');
        const mm = String(now.getMinutes()).padStart(2, '0');
        return `${hh}:${mm}`;
    }

    public async addNote(content: string): Promise<string> {
        return this.serialize(() =>
            this.withFileLock(async () => {
                await fs.mkdir(this.notesDir, { recursive: true });
                const fileName = this.getTodayFileName();
                const filePath = path.join(this.notesDir, fileName);
                const entry = `- [${this.getTimestamp()}] ${content}\n`;
                await fs.appendFile(filePath, entry, { encoding: 'utf8', mode: 0o600 });
                return fileName;
            })
        );
    }

    // ── Search ────────────────────────────────────────

    public async search(query: string): Promise<string[]> {
        const results: string[] = [];
        const queryLower = query.toLowerCase();

        // 1. Search Long-term Facts
        const file = await this._loadFacts();
        for (const fact of Object.values(file.facts)) {
            if (
                fact.key.toLowerCase().includes(queryLower) ||
                fact.value.toLowerCase().includes(queryLower)
            ) {
                results.push(`[Fact] ${fact.key}: ${fact.value}`);
            }
        }

        // 2. Search Daily Notes (Last 30 days)
        try {
            const noteFiles = await fs.readdir(this.notesDir);
            const mdFiles = noteFiles
                .filter((f) => f.endsWith('.md'))
                .sort()
                .reverse();

            for (const noteFile of mdFiles.slice(0, 30)) {
                const filePath = path.join(this.notesDir, noteFile);
                const content = await fs.readFile(filePath, 'utf-8');
                const lines = content.split('\n').filter((l) => l.trim());

                for (const line of lines) {
                    if (line.toLowerCase().includes(queryLower)) {
                        results.push(
                            `[Note ${noteFile.replace('.md', '')}] ${line.replace(/^- /, '')}`
                        );
                    }
                }
            }
        } catch (error: unknown) {
            if (getErrorCode(error) !== 'ENOENT') console.error(`Failed to search notes: ${error}`);
        }

        // 3. Search Indexed Episodic Memory (Knowledge DB / Past Sessions)
        const dbPath = path.join(path.dirname(this.dataDir), 'knowledge.db');
        if (fs_sync.existsSync(dbPath)) {
            try {
                const { DatabaseSync } = await import('node:sqlite');
                const db = new DatabaseSync(dbPath);
                try {
                    const sanitizedQuery = query
                        .replace(/[-/\\^$*+?.()|[\]{}]/g, ' ')
                        .trim()
                        .split(/\s+/)
                        .filter(Boolean)
                        .map((term) => `"${term.replace(/"/g, '""')}"`)
                        .join(' AND ');

                    if (sanitizedQuery) {
                        const dbResults = z.array(KnowledgeSearchRowSchema).parse(
                            db
                                .prepare(
                                    `
                        SELECT f.path, c.content, rank as score
                        FROM chunks_fts fts
                        JOIN chunks c ON fts.rowid = c.id
                        JOIN files f ON c.file_id = f.id
                        WHERE chunks_fts MATCH ?
                        ORDER BY rank
                        LIMIT 5
                    `
                                )
                                .all(sanitizedQuery)
                        );

                        for (const result of dbResults) {
                            // Prettify the source path (e.g. history/session-XXX.json -> Session history)
                            let source = result.path;
                            if (source.startsWith('history/')) {
                                const dateMatch = source.match(/session-(\d{4}-\d{2}-\d{2})/);
                                source = dateMatch
                                    ? `Past Session ${dateMatch[1]}`
                                    : 'Past Session history';
                            }
                            results.push(`[${source}] ${result.content.trim()}`);
                        }
                    }
                } finally {
                    db.close();
                }
            } catch (error) {
                console.error(`Failed to search knowledge DB: ${error}`);
            }
        }

        return results;
    }
}
