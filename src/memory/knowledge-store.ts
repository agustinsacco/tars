import { DatabaseSync } from 'node:sqlite';
import path from 'path';
import fs from 'fs';
import logger from '../utils/logger.js';
import { type Config } from '../config/config.js';
import crypto from 'crypto';
import { z } from 'zod';

const IndexedFileSchema = z.object({
    id: z.number().int().positive(),
    hash: z.string()
});
const SearchRowSchema = z.object({
    path: z.string(),
    content: z.string(),
    start_line: z.number().int(),
    score: z.number()
});

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
    private readonly db: DatabaseSync;

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

    private initialize(): void {
        try {
            this.db.exec('PRAGMA foreign_keys = ON;');

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
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            logger.error(`❌ KnowledgeStore init failed: ${message}`);
            throw error;
        }
    }

    /**
     * Add or update a file in the knowledge base.
     */
    async indexFile(filePath: string, content: string): Promise<void> {
        const hash = crypto.createHash('sha256').update(content).digest('hex');

        // 1. Check if file has changed
        const existingRow = this.db
            .prepare('SELECT id, hash FROM files WHERE path = ?')
            .get(filePath);
        const existing = existingRow ? IndexedFileSchema.parse(existingRow) : undefined;
        if (existing && existing.hash === hash) {
            return; // No changes
        }

        logger.info(`📝 Indexing: ${filePath}`);

        try {
            this.db.exec('BEGIN IMMEDIATE');

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
            const insertStmt = this.db.prepare(
                'INSERT INTO chunks (file_id, content, start_line) VALUES (?, ?, ?)'
            );

            for (const p of paragraphs) {
                insertStmt.run(fileId, p, 0);
            }

            this.db.exec('COMMIT');
        } catch (error) {
            this.db.exec('ROLLBACK');
            throw error;
        }
    }

    /**
     * Remove derived index rows whose source no longer exists.
     */
    async reconcileFiles(validPaths: ReadonlySet<string>): Promise<number> {
        const rows = this.db.prepare('SELECT path FROM files').all();
        const parsedRows = z.array(z.object({ path: z.string() })).parse(rows);
        const stalePaths = parsedRows
            .map(({ path: indexedPath }) => indexedPath)
            .filter((indexedPath) => !validPaths.has(indexedPath));
        if (stalePaths.length === 0) return 0;

        try {
            this.db.exec('BEGIN IMMEDIATE');
            const deleteStatement = this.db.prepare('DELETE FROM files WHERE path = ?');
            for (const stalePath of stalePaths) deleteStatement.run(stalePath);
            this.db.exec('COMMIT');
            logger.info(`🧹 Removed ${stalePaths.length} stale memory index source(s)`);
            return stalePaths.length;
        } catch (error: unknown) {
            this.db.exec('ROLLBACK');
            throw error;
        }
    }

    /**
     * Search for relevant knowledge using keyword match (BM25 ranking).
     */
    async search(query: string, limit: number = 5): Promise<MemoryResult[]> {
        try {
            const sanitizedQuery = query
                .replace(/[-/\\^$*+?.()|[\]{}]/g, ' ')
                .trim()
                .split(/\s+/)
                .filter(Boolean)
                .map((term) => `"${term.replace(/"/g, '""')}"`)
                .join(' AND ');

            if (!sanitizedQuery) return [];

            const rows = this.db
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
                .all(sanitizedQuery, limit);
            const results = z.array(SearchRowSchema).parse(rows);

            return results.map((r) => ({
                path: r.path,
                content: r.content,
                startLine: r.start_line,
                score: 1 / (1 + Math.abs(r.score)) // Normalize FTS rank to 0-1 range
            }));
        } catch {
            logger.warn(`⚠️ Search failed: ${query}`);
            return [];
        }
    }

    close(): void {
        this.db.close();
    }
}
