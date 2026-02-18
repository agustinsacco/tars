import { DatabaseSync } from 'node:sqlite';
import path from 'path';
import fs from 'fs';
import logger from '../utils/logger.js';
import { Config } from '../config/config.js';
import crypto from 'crypto';

export interface MemoryResult {
    path: string;
    content: string;
    score: number;
    startLine: number;
}

/**
 * KnowledgeStore - Local memory using SQLite FTS5.
 * Uses a classic keyword inverted index approach for high-speed, authless search.
 */
export class KnowledgeStore {
    private db: DatabaseSync;

    constructor(config: Config) {
        const dbPath = path.join(config.homeDir, 'data', 'knowledge.db');
        const dbDir = path.dirname(dbPath);
        if (!fs.existsSync(dbDir)) {
            fs.mkdirSync(dbDir, { recursive: true });
        }

        // FTS5 is built-in to modern SQLite, no need for allowExtension
        this.db = new DatabaseSync(dbPath);
        this.initialize();
    }

    private initialize() {
        try {
            // Initialize Tables
            this.db.exec(`
                CREATE TABLE IF NOT EXISTS files (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    path TEXT UNIQUE,
                    hash TEXT,
                    updated_at INTEGER
                );

                CREATE TABLE IF NOT EXISTS chunks (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    file_id INTEGER,
                    content TEXT,
                    start_line INTEGER,
                    end_line INTEGER,
                    FOREIGN KEY(file_id) REFERENCES files(id) ON DELETE CASCADE
                );

                -- Initialize FTS5 Search Table (Internal Storage)
                CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
                    content
                );
                
                -- Triggers to keep FTS in sync with chunks table
                CREATE TRIGGER IF NOT EXISTS chunks_ai AFTER INSERT ON chunks BEGIN
                    INSERT INTO chunks_fts(rowid, content) VALUES (new.id, new.content);
                END;
                CREATE TRIGGER IF NOT EXISTS chunks_ad AFTER DELETE ON chunks BEGIN
                    DELETE FROM chunks_fts WHERE rowid = old.id;
                END;
                CREATE TRIGGER IF NOT EXISTS chunks_au AFTER UPDATE ON chunks BEGIN
                    DELETE FROM chunks_fts WHERE rowid = old.id;
                    INSERT INTO chunks_fts(rowid, content) VALUES (new.id, new.content);
                END;
            `);
            logger.info('🧠 KnowledgeStore: Local keyword index initialized');
        } catch (error: any) {
            logger.error(`❌ KnowledgeStore init failed: ${error.message}`);
            throw error;
        }
    }

    /**
     * Add or update a file in the knowledge base.
     */
    async indexFile(filePath: string, content: string) {
        const hash = crypto.createHash('sha256').update(content).digest('hex');

        // 1. Check if file has changed
        const existing = this.db
            .prepare('SELECT id, hash FROM files WHERE path = ?')
            .get(filePath) as any;
        if (existing && existing.hash === hash) {
            return; // No changes
        }

        logger.info(`📝 Indexing: ${filePath}`);

        // 2. Clear old file data (Cascade delete handles chunks and triggers handle FTS)
        if (existing) {
            this.db.prepare('DELETE FROM files WHERE id = ?').run(existing.id);
        }

        // 3. Insert File Record
        const fileResult = this.db
            .prepare('INSERT INTO files (path, hash, updated_at) VALUES (?, ?, ?)')
            .run(filePath, hash, Date.now());
        const fileId = fileResult.lastInsertRowid;

        // 4. Chunk Content (Simple paragraph split)
        const paragraphs = content.split(/\n\s*\n/).filter((p) => p.trim().length > 20);

        // 5. Store Chunks (FTS is updated automatically via triggers)
        for (const p of paragraphs) {
            this.db
                .prepare('INSERT INTO chunks (file_id, content, start_line) VALUES (?, ?, ?)')
                .run(fileId, p, 0);
        }
    }

    /**
     * Search for relevant knowledge using keyword match (BM25 ranking).
     */
    async search(query: string, limit: number = 5): Promise<MemoryResult[]> {
        try {
            const results = this.db
                .prepare(
                    `
                SELECT f.path, c.content, c.start_line, rank as score
                FROM chunks_fts fts
                JOIN chunks c ON fts.rowid = c.id
                JOIN files f ON c.file_id = f.id
                WHERE chunks_fts MATCH ?
                ORDER BY rank
                LIMIT ?
            `
                )
                .all(query, limit) as any[];

            return results.map((r) => ({
                path: r.path,
                content: r.content,
                startLine: r.start_line,
                score: 1 / (1 + Math.abs(r.score)) // Normalize FTS rank to 0-1 range
            }));
        } catch (err) {
            logger.warn(`⚠️ Search failed: ${query}`);
            return [];
        }
    }
}
