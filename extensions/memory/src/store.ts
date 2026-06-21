import fs from 'fs/promises';
import fs_sync from 'fs';
import path from 'path';
import os from 'os';

// ── Types ──────────────────────────────────────────────

export interface Fact {
    key: string;
    value: string;
    updatedAt: string;
}

export interface FactsFile {
    facts: Record<string, Fact>;
}

// ── Store ──────────────────────────────────────────────

export class MemoryStore {
    private readonly dataDir: string;
    private readonly factsPath: string;
    private readonly notesDir: string;
    private lock: Promise<void> = Promise.resolve();

    constructor() {
        const tarsHome = process.env.TARS_HOME || path.join(os.homedir(), '.tars');
        this.dataDir = path.join(tarsHome, 'data', 'memory');
        this.factsPath = path.join(this.dataDir, 'facts.json');
        this.notesDir = path.join(this.dataDir, 'notes');
    }

    private async withLock<T>(fn: () => Promise<T>): Promise<T> {
        const result = this.lock.then(fn);
        this.lock = result.then(
            () => {},
            () => {}
        );
        return result;
    }

    // ── Facts (Key-Value) ─────────────────────────────

    private async _loadFacts(): Promise<FactsFile> {
        try {
            const data = await fs.readFile(this.factsPath, 'utf-8');
            return JSON.parse(data);
        } catch (error: any) {
            if (error.code === 'ENOENT') {
                return { facts: {} };
            }
            throw error;
        }
    }

    private async _saveFacts(file: FactsFile): Promise<void> {
        await fs.mkdir(path.dirname(this.factsPath), { recursive: true });
        await fs.writeFile(this.factsPath, JSON.stringify(file, null, 2), 'utf-8');
    }

    public async storeFact(key: string, value: string): Promise<Fact> {
        return this.withLock(async () => {
            const file = await this._loadFacts();
            const fact: Fact = {
                key,
                value,
                updatedAt: new Date().toISOString()
            };
            file.facts[key] = fact;
            await this._saveFacts(file);
            return fact;
        });
    }

    public async deleteFact(key: string): Promise<boolean> {
        return this.withLock(async () => {
            const file = await this._loadFacts();
            if (!(key in file.facts)) return false;
            delete file.facts[key];
            await this._saveFacts(file);
            return true;
        });
    }

    public async listFacts(): Promise<Fact[]> {
        return this.withLock(async () => {
            const file = await this._loadFacts();
            return Object.values(file.facts);
        });
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
        await fs.mkdir(this.notesDir, { recursive: true });
        const fileName = this.getTodayFileName();
        const filePath = path.join(this.notesDir, fileName);
        const entry = `- [${this.getTimestamp()}] ${content}\n`;
        await fs.appendFile(filePath, entry, 'utf-8');
        return fileName;
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
        } catch (error: any) {
            if (error.code !== 'ENOENT') console.error(`Failed to search notes: ${error}`);
        }

        // 3. Search Indexed Episodic Memory (Knowledge DB / Past Sessions)
        const dbPath = path.join(path.dirname(this.dataDir), 'knowledge.db');
        if (fs_sync.existsSync(dbPath)) {
            try {
                const { DatabaseSync } = await import('node:sqlite');
                const db = new DatabaseSync(dbPath);

                const sanitizedQuery = query
                    .replace(/[-\/\\^$*+?.()|[\]{}]/g, ' ')
                    .trim()
                    .split(/\s+/)
                    .filter(Boolean)
                    .map((term) => `"${term.replace(/"/g, '""')}"`)
                    .join(' AND ');

                if (sanitizedQuery) {
                    const dbResults = db
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
                        .all(sanitizedQuery) as any[];

                    for (const r of dbResults) {
                        // Prettify the source path (e.g. history/session-XXX.json -> Session history)
                        let source = r.path;
                        if (source.startsWith('history/')) {
                            const dateMatch = source.match(/session-(\d{4}-\d{2}-\d{2})/);
                            source = dateMatch
                                ? `Past Session ${dateMatch[1]}`
                                : 'Past Session history';
                        }
                        results.push(`[${source}] ${r.content.trim()}`);
                    }
                }
                db.close();
            } catch (error) {
                console.error(`Failed to search knowledge DB: ${error}`);
            }
        }

        return results;
    }
}
