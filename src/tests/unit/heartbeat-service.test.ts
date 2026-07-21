import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

const attachmentMocks = vi.hoisted(() => ({ cleanup: vi.fn() }));

vi.mock('../../utils/attachment-processor.js', () => ({
    AttachmentProcessor: class {
        public cleanup(): void {
            attachmentMocks.cleanup();
        }
    }
}));

import { type Config } from '../../config/config.js';
import { type InitiativeService } from '../../initiative/initiative-service.js';
import { HeartbeatService } from '../../supervisor/heartbeat-service.js';
import { type SessionManager } from '../../supervisor/session-manager.js';
import { type Supervisor } from '../../supervisor/supervisor.js';

const temporaryDirectories: string[] = [];

afterEach(() => {
    vi.resetAllMocks();
    for (const directory of temporaryDirectories.splice(0)) {
        fs.rmSync(directory, { force: true, recursive: true });
    }
});

describe('HeartbeatService', () => {
    it('continues maintenance and initiative work while the user is idle', async () => {
        // ARRANGE
        const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tars-heartbeat-'));
        temporaryDirectories.push(homeDir);
        const fullSync = vi.fn().mockResolvedValue(undefined);
        const garbageCollect = vi.fn().mockResolvedValue(0);
        const initiativeTick = vi.fn().mockResolvedValue(undefined);
        const supervisor = {
            hasStaleRun: vi.fn().mockReturnValue(false),
            memory: { fullSync }
        } as unknown as Supervisor;
        const sessionManager = {
            garbageCollect,
            getLastUserInteraction: vi
                .fn()
                .mockReturnValue(new Date(Date.now() - 24 * 60 * 60 * 1_000)),
            getStats: vi.fn().mockReturnValue(null)
        } as unknown as SessionManager;
        const config = { heartbeatIntervalMs: 900_000, homeDir } as Config;
        const service = new HeartbeatService(supervisor, config, sessionManager, {
            tick: initiativeTick
        } as unknown as InitiativeService);
        const privateService = service as unknown as { tick(): Promise<void> };

        // ACT
        await privateService.tick();

        // ASSERT
        expect(fullSync).toHaveBeenCalledOnce();
        expect(garbageCollect).toHaveBeenCalledOnce();
        expect(attachmentMocks.cleanup).toHaveBeenCalledOnce();
        expect(initiativeTick).toHaveBeenCalledOnce();
    });
});
