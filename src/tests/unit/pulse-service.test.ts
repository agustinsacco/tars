import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { type Config } from '../../config/config.js';
import {
    digestPulseReply,
    extractPulseMarker,
    isSilentPulseReply,
    PulseService
} from '../../supervisor/pulse-service.js';
import { type Supervisor } from '../../supervisor/supervisor.js';

const temporaryDirectories: string[] = [];

interface Harness {
    service: PulseService;
    executeTask: ReturnType<typeof vi.fn>;
    homeDir: string;
    statePath: string;
}

function createHarness(options: {
    heartbeat?: string;
    busy?: boolean;
    pulse?: Partial<Config['pulse']>;
    reply?: string | Error;
}): Harness {
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tars-pulse-'));
    temporaryDirectories.push(homeDir);
    if (options.heartbeat !== undefined) {
        fs.mkdirSync(path.join(homeDir, 'workspace'), { recursive: true });
        fs.writeFileSync(path.join(homeDir, 'workspace', 'HEARTBEAT.md'), options.heartbeat);
    }
    const executeTask =
        options.reply instanceof Error
            ? vi.fn().mockRejectedValue(options.reply)
            : vi.fn().mockResolvedValue(options.reply ?? 'Did some work. Details follow.');
    const supervisor = {
        executeTask,
        isBusy: vi.fn().mockReturnValue(options.busy ?? false)
    } as unknown as Supervisor;
    const config = {
        homeDir,
        pulse: {
            enabled: true,
            floorSec: 60,
            ceilingSec: 960,
            activeHoursStart: 0,
            activeHoursEnd: 0,
            ...options.pulse
        }
    } as Config;
    return {
        service: new PulseService(supervisor, config),
        executeTask,
        homeDir,
        statePath: path.join(homeDir, 'data', 'pulse.json')
    };
}

afterEach(() => {
    vi.restoreAllMocks();
    for (const directory of temporaryDirectories.splice(0)) {
        fs.rmSync(directory, { force: true, recursive: true });
    }
});

describe('PulseService.runOnce', () => {
    it('does nothing when pulse is disabled', async () => {
        // ARRANGE
        const { service, executeTask } = createHarness({
            heartbeat: '- Check the task list.',
            pulse: { enabled: false }
        });

        // ACT / ASSERT
        expect(await service.runOnce()).toBe('disabled');
        await service.start();
        expect(executeTask).not.toHaveBeenCalled();
        service.stop();
    });

    it('skips without any API call when HEARTBEAT.md has no directives', async () => {
        // ARRANGE: template-style file with only comments
        const { service, executeTask } = createHarness({
            heartbeat: '# My checklist\n# - example directive\n'
        });

        // ACT / ASSERT
        expect(await service.runOnce()).toBe('skipped-empty');
        expect(executeTask).not.toHaveBeenCalled();
    });

    it('skips when the supervisor is busy so the owner always wins', async () => {
        // ARRANGE
        const { service, executeTask } = createHarness({
            heartbeat: '- Check the task list.',
            busy: true
        });

        // ACT / ASSERT
        expect(await service.runOnce()).toBe('skipped-busy');
        expect(executeTask).not.toHaveBeenCalled();
    });

    it('skips outside active hours', async () => {
        // ARRANGE: active only during an impossible one-hour window
        const now = new Date();
        const inactiveStart = (now.getHours() + 2) % 24;
        const inactiveEnd = (now.getHours() + 3) % 24;
        const { service, executeTask } = createHarness({
            heartbeat: '- Check the task list.',
            pulse: { activeHoursStart: inactiveStart, activeHoursEnd: inactiveEnd }
        });

        // ACT / ASSERT
        expect(await service.runOnce(now)).toBe('skipped-quiet-hours');
        expect(executeTask).not.toHaveBeenCalled();
    });

    it('runs the checklist with the wake contract and previous-wake marker', async () => {
        // ARRANGE
        const { service, executeTask } = createHarness({
            heartbeat: '- Review scheduled tasks.\n- Summarize failures.',
            reply: 'Reviewed tasks; nothing failing. All good.'
        });

        // ACT
        const first = await service.runOnce();
        const second = await service.runOnce();

        // ASSERT
        expect(first).toBe('ran-changed');
        expect(second).toBe('ran-unchanged');
        const prompt = executeTask.mock.calls[0][0] as string;
        expect(prompt).toContain('- Review scheduled tasks.');
        expect(prompt).toContain('- Summarize failures.');
        expect(prompt).toContain('[SILENT]');
        expect(prompt).toContain('This is the first wake.');
        expect(executeTask.mock.calls[0][1]).toEqual({ allowNotifications: true });
        const secondPrompt = executeTask.mock.calls[1][0] as string;
        expect(secondPrompt).toContain('Previous wake');
        expect(secondPrompt).toContain('Reviewed tasks; nothing failing.');
    });

    it('backs off exponentially while replies are unchanged and resets on change', async () => {
        // ARRANGE
        const { service, executeTask, statePath } = createHarness({
            heartbeat: '- Watch the build.',
            reply: 'Build is green as of 14:02:33.'
        });

        // ACT: same answer (modulo clock tokens) three times, then a change
        await service.runOnce();
        executeTask.mockResolvedValue('Build is green as of 15:47:01.');
        await service.runOnce();
        await service.runOnce();
        const stateAfterUnchanged = JSON.parse(fs.readFileSync(statePath, 'utf8'));
        executeTask.mockResolvedValue('Build FAILED: 3 tests broken.');
        const changed = await service.runOnce();
        const stateAfterChange = JSON.parse(fs.readFileSync(statePath, 'utf8'));

        // ASSERT: 60s floor doubled twice → 240s, change snaps back to floor
        expect(stateAfterUnchanged.currentDelayMs).toBe(240_000);
        expect(changed).toBe('ran-changed');
        expect(stateAfterChange.currentDelayMs).toBe(60_000);
        expect(stateAfterChange.lastMarker).toBe('Build FAILED: 3 tests broken.');
    });

    it('treats [SILENT] replies as quiet and never stores their text as marker', async () => {
        // ARRANGE
        const { service, statePath } = createHarness({
            heartbeat: '- Watch the build.',
            reply: '[SILENT]\nNothing changed since the last wake.'
        });

        // ACT
        const result = await service.runOnce();

        // ASSERT
        expect(result).toBe('ran-silent');
        const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
        expect(state.lastMarker).toBe('Nothing to report.');
    });

    it('caps backoff at the ceiling', async () => {
        // ARRANGE
        const { service, statePath } = createHarness({
            heartbeat: '- Watch.',
            reply: '[SILENT]',
            pulse: { floorSec: 60, ceilingSec: 100 }
        });

        // ACT
        await service.runOnce();
        await service.runOnce();
        await service.runOnce();

        // ASSERT
        const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
        expect(state.currentDelayMs).toBe(100_000);
    });

    it('survives wake failures and busy races without throwing', async () => {
        // ARRANGE
        const failing = createHarness({
            heartbeat: '- Work.',
            reply: new Error('provider exploded')
        });
        const busyRace = createHarness({
            heartbeat: '- Work.',
            reply: new Error('Supervisor is busy')
        });

        // ACT / ASSERT
        expect(await failing.service.runOnce()).toBe('error');
        expect(await busyRace.service.runOnce()).toBe('skipped-busy');
    });
});

describe('pulse helpers', () => {
    it('digest ignores clock, date, and duration tokens', () => {
        expect(digestPulseReply('Checked at 14:02:33 on 2026-09-08, took 12s. All green.')).toBe(
            digestPulseReply('Checked at 09:15 on 2026-09-09, took 340ms. All green.')
        );
        expect(digestPulseReply('All green.')).not.toBe(digestPulseReply('Build failed.'));
    });

    it('accepts bracketed silent replies but not prose mentions', () => {
        expect(isSilentPulseReply('[SILENT]')).toBe(true);
        expect(isSilentPulseReply('Nothing new.\n[SILENT]')).toBe(true);
        expect(isSilentPulseReply('I will reply [SILENT] when idle, but today: news!')).toBe(false);
    });

    it('extracts a bounded first sentence as the marker', () => {
        expect(extractPulseMarker('Reviewed 3 tasks. Then I did more.\nSecond line.')).toBe(
            'Reviewed 3 tasks.'
        );
        expect(extractPulseMarker('x'.repeat(500)).length).toBeLessThanOrEqual(200);
    });
});
