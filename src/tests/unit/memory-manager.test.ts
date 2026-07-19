import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { Config } from '../../config/config.js';
import { MemoryManager } from '../../memory/memory-manager.js';

describe('MemoryManager', () => {
    let homeDir: string | undefined;

    afterEach(async () => {
        if (homeDir) await fs.rm(homeDir, { recursive: true, force: true });
        homeDir = undefined;
    });

    it('indexes durable facts, skills, and session transcripts', async () => {
        // ARRANGE
        homeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tars-memory-manager-'));
        await fs.mkdir(path.join(homeDir, 'data', 'memory'), { recursive: true });
        await fs.mkdir(path.join(homeDir, 'skills', 'sample'), { recursive: true });
        await fs.mkdir(path.join(homeDir, 'chats'), { recursive: true });
        await fs.writeFile(
            path.join(homeDir, 'data', 'memory', 'facts.json'),
            JSON.stringify({
                facts: {
                    favorite_fruit: {
                        key: 'favorite_fruit',
                        value: 'pineapple is the durable preference'
                    }
                }
            })
        );
        await fs.writeFile(
            path.join(homeDir, 'skills', 'sample', 'SKILL.md'),
            'Deployment runbooks contain the skillmarker keyword for retrieval.'
        );
        await fs.writeFile(
            path.join(homeDir, 'chats', 'session.json'),
            JSON.stringify([
                { role: 'user', content: 'Remember sessionmarker during this conversation.' },
                {
                    role: 'assistant',
                    content: [{ type: 'text', text: 'The sessionmarker has been recorded.' }]
                }
            ])
        );
        const manager = new MemoryManager({ homeDir } as unknown as Config);

        // ACT
        await manager.fullSync();

        // ASSERT
        await expect(manager.search('pineapple')).resolves.toHaveLength(1);
        await expect(manager.search('skillmarker')).resolves.toHaveLength(1);
        await expect(manager.search('sessionmarker')).resolves.not.toHaveLength(0);
    });

    it('replaces changed indexed content without returning stale chunks', async () => {
        // ARRANGE
        homeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tars-memory-manager-'));
        await fs.mkdir(path.join(homeDir, 'data', 'memory'), { recursive: true });
        await fs.writeFile(
            path.join(homeDir, 'data', 'memory', 'facts.json'),
            JSON.stringify({
                facts: { topic: { key: 'topic', value: 'oldmarker is long enough to index' } }
            })
        );
        const manager = new MemoryManager({ homeDir } as unknown as Config);
        await manager.fullSync();

        // ACT
        await fs.writeFile(
            path.join(homeDir, 'data', 'memory', 'facts.json'),
            JSON.stringify({
                facts: { topic: { key: 'topic', value: 'newmarker is long enough to index' } }
            })
        );
        await manager.fullSync();

        // ASSERT
        await expect(manager.search('oldmarker')).resolves.toEqual([]);
        await expect(manager.search('newmarker')).resolves.toHaveLength(1);
    });
});
