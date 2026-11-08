import { describe, it, expect, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { BrokerClient } from '../../workers/broker-client.js';
import { ManageWorkersTool } from '../../tools/manage-workers.js';

describe('worker management compatibility', () => {
    it('keeps stop/abort messaging available for externally owned RPC adapters', async () => {
        const request = vi.fn(async () => null),
            workerId = randomUUID();
        const tool = new ManageWorkersTool({ request } as unknown as BrokerClient);
        await tool.execute('call', { action: 'stop', workerId });
        expect(request).toHaveBeenCalledWith(
            expect.objectContaining({ op: 'send', mode: 'stop', workerId })
        );
    });
    it('legacy import defaults to dry-run and registration remains passive', async () => {
        const request = vi.fn(async () => null),
            tool = new ManageWorkersTool({ request } as unknown as BrokerClient);
        await tool.execute('call', {
            action: 'import_legacy',
            name: 'Relay',
            emoji: '📬',
            objective: 'Review',
            scope: 'Read only',
            legacy: { sourceId: 'old', artifactDirectory: '/original/old' }
        });
        expect(request).toHaveBeenCalledWith(
            expect.objectContaining({ op: 'import_legacy', dryRun: true })
        );
        const result = await tool.execute('call', {
            action: 'register',
            name: 'Scout',
            emoji: '🔎',
            objective: 'Review',
            scope: 'Read only'
        });
        expect(JSON.parse(result.content[0].text).processLaunched).toBe(false);
    });
});
