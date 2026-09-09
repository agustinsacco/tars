import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * WorkspaceStore - the curated, human-editable memory layer.
 *
 * Owns `~/.tars/workspace/`: small markdown files that are injected into the
 * system prompt (SOUL.md, MEMORY.md, USER.md) or drive autonomy (HEARTBEAT.md,
 * BOOTSTRAP.md). MEMORY.md and USER.md hold `§`-delimited entries under a hard
 * character budget so the model must consolidate instead of hoarding; the raw
 * conversation history remains the source of truth for "what was said".
 */

export type WorkspaceTarget = 'memory' | 'user';

export type WorkspaceOperation =
    | { readonly action: 'add'; readonly text: string }
    | { readonly action: 'replace'; readonly oldText: string; readonly text: string }
    | { readonly action: 'remove'; readonly oldText: string };

export interface WorkspaceWriteResult {
    readonly entries: readonly string[];
    readonly usedChars: number;
    readonly budgetChars: number;
    readonly notes: readonly string[];
}

export interface WorkspaceSnapshot {
    readonly soul: string;
    readonly memory: string;
    readonly user: string;
    readonly bootstrap: string;
}

/** Budgets are characters, not tokens, so they are model-independent. */
export const WORKSPACE_BUDGETS = {
    soul: 4_000,
    memory: 2_500,
    user: 1_500
} as const;

export const ENTRY_DELIMITER = '\n§\n';

const TARGET_FILES: Record<WorkspaceTarget, string> = {
    memory: 'MEMORY.md',
    user: 'USER.md'
};

const TARGET_TITLES: Record<WorkspaceTarget, string> = {
    memory: 'MEMORY (your durable notes)',
    user: 'USER PROFILE (who the owner is)'
};

const DEFAULT_SOUL = `# SOUL.md — who I am

I am Tars, a personal assistant that runs on my owner's machine.

- I am direct, concise, and honest about what I did and did not do.
- I remember what matters and consolidate instead of hoarding.
- I act autonomously only on work my owner already authorized, and I stay
  silent unless something genuinely deserves their attention.

I may edit this file as I learn who I am, and I tell my owner when I do.
`;

const DEFAULT_HEARTBEAT = `# HEARTBEAT.md — my autonomous checklist
#
# Lines starting with '#' are comments. While this file has no active
# directives, autonomous pulse wakes are skipped and cost zero API calls.
#
# Add one directive per line, for example:
# - Review my task list and make progress on anything already authorized.
# - Check for failed scheduled tasks and summarize anything broken.
#
# Keep directives batchable and idempotent: every wake runs the whole list
# against the CURRENT state. Use scheduled tasks (cron) for exact timing.
`;

const DEFAULT_BOOTSTRAP = `# BOOTSTRAP.md — first run

You just came online with no memory. In your first conversation with your
owner:

1. Introduce yourself briefly and ask who they are and what they want from you.
2. Save what you learn about them with the memory tool (target "user").
3. Read SOUL.md, adjust it to the identity you agreed on, and tell the owner.
4. Ask what (if anything) you should do autonomously, and record it in
   workspace/HEARTBEAT.md.
5. Delete this file (workspace/BOOTSTRAP.md). Its existence is the only flag
   that first-run setup is still pending — you're you now.
`;

function getErrorCode(error: unknown): string | undefined {
    if (typeof error !== 'object' || error === null) return undefined;
    const code = Reflect.get(error, 'code');
    return typeof code === 'string' ? code : undefined;
}

/** Order-preserving parse of a `§`-delimited entry file. */
export function parseEntries(raw: string): string[] {
    const entries = raw
        .split('§')
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0);
    return [...new Set(entries)];
}

function joinEntries(entries: readonly string[]): string {
    return entries.join(ENTRY_DELIMITER);
}

/** `[67% — 1,474/2,200 chars]` capacity gauge so the model can self-manage. */
export function formatGauge(usedChars: number, budgetChars: number): string {
    const percent = budgetChars > 0 ? Math.round((usedChars / budgetChars) * 100) : 0;
    return `[${percent}% — ${usedChars.toLocaleString('en-US')}/${budgetChars.toLocaleString('en-US')} chars]`;
}

/** Head-and-tail truncation that keeps both ends of an oversized file. */
export function truncateHeadTail(text: string, budget: number): string {
    if (text.length <= budget) return text;
    const headLength = Math.floor(budget * 0.7);
    const tailLength = Math.floor(budget * 0.2);
    const omitted = text.length - headLength - tailLength;
    return `${text.slice(0, headLength)}\n[...truncated ${omitted} chars...]\n${text.slice(text.length - tailLength)}`;
}

/**
 * Extracts active heartbeat directives: non-empty lines that are not comments
 * ('#'-prefixed, which also covers markdown headings in the shipped template).
 * An empty result means autonomous wakes are skipped without any API call.
 */
export function parseHeartbeatDirectives(raw: string): string[] {
    return raw
        .replace(/<!--[\s\S]*?-->/g, '')
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !line.startsWith('#'));
}

export class WorkspaceStore {
    public readonly workspaceDir: string;

    public constructor(homeDir: string) {
        this.workspaceDir = path.join(homeDir, 'workspace');
    }

    public filePath(name: string): string {
        return path.join(this.workspaceDir, name);
    }

    /**
     * Seeds the workspace with default files, preserving anything that already
     * exists. BOOTSTRAP.md is only created when the workspace itself is new so
     * a deleted bootstrap file never resurrects on restart.
     */
    public async ensure(): Promise<void> {
        let workspaceIsNew = false;
        try {
            await fs.access(this.workspaceDir);
        } catch {
            workspaceIsNew = true;
        }
        await fs.mkdir(this.workspaceDir, { recursive: true });

        const seeds: Array<{ name: string; content: string }> = [
            { name: 'SOUL.md', content: DEFAULT_SOUL },
            { name: 'HEARTBEAT.md', content: DEFAULT_HEARTBEAT },
            { name: 'MEMORY.md', content: '' },
            { name: 'USER.md', content: '' }
        ];
        if (workspaceIsNew) seeds.push({ name: 'BOOTSTRAP.md', content: DEFAULT_BOOTSTRAP });

        for (const seed of seeds) {
            const target = this.filePath(seed.name);
            try {
                await fs.access(target);
            } catch {
                await this.atomicWrite(target, seed.content);
            }
        }
    }

    public async readFileOrEmpty(name: string): Promise<string> {
        try {
            return await fs.readFile(this.filePath(name), 'utf-8');
        } catch (error: unknown) {
            if (getErrorCode(error) === 'ENOENT') return '';
            throw error;
        }
    }

    public async readEntries(target: WorkspaceTarget): Promise<string[]> {
        return parseEntries(await this.readFileOrEmpty(TARGET_FILES[target]));
    }

    /**
     * Applies a batch of operations all-or-nothing. The budget is checked only
     * on the FINAL result, so one call can remove or replace stale entries to
     * free room AND add new ones even when an add alone would overflow.
     */
    public async applyOperations(
        target: WorkspaceTarget,
        operations: readonly WorkspaceOperation[]
    ): Promise<WorkspaceWriteResult> {
        if (operations.length === 0) throw new Error('No operations provided.');
        const budgetChars = WORKSPACE_BUDGETS[target];
        const original = await this.readEntries(target);
        const entries = [...original];
        const notes: string[] = [];

        for (const operation of operations) {
            if (operation.action === 'add') {
                const text = operation.text.trim();
                if (!text) throw new Error('add requires non-empty text.');
                if (entries.includes(text)) {
                    notes.push('Skipped duplicate add (entry already present).');
                    continue;
                }
                entries.push(text);
                continue;
            }

            const needle = operation.oldText.trim();
            if (!needle) throw new Error(`${operation.action} requires non-empty oldText.`);
            const matches = entries.filter((entry) => entry.includes(needle));
            if (matches.length === 0) {
                throw new Error(
                    `No ${target} entry contains "${needle}". Existing entries:\n${this.describeEntries(entries)}`
                );
            }
            if (matches.length > 1) {
                throw new Error(
                    `"${needle}" matches ${matches.length} entries; use a longer unique substring.`
                );
            }
            const index = entries.indexOf(matches[0]);
            if (operation.action === 'remove') {
                entries.splice(index, 1);
            } else {
                const text = operation.text.trim();
                if (!text) throw new Error('replace requires non-empty text.');
                entries.splice(index, 1);
                // Re-added at the same position; dedupe below handles collisions.
                entries.splice(index, 0, text);
            }
        }

        const finalEntries = [...new Set(entries)];
        if (original.length > 0 && finalEntries.length === 0) {
            throw new Error(
                'This batch would remove every entry. Refusing to empty the store; remove entries individually if that is intended.'
            );
        }

        const content = joinEntries(finalEntries);
        if (content.length > budgetChars) {
            throw new Error(
                `Result exceeds the ${target} budget ${formatGauge(content.length, budgetChars)}. ` +
                    `Consolidate in this same call: replace or remove stale entries to free room. Current entries:\n${this.describeEntries(finalEntries)}`
            );
        }

        await this.atomicWrite(this.filePath(TARGET_FILES[target]), content);
        return { entries: finalEntries, usedChars: content.length, budgetChars, notes };
    }

    /**
     * Frozen prompt snapshot: captured when the system prompt is (re)built,
     * never on every write, so mid-session memory writes hit disk without
     * churning the provider prefix cache.
     */
    public async snapshot(): Promise<WorkspaceSnapshot> {
        const [soul, memoryRaw, userRaw, bootstrap] = await Promise.all([
            this.readFileOrEmpty('SOUL.md'),
            this.readFileOrEmpty('MEMORY.md'),
            this.readFileOrEmpty('USER.md'),
            this.readFileOrEmpty('BOOTSTRAP.md')
        ]);
        return {
            soul: truncateHeadTail(soul.trim(), WORKSPACE_BUDGETS.soul),
            memory: this.renderEntryBlock('memory', parseEntries(memoryRaw)),
            user: this.renderEntryBlock('user', parseEntries(userRaw)),
            bootstrap: bootstrap.trim()
        };
    }

    /** Renders one prompt section with its capacity gauge; '' when empty. */
    private renderEntryBlock(target: WorkspaceTarget, entries: readonly string[]): string {
        if (entries.length === 0) return '';
        const content = joinEntries(entries);
        const gauge = formatGauge(content.length, WORKSPACE_BUDGETS[target]);
        return `## ${TARGET_TITLES[target]} ${gauge}\n\n${content}`;
    }

    private describeEntries(entries: readonly string[]): string {
        if (entries.length === 0) return '(no entries)';
        return entries.map((entry, index) => `${index + 1}. ${entry}`).join('\n');
    }

    private async atomicWrite(filePath: string, content: string): Promise<void> {
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        const temporaryPath = `${filePath}.${process.pid}.tmp`;
        try {
            await fs.writeFile(temporaryPath, content, { encoding: 'utf-8', mode: 0o600 });
            await fs.rename(temporaryPath, filePath);
        } catch (error: unknown) {
            await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
            throw error;
        }
    }
}
