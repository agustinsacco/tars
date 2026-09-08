import { type AgentTool } from '@earendil-works/pi-agent-core';
import { Type, type Static } from 'typebox';

import {
    formatGauge,
    type WorkspaceOperation,
    type WorkspaceStore
} from '../memory/workspace-store.js';

const MemoryParamsSchema = Type.Object({
    target: Type.Union([Type.Literal('memory'), Type.Literal('user')], {
        description:
            '"memory" = your durable operational notes (MEMORY.md); "user" = facts about the owner (USER.md).'
    }),
    operations: Type.Array(
        Type.Object({
            action: Type.Union([
                Type.Literal('add'),
                Type.Literal('replace'),
                Type.Literal('remove')
            ]),
            text: Type.Optional(
                Type.String({ description: 'New entry text (for add and replace).' })
            ),
            oldText: Type.Optional(
                Type.String({
                    description:
                        'Unique substring of the existing entry to replace or remove. Does not need to be the full entry.'
                })
            )
        }),
        {
            minItems: 1,
            description:
                'Applied all-or-nothing. The character budget is checked only on the FINAL result, so one call can remove or replace stale entries to free room AND add new ones.'
        }
    )
});

type MemoryParams = Static<typeof MemoryParamsSchema>;

function toWorkspaceOperation(operation: MemoryParams['operations'][number]): WorkspaceOperation {
    if (operation.action === 'add') {
        if (!operation.text) throw new Error('add requires "text".');
        return { action: 'add', text: operation.text };
    }
    if (!operation.oldText) throw new Error(`${operation.action} requires "oldText".`);
    if (operation.action === 'remove') return { action: 'remove', oldText: operation.oldText };
    if (!operation.text) throw new Error('replace requires "text".');
    return { action: 'replace', oldText: operation.oldText, text: operation.text };
}

/**
 * The one write path into the curated memory workspace. Entries are durable
 * immediately; the in-context memory view refreshes at the next session
 * boundary (reset or compaction), which preserves the provider prompt cache.
 */
export class MemoryTool implements AgentTool<typeof MemoryParamsSchema> {
    public readonly name = 'memory';
    public readonly label = 'Memory';
    public readonly description =
        'Save, update, or remove durable memory entries. Memory says who the owner is and what the ' +
        'standing state of your operations is; reusable procedures belong in skills, and one-off task ' +
        'narratives belong nowhere. Keep entries short; the same lesson learned twice is ONE entry. ' +
        'Writes are saved to disk immediately and appear in your context at the next session boundary.';
    public readonly parameters = MemoryParamsSchema;

    public constructor(private readonly workspace: WorkspaceStore) {}

    public async execute(_toolCallId: string, params: MemoryParams) {
        try {
            const operations = params.operations.map(toWorkspaceOperation);
            const result = await this.workspace.applyOperations(params.target, operations);
            const notes = result.notes.length > 0 ? ` ${result.notes.join(' ')}` : '';
            // The entry list is deliberately omitted from success responses:
            // echoing it invites the model to "find more to fix".
            return {
                content: [
                    {
                        type: 'text' as const,
                        text:
                            `Saved. ${result.entries.length} ${params.target} entries, ` +
                            `${formatGauge(result.usedChars, result.budgetChars)}.${notes} ` +
                            'This update is complete — do not repeat it.'
                    }
                ],
                details: { usedChars: result.usedChars, budgetChars: result.budgetChars }
            };
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            return {
                content: [
                    {
                        type: 'text' as const,
                        text: `Memory write failed: ${message}\nIf this is your second failed attempt this turn, stop retrying memory calls, leave memory unchanged, and continue with your reply.`
                    }
                ],
                details: { status: 'error' },
                isError: true
            };
        }
    }
}
