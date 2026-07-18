import fs from 'node:fs';
import path from 'node:path';

import pm2 from 'pm2';
import { z } from 'zod';

const Pm2EnvironmentSchema = z
    .object({
        status: z.string().optional(),
        pm_cwd: z.string().optional(),
        pm_exec_path: z.string().optional(),
        TARS_HOME: z.string().optional(),
        TARS_INSTANCE_ROLE: z.string().optional(),
        TARS_MANAGED_PROCESS: z.string().optional(),
        TARS_PROCESS_KIND: z.string().optional(),
        TARS_SUPERVISOR_MODE: z.string().optional(),
        env: z.record(z.string(), z.unknown()).optional()
    })
    .passthrough();

const TarsProcessKindSchema = z.enum(['supervisor', 'dashboard', 'tunnel']);
export type TarsProcessKind = z.infer<typeof TarsProcessKindSchema>;

export interface TarsPm2IdentityEnvironment {
    readonly TARS_MANAGED_PROCESS: 'true';
    readonly TARS_PROCESS_KIND: TarsProcessKind;
}

const Pm2ProcessSchema = z
    .object({
        name: z.string().min(1),
        pid: z.number().optional(),
        pm2_env: Pm2EnvironmentSchema.optional()
    })
    .passthrough();

export interface TarsPm2Process {
    readonly isActive: boolean;
    readonly isSupervisor: boolean;
    readonly kind: TarsProcessKind;
    readonly legacy: boolean;
    readonly name: string;
    readonly role?: string;
    readonly status?: string;
}

interface ProcessIdentity {
    readonly kind: TarsProcessKind;
    readonly legacy: boolean;
}

export function createTarsPm2Identity(kind: TarsProcessKind): TarsPm2IdentityEnvironment {
    return {
        TARS_MANAGED_PROCESS: 'true',
        TARS_PROCESS_KIND: kind
    };
}

function canonicalPath(candidate: string): string {
    const resolved = path.resolve(candidate);
    const missingSegments: string[] = [];
    let existingAncestor = resolved;
    while (!fs.existsSync(existingAncestor)) {
        const parent = path.dirname(existingAncestor);
        if (parent === existingAncestor) return resolved;
        missingSegments.unshift(path.basename(existingAncestor));
        existingAncestor = parent;
    }
    try {
        return path.join(fs.realpathSync(existingAncestor), ...missingSegments);
    } catch {
        return resolved;
    }
}

function getEnvironmentValue(
    environment: z.infer<typeof Pm2EnvironmentSchema>,
    key: string
): string | undefined {
    const direct = Reflect.get(environment, key);
    if (typeof direct === 'string') return direct;
    const nested = environment.env?.[key];
    return typeof nested === 'string' ? nested : undefined;
}

function matchesConfiguredHome(
    environment: z.infer<typeof Pm2EnvironmentSchema>,
    canonicalHome: string
): boolean {
    const configuredHome = getEnvironmentValue(environment, 'TARS_HOME');
    return Boolean(configuredHome && canonicalPath(configuredHome) === canonicalHome);
}

function hasManagedIdentityField(environment: z.infer<typeof Pm2EnvironmentSchema>): boolean {
    return (
        getEnvironmentValue(environment, 'TARS_MANAGED_PROCESS') !== undefined ||
        getEnvironmentValue(environment, 'TARS_PROCESS_KIND') !== undefined
    );
}

function resolveManagedIdentity(
    environment: z.infer<typeof Pm2EnvironmentSchema>,
    canonicalHome: string
): ProcessIdentity | null {
    if (getEnvironmentValue(environment, 'TARS_MANAGED_PROCESS') !== 'true') return null;
    const parsedKind = TarsProcessKindSchema.safeParse(
        getEnvironmentValue(environment, 'TARS_PROCESS_KIND')
    );
    if (!parsedKind.success || !matchesConfiguredHome(environment, canonicalHome)) return null;
    return { kind: parsedKind.data, legacy: false };
}

function matchesLegacySupervisor(
    environment: z.infer<typeof Pm2EnvironmentSchema>,
    canonicalHome: string
): boolean {
    const executablePath = environment.pm_exec_path;
    if (
        getEnvironmentValue(environment, 'TARS_SUPERVISOR_MODE') !== 'true' ||
        !executablePath?.endsWith(`${path.sep}dist${path.sep}supervisor${path.sep}main.js`)
    ) {
        return false;
    }

    const configuredHome = getEnvironmentValue(environment, 'TARS_HOME');
    if (configuredHome) return canonicalPath(configuredHome) === canonicalHome;
    return Boolean(environment.pm_cwd && canonicalPath(environment.pm_cwd) === canonicalHome);
}

function matchesLegacyDashboard(
    name: string,
    environment: z.infer<typeof Pm2EnvironmentSchema>,
    canonicalHome: string
): boolean {
    if (!(name === 'tars-dashboard' || name.endsWith('-dash'))) return false;
    if (!matchesConfiguredHome(environment, canonicalHome)) return false;

    const dashboardDirectory = canonicalPath(path.join(canonicalHome, 'apps', 'dashboard'));
    return Boolean(
        environment.pm_cwd &&
        environment.pm_exec_path &&
        canonicalPath(environment.pm_cwd) === dashboardDirectory &&
        canonicalPath(environment.pm_exec_path) ===
            canonicalPath(path.join(dashboardDirectory, 'server.js'))
    );
}

function matchesLegacyTunnel(
    name: string,
    environment: z.infer<typeof Pm2EnvironmentSchema>,
    canonicalHome: string
): boolean {
    if (!(name === 'tars-tunnel' || name.endsWith('-tunnel'))) return false;
    if (!matchesConfiguredHome(environment, canonicalHome) || !environment.pm_exec_path) {
        return false;
    }
    return path.basename(environment.pm_exec_path) === 'cloudflared';
}

function resolveLegacyIdentity(
    name: string,
    environment: z.infer<typeof Pm2EnvironmentSchema>,
    canonicalHome: string
): ProcessIdentity | null {
    if (matchesLegacyDashboard(name, environment, canonicalHome)) {
        return { kind: 'dashboard', legacy: true };
    }
    if (matchesLegacyTunnel(name, environment, canonicalHome)) {
        return { kind: 'tunnel', legacy: true };
    }
    if (matchesLegacySupervisor(environment, canonicalHome)) {
        return { kind: 'supervisor', legacy: true };
    }
    return null;
}

function resolveProcessIdentity(
    name: string,
    environment: z.infer<typeof Pm2EnvironmentSchema>,
    canonicalHome: string
): ProcessIdentity | null {
    if (hasManagedIdentityField(environment)) {
        return resolveManagedIdentity(environment, canonicalHome);
    }
    return resolveLegacyIdentity(name, environment, canonicalHome);
}

function connectPm2(): Promise<void> {
    return new Promise((resolve, reject) => {
        pm2.connect((error) => (error ? reject(error) : resolve()));
    });
}

function listPm2(): Promise<unknown[]> {
    return new Promise((resolve, reject) => {
        pm2.list((error, processes) => (error ? reject(error) : resolve(processes ?? [])));
    });
}

function deletePm2Process(name: string): Promise<void> {
    return new Promise((resolve, reject) => {
        pm2.delete(name, (error) => (error ? reject(error) : resolve()));
    });
}

function stopPm2Process(name: string): Promise<void> {
    return new Promise((resolve, reject) => {
        pm2.stop(name, (error) => (error ? reject(error) : resolve()));
    });
}

function restartPm2Process(name: string): Promise<void> {
    return new Promise((resolve, reject) => {
        pm2.restart(name, (error) => (error ? reject(error) : resolve()));
    });
}

async function withPm2Connection(
    names: readonly string[],
    operation: (name: string) => Promise<void>
): Promise<void> {
    if (names.length === 0) return;
    await connectPm2();
    try {
        for (const name of names) await operation(name);
    } finally {
        pm2.disconnect();
    }
}

function orderAuxiliariesBeforeSupervisors(processes: readonly TarsPm2Process[]): TarsPm2Process[] {
    return [...processes].sort(
        (first, second) => Number(first.isSupervisor) - Number(second.isSupervisor)
    );
}

export async function findTarsProcessesByHome(tarsHome: string): Promise<TarsPm2Process[]> {
    const canonicalHome = canonicalPath(tarsHome);
    await connectPm2();
    try {
        const descriptions = await listPm2();
        const matches: TarsPm2Process[] = [];
        for (const description of descriptions) {
            const parsed = Pm2ProcessSchema.safeParse(description);
            if (!parsed.success || !parsed.data.pm2_env) continue;

            const environment = parsed.data.pm2_env;
            const identity = resolveProcessIdentity(parsed.data.name, environment, canonicalHome);
            if (!identity) continue;

            const status = environment.status;
            matches.push({
                name: parsed.data.name,
                status,
                role: getEnvironmentValue(environment, 'TARS_INSTANCE_ROLE'),
                kind: identity.kind,
                legacy: identity.legacy,
                isSupervisor: identity.kind === 'supervisor',
                isActive: status !== 'stopped' && status !== 'errored'
            });
        }
        return matches;
    } finally {
        pm2.disconnect();
    }
}

export async function assertTarsHomeInactive(tarsHome: string, operation: string): Promise<void> {
    const active = (await findTarsProcessesByHome(tarsHome)).filter((process) => process.isActive);
    if (active.length === 0) return;
    throw new Error(
        `Refusing to ${operation} while Tars is running (${active.map(({ name }) => name).join(', ')}). Run \`tars stop\` first.`
    );
}

export async function deleteTarsProcessesByHome(tarsHome: string): Promise<TarsPm2Process[]> {
    const matches = await findTarsProcessesByHome(tarsHome);
    if (matches.length === 0) return [];

    await withPm2Connection(
        orderAuxiliariesBeforeSupervisors(matches).map(({ name }) => name),
        deletePm2Process
    );
    return matches;
}

export async function deleteTarsProcessNames(names: readonly string[]): Promise<void> {
    await withPm2Connection(names, deletePm2Process);
}

export async function stopTarsProcessNames(names: readonly string[]): Promise<void> {
    await withPm2Connection(names, stopPm2Process);
}

export async function restartTarsProcessNames(names: readonly string[]): Promise<void> {
    await withPm2Connection(names, restartPm2Process);
}

export async function restartActiveTarsProcessesByHome(
    tarsHome: string
): Promise<TarsPm2Process[]> {
    const active = (await findTarsProcessesByHome(tarsHome)).filter((process) => process.isActive);
    if (active.length === 0) return [];

    await restartTarsProcessNames(
        orderAuxiliariesBeforeSupervisors(active).map(({ name }) => name)
    );
    return active;
}
