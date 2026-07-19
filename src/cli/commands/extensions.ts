import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

import chalk from 'chalk';
import inquirer from 'inquirer';
import { z } from 'zod';

import { findMcpPolicyViolations, type McpPolicyViolation } from '../../supervisor/mcp-bridge.js';
import { getTarsHome } from '../../utils/paths.js';
import { withTarsHomeMutationLease } from '../../utils/tars-home-lease.js';

const EnvironmentNameSchema = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/);
const ExtensionActionSchema = z.enum(['audit', 'migrate']);
const EnablementEntrySchema = z.union([
    z.boolean(),
    z
        .object({
            enabled: z.boolean().optional(),
            envAllowlist: z.array(EnvironmentNameSchema).optional()
        })
        .passthrough()
]);
const EnablementSchema = z.record(z.string().trim().min(1), EnablementEntrySchema);
const MigrationActionAnswerSchema = z.object({
    action: z.enum(['allow-detected', 'custom', 'disable', 'none', 'skip'])
});
const CustomEnvironmentAnswerSchema = z.object({ environmentNames: z.string() });

type ExtensionEnablement = z.infer<typeof EnablementSchema>;
type MigrationAction = z.infer<typeof MigrationActionAnswerSchema>['action'];

export interface McpPolicyMigrationDecision {
    readonly action: 'allow' | 'disable';
    readonly envAllowlist?: readonly string[];
    readonly extension: string;
}

export interface McpPolicyMigrationResult {
    readonly backupPath?: string;
    readonly changed: boolean;
    readonly ready: boolean;
}

interface MissingPolicyGroup {
    readonly extension: string;
    readonly manifestPath: string;
    readonly servers: readonly string[];
    readonly suggestedEnvironmentVariables: readonly string[];
    readonly suggestionScanTruncated: boolean;
}

interface ManualPolicyGroup {
    readonly extension: string;
    readonly manifestPath: string;
    readonly reasons: readonly string[];
    readonly servers: readonly string[];
}

function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function uniqueSorted(values: readonly string[]): string[] {
    return [...new Set(values)].sort();
}

export function parseEnvironmentNames(input: string): string[] {
    const names = input
        .split(/[\s,]+/)
        .map((name) => name.trim())
        .filter(Boolean);
    return z.array(EnvironmentNameSchema).parse(uniqueSorted(names));
}

function validateCustomEnvironmentNames(input: unknown): true | string {
    if (typeof input !== 'string') return 'Enter comma- or space-separated variable names';
    try {
        const names = parseEnvironmentNames(input);
        return names.length > 0 || 'Enter at least one name, or choose the empty allowlist option';
    } catch {
        return 'Names must use only letters, numbers, and underscores and cannot start with a number';
    }
}

function groupMissingPolicies(violations: readonly McpPolicyViolation[]): MissingPolicyGroup[] {
    const grouped = new Map<string, McpPolicyViolation[]>();
    for (const violation of violations) {
        if (violation.code !== 'missing-environment-policy') continue;
        const current = grouped.get(violation.extension) ?? [];
        current.push(violation);
        grouped.set(violation.extension, current);
    }

    return [...grouped.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([extension, entries]) => ({
            extension,
            manifestPath: entries[0].manifestPath,
            servers: uniqueSorted(entries.map(({ server }) => server)),
            suggestedEnvironmentVariables: uniqueSorted(
                entries.flatMap(({ suggestedEnvironmentVariables }) => [
                    ...suggestedEnvironmentVariables
                ])
            ),
            suggestionScanTruncated: entries.some(({ suggestionScanTruncated }) =>
                Boolean(suggestionScanTruncated)
            )
        }));
}

function groupManualPolicies(violations: readonly McpPolicyViolation[]): ManualPolicyGroup[] {
    const grouped = new Map<string, McpPolicyViolation[]>();
    for (const violation of violations) {
        if (violation.code === 'missing-environment-policy') continue;
        const current = grouped.get(violation.extension) ?? [];
        current.push(violation);
        grouped.set(violation.extension, current);
    }

    return [...grouped.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([extension, entries]) => ({
            extension,
            manifestPath: entries[0].manifestPath,
            reasons: uniqueSorted(entries.map(({ reason }) => reason)),
            servers: uniqueSorted(entries.map(({ server }) => server))
        }));
}

function printViolation(violation: McpPolicyViolation): void {
    console.log(chalk.yellow(`  • ${violation.extension}/${violation.server}`));
    console.log(chalk.dim(`    ${violation.reason}`));
    console.log(chalk.dim(`    Manifest: ${violation.manifestPath}`));
    if (violation.suggestedEnvironmentVariables.length > 0) {
        console.log(
            chalk.dim(
                `    Source scan found: ${violation.suggestedEnvironmentVariables.join(', ')}`
            )
        );
    }
    if (violation.suggestionScanTruncated) {
        console.log(chalk.dim('    Source scan reached its safety limit and may be incomplete.'));
    }
}

export function printMcpPolicyAudit(
    tarsHome: string,
    violations: readonly McpPolicyViolation[] = findMcpPolicyViolations(tarsHome)
): boolean {
    if (violations.length === 0) {
        console.log(chalk.green('✅ Custom MCP extension policies are ready.'));
        return true;
    }

    console.log(
        chalk.yellow(
            `⚠️ ${violations.length} custom MCP server polic${violations.length === 1 ? 'y needs' : 'ies need'} review:`
        )
    );
    for (const violation of violations) printViolation(violation);
    console.log(
        chalk.dim(
            '\nSource-scan suggestions are best-effort. Verify the extension code and never add secret values—only environment-variable names.'
        )
    );
    return false;
}

export function applyMcpPolicyMigrationDecisions(
    enablement: ExtensionEnablement,
    decisions: readonly McpPolicyMigrationDecision[]
): ExtensionEnablement {
    const migrated: ExtensionEnablement = { ...enablement };
    for (const decision of decisions) {
        const current = migrated[decision.extension];
        if (current === undefined) {
            throw new Error(`Extension ${decision.extension} is missing from the enablement file.`);
        }
        const existing = typeof current === 'boolean' ? { enabled: current } : current;
        migrated[decision.extension] =
            decision.action === 'disable'
                ? { ...existing, enabled: false }
                : {
                      ...existing,
                      enabled: existing.enabled ?? true,
                      envAllowlist: uniqueSorted(decision.envAllowlist ?? [])
                  };
    }
    return migrated;
}

async function readEnablement(enablementPath: string): Promise<ExtensionEnablement> {
    const raw: unknown = JSON.parse(await fsp.readFile(enablementPath, 'utf8'));
    return EnablementSchema.parse(raw);
}

export async function writeMcpPolicyEnablementWithBackup(
    enablementPath: string,
    enablement: ExtensionEnablement
): Promise<string> {
    const backupPath = `${enablementPath}.backup-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    const temporaryPath = `${enablementPath}.${process.pid}.${randomUUID()}.tmp`;
    await fsp.copyFile(enablementPath, backupPath, fs.constants.COPYFILE_EXCL);
    await fsp.chmod(backupPath, 0o600);

    try {
        await fsp.writeFile(temporaryPath, `${JSON.stringify(enablement, null, 2)}\n`, {
            encoding: 'utf8',
            flag: 'wx',
            mode: 0o600
        });
        await fsp.rename(temporaryPath, enablementPath);
        await fsp.chmod(enablementPath, 0o600);
        return backupPath;
    } catch (error: unknown) {
        await fsp.rm(temporaryPath, { force: true }).catch(() => undefined);
        throw error;
    }
}

function isInteractiveTerminal(): boolean {
    return process.stdin.isTTY === true && process.stdout.isTTY === true;
}

function printMigrationGroup(group: MissingPolicyGroup): void {
    console.log(chalk.bold(`\n${group.extension}`));
    console.log(chalk.dim(`  Servers: ${group.servers.join(', ')}`));
    console.log(chalk.dim(`  Manifest: ${group.manifestPath}`));
    if (group.suggestedEnvironmentVariables.length > 0) {
        console.log(
            chalk.cyan(
                `  Likely environment names: ${group.suggestedEnvironmentVariables.join(', ')}`
            )
        );
    } else {
        console.log(chalk.dim('  No environment references were detected in extension source.'));
    }
    if (group.suggestionScanTruncated) {
        console.log(
            chalk.yellow('  The source scan was incomplete; review the manifest and code.')
        );
    }
}

async function promptForMigrationAction(group: MissingPolicyGroup): Promise<MigrationAction> {
    const choices: Array<{ name: string; value: MigrationAction }> = [];
    if (group.suggestedEnvironmentVariables.length > 0) {
        choices.push({
            name: `Allow detected names (${group.suggestedEnvironmentVariables.join(', ')})`,
            value: 'allow-detected'
        });
    }
    choices.push(
        { name: 'Enter required environment-variable names', value: 'custom' },
        { name: 'No inherited environment variables (envAllowlist: [])', value: 'none' },
        { name: 'Disable this extension', value: 'disable' },
        { name: 'Skip and leave the configuration unchanged', value: 'skip' }
    );

    const rawAnswer: unknown = await inquirer.prompt([
        {
            type: 'list',
            name: 'action',
            message: `Choose the policy for ${group.extension}:`,
            choices
        }
    ]);
    return MigrationActionAnswerSchema.parse(rawAnswer).action;
}

async function promptForCustomEnvironmentNames(extension: string): Promise<string[]> {
    const rawAnswer: unknown = await inquirer.prompt([
        {
            type: 'input',
            name: 'environmentNames',
            message: `Environment-variable names for ${extension}:`,
            validate: validateCustomEnvironmentNames
        }
    ]);
    const answer = CustomEnvironmentAnswerSchema.parse(rawAnswer);
    return parseEnvironmentNames(answer.environmentNames);
}

async function collectMigrationDecision(
    group: MissingPolicyGroup
): Promise<McpPolicyMigrationDecision | null> {
    printMigrationGroup(group);
    const action = await promptForMigrationAction(group);
    if (action === 'skip') return null;
    if (action === 'disable') return { action: 'disable', extension: group.extension };
    if (action === 'allow-detected') {
        return {
            action: 'allow',
            envAllowlist: group.suggestedEnvironmentVariables,
            extension: group.extension
        };
    }
    if (action === 'none') {
        return { action: 'allow', envAllowlist: [], extension: group.extension };
    }
    return {
        action: 'allow',
        envAllowlist: await promptForCustomEnvironmentNames(group.extension),
        extension: group.extension
    };
}

async function collectManualPolicyDecision(
    group: ManualPolicyGroup
): Promise<McpPolicyMigrationDecision | null> {
    console.log(chalk.bold(`\n${group.extension}`));
    console.log(chalk.dim(`  Servers: ${group.servers.join(', ')}`));
    console.log(chalk.dim(`  Manifest: ${group.manifestPath}`));
    for (const reason of group.reasons) console.log(chalk.yellow(`  ${reason}`));

    const rawAnswer: unknown = await inquirer.prompt([
        {
            type: 'list',
            name: 'action',
            message: 'This working-directory policy requires a manifest change:',
            choices: [
                { name: 'Disable this extension', value: 'disable' },
                { name: 'Cancel so I can update the manifest', value: 'skip' }
            ]
        }
    ]);
    const action = MigrationActionAnswerSchema.parse(rawAnswer).action;
    return action === 'disable' ? { action: 'disable', extension: group.extension } : null;
}

export async function migrateMcpPoliciesInteractively(
    tarsHome: string
): Promise<McpPolicyMigrationResult> {
    const violations = findMcpPolicyViolations(tarsHome);
    if (violations.length === 0) return { changed: false, ready: true };

    console.log(chalk.yellow('\n⚠️ Custom MCP extension policies require migration.'));
    printMcpPolicyAudit(tarsHome, violations);
    if (!isInteractiveTerminal()) {
        console.log(
            chalk.yellow(
                '\nMigration requires an interactive terminal. Run `tars extensions migrate` from an operator shell.'
            )
        );
        return { changed: false, ready: false };
    }

    const decisions: McpPolicyMigrationDecision[] = [];
    const disabledExtensions = new Set<string>();
    for (const group of groupManualPolicies(violations)) {
        const decision = await collectManualPolicyDecision(group);
        if (!decision) {
            console.log(
                chalk.yellow('\nMigration cancelled. No configuration changes were written.')
            );
            return { changed: false, ready: false };
        }
        decisions.push(decision);
        disabledExtensions.add(decision.extension);
    }

    for (const group of groupMissingPolicies(violations)) {
        if (disabledExtensions.has(group.extension)) continue;
        const decision = await collectMigrationDecision(group);
        if (!decision) {
            console.log(
                chalk.yellow('\nMigration cancelled. No configuration changes were written.')
            );
            return { changed: false, ready: false };
        }
        decisions.push(decision);
    }

    const enablementPath = path.join(tarsHome, 'extensions', 'extension-enablement.json');
    const enablement = await readEnablement(enablementPath);
    const migrated = applyMcpPolicyMigrationDecisions(enablement, decisions);
    const backupPath = await writeMcpPolicyEnablementWithBackup(enablementPath, migrated);
    const remaining = findMcpPolicyViolations(tarsHome);
    if (remaining.length > 0) {
        console.log(chalk.yellow('\nMigration saved, but policies still require review.'));
        printMcpPolicyAudit(tarsHome, remaining);
        return { backupPath, changed: true, ready: false };
    }

    console.log(chalk.green('\n✅ Custom MCP extension policies migrated.'));
    console.log(chalk.dim(`   Backup: ${backupPath}`));
    return { backupPath, changed: true, ready: true };
}

async function runAudit(tarsHome: string): Promise<boolean> {
    console.log(chalk.cyan.bold('\n🔍 Tars Extension Policy Audit'));
    console.log(chalk.cyan('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n'));
    return printMcpPolicyAudit(tarsHome);
}

async function runMigration(tarsHome: string): Promise<boolean> {
    const result = await withTarsHomeMutationLease(tarsHome, 'migrate MCP policies', () =>
        migrateMcpPoliciesInteractively(tarsHome)
    );
    if (result.ready && result.changed) {
        console.log(chalk.dim('Run `tars restart` to load the reviewed policies.'));
    } else if (result.ready) {
        console.log(chalk.green('✅ Custom MCP extension policies are already ready.'));
    }
    return result.ready;
}

export async function extensions(actionInput: unknown): Promise<boolean> {
    const action = ExtensionActionSchema.safeParse(actionInput);
    if (!action.success) {
        console.error(chalk.red('Action must be `audit` or `migrate`.'));
        return false;
    }

    const tarsHome = getTarsHome();
    try {
        return action.data === 'audit' ? await runAudit(tarsHome) : await runMigration(tarsHome);
    } catch (error: unknown) {
        console.error(
            chalk.red(`Extension policy ${action.data} failed: ${getErrorMessage(error)}`)
        );
        return false;
    }
}
