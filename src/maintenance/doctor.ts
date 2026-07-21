import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { z } from 'zod';

import { type Config } from '../config/config.js';
import { findMcpPolicyViolations } from '../supervisor/mcp-bridge.js';
import { TaskFileStore } from '../supervisor/task-file-store.js';
import { DLPService } from '../utils/dlp-service.js';

const FindingSeveritySchema = z.enum(['info', 'warning', 'critical']);
const DoctorFindingSchema = z.object({
    area: z.enum(['brain', 'extensions', 'inference', 'runtime', 'security', 'tasks', 'update']),
    autoRepairable: z.boolean().default(false),
    evidence: z.array(z.string()).default([]),
    id: z.string().min(1),
    repairId: z.string().min(1).optional(),
    requiresRestart: z.boolean().default(false),
    severity: FindingSeveritySchema,
    summary: z.string().min(1),
    title: z.string().min(1)
});

export type DoctorFinding = z.infer<typeof DoctorFindingSchema>;

export interface DoctorReport {
    readonly findings: readonly DoctorFinding[];
    readonly generatedAt: string;
    readonly status: 'healthy' | 'degraded' | 'critical';
    readonly version: 1;
}

const ManifestSchema = z
    .object({
        mcpServers: z.record(
            z
                .object({
                    env: z.record(z.string()).optional()
                })
                .passthrough()
        )
    })
    .passthrough();
const FactsSchema = z.object({
    facts: z.record(z.object({ key: z.string(), value: z.string() }).passthrough())
});
const IndexedPathSchema = z.object({ path: z.string() });
const LARGE_LOG_BYTES = 100 * 1024 * 1024;
const BUNDLED_EXTENSIONS = new Set(['tars-memory', 'tars-search', 'tars-tasks']);

function createFinding(input: z.input<typeof DoctorFindingSchema>): DoctorFinding {
    return DoctorFindingSchema.parse(input);
}

function readJson(filePath: string): unknown {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function listFiles(directory: string): string[] {
    if (!fs.existsSync(directory)) return [];
    return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const entryPath = path.join(directory, entry.name);
        return entry.isDirectory() ? listFiles(entryPath) : [entryPath];
    });
}

function calculateStatus(findings: readonly DoctorFinding[]): DoctorReport['status'] {
    if (findings.some(({ severity }) => severity === 'critical')) return 'critical';
    if (findings.some(({ severity }) => severity === 'warning')) return 'degraded';
    return 'healthy';
}

function isTemplateValue(value: string): boolean {
    return /^\$\{[A-Za-z_][A-Za-z0-9_]*}$/.test(value.trim());
}

function isReminderIntent(text: string): boolean {
    return /\b(remind|notify|alert|tell me|send (?:me|a).*message|discord)\b/i.test(text);
}

export class TarsDoctor {
    public constructor(private readonly config: Config) {}

    public async run(): Promise<DoctorReport> {
        const findings = [
            ...this.checkCoreFiles(),
            ...this.checkExtensionPolicies(),
            ...this.checkManifestSecrets(),
            ...(await this.checkTasks()),
            ...this.checkMemoryIndex(),
            ...this.checkMemorySecrets(),
            ...this.checkSensitivePermissions(),
            ...this.checkLogs(),
            ...this.checkBackupScript()
        ];
        return {
            findings,
            generatedAt: new Date().toISOString(),
            status: calculateStatus(findings),
            version: 1
        };
    }

    private checkCoreFiles(): DoctorFinding[] {
        const candidates = [
            this.config.configFilePath,
            this.config.sessionFilePath,
            this.config.taskFilePath,
            path.join(this.config.homeDir, 'extensions', 'extension-enablement.json')
        ];
        return candidates.flatMap((filePath) => {
            if (!fs.existsSync(filePath)) return [];
            try {
                readJson(filePath);
                return [];
            } catch {
                return [
                    createFinding({
                        area: 'brain',
                        id: `brain.invalid-json.${path.basename(filePath)}`,
                        severity: 'critical',
                        summary: 'A core state file is not valid JSON and cannot be trusted.',
                        title: `Invalid ${path.basename(filePath)}`,
                        evidence: [filePath]
                    })
                ];
            }
        });
    }

    private checkExtensionPolicies(): DoctorFinding[] {
        try {
            return findMcpPolicyViolations(this.config.homeDir).map((violation) =>
                createFinding({
                    area: 'extensions',
                    id: `extensions.policy.${violation.extension}.${violation.server}`,
                    severity: 'warning',
                    summary: violation.reason,
                    title: `${violation.extension} is fail-closed`,
                    evidence: [violation.manifestPath],
                    requiresRestart: true
                })
            );
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            return [
                createFinding({
                    area: 'extensions',
                    id: 'extensions.policy-audit-failed',
                    severity: 'critical',
                    summary: 'Extension policy files could not be validated safely.',
                    title: 'Extension policy audit failed',
                    evidence: [DLPService.scrub(message)]
                })
            ];
        }
    }

    private checkManifestSecrets(): DoctorFinding[] {
        const extensionsDirectory = path.join(this.config.homeDir, 'extensions');
        if (!fs.existsSync(extensionsDirectory)) return [];
        return fs.readdirSync(extensionsDirectory, { withFileTypes: true }).flatMap((entry) => {
            if (!entry.isDirectory() || BUNDLED_EXTENSIONS.has(entry.name)) return [];
            return this.checkExtensionManifest(entry.name, extensionsDirectory);
        });
    }

    private checkExtensionManifest(name: string, extensionsDirectory: string): DoctorFinding[] {
        const extensionPath = path.join(extensionsDirectory, name);
        const manifestPath = ['tars-extension.json', 'gemini-extension.json']
            .map((candidate) => path.join(extensionPath, candidate))
            .find((candidate) => fs.existsSync(candidate));
        if (!manifestPath) return [];
        let rawManifest: unknown;
        try {
            rawManifest = readJson(manifestPath);
        } catch {
            return [];
        }
        const parsed = ManifestSchema.safeParse(rawManifest);
        if (!parsed.success) return [];
        const literalKeys = Object.values(parsed.data.mcpServers).flatMap(({ env = {} }) =>
            Object.entries(env)
                .filter(([key, value]) => DLPService.isSensitiveKey(key) && !isTemplateValue(value))
                .map(([key]) => key)
        );
        if (literalKeys.length === 0) return [];
        return [
            createFinding({
                area: 'security',
                id: `security.extension-secret.${name}`,
                severity: 'critical',
                summary: 'Credential values must come from the Tars secret store, not a manifest.',
                title: `${name} contains literal credential values`,
                evidence: [manifestPath, `Credential fields: ${literalKeys.sort().join(', ')}`],
                requiresRestart: true
            })
        ];
    }

    private async checkTasks(): Promise<DoctorFinding[]> {
        let tasks;
        try {
            tasks = await new TaskFileStore(this.config.taskFilePath).loadTasks();
        } catch {
            return [];
        }
        return tasks.flatMap((task) => {
            if (!task.enabled || task.mode !== 'silent') return [];
            if (!isReminderIntent(`${task.title}\n${task.prompt}`)) return [];
            return [
                createFinding({
                    area: 'tasks',
                    id: `tasks.silent-reminder.${task.id}`,
                    severity: 'critical',
                    summary: 'The task asks to contact the user but its delivery policy is silent.',
                    title: `Reminder cannot notify: ${task.title}`,
                    evidence: [`Task ID: ${task.id}`]
                })
            ];
        });
    }

    private checkMemoryIndex(): DoctorFinding[] {
        const databasePath = path.join(this.config.homeDir, 'data', 'knowledge.db');
        if (!fs.existsSync(databasePath)) return [];
        let database: DatabaseSync | undefined;
        try {
            database = new DatabaseSync(databasePath, { readOnly: true });
            const integrityRows = z
                .array(z.object({ integrity_check: z.string() }))
                .parse(database.prepare('PRAGMA integrity_check').all());
            if (integrityRows.some(({ integrity_check }) => integrity_check !== 'ok')) {
                return [this.createMemoryIntegrityFinding(databasePath)];
            }
            return this.createStaleIndexFinding(database, databasePath);
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            return [
                createFinding({
                    area: 'brain',
                    id: 'brain.memory-index-unreadable',
                    severity: 'critical',
                    summary: 'The derived memory index could not be inspected safely.',
                    title: 'Memory index is unreadable',
                    evidence: [databasePath, DLPService.scrub(message)]
                })
            ];
        } finally {
            database?.close();
        }
    }

    private createMemoryIntegrityFinding(databasePath: string): DoctorFinding {
        return createFinding({
            area: 'brain',
            id: 'brain.memory-index-integrity',
            severity: 'critical',
            summary: 'SQLite reported an integrity failure in the derived memory index.',
            title: 'Memory index integrity check failed',
            evidence: [databasePath]
        });
    }

    private createStaleIndexFinding(database: DatabaseSync, databasePath: string): DoctorFinding[] {
        const indexedPaths = z
            .array(IndexedPathSchema)
            .parse(database.prepare('SELECT path FROM files').all())
            .map(({ path: indexedPath }) => indexedPath);
        const livePaths = this.collectLiveMemoryPaths();
        const staleCount = indexedPaths.filter((indexedPath) => !livePaths.has(indexedPath)).length;
        if (staleCount === 0) return [];
        return [
            createFinding({
                area: 'brain',
                autoRepairable: true,
                id: 'brain.stale-memory-index',
                repairId: 'memory.reconcile-index',
                severity: 'warning',
                summary: `${staleCount} indexed source(s) no longer exist and may return stale context.`,
                title: 'Memory index contains stale sources',
                evidence: [databasePath]
            })
        ];
    }

    private collectLiveMemoryPaths(): Set<string> {
        const livePaths = new Set<string>();
        const factsPath = path.join(this.config.homeDir, 'data', 'memory', 'facts.json');
        if (fs.existsSync(factsPath)) livePaths.add('active_memory/facts.txt');
        for (const skillPath of listFiles(path.join(this.config.homeDir, 'skills'))) {
            if (skillPath.endsWith('.md'))
                livePaths.add(path.relative(this.config.homeDir, skillPath));
        }
        const chatsDirectory = path.join(this.config.homeDir, 'chats');
        if (!fs.existsSync(chatsDirectory)) return livePaths;
        for (const fileName of fs.readdirSync(chatsDirectory)) {
            if (fileName.endsWith('.json')) livePaths.add(`history/${fileName}`);
        }
        return livePaths;
    }

    private checkMemorySecrets(): DoctorFinding[] {
        const factsPath = path.join(this.config.homeDir, 'data', 'memory', 'facts.json');
        if (!fs.existsSync(factsPath)) return [];
        let rawFacts: unknown;
        try {
            rawFacts = readJson(factsPath);
        } catch {
            return [
                createFinding({
                    area: 'brain',
                    id: 'brain.invalid-json.facts.json',
                    severity: 'critical',
                    summary: 'Durable memory is not valid JSON and cannot be inspected safely.',
                    title: 'Invalid facts.json',
                    evidence: [factsPath]
                })
            ];
        }
        const parsed = FactsSchema.safeParse(rawFacts);
        if (!parsed.success) return [];
        const count = Object.values(parsed.data.facts).filter(({ key }) =>
            DLPService.isSensitiveKey(key)
        ).length;
        if (count === 0) return [];
        return [
            createFinding({
                area: 'security',
                id: 'security.credentials-in-memory',
                severity: 'critical',
                summary: `${count} durable fact key(s) look like credentials and must be removed and rotated.`,
                title: 'Credentials are stored in durable memory',
                evidence: [factsPath]
            })
        ];
    }

    private checkSensitivePermissions(): DoctorFinding[] {
        const paths = [
            path.join(this.config.homeDir, '.env'),
            this.config.configFilePath,
            this.config.sessionFilePath,
            this.config.taskFilePath,
            path.join(this.config.homeDir, 'extensions', 'extension-enablement.json'),
            path.join(this.config.homeDir, 'data', 'memory', 'facts.json'),
            path.join(this.config.homeDir, 'tars-gateway-creds.json'),
            path.join(this.config.homeDir, '.fusion-auth-token'),
            path.join(this.config.homeDir, '.config', 'gws', 'credentials.json')
        ];
        const unsafe = paths.filter((filePath) => {
            if (!fs.existsSync(filePath)) return false;
            return (fs.statSync(filePath).mode & 0o077) !== 0;
        });
        if (unsafe.length === 0) return [];
        return [
            createFinding({
                area: 'security',
                autoRepairable: true,
                id: 'security.sensitive-file-permissions',
                repairId: 'security.restrict-sensitive-files',
                severity: 'critical',
                summary: `${unsafe.length} sensitive file(s) are readable outside the owner account.`,
                title: 'Sensitive file permissions are too broad',
                evidence: unsafe
            })
        ];
    }

    private checkLogs(): DoctorFinding[] {
        const logFiles = [
            ...listFiles(path.join(this.config.homeDir, 'logs')),
            ...listFiles(path.join(process.env.PM2_HOME ?? path.join(os.homedir(), '.pm2'), 'logs'))
        ];
        const oversized = logFiles.filter(
            (filePath) => fs.statSync(filePath).size > LARGE_LOG_BYTES
        );
        if (oversized.length === 0) return [];
        return [
            createFinding({
                area: 'runtime',
                id: 'runtime.oversized-logs',
                severity: 'warning',
                summary: `${oversized.length} log file(s) exceed 100 MiB and need bounded rotation.`,
                title: 'Runtime logs are not bounded',
                evidence: oversized
            })
        ];
    }

    private checkBackupScript(): DoctorFinding[] {
        const scriptPath = path.join(this.config.homeDir, 'scripts', 'tars-backup.sh');
        if (!fs.existsSync(scriptPath)) return [];
        const content = fs.readFileSync(scriptPath, 'utf8');
        if (
            !content.includes('tar') ||
            /exclude[^\n]*(?:\.env|credentials|secrets)/i.test(content)
        ) {
            return [];
        }
        return [
            createFinding({
                area: 'security',
                id: 'security.backup-includes-secrets',
                severity: 'critical',
                summary:
                    'The backup archive does not explicitly exclude credentials before upload.',
                title: 'Brain backup may include secrets',
                evidence: [scriptPath]
            })
        ];
    }
}
