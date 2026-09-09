import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
    formatGauge,
    parseHeartbeatDirectives,
    truncateHeadTail,
    WorkspaceStore,
    WORKSPACE_BUDGETS
} from '../../memory/workspace-store.js';

const temporaryDirectories: string[] = [];

function createStore(): { store: WorkspaceStore; homeDir: string } {
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tars-workspace-'));
    temporaryDirectories.push(homeDir);
    return { store: new WorkspaceStore(homeDir), homeDir };
}

afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
        fs.rmSync(directory, { force: true, recursive: true });
    }
});

describe('WorkspaceStore.ensure', () => {
    it('seeds default files and preserves existing content', async () => {
        // ARRANGE
        const { store } = createStore();
        await store.ensure();
        fs.writeFileSync(store.filePath('SOUL.md'), 'custom identity', 'utf-8');

        // ACT
        await store.ensure();

        // ASSERT
        expect(fs.readFileSync(store.filePath('SOUL.md'), 'utf-8')).toBe('custom identity');
        expect(fs.existsSync(store.filePath('HEARTBEAT.md'))).toBe(true);
        expect(fs.existsSync(store.filePath('MEMORY.md'))).toBe(true);
        expect(fs.existsSync(store.filePath('USER.md'))).toBe(true);
        expect(fs.existsSync(store.filePath('BOOTSTRAP.md'))).toBe(true);
    });

    it('does not resurrect a deleted BOOTSTRAP.md', async () => {
        // ARRANGE
        const { store } = createStore();
        await store.ensure();
        fs.rmSync(store.filePath('BOOTSTRAP.md'));

        // ACT
        await store.ensure();

        // ASSERT
        expect(fs.existsSync(store.filePath('BOOTSTRAP.md'))).toBe(false);
    });

    it('ships a heartbeat template with zero active directives', async () => {
        // ARRANGE
        const { store } = createStore();
        await store.ensure();

        // ACT
        const directives = parseHeartbeatDirectives(await store.readFileOrEmpty('HEARTBEAT.md'));

        // ASSERT
        expect(directives).toEqual([]);
    });
});

describe('WorkspaceStore.applyOperations', () => {
    it('adds, replaces, and removes entries by unique substring', async () => {
        // ARRANGE
        const { store } = createStore();
        await store.applyOperations('memory', [
            { action: 'add', text: 'Owner prefers metric units.' },
            { action: 'add', text: 'Deploys happen on Fridays.' }
        ]);

        // ACT
        const result = await store.applyOperations('memory', [
            { action: 'replace', oldText: 'Fridays', text: 'Deploys happen on Mondays.' },
            { action: 'remove', oldText: 'metric units' }
        ]);

        // ASSERT
        expect(result.entries).toEqual(['Deploys happen on Mondays.']);
        expect(await store.readEntries('memory')).toEqual(['Deploys happen on Mondays.']);
    });

    it('skips duplicate adds without failing the batch', async () => {
        // ARRANGE
        const { store } = createStore();
        await store.applyOperations('user', [{ action: 'add', text: 'Name: Agustin' }]);

        // ACT
        const result = await store.applyOperations('user', [
            { action: 'add', text: 'Name: Agustin' },
            { action: 'add', text: 'Timezone: America/Toronto' }
        ]);

        // ASSERT
        expect(result.entries).toEqual(['Name: Agustin', 'Timezone: America/Toronto']);
        expect(result.notes.some((note) => note.includes('duplicate'))).toBe(true);
    });

    it('rejects ambiguous and missing substring matches', async () => {
        // ARRANGE
        const { store } = createStore();
        await store.applyOperations('memory', [
            { action: 'add', text: 'Project alpha uses Node.' },
            { action: 'add', text: 'Project beta uses Node.' }
        ]);

        // ACT / ASSERT
        await expect(
            store.applyOperations('memory', [{ action: 'remove', oldText: 'uses Node' }])
        ).rejects.toThrow(/matches 2 entries/);
        await expect(
            store.applyOperations('memory', [{ action: 'remove', oldText: 'gamma' }])
        ).rejects.toThrow(/No memory entry contains/);
    });

    it('checks the budget only on the final result of a batch', async () => {
        // ARRANGE
        const { store } = createStore();
        const bigEntry = 'A'.repeat(WORKSPACE_BUDGETS.memory - 100);
        await store.applyOperations('memory', [{ action: 'add', text: bigEntry }]);
        const replacement = 'B'.repeat(500);

        // ACT: an add alone would overflow, but remove+add in one call fits.
        await expect(
            store.applyOperations('memory', [{ action: 'add', text: replacement }])
        ).rejects.toThrow(/exceeds the memory budget/);
        const result = await store.applyOperations('memory', [
            { action: 'remove', oldText: 'AAAA' },
            { action: 'add', text: replacement }
        ]);

        // ASSERT
        expect(result.entries).toEqual([replacement]);
        expect(result.usedChars).toBeLessThanOrEqual(WORKSPACE_BUDGETS.memory);
    });

    it('refuses a batch that would empty a non-empty store', async () => {
        // ARRANGE
        const { store } = createStore();
        await store.applyOperations('memory', [{ action: 'add', text: 'only entry' }]);

        // ACT / ASSERT
        await expect(
            store.applyOperations('memory', [{ action: 'remove', oldText: 'only entry' }])
        ).rejects.toThrow(/Refusing to empty/);
    });
});

describe('WorkspaceStore.snapshot', () => {
    it('renders entry sections with a capacity gauge and truncates a long soul', async () => {
        // ARRANGE
        const { store } = createStore();
        await store.applyOperations('memory', [{ action: 'add', text: 'Deploys on Mondays.' }]);
        await store.applyOperations('user', [{ action: 'add', text: 'Name: Agustin' }]);
        fs.mkdirSync(store.workspaceDir, { recursive: true });
        fs.writeFileSync(store.filePath('SOUL.md'), 'S'.repeat(10_000), 'utf-8');

        // ACT
        const snapshot = await store.snapshot();

        // ASSERT
        expect(snapshot.memory).toContain('MEMORY (your durable notes)');
        expect(snapshot.memory).toMatch(/\[\d+% — [\d,]+\/2,500 chars\]/);
        expect(snapshot.memory).toContain('Deploys on Mondays.');
        expect(snapshot.user).toContain('Name: Agustin');
        expect(snapshot.soul).toContain('[...truncated');
        expect(snapshot.soul.length).toBeLessThan(10_000);
    });

    it('returns empty sections for a missing workspace', async () => {
        // ARRANGE
        const { store } = createStore();

        // ACT
        const snapshot = await store.snapshot();

        // ASSERT
        expect(snapshot).toEqual({ soul: '', memory: '', user: '', bootstrap: '' });
    });
});

describe('parseHeartbeatDirectives', () => {
    it('keeps only non-comment, non-empty lines', () => {
        const raw = [
            '# Heading comment',
            '',
            '- Review the task list.',
            '  # indented comment',
            '<!-- html comment -->',
            'Check failed cron jobs.'
        ].join('\n');
        expect(parseHeartbeatDirectives(raw)).toEqual([
            '- Review the task list.',
            'Check failed cron jobs.'
        ]);
    });
});

describe('helpers', () => {
    it('formats the gauge like the design', () => {
        expect(formatGauge(1_474, 2_200)).toBe('[67% — 1,474/2,200 chars]');
    });

    it('keeps short text unchanged in truncateHeadTail', () => {
        expect(truncateHeadTail('short', 100)).toBe('short');
    });
});
