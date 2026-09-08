import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { z } from 'zod';

import { type Config } from '../config/config.js';
import { parseHeartbeatDirectives, WorkspaceStore } from '../memory/workspace-store.js';
import logger from '../utils/logger.js';
import { type Supervisor } from './supervisor.js';

const PulseStateSchema = z.object({
    tickCount: z.number().int().nonnegative().default(0),
    currentDelayMs: z.number().int().positive().optional(),
    lastDigest: z.string().optional(),
    lastTickAt: z.string().datetime().optional(),
    lastMarker: z.string().max(400).optional()
});

type PulseState = z.infer<typeof PulseStateSchema>;

export type PulseTickResult =
    | 'disabled'
    | 'skipped-empty'
    | 'skipped-quiet-hours'
    | 'skipped-busy'
    | 'ran-silent'
    | 'ran-unchanged'
    | 'ran-changed'
    | 'error';

/** Sentinel the wake contract asks for when there is nothing to report. */
export const PULSE_SILENT_SENTINEL = '[SILENT]';

const MARKER_MAX_CHARS = 200;

/**
 * Digest of a wake reply used for self-paced backoff. Clock, date, and
 * duration tokens are stripped so "checked at 14:02:33" cannot defeat
 * unchanged-detection.
 */
export function digestPulseReply(reply: string): string {
    const normalized = reply
        .toLowerCase()
        .replace(/\d{4}-\d{2}-\d{2}/g, '')
        .replace(/\d{1,2}:\d{2}(:\d{2})?\s*(am|pm)?/g, '')
        .replace(/\d+(\.\d+)?\s*(ms|s|sec|seconds|m|min|minutes|h|hours)\b/g, '')
        .replace(/\s+/g, ' ')
        .trim();
    return crypto.createHash('sha256').update(normalized).digest('hex');
}

/**
 * Autonomous replies reliably bracket the sentinel with a short note, so the
 * matcher accepts it on the first or last line as well as exact/prefix form.
 */
export function isSilentPulseReply(reply: string): boolean {
    const trimmed = reply.trim();
    if (trimmed === '' || trimmed.startsWith(PULSE_SILENT_SENTINEL)) return true;
    const lines = trimmed.split('\n').map((line) => line.trim());
    return lines[0] === PULSE_SILENT_SENTINEL || lines[lines.length - 1] === PULSE_SILENT_SENTINEL;
}

/** One-sentence tick marker: first sentence, hard-capped. Never the full reply. */
export function extractPulseMarker(reply: string): string {
    const firstLine = reply.trim().split('\n')[0] ?? '';
    const sentenceEnd = firstLine.search(/[.!?](\s|$)/);
    const sentence = sentenceEnd >= 0 ? firstLine.slice(0, sentenceEnd + 1) : firstLine;
    return sentence.slice(0, MARKER_MAX_CHARS);
}

function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function getErrorCode(error: unknown): string | undefined {
    if (typeof error !== 'object' || error === null) return undefined;
    const code = Reflect.get(error, 'code');
    return typeof code === 'string' ? code : undefined;
}

/**
 * PulseService - the single autonomous agent loop.
 *
 * Replaces the stateless heartbeat agent ping: wakes are driven by the
 * owner-editable workspace/HEARTBEAT.md checklist (no directives = no API
 * call), pace themselves with reply-digest backoff (unchanged answers double
 * the delay up to a ceiling; any change snaps back to the floor), carry a
 * one-sentence marker of the previous wake instead of full prior output, and
 * follow a [SILENT] contract so quiet wakes never message the owner.
 */
export class PulseService {
    private timer: NodeJS.Timeout | null = null;
    private stopped = true;
    private readonly workspace: WorkspaceStore;
    private readonly statePath: string;
    private state: PulseState = { tickCount: 0 };

    public constructor(
        private readonly supervisor: Supervisor,
        private readonly config: Config
    ) {
        this.workspace = new WorkspaceStore(config.homeDir);
        this.statePath = path.join(config.homeDir, 'data', 'pulse.json');
    }

    public async start(): Promise<void> {
        if (!this.config.pulse.enabled) {
            logger.info('🫀 Pulse service disabled (pulse.enabled=false)');
            return;
        }
        this.stopped = false;
        this.state = await this.loadState();
        const delay = this.currentDelayMs();
        logger.info(
            `🫀 Pulse service started (floor ${this.floorMs() / 1000}s, ceiling ${this.ceilingMs() / 1000}s, next wake in ${Math.round(delay / 1000)}s)`
        );
        this.schedule(delay);
    }

    public stop(): void {
        this.stopped = true;
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }
        logger.info('🫀 Pulse service stopped');
    }

    /**
     * Runs one pulse wake and reschedules. Public so tests and manual triggers
     * can drive a tick without timers.
     */
    public async runOnce(now: Date = new Date()): Promise<PulseTickResult> {
        if (!this.config.pulse.enabled) return 'disabled';

        const directives = parseHeartbeatDirectives(
            await this.workspace.readFileOrEmpty('HEARTBEAT.md')
        );
        if (directives.length === 0) {
            logger.debug('🫀 Pulse wake skipped: HEARTBEAT.md has no active directives');
            return 'skipped-empty';
        }

        if (this.isQuietHour(now)) {
            logger.debug('🫀 Pulse wake skipped: outside active hours');
            return 'skipped-quiet-hours';
        }

        // Idle-only admission: a live owner turn always wins. Missed wakes
        // coalesce — the next scheduled wake covers them.
        if (this.supervisor.isBusy()) {
            logger.debug('🫀 Pulse wake skipped: supervisor busy');
            return 'skipped-busy';
        }

        this.state.tickCount += 1;
        const prompt = this.buildWakePrompt(directives);
        let reply: string;
        try {
            reply = await this.supervisor.executeTask(prompt, { allowNotifications: true });
        } catch (error: unknown) {
            const message = getErrorMessage(error);
            if (message.toLowerCase().includes('busy')) {
                logger.debug('🫀 Pulse wake skipped: supervisor became busy');
                return 'skipped-busy';
            }
            logger.warn(`🫀 Pulse wake failed; will retry on the next wake: ${message}`);
            this.state.lastTickAt = now.toISOString();
            await this.saveState();
            return 'error';
        }

        const silent = isSilentPulseReply(reply);
        const digest = digestPulseReply(reply);
        const unchanged = silent || digest === this.state.lastDigest;

        const floor = this.floorMs();
        const previousDelay = this.currentDelayMs();
        this.state.currentDelayMs = unchanged
            ? Math.min(Math.max(previousDelay, floor) * 2, this.ceilingMs())
            : floor;
        this.state.lastDigest = digest;
        this.state.lastTickAt = now.toISOString();
        this.state.lastMarker = silent ? 'Nothing to report.' : extractPulseMarker(reply);
        await this.saveState();

        logger.info(
            `🫀 Pulse wake #${this.state.tickCount} ${silent ? 'silent' : unchanged ? 'unchanged' : 'changed'}; next in ${Math.round(this.state.currentDelayMs / 1000)}s`
        );
        return silent ? 'ran-silent' : unchanged ? 'ran-unchanged' : 'ran-changed';
    }

    private buildWakePrompt(directives: readonly string[]): string {
        const lastWake = this.state.lastMarker
            ? `Previous wake${this.state.lastTickAt ? ` (${this.state.lastTickAt})` : ''}: ${this.state.lastMarker}`
            : 'This is the first wake.';
        return [
            `[Pulse wake #${this.state.tickCount} — autonomous, no owner present]`,
            '',
            'Your checklist (from workspace/HEARTBEAT.md):',
            ...directives.map((directive) => directive),
            '',
            lastWake,
            '',
            'Run the checklist against the CURRENT state — do not assume anything from earlier wakes still holds, and do not infer or repeat old tasks from prior chats. Work silently: use the send_notification tool ONLY for something genuinely important; otherwise do not message the owner. Never take consequential or unauthorized actions (purchases, trades, deployments, destructive commands).',
            `If there is nothing meaningful to do or report, reply with exactly ${PULSE_SILENT_SENTINEL} and stop — do not invent work.`
        ].join('\n');
    }

    private schedule(delayMs: number): void {
        if (this.stopped) return;
        this.timer = setTimeout(() => {
            void this.runOnce()
                .catch((error: unknown) => {
                    logger.error(`❌ Pulse tick error: ${getErrorMessage(error)}`);
                })
                .finally(() => this.schedule(this.currentDelayMs()));
        }, delayMs);
        this.timer.unref?.();
    }

    private floorMs(): number {
        return this.config.pulse.floorSec * 1_000;
    }

    private ceilingMs(): number {
        return Math.max(this.floorMs(), this.config.pulse.ceilingSec * 1_000);
    }

    private currentDelayMs(): number {
        const delay = this.state.currentDelayMs ?? this.floorMs();
        return Math.min(Math.max(delay, this.floorMs()), this.ceilingMs());
    }

    /** Same wrap-around semantics as initiative quiet hours; start===end disables. */
    private isQuietHour(now: Date): boolean {
        const { activeHoursEnd: end, activeHoursStart: start } = this.config.pulse;
        if (start === end) return false;
        const hour = now.getHours();
        const active = start < end ? hour >= start && hour < end : hour >= start || hour < end;
        return !active;
    }

    private async loadState(): Promise<PulseState> {
        try {
            const parsed: unknown = JSON.parse(await fs.readFile(this.statePath, 'utf8'));
            return PulseStateSchema.parse(parsed);
        } catch (error: unknown) {
            if (getErrorCode(error) !== 'ENOENT') {
                logger.warn(`🫀 Pulse state reset: ${getErrorMessage(error)}`);
            }
            return { tickCount: 0 };
        }
    }

    private async saveState(): Promise<void> {
        await fs.mkdir(path.dirname(this.statePath), { recursive: true });
        const temporaryPath = `${this.statePath}.${process.pid}.tmp`;
        try {
            await fs.writeFile(temporaryPath, `${JSON.stringify(this.state, null, 2)}\n`, {
                encoding: 'utf8',
                mode: 0o600
            });
            await fs.rename(temporaryPath, this.statePath);
        } catch (error: unknown) {
            await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
            logger.warn(`🫀 Failed to persist pulse state: ${getErrorMessage(error)}`);
        }
    }
}
