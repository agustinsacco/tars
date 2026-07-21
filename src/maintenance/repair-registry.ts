import fs from 'node:fs/promises';
import path from 'node:path';

import { z } from 'zod';

import { type Config } from '../config/config.js';
import { MemoryManager } from '../memory/memory-manager.js';
import { TarsDoctor, type DoctorReport } from './doctor.js';

const RepairIdSchema = z.enum(['memory.reconcile-index', 'security.restrict-sensitive-files']);

export type SafeRepairId = z.infer<typeof RepairIdSchema>;

export interface RepairResult {
    readonly id: SafeRepairId;
    readonly status: 'applied' | 'failed' | 'verified';
    readonly summary: string;
}

function getSensitivePaths(config: Config): string[] {
    return [
        path.join(config.homeDir, '.env'),
        config.configFilePath,
        config.sessionFilePath,
        config.taskFilePath,
        path.join(config.homeDir, 'extensions', 'extension-enablement.json'),
        path.join(config.homeDir, 'data', 'memory', 'facts.json'),
        path.join(config.homeDir, 'tars-gateway-creds.json'),
        path.join(config.homeDir, '.fusion-auth-token'),
        path.join(config.homeDir, '.config', 'gws', 'credentials.json')
    ];
}

export class RepairRegistry {
    public constructor(private readonly config: Config) {}

    public async plan(requestedIds?: readonly string[]): Promise<SafeRepairId[]> {
        if (requestedIds && requestedIds.length > 0)
            return RepairIdSchema.array().parse(requestedIds);
        const report = await new TarsDoctor(this.config).run();
        return RepairIdSchema.array().parse(
            report.findings
                .filter(({ autoRepairable, repairId }) => autoRepairable && repairId)
                .map(({ repairId }) => repairId)
        );
    }

    public async apply(ids: readonly SafeRepairId[]): Promise<readonly RepairResult[]> {
        const results: RepairResult[] = [];
        for (const id of ids) {
            try {
                await this.applyOne(id);
                const verified = await this.isResolved(id);
                results.push({
                    id,
                    status: verified ? 'verified' : 'applied',
                    summary: verified ? 'Repair applied and finding cleared.' : 'Repair applied.'
                });
            } catch (error: unknown) {
                const message = error instanceof Error ? error.message : String(error);
                results.push({ id, status: 'failed', summary: message });
            }
        }
        return results;
    }

    private async applyOne(id: SafeRepairId): Promise<void> {
        if (id === 'memory.reconcile-index') {
            const memory = new MemoryManager(this.config);
            try {
                await memory.fullSync();
            } finally {
                memory.close();
            }
            return;
        }
        await this.restrictSensitiveFiles();
    }

    private async restrictSensitiveFiles(): Promise<void> {
        for (const filePath of getSensitivePaths(this.config)) {
            try {
                await fs.chmod(filePath, 0o600);
            } catch (error: unknown) {
                if (
                    typeof error === 'object' &&
                    error !== null &&
                    Reflect.get(error, 'code') === 'ENOENT'
                ) {
                    continue;
                }
                throw error;
            }
        }
    }

    private async isResolved(id: SafeRepairId): Promise<boolean> {
        const report: DoctorReport = await new TarsDoctor(this.config).run();
        return !report.findings.some(({ repairId }) => repairId === id);
    }
}
