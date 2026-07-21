import fsPromises from 'fs/promises';
import path from 'path';
import { KnowledgeStore, type MemoryResult } from './knowledge-store.js';
import { type Config } from '../config/config.js';
import logger from '../utils/logger.js';
import { z } from 'zod';

const FactsFileSchema = z.object({
    facts: z.record(
        z.string(),
        z.object({
            key: z.string(),
            value: z.string()
        })
    )
});
const SessionContentPartSchema = z.object({ text: z.string().optional() }).passthrough();
const SessionMessageSchema = z
    .object({
        role: z.string(),
        content: z.union([z.string(), z.array(SessionContentPartSchema)])
    })
    .passthrough();
const SessionFileSchema = z.union([
    z.array(SessionMessageSchema),
    z.object({ messages: z.array(SessionMessageSchema) }).passthrough()
]);

function getErrorCode(error: unknown): string | undefined {
    if (typeof error !== 'object' || error === null) return undefined;
    const code = Reflect.get(error, 'code');
    return typeof code === 'string' ? code : undefined;
}

function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

/**
 * MemoryManager - High-level interface for Tars' memory systems.
 * Synchronizes durable facts, skills, and session transcripts into the search index.
 */
export class MemoryManager {
    private readonly knowledgeStore: KnowledgeStore;
    private readonly config: Config;

    constructor(config: Config) {
        this.config = config;
        this.knowledgeStore = new KnowledgeStore(config);
    }

    /**
     * Synchronize durable memory sources into the knowledge store.
     */
    public async fullSync(): Promise<void> {
        try {
            logger.info('🔄 Starting full memory sync...');
            logger.debug(`📁 HomeDir: ${this.config.homeDir}`);
            const indexedPaths = new Set<string>();
            let canReconcile = true;

            // 1. Sync Active Memory (Facts & Preferences)
            const memoryDir = path.join(this.config.homeDir, 'data', 'memory');
            const factsPath = path.join(memoryDir, 'facts.json');
            try {
                const content = await fsPromises.readFile(factsPath, 'utf-8');
                const parsed = FactsFileSchema.parse(JSON.parse(content));
                const factsText = Object.values(parsed.facts)
                    .map((fact) => `${fact.key}: ${fact.value}`)
                    .join('\n');
                await this.knowledgeStore.indexFile('active_memory/facts.txt', factsText);
                indexedPaths.add('active_memory/facts.txt');
            } catch (error: unknown) {
                if (getErrorCode(error) !== 'ENOENT') {
                    logger.warn(`Failed to sync memory facts: ${getErrorMessage(error)}`);
                    canReconcile = false;
                }
            }

            // 2. Sync Skills
            const skillsDir = path.join(this.config.homeDir, 'skills');
            try {
                await fsPromises.access(skillsDir);
                const skillSync = await this.syncDir(skillsDir);
                for (const indexedPath of skillSync.paths) indexedPaths.add(indexedPath);
                canReconcile &&= skillSync.complete;
            } catch (error: unknown) {
                if (getErrorCode(error) !== 'ENOENT') {
                    logger.warn(`Failed to sync skills: ${getErrorMessage(error)}`);
                    canReconcile = false;
                }
            }

            // 3. Sync Sessions (Episodic Memory)
            const sessionSync = await this.syncSessions();
            for (const indexedPath of sessionSync.paths) indexedPaths.add(indexedPath);
            canReconcile &&= sessionSync.complete;

            if (canReconcile) await this.knowledgeStore.reconcileFiles(indexedPaths);

            logger.info('✅ Memory sync complete.');
        } catch (error: unknown) {
            logger.error(`❌ Memory sync failed: ${getErrorMessage(error)}`);
        }
    }

    private async syncSessions(): Promise<{
        readonly complete: boolean;
        readonly paths: string[];
    }> {
        const chatsDir = path.join(this.config.homeDir, 'chats');
        const indexedPaths: string[] = [];
        let complete = true;
        try {
            await fsPromises.access(chatsDir); // check exists
            const files = (await fsPromises.readdir(chatsDir)).filter((f) => f.endsWith('.json'));

            for (const file of files) {
                try {
                    const fullPath = path.join(chatsDir, file);
                    const raw = await fsPromises.readFile(fullPath, 'utf-8');
                    const session = SessionFileSchema.parse(JSON.parse(raw));
                    const messages = Array.isArray(session) ? session : session.messages;

                    if (messages && messages.length > 0) {
                        const transcript = messages
                            .map((message) => {
                                const role = message.role === 'user' ? 'USER' : 'ASSISTANT';
                                const text = Array.isArray(message.content)
                                    ? message.content.map((part) => part.text ?? '').join(' ')
                                    : message.content;
                                return `${role}: ${text}`;
                            })
                            .join('\n\n');

                        const indexedPath = `history/${file}`;
                        await this.knowledgeStore.indexFile(indexedPath, transcript);
                        indexedPaths.push(indexedPath);
                    }
                } catch {
                    // Skip invalid session files
                    complete = false;
                }
            }
        } catch (error: unknown) {
            return { complete: getErrorCode(error) === 'ENOENT', paths: indexedPaths };
        }
        return { complete, paths: indexedPaths };
    }

    private async syncDir(
        dir: string
    ): Promise<{ readonly complete: boolean; readonly paths: string[] }> {
        const indexedPaths: string[] = [];
        let complete = true;
        try {
            const entries = await fsPromises.readdir(dir, { withFileTypes: true });
            for (const entry of entries) {
                const fullPath = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    const nested = await this.syncDir(fullPath);
                    indexedPaths.push(...nested.paths);
                    complete &&= nested.complete;
                } else if (entry.name.endsWith('.md')) {
                    const content = await fsPromises.readFile(fullPath, 'utf-8');
                    const relPath = path.relative(this.config.homeDir, fullPath);
                    await this.knowledgeStore.indexFile(relPath, content);
                    indexedPaths.push(relPath);
                }
            }
        } catch (e) {
            logger.warn(`Failed to sync directory ${dir}: ${e}`);
            complete = false;
        }
        return { complete, paths: indexedPaths };
    }

    /**
     * Search memory for relevant snippets.
     */
    public async search(query: string, limit: number = 5): Promise<MemoryResult[]> {
        return this.knowledgeStore.search(query, limit);
    }

    public close(): void {
        this.knowledgeStore.close();
    }
}
