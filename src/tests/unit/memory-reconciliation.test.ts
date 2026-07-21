import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { afterEach, describe, expect, it } from 'vitest';

import { type Config } from '../../config/config.js';
import { MemoryManager } from '../../memory/memory-manager.js';

const temporaryDirectories: string[] = [];

afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
        fs.rmSync(directory, { force: true, recursive: true });
    }
});

describe('MemoryManager reconciliation', () => {
    it('removes indexed chat sources after the source file is deleted', async () => {
        // ARRANGE
        const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tars-memory-reconcile-'));
        temporaryDirectories.push(homeDir);
        const chatsDir = path.join(homeDir, 'chats');
        fs.mkdirSync(chatsDir, { recursive: true });
        const chatPath = path.join(chatsDir, 'old-session.json');
        fs.writeFileSync(
            chatPath,
            JSON.stringify([{ role: 'user', content: 'A sufficiently long memory paragraph.' }])
        );
        const manager = new MemoryManager({ homeDir } as Config);
        await manager.fullSync();

        // ACT
        fs.rmSync(chatsDir, { recursive: true });
        await manager.fullSync();

        // ASSERT
        const database = new DatabaseSync(path.join(homeDir, 'data', 'knowledge.db'), {
            readOnly: true
        });
        const count = database.prepare('SELECT count(*) count FROM files').get();
        expect(count).toEqual({ count: 0 });
        database.close();
    });
});
