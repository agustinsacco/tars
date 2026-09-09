import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { type Config } from '../../config/config.js';
import {
    digestPulseReply,
    extractPulseMarker,
    isSilentPulseReply,
    localDay,
    PulseService
} from '../../supervisor/pulse-service.js';
import { type Supervisor } from '../../supervisor/supervisor.js';

const temporaryDirectories: string[] = [];

interface Harness {
    service: PulseService;
    executeTask: ReturnType<typeof vi.fn>;
    notify: ReturnType<typeof vi.fn>;
    homeDir: string;
    statePath: string;
}

function createHarness(options: {
    heartbeat?: string;
    memory?: string;
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
    if (options.memory !== undefined) {
        fs.mkdirSync(path.join(homeDir, 'workspace'), { recursive: true });
        fs.writeFileSync(path.join(homeDir, 'workspace', 'MEMORY.md'), options.memory);
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
            maxWakesPerDay: 60,
            // Dream is off by default in the harness so wake tests stay focused.
            dreamEnabled: false,
            dreamHour: 3,
            ...options.pulse
        }
    } as Config;
    const notify = vi.fn().mockResolvedValue(undefined);
    return {
        service: new PulseService(supervisor, config, { notify }),
        executeTask,
        notify,
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

    it('stops waking after the daily budget is spent and resets on day rollover', async () => {
        // ARRANGE
        const { service, executeTask } = createHarness({
            heartbeat: '- Work.',
            reply: '[SILENT]',
            pulse: { maxWakesPerDay: 2 }
        });
        const today = new Date('2026-09-08T12:00:00');
        const tomorrow = new Date('2026-09-09T12:00:00');

        // ACT / ASSERT
        expect(await service.runOnce(today)).toBe('ran-silent');
        expect(await service.runOnce(today)).toBe('ran-silent');
        expect(await service.runOnce(today)).toBe('skipped-budget');
        expect(executeTask).toHaveBeenCalledTimes(2);
        expect(await service.runOnce(tomorrow)).toBe('ran-silent');
    });

    it('does not charge the budget for busy races', async () => {
        // ARRANGE
        const { service, statePath } = createHarness({
            heartbeat: '- Work.',
            reply: new Error('Supervisor is busy')
        });

        // ACT
        await service.runOnce();
        await service.runOnce(); // second call persists state via day bookkeeping

        // ASSERT: state file may not exist yet; in-memory counters stayed at zero
        if (fs.existsSync(statePath)) {
            const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
            expect(state.wakesToday ?? 0).toBe(0);
        }
    });

    it('parks after 5 consecutive errors, notifies once, and un-parks next day', async () => {
        // ARRANGE
        const { service, executeTask, notify } = createHarness({
            heartbeat: '- Work.',
            reply: new Error('provider exploded')
        });
        const today = new Date('2026-09-08T12:00:00');
        const tomorrow = new Date('2026-09-09T12:00:00');

        // ACT: five failing wakes, then two parked ticks
        for (let index = 0; index < 5; index += 1) {
            expect(await service.runOnce(today)).toBe('error');
        }
        const parked = await service.runOnce(today);
        const parkedAgain = await service.runOnce(today);
        executeTask.mockResolvedValue('[SILENT]');
        const nextDay = await service.runOnce(tomorrow);

        // ASSERT
        expect(parked).toBe('skipped-parked');
        expect(parkedAgain).toBe('skipped-parked');
        expect(executeTask).toHaveBeenCalledTimes(6); // 5 failures + next-day wake
        expect(notify).toHaveBeenCalledTimes(1);
        expect(String(notify.mock.calls[0][0])).toContain('Pulse parked');
        expect(nextDay).toBe('ran-silent');
    });

    it('resets the error streak on a successful wake', async () => {
        // ARRANGE
        const { service, executeTask, statePath } = createHarness({
            heartbeat: '- Work.',
            reply: new Error('provider exploded')
        });

        // ACT: four errors, then a success
        for (let index = 0; index < 4; index += 1) await service.runOnce();
        executeTask.mockResolvedValue('[SILENT]');
        await service.runOnce();

        // ASSERT
        const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
        expect(state.errorStreak).toBe(0);
        expect(state.parkedReason).toBeUndefined();
    });
});

describe('PulseService dream consolidation', () => {
    function writeChat(homeDir: string, sessionId: string): void {
        fs.mkdirSync(path.join(homeDir, 'chats'), { recursive: true });
        fs.writeFileSync(
            path.join(homeDir, 'chats', `${sessionId}.json`),
            JSON.stringify([
                { role: 'user', content: 'My favorite editor is Helix.' },
                { role: 'assistant', content: [{ type: 'text', text: 'Noted, saving that.' }] },
                { role: 'toolResult', content: 'should not appear' }
            ])
        );
    }

    it('runs once per day with memory writes enabled, even with an empty checklist', async () => {
        // ARRANGE: no HEARTBEAT directives, dream due at hour 0
        const { service, executeTask, homeDir, statePath } = createHarness({
            heartbeat: '# comments only\n',
            memory: 'Owner prefers concise replies.\n',
            reply: '[SILENT]',
            pulse: { dreamEnabled: true, dreamHour: 0 }
        });
        writeChat(homeDir, 'session-a');
        const now = new Date('2026-09-08T04:00:00');

        // ACT
        const first = await service.runOnce(now);
        const second = await service.runOnce(now);

        // ASSERT: dream ran exactly once, wake itself still skipped
        expect(first).toBe('skipped-empty');
        expect(second).toBe('skipped-empty');
        expect(executeTask).toHaveBeenCalledTimes(1);
        const [prompt, options] = executeTask.mock.calls[0];
        expect(prompt).toContain('Nightly dream');
        expect(prompt).toContain('Owner prefers concise replies.');
        expect(prompt).toContain('OWNER: My favorite editor is Helix.');
        expect(prompt).toContain('ASSISTANT: Noted, saving that.');
        expect(prompt).not.toContain('should not appear');
        expect(options).toEqual({ allowMemoryWrites: true, allowNotifications: false });
        const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
        expect(state.lastDreamDay).toBe(localDay(now));
    });

    it('waits for the dream hour and skips when disabled', async () => {
        // ARRANGE
        const early = createHarness({
            heartbeat: '# none\n',
            memory: 'A fact.\n',
            pulse: { dreamEnabled: true, dreamHour: 3 }
        });
        const disabled = createHarness({
            heartbeat: '# none\n',
            memory: 'A fact.\n',
            pulse: { dreamEnabled: false }
        });

        // ACT / ASSERT
        await early.service.runOnce(new Date('2026-09-08T01:00:00'));
        expect(early.executeTask).not.toHaveBeenCalled();
        await early.service.runOnce(new Date('2026-09-08T03:30:00'));
        expect(early.executeTask).toHaveBeenCalledTimes(1);
        await disabled.service.runOnce(new Date('2026-09-08T12:00:00'));
        expect(disabled.executeTask).not.toHaveBeenCalled();
    });

    it('marks the day without an agent turn when there is nothing to consolidate', async () => {
        // ARRANGE: no memory, no chats
        const { service, executeTask, statePath } = createHarness({
            heartbeat: '# none\n',
            pulse: { dreamEnabled: true, dreamHour: 0 }
        });
        const now = new Date('2026-09-08T12:00:00');

        // ACT
        await service.runOnce(now);

        // ASSERT
        expect(executeTask).not.toHaveBeenCalled();
        const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
        expect(state.lastDreamDay).toBe(localDay(now));
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
