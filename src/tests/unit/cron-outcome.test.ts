import { describe, expect, it } from 'vitest';

import { parseTaskOutcome } from '../../supervisor/cron-service.js';

describe('parseTaskOutcome', () => {
    it('accepts the structured scheduled-task contract', () => {
        // ARRANGE
        const response = JSON.stringify({
            changed: false,
            requiresAttention: false,
            status: 'ok',
            summary: 'No thresholds were crossed.'
        });

        // ACT
        const outcome = parseTaskOutcome(response);

        // ASSERT
        expect(outcome).toEqual({
            changed: false,
            requiresAttention: false,
            status: 'ok',
            summary: 'No thresholds were crossed.'
        });
    });

    it('treats legacy unstructured output as actionable instead of a silent success', () => {
        // ARRANGE
        const response = 'The tool failed authorization.';

        // ACT
        const outcome = parseTaskOutcome(response);

        // ASSERT
        expect(outcome.status).toBe('warning');
        expect(outcome.requiresAttention).toBe(true);
    });
});
