import fs from 'fs';
import fsPromises from 'fs/promises';
import path from 'path';
import { KnowledgeStore } from './knowledge-store.js';
import { Config } from '../config/config.js';
import logger from '../utils/logger.js';

/**
 * MemoryManager - High-level interface for Tars' memory systems.
 * Manages the transition from flat GEMINI.md to indexed storage.
 */
export class MemoryManager {
    private knowledgeStore: KnowledgeStore;
    private config: Config;

    constructor(config: Config) {
        this.config = config;
        this.knowledgeStore = new KnowledgeStore(config);
    }

    /**
     * Initial sync of the "Brain" into the knowledge store.
     * This includes GEMINI.md, skills, and session transcripts.
     */
    public async fullSync(): Promise<void> {
        try {
            logger.info('🔄 Starting full memory sync...');
            logger.debug(`📁 HomeDir: ${this.config.homeDir}`);

            // 1. Sync GEMINI.md
            const geminiPath = path.join(this.config.homeDir, '.gemini', 'GEMINI.md');
            try {
                const content = await fsPromises.readFile(geminiPath, 'utf-8');
                await this.knowledgeStore.indexFile('GEMINI.md', content);
            } catch (e: any) {
                if (e.code !== 'ENOENT') logger.warn(`Failed to sync GEMINI.md: ${e.message}`);
            }

            // 2. Sync Skills
            const skillsDir = path.join(this.config.homeDir, '.gemini', 'skills');
            try {
                await fsPromises.access(skillsDir);
                await this.syncDir(skillsDir, 'skills');
            } catch (e: any) {
                if (e.code !== 'ENOENT') logger.warn(`Failed to sync skills: ${e.message}`);
            }

            // 3. Sync Sessions (Episodic Memory)
            await this.syncSessions();

            logger.info('✅ Memory sync complete.');
        } catch (error: any) {
            logger.error(`❌ Memory sync failed: ${error.message}`);
        }
    }

    /**
     * Finds and indexes past session conversations for episodic memory.
     */
    private async syncSessions(): Promise<void> {
        const tmpDir = path.join(this.config.homeDir, '.gemini', 'tmp');
        try {
            await fsPromises.access(tmpDir); // check exists
            const projectDirs = await fsPromises.readdir(tmpDir);

            for (const dir of projectDirs) {
                const chatsDir = path.join(tmpDir, dir, 'chats');
                try {
                    await fsPromises.access(chatsDir);
                    const files = (await fsPromises.readdir(chatsDir)).filter((f) =>
                        f.endsWith('.json')
                    );

                    for (const file of files) {
                        try {
                            const fullPath = path.join(chatsDir, file);
                            const raw = await fsPromises.readFile(fullPath, 'utf-8');
                            const session = JSON.parse(raw);

                            if (session.messages && session.messages.length > 0) {
                                const transcript = session.messages
                                    .map((m: any) => {
                                        const role = m.type === 'user' ? 'USER' : 'ASSISTANT';
                                        const text = Array.isArray(m.content)
                                            ? m.content.map((c: any) => c.text).join(' ')
                                            : m.content || '[Action]';
                                        return `${role}: ${text}`;
                                    })
                                    .join('\n\n');

                                await this.knowledgeStore.indexFile(`history/${file}`, transcript);
                            }
                        } catch (err) {
                            // Skip invalid session files
                        }
                    }
                } catch {
                    // chats dir doesn't exist
                }
            }
        } catch {
            return;
        }
    }

    private async syncDir(dir: string, category: string): Promise<void> {
        try {
            const entries = await fsPromises.readdir(dir, { withFileTypes: true });
            for (const entry of entries) {
                const fullPath = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    await this.syncDir(fullPath, category);
                } else if (entry.name.endsWith('.md')) {
                    const content = await fsPromises.readFile(fullPath, 'utf-8');
                    const relPath = path.relative(
                        path.join(this.config.homeDir, '.gemini'),
                        fullPath
                    );
                    await this.knowledgeStore.indexFile(relPath, content);
                }
            }
        } catch (e) {
            logger.warn(`Failed to sync directory ${dir}: ${e}`);
        }
    }

    /**
     * Search memory for relevant snippets.
     */
    public async search(query: string, limit: number = 5) {
        return this.knowledgeStore.search(query, limit);
    }
}
