import { describe, expect, it, vi } from 'vitest';

import { SendNotificationTool } from '../../tools/send-notification.js';

describe('SendNotificationTool', () => {
    it('delivers the requested message through the configured channel', async () => {
        // ARRANGE
        const notify = vi.fn().mockResolvedValue(undefined);
        const tool = new SendNotificationTool({ notify });

        // ACT
        const result = await tool.execute('call-1', { message: 'Deployment complete.' });

        // ASSERT
        expect(notify).toHaveBeenCalledWith('Deployment complete.');
        expect(result.details).toEqual({ status: 'success' });
    });

    it('returns a structured error when delivery fails', async () => {
        // ARRANGE
        const notify = vi.fn().mockRejectedValue(new Error('Channel unavailable'));
        const tool = new SendNotificationTool({ notify });

        // ACT
        const result = await tool.execute('call-2', { message: 'Deployment complete.' });

        // ASSERT
        expect(result.content[0]?.text).toContain('Channel unavailable');
        expect(result.details).toEqual({ status: 'error', error: 'Channel unavailable' });
    });
});
