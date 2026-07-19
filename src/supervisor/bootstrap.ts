import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { z } from 'zod';

import { ChannelManager } from '../channels/channel-manager.js';
import type { ChannelMessage } from '../channels/types.js';
import { type TuiChannel } from '../channels/tui/tui-channel.js';
import { Config } from '../config/config.js';
import { GetQuotaTool } from '../tools/get-quota.js';
import { BrainAuditor } from '../utils/brain-audit.js';
import { initializeMemoryFiles } from '../utils/memory-initializer.js';
import logger, { configureDaemonLogging } from '../utils/logger.js';
import { DLPService } from '../utils/dlp-service.js';
import { CronService } from './cron-service.js';
import { DashboardService } from './dashboard-service.js';
import { HeartbeatService } from './heartbeat-service.js';
import { SessionManager } from './session-manager.js';
import { Supervisor } from './supervisor.js';
import { TarsEngine } from './tars-engine.js';
import type { ToolStatus } from './tars-engine.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const LEGACY_BUNDLED_PROMPT_HASH =
    'cc3c835004fd340459aeaf9af1e81da37aef877bd10ceeb2a78c340f93b84a7c';

const BootstrapExtensionEnablementEntrySchema = z.union([
    z.boolean(),
    z
        .object({
            enabled: z.boolean().optional(),
            overrides: z.array(z.string()).optional()
        })
        .passthrough()
]);

const BootstrapExtensionEnablementSchema = z.record(
    z.string().trim().min(1),
    BootstrapExtensionEnablementEntrySchema
);
const ManagedExtensionMarkerSchema = z
    .object({
        schemaVersion: z.literal(1),
        name: z.string().trim().min(1)
    })
    .strict();

type BootstrapExtensionEnablementEntry = z.infer<typeof BootstrapExtensionEnablementEntrySchema>;

export interface LiveStatusState {
    initialized: boolean;
}

export async function deliverStatusUpdateBestEffort(
    channelManager: Pick<ChannelManager, 'editStatus' | 'sendStatus'>,
    state: LiveStatusState,
    content: string
): Promise<void> {
    // Live progress is presentation-only. Final replies remain awaited by the routing flow.
    try {
        if (!state.initialized) {
            await channelManager.sendStatus(content);
            state.initialized = true;
            return;
        }

        const edited = await channelManager.editStatus(content);
        if (edited) return;

        logger.warn('[Main] Status edit failed, sending new notification.');
        state.initialized = false;
        await channelManager.sendStatus(content);
        state.initialized = true;
    } catch (error: unknown) {
        state.initialized = false;
        const message = error instanceof Error ? error.message : String(error);
        logger.warn(
            `[Main] Live status delivery failed; continuing the active turn: ${DLPService.scrub(message)}`
        );
    }
}

export function isManagedBundledExtension(directoryPath: string, expectedName: string): boolean {
    const markerPath = path.join(directoryPath, '.tars-managed-extension.json');
    try {
        const markerStats = fs.lstatSync(markerPath);
        if (!markerStats.isFile() || markerStats.isSymbolicLink()) return false;
        const parsed: unknown = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
        const marker = ManagedExtensionMarkerSchema.safeParse(parsed);
        return marker.success && marker.data.name === expectedName;
    } catch {
        return false;
    }
}

function createBuildEnvironment(): NodeJS.ProcessEnv {
    return Object.fromEntries(
        Object.entries(process.env).filter(([key]) => !DLPService.isSensitiveKey(key))
    );
}

function writePrivateFileAtomic(filePath: string, content: string): void {
    const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
    try {
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(temporaryPath, content, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
        fs.renameSync(temporaryPath, filePath);
    } catch (error: unknown) {
        try {
            fs.unlinkSync(temporaryPath);
        } catch {
            // Best-effort cleanup; the original destination remains untouched.
        }
        throw error;
    }
}

function pathEntryExists(filePath: string): boolean {
    try {
        fs.lstatSync(filePath);
        return true;
    } catch (error: unknown) {
        const code =
            typeof error === 'object' && error !== null ? Reflect.get(error, 'code') : undefined;
        if (code === 'ENOENT') return false;
        throw error;
    }
}

function hasRunnableExtension(directoryPath: string): boolean {
    return (
        fs.existsSync(path.join(directoryPath, 'node_modules')) &&
        fs.existsSync(path.join(directoryPath, 'dist', 'server.js'))
    );
}

function installManagedExtensionCopy(
    sourcePath: string,
    destinationPath: string,
    extensionName: string
): void {
    const parentDirectory = path.dirname(destinationPath);
    const stagedPath = path.join(
        parentDirectory,
        `.tars-bootstrap-${extensionName}-${randomUUID()}`
    );
    const backupPath = `${destinationPath}.backup-${randomUUID()}`;
    let movedExisting = false;
    try {
        fs.cpSync(sourcePath, stagedPath, {
            recursive: true,
            filter: (source) => {
                const relative = path.relative(sourcePath, source);
                if (!relative) return true;
                return !relative
                    .split(path.sep)
                    .some(
                        (segment) =>
                            segment === 'node_modules' ||
                            segment === 'dist' ||
                            segment === '.env' ||
                            segment.startsWith('.env.')
                    );
            }
        });
        execFileSync('npm', ['ci', '--ignore-scripts'], {
            cwd: stagedPath,
            env: createBuildEnvironment(),
            stdio: 'pipe'
        });
        execFileSync('npm', ['run', 'build'], {
            cwd: stagedPath,
            env: createBuildEnvironment(),
            stdio: 'pipe'
        });
        if (!hasRunnableExtension(stagedPath)) {
            throw new Error(`${extensionName} did not produce dist/server.js and dependencies.`);
        }
        writePrivateFileAtomic(
            path.join(stagedPath, '.tars-managed-extension.json'),
            `${JSON.stringify({ schemaVersion: 1, name: extensionName }, null, 2)}\n`
        );

        if (pathEntryExists(destinationPath)) {
            fs.renameSync(destinationPath, backupPath);
            movedExisting = true;
        }
        fs.renameSync(stagedPath, destinationPath);
        if (movedExisting) fs.rmSync(backupPath, { recursive: true, force: true });
    } catch (error) {
        fs.rmSync(stagedPath, { recursive: true, force: true });
        if (movedExisting && !pathEntryExists(destinationPath)) {
            fs.renameSync(backupPath, destinationPath);
        }
        throw error;
    }
}

/**
 * Result of the bootstrap process. Contains all initialized services.
 */
export interface BootstrapResult {
    config: Config;
    tarsEngine: TarsEngine;
    sessionManager: SessionManager;
    supervisor: Supervisor;
    channelManager: ChannelManager;
    heartbeat: HeartbeatService;
    cron: CronService;
    dashboard: DashboardService;
}

function normalizeLegacyBundledPrompt(content: string): string {
    return content
        .replace(/\r\n/g, '\n')
        .replace(/^# .+ - System Instructions$/m, '# {{ASSISTANT_NAME}} - System Instructions')
        .replace(/^- \*\*Assistant Name\*\*: .+$/m, '- **Assistant Name**: {{ASSISTANT_NAME}}')
        .replace(/^- \*\*Instance ID\*\*: .+$/m, '- **Instance ID**: {{INSTANCE_NAME}}')
        .replace(/^- \*\*Provider\*\*: .+$/m, '- **Provider**: {{PROVIDER}}')
        .replace(/^- \*\*Model\*\*: .+$/m, '- **Model**: {{MODEL_NAME}}')
        .replace(
            /^- \*\*Context Window\*\*: .+ tokens$/m,
            '- **Context Window**: {{CONTEXT_WINDOW}} tokens'
        )
        .replace(
            /^You are \*\*.+\*\*, an autonomous/m,
            'You are **{{ASSISTANT_NAME}}**, an autonomous'
        );
}

function isLegacyBundledPrompt(content: string): boolean {
    const normalized = normalizeLegacyBundledPrompt(content);
    const fingerprint = createHash('sha256').update(normalized).digest('hex');
    return fingerprint === LEGACY_BUNDLED_PROMPT_HASH;
}

/**
 * Install the bundled system prompt without replacing user-customized instructions.
 */
function installSystemPrompt(config: Config): void {
    let searchDir = __dirname;
    let srcPrompt = '';

    for (let i = 0; i < 5; i++) {
        const candidate = path.join(searchDir, 'prompts', 'system.md');
        const srcCandidate = path.join(searchDir, 'src', 'prompts', 'system.md');

        if (fs.existsSync(candidate)) {
            srcPrompt = candidate;
            break;
        } else if (fs.existsSync(srcCandidate)) {
            srcPrompt = srcCandidate;
            break;
        }
        searchDir = path.dirname(searchDir);
    }

    if (!srcPrompt) {
        logger.warn('⚠️ Could not locate system.md prompt file');
        return;
    }

    const targetDir = path.dirname(config.systemPromptPath);
    fs.mkdirSync(targetDir, { recursive: true });

    let installAction = 'installed';
    if (fs.existsSync(config.systemPromptPath)) {
        const existingPrompt = fs.readFileSync(config.systemPromptPath, 'utf-8');
        if (!isLegacyBundledPrompt(existingPrompt)) {
            logger.debug(`Preserving customized system prompt: ${config.systemPromptPath}`);
            return;
        }
        installAction = 'migrated from the legacy bundled prompt';
    }

    let promptContent = fs.readFileSync(srcPrompt, 'utf-8');
    promptContent = promptContent.replace(/{{ASSISTANT_NAME}}/g, config.assistantName);
    promptContent = promptContent.replace(/{{INSTANCE_NAME}}/g, config.instanceName);
    promptContent = promptContent.replace(/{{PROVIDER}}/g, config.piProvider);
    promptContent = promptContent.replace(/{{MODEL_NAME}}/g, config.piModel);
    promptContent = promptContent.replace(
        /{{CONTEXT_WINDOW}}/g,
        config.contextWindowTokens.toLocaleString()
    );

    fs.writeFileSync(config.systemPromptPath, promptContent);
    logger.info(`📝 System prompt ${installAction}: ${config.systemPromptPath}`);
}

/**
 * Install and sync built-in skills into the Tars runtime directory.
 */
function installSkills(config: Config): void {
    let searchDir = __dirname;
    let skillsSrc = '';

    for (let i = 0; i < 5; i++) {
        const candidate = path.join(searchDir, 'context', 'skills');
        const srcCandidate = path.join(searchDir, '..', 'context', 'skills');

        if (fs.existsSync(candidate)) {
            skillsSrc = candidate;
            break;
        } else if (fs.existsSync(srcCandidate)) {
            skillsSrc = srcCandidate;
            break;
        }
        const rootCandidate = path.join(searchDir, '..', '..', 'context', 'skills');
        if (fs.existsSync(rootCandidate)) {
            skillsSrc = rootCandidate;
            break;
        }

        searchDir = path.dirname(searchDir);
    }

    if (!skillsSrc) {
        logger.warn('⚠️ Could not locate built-in skills directory');
        return;
    }

    const skillsDest = path.join(config.homeDir, 'skills');

    try {
        if (!fs.existsSync(skillsDest)) {
            fs.mkdirSync(skillsDest, { recursive: true });
        }

        const builtInSkills = fs.readdirSync(skillsSrc);

        for (const skillName of builtInSkills) {
            const srcSkillPath = path.join(skillsSrc, skillName);
            const destSkillPath = path.join(skillsDest, skillName);

            if (!fs.statSync(srcSkillPath).isDirectory()) continue;

            if (fs.existsSync(destSkillPath)) {
                fs.rmSync(destSkillPath, { recursive: true, force: true });
            }

            fs.cpSync(srcSkillPath, destSkillPath, { recursive: true });
        }
    } catch (error) {
        logger.error(`❌ Failed to sync skills: ${error}`);
    }
}

/**
 * Automatically install/link extensions and enable them.
 */
export function installExtensions(config: Config): void {
    const repoExtensionsDir = path.join(__dirname, '..', '..', 'extensions');
    const targetExtensionsDir = path.join(config.homeDir, 'extensions');
    const enablementFile = path.join(targetExtensionsDir, 'extension-enablement.json');

    if (!fs.existsSync(repoExtensionsDir)) {
        logger.warn('⚠️ Could not locate extensions directory');
        return;
    }

    if (!fs.existsSync(targetExtensionsDir)) {
        fs.mkdirSync(targetExtensionsDir, { recursive: true });
    }

    let enablement: Record<string, BootstrapExtensionEnablementEntry> = {};
    if (fs.existsSync(enablementFile)) {
        try {
            const rawEnablement: unknown = JSON.parse(fs.readFileSync(enablementFile, 'utf-8'));
            const parsedEnablement = BootstrapExtensionEnablementSchema.safeParse(rawEnablement);
            if (!parsedEnablement.success) {
                logger.error(
                    `❌ Invalid extension-enablement.json; preserving it unchanged: ${parsedEnablement.error.message}`
                );
                return;
            }
            enablement = parsedEnablement.data;
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            logger.error(`❌ Could not parse extension-enablement.json; preserving it: ${message}`);
            return;
        }
    }

    const builtInExtensions = fs.readdirSync(repoExtensionsDir);
    const useDevelopmentLinks = process.env.TARS_DEV_EXTENSION_LINKS === 'true';
    for (const extName of builtInExtensions) {
        const srcPath = path.resolve(repoExtensionsDir, extName);
        if (!fs.statSync(srcPath).isDirectory()) continue;

        const finalExtName =
            extName === 'tasks'
                ? 'tars-tasks'
                : extName === 'memory'
                  ? 'tars-memory'
                  : extName === 'search'
                    ? 'tars-search'
                    : extName;
        const finalDestPath = path.join(targetExtensionsDir, finalExtName);

        if (useDevelopmentLinks) {
            try {
                if (pathEntryExists(finalDestPath)) {
                    const stats = fs.lstatSync(finalDestPath);
                    if (
                        !stats.isSymbolicLink() &&
                        !isManagedBundledExtension(finalDestPath, finalExtName)
                    ) {
                        logger.warn(
                            `⚠️ Preserving unmanaged extension directory at ${finalDestPath}; move it aside to use a development link.`
                        );
                        continue;
                    }
                    fs.rmSync(finalDestPath, { recursive: true, force: true });
                }
                fs.symlinkSync(srcPath, finalDestPath);
                logger.info(`🔌 Linked development extension: ${finalExtName}`);
            } catch (error: unknown) {
                logger.error(
                    `❌ Failed to link development extension ${finalExtName}: ${DLPService.scrub(String(error))}`
                );
                continue;
            }
            if (!hasRunnableExtension(finalDestPath)) {
                logger.info(`💧 Hydrating development extension: ${finalExtName}...`);
                execFileSync('npm', ['ci', '--ignore-scripts'], {
                    cwd: finalDestPath,
                    env: createBuildEnvironment(),
                    stdio: 'pipe'
                });
                execFileSync('npm', ['run', 'build'], {
                    cwd: finalDestPath,
                    env: createBuildEnvironment(),
                    stdio: 'pipe'
                });
            }
        } else {
            try {
                if (pathEntryExists(finalDestPath)) {
                    const stats = fs.lstatSync(finalDestPath);
                    if (
                        stats.isDirectory() &&
                        isManagedBundledExtension(finalDestPath, finalExtName)
                    ) {
                        if (hasRunnableExtension(finalDestPath)) {
                            logger.debug(`Preserving validated extension copy: ${finalExtName}`);
                        } else {
                            installManagedExtensionCopy(srcPath, finalDestPath, finalExtName);
                            logger.info(`🔄 Repaired managed extension copy: ${finalExtName}`);
                        }
                    } else if (!stats.isSymbolicLink()) {
                        logger.warn(
                            `⚠️ Preserving unmanaged extension directory at ${finalDestPath}; move it aside to restore the bundled ${finalExtName} extension.`
                        );
                        continue;
                    } else {
                        installManagedExtensionCopy(srcPath, finalDestPath, finalExtName);
                        logger.info(
                            `🔄 Migrated extension link to a managed copy: ${finalExtName}`
                        );
                    }
                } else {
                    installManagedExtensionCopy(srcPath, finalDestPath, finalExtName);
                    logger.info(`🔌 Installed managed extension: ${finalExtName}`);
                }
            } catch (error: unknown) {
                logger.error(
                    `❌ Failed to install extension ${finalExtName}; previous copy was preserved: ${DLPService.scrub(String(error))}`
                );
                continue;
            }
        }

        if (!hasRunnableExtension(finalDestPath)) {
            logger.error(`❌ Extension ${finalExtName} is not runnable; leaving it disabled.`);
            continue;
        }

        // Bundled extensions are trusted distribution components. Preserve explicit disablement.
        if (!Object.prototype.hasOwnProperty.call(enablement, finalExtName)) {
            enablement[finalExtName] = { overrides: [] };
        }
    }

    const allInstalledExtensions = fs.readdirSync(targetExtensionsDir);
    for (const extName of allInstalledExtensions) {
        if (extName === 'extension-enablement.json') continue;

        const rawEntry = enablement[extName];
        if (rawEntry === undefined || rawEntry === false) continue;

        const entry = rawEntry === true ? { enabled: true, overrides: [] } : rawEntry;
        if (entry.enabled === false) continue;

        const extPath = path.join(targetExtensionsDir, extName);
        if (!fs.statSync(extPath).isDirectory()) continue;

        const realPath = fs.realpathSync(extPath);
        const overrides = new Set(entry.overrides ?? []);
        overrides.add(path.join(config.homeDir, '*'));
        overrides.add(path.join(realPath, '*'));

        entry.overrides = Array.from(overrides);
        enablement[extName] = entry;
    }

    writePrivateFileAtomic(enablementFile, `${JSON.stringify(enablement, null, 2)}\n`);
}

/**
 * Install default settings if none exist.
 */
function installDefaultSettings(config: Config): void {
    const settingsTemplate = path.join(
        __dirname,
        '..',
        '..',
        'context',
        'config',
        'settings.json-template'
    );
    const targetSettings = path.join(config.homeDir, 'settings.json');

    if (fs.existsSync(targetSettings)) return;

    if (fs.existsSync(settingsTemplate)) {
        fs.mkdirSync(path.dirname(targetSettings), { recursive: true });
        fs.copyFileSync(settingsTemplate, targetSettings);
        logger.info(`⚙️ Default settings installed: ${targetSettings}`);
    }
}

/**
 * Ensure existing settings.json has required settings
 */
function patchSettings(config: Config): void {
    const targetSettings = path.join(config.homeDir, 'settings.json');
    if (!fs.existsSync(targetSettings)) return;

    const settingsTemplate = path.join(
        __dirname,
        '..',
        '..',
        'context',
        'config',
        'settings.json-template'
    );

    try {
        const raw = fs.readFileSync(targetSettings, 'utf-8');
        const settings = JSON.parse(raw);
        let modified = false;

        if (fs.existsSync(settingsTemplate)) {
            const template = JSON.parse(fs.readFileSync(settingsTemplate, 'utf-8'));
            const sections = ['experimental', 'agents', 'model', 'general'];
            for (const section of sections) {
                if (template[section] && !settings[section]) {
                    settings[section] = template[section];
                    modified = true;
                }
            }
        }

        if (modified) {
            fs.writeFileSync(targetSettings, JSON.stringify(settings, null, 2));
            logger.info('⚙️ Patched settings.json from template.');
        }
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        logger.warn(`⚠️ Failed to patch settings.json: ${message}`);
    }
}

/**
 * Install the built-in dashboard into the Tars home directory.
 */
function installDashboard(config: Config): void {
    const repoDashSrc = path.join(__dirname, '..', '..', 'dash');
    const targetDashDir = path.join(config.homeDir, 'apps', 'dashboard');

    if (!fs.existsSync(repoDashSrc)) {
        logger.warn('⚠️ Could not locate stock dashboard directory');
        return;
    }

    if (!fs.existsSync(targetDashDir)) {
        try {
            fs.mkdirSync(path.dirname(targetDashDir), { recursive: true });
            fs.cpSync(repoDashSrc, targetDashDir, { recursive: true });
            logger.info(`🚚 Installed stock dashboard to ${targetDashDir}`);
        } catch (error) {
            logger.error(`❌ Failed to install stock dashboard: ${error}`);
            return;
        }
    }

    const targetEnv = path.join(targetDashDir, '.env');
    const templateEnv = path.join(targetDashDir, '.env.template');
    if (!fs.existsSync(targetEnv) && fs.existsSync(templateEnv)) {
        try {
            fs.copyFileSync(templateEnv, targetEnv);
            logger.info('⚙️ Created default dashboard .env');
        } catch {
            logger.warn(`⚠️ Could not create the dashboard environment file at ${targetEnv}`);
        }
    }

    const nmPath = path.join(targetDashDir, 'node_modules');
    const nextPath = path.join(targetDashDir, '.next');

    if (!fs.existsSync(nmPath) || !fs.existsSync(nextPath)) {
        logger.info('💧 Hydrating dashboard (this may take a minute)...');
        try {
            const env = { ...process.env };
            delete env.NODE_ENV;

            execFileSync('npm', ['ci'], {
                cwd: targetDashDir,
                stdio: 'pipe',
                env: Object.fromEntries(
                    Object.entries(env).filter(([key]) => !DLPService.isSensitiveKey(key))
                )
            });

            logger.info('🏗️ Building dashboard...');
            execFileSync('npm', ['run', 'build'], {
                cwd: targetDashDir,
                stdio: 'pipe',
                env: Object.fromEntries(
                    Object.entries(env).filter(([key]) => !DLPService.isSensitiveKey(key))
                )
            });

            logger.info('✅ Dashboard hydrated successfully.');
        } catch (error: unknown) {
            logger.error(`❌ Failed to hydrate dashboard: ${DLPService.scrub(String(error))}`);
        }
    }
}

/**
 * Format byte size to human-readable string.
 */
function formatSize(chars: number): string {
    if (chars < 1024) return `${chars}B`;
    if (chars < 1024 * 1024) return `${(chars / 1024).toFixed(1)}KB`;
    return `${(chars / (1024 * 1024)).toFixed(1)}MB`;
}

/**
 * Build the status content string for live tool execution updates.
 */
function formatStatusContent(
    turnCount: number,
    recentTools: ToolStatus[],
    sessionManager: SessionManager,
    config: Config
): string {
    const lines: string[] = [];

    // Get current context window stats
    const stats = sessionManager.getStats();
    let contextStr = '';
    if (stats && stats.lastInputTokens > 0) {
        const limit = config.contextWindowTokens;
        const active = stats.lastInputTokens;
        const pct = ((active / limit) * 100).toFixed(1);
        contextStr = ` | ${active.toLocaleString()}/${limit.toLocaleString()} (${pct}%)`;
    }

    const executedCount = recentTools.filter((t) => t.status === 'completed').length;
    const timeStr = new Date().toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });

    lines.push(
        `⏳ **Working...** | Turn ${turnCount} (${executedCount} tools)${contextStr} | ${timeStr}`
    );

    // Show last 5 tool calls (moving window)
    const toolsToShow = recentTools.slice(-5);
    if (toolsToShow.length > 0) {
        lines.push('');
        for (const tool of toolsToShow) {
            if (tool.status === 'running') {
                lines.push(`⚙️ **${tool.name}** — *Executing...*`);
            } else {
                let preview = (tool.responsePreview || '')
                    .replace(/\s+/g, ' ')
                    .replace(/[`*#_[\]]/g, '')
                    .trim();

                if (preview.length > 80) {
                    preview = preview.substring(0, 77) + '...';
                }
                const size = formatSize(tool.responseSize || 0);
                lines.push(`🛠️ **${tool.name}** — "${preview}" (${size})`);
            }
        }
    }

    return lines.join('\n');
}

/**
 * Options to customize the bootstrap process.
 */
export interface BootstrapOptions {
    /** Skip Discord channel initialization */
    skipDiscord?: boolean;
    /** Skip dashboard installation/hydration */
    skipDashboard?: boolean;
}

/**
 * Shared supervisor bootstrap logic.
 * Used by both main.ts (PM2 background) and chat.ts (foreground TUI).
 *
 * Returns all initialized services but does NOT start them.
 * The caller is responsible for starting channels, heartbeat, cron, etc.
 */
export async function bootstrap(options: BootstrapOptions = {}): Promise<BootstrapResult> {
    // 1. Load Configuration & Audit Brain
    const config = Config.getInstance();

    // Configure logging based on mode
    if (process.env.TARS_CHAT_MODE === 'true') {
        const { configureChatLogging } = await import('../utils/logger.js');
        configureChatLogging(config.homeDir);
    } else if (process.env.TARS_SUPERVISOR_MODE === 'true') {
        // Daemon mode: write logs to supervisor.log for traceability
        configureDaemonLogging(config.homeDir);
    }

    // Initialize memory/directive files if they don't exist
    await initializeMemoryFiles(config.homeDir);

    logger.info('🚀 Tars Starting...');

    const auditor = new BrainAuditor(config.homeDir);
    await auditor.audit({ silent: true });

    // 2. Install components
    installSystemPrompt(config);
    installSkills(config);
    installExtensions(config);
    if (!options.skipDashboard) {
        installDashboard(config);
    }
    installDefaultSettings(config);
    patchSettings(config);

    // 3. Initialize Core Services
    const tarsEngine = new TarsEngine(config);
    const sessionManager = new SessionManager(config.sessionFilePath);
    const supervisor = new Supervisor(tarsEngine, sessionManager);

    // 4. Initialize Multi-Channel Interface
    const channelManager = new ChannelManager({ skipDiscord: options.skipDiscord });

    // 5. Inject Interface into Engine
    tarsEngine.setChannelManager(channelManager);
    tarsEngine.setSessionManager(sessionManager);
    await tarsEngine.initialize();

    // 6. Initialize Background Services
    const heartbeat = new HeartbeatService(supervisor, config, sessionManager);
    const cron = new CronService(supervisor, config, channelManager);
    const dashboard = new DashboardService(config);

    return {
        config,
        tarsEngine,
        sessionManager,
        supervisor,
        channelManager,
        heartbeat,
        cron,
        dashboard
    };
}

/**
 * Wire the shared message routing logic onto a channel manager.
 * Handles slash commands (/reset, /clear, /quota, /stats, /help) and
 * forwards all other messages to the supervisor for AI processing.
 *
 * The optional `tuiChannel` parameter enables real-time token streaming
 * when the active channel is a TUI (instead of Discord-style buffering).
 */
export function wireMessageRouting(
    channelManager: ChannelManager,
    supervisor: Supervisor,
    sessionManager: SessionManager,
    tarsEngine: TarsEngine,
    config: Config,
    tuiChannel?: TuiChannel
): void {
    channelManager.onMessage(async (message: ChannelMessage) => {
        const rawPrompt = message.content.trim();

        if (rawPrompt.startsWith('/')) {
            const parts = rawPrompt.split(' ');
            const command = parts[0].toLowerCase();

            if (command === '/reset' || command === '/clear') {
                try {
                    const stats = sessionManager.getStats();
                    if (stats) {
                        const chatFile = path.join(
                            config.homeDir,
                            'chats',
                            `${stats.sessionId}.json`
                        );
                        if (fs.existsSync(chatFile)) {
                            await fs.promises.unlink(chatFile).catch(() => {});
                        }
                    }
                    await sessionManager.clear();
                    tarsEngine.resetSession();
                    await message.reply(
                        '✨ **Session Reset:** I have cleared the current session context and started a new, clean conversation.'
                    );
                } catch (error: unknown) {
                    const errorMessage = error instanceof Error ? error.message : String(error);
                    await message.reply(`❌ **Error resetting session:** ${errorMessage}`);
                }
                message.stopTyping();
                return;
            }

            if (command === '/quota' || command === '/stats') {
                const stats = sessionManager.getStats();
                if (!stats) {
                    await message.reply('📊 **No active session stats found.**');
                    message.stopTyping();
                    return;
                }

                const quotaTool = new GetQuotaTool(sessionManager, {
                    piProvider: config.piProvider,
                    contextWindowTokens: config.contextWindowTokens,
                    piModel: config.piModel,
                    piBaseUrl: config.piBaseUrl
                });

                const usageText = quotaTool.getLocalUsage();
                await message.reply(usageText);
                message.stopTyping();
                return;
            }

            if (command === '/help') {
                const helpText = [
                    `🤖 **Tars Deterministic Commands**`,
                    `• \`/reset\` or \`/clear\` - Reset active session and start a new clean conversation.`,
                    `• \`/quota\` or \`/stats\` - View token consumption, active context size, and session statistics.`,
                    `• \`/help\` - Show this help menu.`
                ].join('\n');
                await message.reply(helpText);
                message.stopTyping();
                return;
            }
        }

        // Determine if the message came from the TUI channel
        const isTui = message.channelId === 'tui' && tuiChannel;

        let responseBuffer = '';

        // --- Live status tracking for in-place message editing ---
        const liveStatus: LiveStatusState = { initialized: false };

        const updateStatus = async (
            turnCount: number,
            recentTools: ToolStatus[],
            _isMilestone: boolean
        ): Promise<void> => {
            const content = formatStatusContent(turnCount, recentTools, sessionManager, config);
            await deliverStatusUpdateBestEffort(channelManager, liveStatus, content);
        };

        const flush = async (isDone = false) => {
            const text = responseBuffer.trim();
            if (!text) return;

            let finalContent = text;

            if (isDone) {
                const stats = sessionManager.getStats();
                if (stats && stats.lastInputTokens > 0) {
                    const limit = config.contextWindowTokens;
                    const active = stats.lastInputTokens;
                    const pct = ((active / limit) * 100).toFixed(1);
                    const thresholdPct = (config.compressionThreshold * 100).toFixed(1);
                    finalContent += `\n\n*${active.toLocaleString()}/${limit.toLocaleString()} (${pct}%, compaction at ${thresholdPct}%)*`;
                }
            }

            await message.reply(finalContent);
            responseBuffer = '';
        };

        // Clear any previous status message for a fresh start
        channelManager.clearStatus();
        liveStatus.initialized = false;

        // Feature flag: status updates are per-backend
        const statusEnabled = config.isStatusUpdatesEnabled();
        if (!statusEnabled) {
            logger.debug(
                `[Main] Status updates disabled for backend "${config.inferenceBackend}".`
            );
        }

        try {
            message.startTyping();
            await supervisor.run(
                message.content,
                async (event) => {
                    if (event.type === 'text' && event.content && event.role !== 'user') {
                        if (isTui) {
                            // TUI: stream tokens directly to terminal
                            // Clear status lines before first streamed text
                            if (!responseBuffer) {
                                channelManager.clearStatus();
                                liveStatus.initialized = false;
                            }
                            tuiChannel!.streamText(event.content);
                            responseBuffer += event.content; // Track for length, not for flushing
                        } else {
                            // Discord: buffer text for batch reply
                            responseBuffer += event.content;
                        }
                    } else if (event.type === 'tool_call') {
                        // Local models emit reasoning before a tool call. By clearing the buffer, we suppress it.
                        if (isTui && responseBuffer) {
                            // If we streamed partial text, add a newline before status
                            tuiChannel!.streamText('\n');
                        }
                        responseBuffer = '';
                    } else if (event.type === 'error') {
                        if (isTui) {
                            channelManager.clearStatus();
                            liveStatus.initialized = false;
                        }
                        await flush();
                        await message.reply(`❌ **Error:** ${event.error}`);
                    } else if (event.type === 'done') {
                        if (isTui) {
                            // TUI: text was already streamed, just print footer
                            channelManager.clearStatus();
                            liveStatus.initialized = false;

                            const stats = sessionManager.getStats();
                            if (stats && stats.lastInputTokens > 0) {
                                const { TuiRenderer } =
                                    await import('../channels/tui/tui-renderer.js');
                                const footer = TuiRenderer.renderFooter(
                                    stats.lastInputTokens,
                                    config.contextWindowTokens,
                                    config.compressionThreshold
                                );
                                tuiChannel!.streamText('\n\n' + footer + '\n');
                            } else {
                                tuiChannel!.streamText('\n\n');
                            }
                            responseBuffer = '';
                        } else {
                            await flush(true);
                        }
                    }
                },
                undefined,
                message.attachments,
                statusEnabled ? updateStatus : undefined
            );
        } catch (error: unknown) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            logger.error(`Routing error: ${errorMsg}`);
            await message.reply(`❌ **Supervisor Error:** ${errorMsg}`);
        } finally {
            message.stopTyping();
        }
    });
}
