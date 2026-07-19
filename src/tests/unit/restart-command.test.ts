import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const commandMocks = vi.hoisted(() => ({
    migrateMcpPoliciesInteractively: vi.fn(),
    restartActiveTarsProcessesByHome: vi.fn(),
    withTarsHomeMutationLease: vi.fn()
}));

vi.mock('../../cli/commands/extensions.js', () => ({
    migrateMcpPoliciesInteractively: commandMocks.migrateMcpPoliciesInteractively
}));
vi.mock('../../utils/pm2-processes.js', () => ({
    restartActiveTarsProcessesByHome: commandMocks.restartActiveTarsProcessesByHome
}));
vi.mock('../../utils/paths.js', () => ({ getTarsHome: () => '/tmp/tars-restart-test' }));
vi.mock('../../utils/tars-home-lease.js', () => ({
    withTarsHomeMutationLease: commandMocks.withTarsHomeMutationLease
}));

import { restart } from '../../cli/commands/restart.js';

beforeEach(() => {
    commandMocks.withTarsHomeMutationLease.mockImplementation(
        async (_home: string, _operation: string, callback: () => Promise<unknown>) => callback()
    );
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
});

afterEach(() => {
    vi.restoreAllMocks();
    vi.resetAllMocks();
});

describe('restart extension policy migration', () => {
    it('cancels restart when extension policies remain unresolved', async () => {
        // ARRANGE
        commandMocks.migrateMcpPoliciesInteractively.mockResolvedValue({
            changed: false,
            ready: false
        });

        // ACT
        const restarted = await restart();

        // ASSERT
        expect(restarted).toBe(false);
        expect(commandMocks.restartActiveTarsProcessesByHome).not.toHaveBeenCalled();
    });

    it('restarts active processes after a successful policy migration', async () => {
        // ARRANGE
        commandMocks.migrateMcpPoliciesInteractively.mockResolvedValue({
            changed: true,
            ready: true
        });
        commandMocks.restartActiveTarsProcessesByHome.mockResolvedValue([
            { name: 'tars-supervisor' }
        ]);

        // ACT
        const restarted = await restart();

        // ASSERT
        expect(restarted).toBe(true);
        expect(commandMocks.restartActiveTarsProcessesByHome).toHaveBeenCalledWith(
            '/tmp/tars-restart-test'
        );
    });
});
