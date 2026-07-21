import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { z } from 'zod';

import { type ChannelManager } from '../channels/channel-manager.js';
import { type Config } from '../config/config.js';
import { TarsDoctor, type DoctorFinding } from '../maintenance/doctor.js';
import { RepairRegistry } from '../maintenance/repair-registry.js';
import logger from '../utils/logger.js';
import { ObjectiveStore, type Objective } from './objective-store.js';

const InitiativeStateSchema = z.object({
    day: z.string(),
    fingerprints: z.record(z.string().datetime()).default({}),
    lastRunAt: z.string().datetime().optional(),
    notificationsToday: z.number().int().nonnegative().default(0)
});

type InitiativeState = z.infer<typeof InitiativeStateSchema>;

interface InitiativeCandidate {
    readonly fingerprint: string;
    readonly message: string;
    readonly severity: 'warning' | 'critical';
}

function getErrorCode(error: unknown): string | undefined {
    if (typeof error !== 'object' || error === null) return undefined;
    const code = Reflect.get(error, 'code');
    return typeof code === 'string' ? code : undefined;
}

function dayKey(date: Date): string {
    return date.toISOString().slice(0, 10);
}

function fingerprint(value: string): string {
    return crypto.createHash('sha256').update(value).digest('hex');
}

export class InitiativeService {
    private readonly doctor: TarsDoctor;
    private readonly objectives: ObjectiveStore;
    private readonly repairs: RepairRegistry;
    private readonly statePath: string;

    public constructor(
        private readonly config: Config,
        private readonly channelManager: ChannelManager
    ) {
        this.doctor = new TarsDoctor(config);
        this.objectives = new ObjectiveStore(path.join(config.homeDir, 'data', 'objectives.json'));
        this.repairs = new RepairRegistry(config);
        this.statePath = path.join(config.homeDir, 'data', 'initiative-state.json');
    }

    public async tick(now: Date = new Date()): Promise<void> {
        const policy = this.config.initiative;
        if (policy.mode === 'off') return;
        const state = await this.loadState(now);
        if (!this.isDue(state, now)) return;

        let report = await this.doctor.run();
        if (policy.mode === 'safe-auto' || policy.mode === 'delegated') {
            const plan = await this.repairs.plan();
            if (plan.length > 0) {
                await this.repairs.apply(plan);
                report = await this.doctor.run();
            }
        }

        const candidates = [
            ...this.createFindingCandidates(report.findings),
            ...this.createObjectiveCandidates(await this.objectives.listDue(now))
        ].filter((candidate) => this.isNovel(candidate, state, now));

        state.lastRunAt = now.toISOString();
        if (policy.mode !== 'observe' && candidates.length > 0) {
            const delivered = await this.notifyCandidates(candidates, state, now);
            for (const candidate of delivered) {
                state.fingerprints[candidate.fingerprint] = now.toISOString();
            }
        }
        await this.saveState(state);
    }

    private isDue(state: InitiativeState, now: Date): boolean {
        if (!state.lastRunAt) return true;
        return (
            now.getTime() - new Date(state.lastRunAt).getTime() >=
            this.config.initiative.intervalSec * 1_000
        );
    }

    private createFindingCandidates(findings: readonly DoctorFinding[]): InitiativeCandidate[] {
        return findings.flatMap((finding) => {
            if (finding.severity === 'info') return [];
            return [
                {
                    fingerprint: fingerprint(`${finding.id}:${finding.summary}`),
                    message: `**${finding.title}** — ${finding.summary}`,
                    severity: finding.severity
                }
            ];
        });
    }

    private createObjectiveCandidates(objectives: readonly Objective[]): InitiativeCandidate[] {
        return objectives.map((objective) => ({
            fingerprint: fingerprint(`objective:${objective.id}:${objective.reviewAt}`),
            message: `**Objective ready for review: ${objective.title}** — ${objective.desiredOutcome}`,
            severity: 'warning'
        }));
    }

    private isNovel(candidate: InitiativeCandidate, state: InitiativeState, now: Date): boolean {
        const lastSeen = state.fingerprints[candidate.fingerprint];
        if (!lastSeen) return true;
        return (
            now.getTime() - new Date(lastSeen).getTime() >=
            this.config.initiative.repeatAfterHours * 60 * 60 * 1_000
        );
    }

    private async notifyCandidates(
        candidates: readonly InitiativeCandidate[],
        state: InitiativeState,
        now: Date
    ): Promise<readonly InitiativeCandidate[]> {
        if (this.isQuietHour(now)) return [];
        if (state.notificationsToday >= this.config.initiative.maxNotificationsPerDay) return [];
        const selected = [...candidates]
            .sort((left, right) =>
                left.severity === right.severity ? 0 : left.severity === 'critical' ? -1 : 1
            )
            .slice(0, 5);
        await this.channelManager.notify(
            `## Tars initiative check\n\n${selected.map(({ message }) => `- ${message}`).join('\n')}\n\nAsk me to diagnose or repair any of these.`
        );
        state.notificationsToday++;
        return selected;
    }

    private isQuietHour(now: Date): boolean {
        const { quietHoursEnd: end, quietHoursStart: start } = this.config.initiative;
        if (start === end) return false;
        const hour = now.getHours();
        return start < end ? hour >= start && hour < end : hour >= start || hour < end;
    }

    private async loadState(now: Date): Promise<InitiativeState> {
        try {
            const parsed: unknown = JSON.parse(await fs.readFile(this.statePath, 'utf8'));
            const state = InitiativeStateSchema.parse(parsed);
            if (state.day === dayKey(now)) return state;
            return { ...state, day: dayKey(now), notificationsToday: 0 };
        } catch (error: unknown) {
            if (getErrorCode(error) !== 'ENOENT') logger.warn(`Initiative state reset: ${error}`);
            return { day: dayKey(now), fingerprints: {}, notificationsToday: 0 };
        }
    }

    private async saveState(state: InitiativeState): Promise<void> {
        await fs.mkdir(path.dirname(this.statePath), { recursive: true });
        const temporaryPath = `${this.statePath}.${process.pid}.tmp`;
        try {
            await fs.writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, {
                encoding: 'utf8',
                mode: 0o600
            });
            await fs.rename(temporaryPath, this.statePath);
            await fs.chmod(this.statePath, 0o600);
        } catch (error: unknown) {
            await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
            throw error;
        }
    }
}
