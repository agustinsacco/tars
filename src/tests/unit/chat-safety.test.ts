import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const chatMocks = vi.hoisted(() => ({
    acquireForegroundChatLease: vi.fn(),
    assertTarsHomeInactive: vi.fn(),
    bootstrap: vi.fn(),
    releaseLease: vi.fn(),
    withTarsStartupLock: vi.fn(),
    wireMessageRouting: vi.fn()
}));

vi.mock('../../utils/pm2-processes.js', () => ({
    assertTarsHomeInactive: chatMocks.assertTarsHomeInactive
}));

vi.mock('../../supervisor/bootstrap.js', () => ({
    bootstrap: chatMocks.bootstrap,
    wireMessageRouting: chatMocks.wireMessageRouting
}));

vi.mock('../../utils/startup-lock.js', () => ({
    withTarsStartupLock: chatMocks.withTarsStartupLock
}));

vi.mock('../../utils/tars-home-lease.js', () => ({
    acquireForegroundChatLease: chatMocks.acquireForegroundChatLease
}));

import { chat } from '../../cli/commands/chat.js';

describe('foreground chat safety', () => {
    beforeEach(() => {
        chatMocks.withTarsStartupLock.mockImplementation(
            (_home: string, operation: () => Promise<unknown>) => operation()
        );
        chatMocks.acquireForegroundChatLease.mockResolvedValue({
            canonicalHome: '/tmp/tars-chat-test',
            kind: 'foreground-chat',
            operation: 'run foreground chat',
            release: chatMocks.releaseLease
        });
        chatMocks.releaseLease.mockResolvedValue(undefined);
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.resetAllMocks();
    });

    it('never bootstraps a second engine while the same Tars home is active', async () => {
        // ARRANGE
        chatMocks.assertTarsHomeInactive.mockRejectedValue(
            new Error('matching PM2 supervisor is online')
        );
        const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
        vi.spyOn(console, 'error').mockImplementation(() => undefined);

        // ACT
        await chat({ discord: false });

        // ASSERT
        expect(chatMocks.assertTarsHomeInactive).toHaveBeenCalledWith(
            expect.any(String),
            'start foreground chat'
        );
        expect(chatMocks.bootstrap).not.toHaveBeenCalled();
        expect(chatMocks.acquireForegroundChatLease).not.toHaveBeenCalled();
        expect(exit).toHaveBeenCalledWith(1);
    });

    it('holds the lease after startup and releases it through the TUI shutdown path', async () => {
        // ARRANGE
        chatMocks.assertTarsHomeInactive.mockResolvedValue(undefined);
        const channelManager = {
            registerChannel: vi.fn(),
            start: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
            stop: vi.fn<() => Promise<void>>().mockResolvedValue(undefined)
        };
        const tarsEngine = {
            shutdown: vi.fn<() => Promise<void>>().mockResolvedValue(undefined)
        };
        chatMocks.bootstrap.mockResolvedValue({
            config: {},
            tarsEngine,
            sessionManager: {},
            supervisor: {},
            channelManager
        });

        // ACT
        await chat({ discord: false });

        // ASSERT
        expect(chatMocks.acquireForegroundChatLease).toHaveBeenCalledOnce();
        expect(chatMocks.releaseLease).not.toHaveBeenCalled();
        const registeredChannel: unknown = channelManager.registerChannel.mock.calls[0]?.[0];
        const onExit =
            typeof registeredChannel === 'object' && registeredChannel !== null
                ? Reflect.get(registeredChannel, 'onExitCallback')
                : undefined;
        if (typeof onExit !== 'function') throw new Error('Expected a TUI exit callback.');
        await onExit();
        expect(channelManager.stop).toHaveBeenCalledOnce();
        expect(tarsEngine.shutdown).toHaveBeenCalledOnce();
        expect(chatMocks.releaseLease).toHaveBeenCalledOnce();
    });

    it('releases the lease when bootstrap fails after acquisition', async () => {
        // ARRANGE
        chatMocks.assertTarsHomeInactive.mockResolvedValue(undefined);
        chatMocks.bootstrap.mockRejectedValue(new Error('bootstrap failed'));
        const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
        vi.spyOn(console, 'error').mockImplementation(() => undefined);

        // ACT
        await chat({ discord: false });

        // ASSERT
        expect(chatMocks.releaseLease).toHaveBeenCalledOnce();
        expect(exit).toHaveBeenCalledWith(1);
    });
});
