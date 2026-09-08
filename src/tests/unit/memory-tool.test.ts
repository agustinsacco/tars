import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { WorkspaceStore, WORKSPACE_BUDGETS } from '../../memory/workspace-store.js';
import { MemoryTool } from '../../tools/memory-tool.js';

const temporaryDirectories: string[] = [];

function createTool(): { tool: MemoryTool; store: WorkspaceStore } {
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tars-memory-tool-'));
    temporaryDirectories.push(homeDir);
    const store = new WorkspaceStore(homeDir);
    return { tool: new MemoryTool(store), store };
}

function resultText(result: { content: Array<{ text: string }> }): string {
    return result.content.map((part) => part.text).join('\n');
}

afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
        fs.rmSync(directory, { force: true, recursive: true });
    }
});

describe('MemoryTool', () => {
    it('saves entries and reports the gauge without echoing the entry list', async () => {
        // ARRANGE
        const { tool, store } = createTool();

        // ACT
        const result = await tool.execute('call-1', {
            target: 'user',
            operations: [{ action: 'add', text: 'Owner: Agustin, prefers concise replies.' }]
        });

        // ASSERT
        const text = resultText(result);
        expect(text).toContain('Saved. 1 user entries');
        expect(text).toContain('do not repeat it');
        expect(text).not.toContain('prefers concise replies');
        expect(await store.readEntries('user')).toEqual([
            'Owner: Agustin, prefers concise replies.'
        ]);
    });

    it('returns a consolidation error with usage when the budget overflows', async () => {
        // ARRANGE
        const { tool } = createTool();

        // ACT
        const result = await tool.execute('call-1', {
            target: 'memory',
            operations: [{ action: 'add', text: 'X'.repeat(WORKSPACE_BUDGETS.memory + 1) }]
        });

        // ASSERT
        expect(result.isError).toBe(true);
        const text = resultText(result);
        expect(text).toContain('exceeds the memory budget');
        expect(text).toContain('stop retrying memory calls');
    });

    it('rejects malformed operations without touching the store', async () => {
        // ARRANGE
        const { tool, store } = createTool();

        // ACT
        const result = await tool.execute('call-1', {
            target: 'memory',
            operations: [{ action: 'replace', text: 'new text' }]
        });

        // ASSERT
        expect(result.isError).toBe(true);
        expect(resultText(result)).toContain('replace requires "oldText"');
        expect(await store.readEntries('memory')).toEqual([]);
    });
});
