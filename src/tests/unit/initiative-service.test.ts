import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { type ChannelManager } from '../../channels/channel-manager.js';
import { type Config } from '../../config/config.js';
import { InitiativeService } from '../../initiative/initiative-service.js';
import { ObjectiveStore } from '../../initiative/objective-store.js';

const temporaryDirectories: string[] = [];
const previousPm2Home = process.env.PM2_HOME;

afterEach(() => {
    vi.resetAllMocks();
    if (previousPm2Home === undefined) delete process.env.PM2_HOME;
    else process.env.PM2_HOME = previousPm2Home;
    for (const directory of temporaryDirectories.splice(0)) {
        fs.rmSync(directory, { force: true, recursive: true });
    }
});

function createConfig(homeDir: string): Config {
    return {
        configFilePath: path.join(homeDir, 'config.json'),
        homeDir,
        initiative: {
            intervalSec: 60,
            maxNotificationsPerDay: 3,
            mode: 'propose',
            quietHoursEnd: 0,
            quietHoursStart: 0,
            repeatAfterHours: 24
        },
        sessionFilePath: path.join(homeDir, 'data', 'session.json'),
        taskFilePath: path.join(homeDir, 'data', 'tasks.json')
    } as Config;
}

describe('InitiativeService', () => {
    it('proposes a due objective once and deduplicates later checks', async () => {
        // ARRANGE
        const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tars-initiative-'));
        temporaryDirectories.push(homeDir);
        process.env.PM2_HOME = path.join(homeDir, 'pm2');
        const config = createConfig(homeDir);
        const store = new ObjectiveStore(path.join(homeDir, 'data', 'objectives.json'));
        await store.create({
            desiredOutcome: 'Prepare a useful next step.',
            reviewAt: '2026-07-19T12:00:00.000Z',
            successCriteria: ['A next step is ready'],
            title: 'Advance personal project'
        });
        const notify = vi.fn().mockResolvedValue(undefined);
        const service = new InitiativeService(config, { notify } as unknown as ChannelManager);
        const firstTick = new Date('2026-07-20T12:00:00.000Z');

        // ACT
        await service.tick(firstTick);
        await service.tick(new Date(firstTick.getTime() + 61_000));

        // ASSERT
        expect(notify).toHaveBeenCalledOnce();
        expect(notify).toHaveBeenCalledWith(expect.stringContaining('Advance personal project'));
    });

    it('retries an alert after quiet hours instead of consuming it', async () => {
        // ARRANGE
        const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tars-initiative-quiet-'));
        temporaryDirectories.push(homeDir);
        process.env.PM2_HOME = path.join(homeDir, 'pm2');
        const config = createConfig(homeDir);
        config.initiative.quietHoursStart = 22;
        config.initiative.quietHoursEnd = 8;
        const store = new ObjectiveStore(path.join(homeDir, 'data', 'objectives.json'));
        await store.create({
            desiredOutcome: 'Review the waiting item.',
            reviewAt: '2026-07-19T12:00:00.000Z',
            successCriteria: ['The item was reviewed'],
            title: 'Waiting item'
        });
        const notify = vi.fn().mockResolvedValue(undefined);
        const service = new InitiativeService(config, { notify } as unknown as ChannelManager);

        // ACT
        await service.tick(new Date(2026, 6, 20, 23, 0, 0));
        await service.tick(new Date(2026, 6, 21, 9, 0, 0));

        // ASSERT
        expect(notify).toHaveBeenCalledOnce();
        expect(notify).toHaveBeenCalledWith(expect.stringContaining('Waiting item'));
    });
});
