import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';

import dotenv from 'dotenv';
import { type z } from 'zod';

import logger from '../utils/logger.js';
import { getTarsHome } from '../utils/paths.js';
import { SecretsManager } from '../utils/secrets-manager.js';
import {
    type ChannelConfigSchema,
    ConfigFileSchema,
    RuntimeConfigSchema,
    type RuntimeConfig
} from './schema.js';

dotenv.config();

export const COMPRESSION_THRESHOLD = 0.6;
export const PREFLIGHT_COMPRESSION_THRESHOLD = 0.75;

export type ChannelConfig = z.infer<typeof ChannelConfigSchema>;

function getRecord(value: unknown): Record<string, unknown> {
    const result = ConfigFileSchema.safeParse(value);
    return result.success ? result.data : {};
}

function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function getNonEmptyEnvironmentValue(value: string | undefined): string | undefined {
    return value?.trim() ? value : undefined;
}

function readConfigFile(configFilePath: string): Record<string, unknown> {
    if (!fs.existsSync(configFilePath)) return {};
    const parsed: unknown = JSON.parse(fs.readFileSync(configFilePath, 'utf-8'));
    return ConfigFileSchema.parse(parsed);
}

function resolveRuntimeConfig(jsonConfig: Record<string, unknown>): RuntimeConfig {
    const statusUpdates = getRecord(jsonConfig.statusUpdates);
    const channels = getRecord(jsonConfig.channels);
    const discord = getRecord(channels.discord);
    const initiative = getRecord(jsonConfig.initiative);

    return RuntimeConfigSchema.parse({
        assistantName: process.env.ASSISTANT_NAME ?? jsonConfig.assistantName,
        instanceName: process.env.TARS_INSTANCE_NAME ?? jsonConfig.instanceName,
        instanceRole: process.env.TARS_INSTANCE_ROLE ?? jsonConfig.instanceRole,
        geminiModel: process.env.GEMINI_MODEL ?? jsonConfig.geminiModel,
        piProvider: process.env.PI_PROVIDER ?? jsonConfig.piProvider,
        piModel: process.env.PI_MODEL ?? jsonConfig.piModel,
        piBaseUrl: process.env.PI_BASE_URL ?? jsonConfig.piBaseUrl,
        inferenceBackend: process.env.INFERENCE_BACKEND ?? jsonConfig.inferenceBackend,
        localInferenceUrl: process.env.LOCAL_INFERENCE_URL ?? jsonConfig.localInferenceUrl,
        statusUpdates: {
            tars:
                process.env.STATUS_UPDATES_TARS ??
                process.env.STATUS_UPDATES_GEMINI ??
                statusUpdates.tars ??
                statusUpdates.gemini,
            llamacpp: process.env.STATUS_UPDATES_LLAMACPP ?? statusUpdates.llamacpp
        },
        heartbeatIntervalSec:
            getNonEmptyEnvironmentValue(process.env.HEARTBEAT_INTERVAL_SEC) ??
            jsonConfig.heartbeatIntervalSec,
        initiative: {
            mode: process.env.TARS_INITIATIVE_MODE ?? initiative.mode,
            intervalSec: process.env.TARS_INITIATIVE_INTERVAL_SEC ?? initiative.intervalSec,
            maxNotificationsPerDay:
                process.env.TARS_INITIATIVE_MAX_NOTIFICATIONS ?? initiative.maxNotificationsPerDay,
            quietHoursStart: process.env.TARS_INITIATIVE_QUIET_START ?? initiative.quietHoursStart,
            quietHoursEnd: process.env.TARS_INITIATIVE_QUIET_END ?? initiative.quietHoursEnd,
            repeatAfterHours:
                process.env.TARS_INITIATIVE_REPEAT_HOURS ?? initiative.repeatAfterHours
        },
        contextWindowTokens:
            getNonEmptyEnvironmentValue(process.env.CONTEXT_WINDOW_TOKENS) ??
            jsonConfig.contextWindowTokens,
        compressionThreshold:
            getNonEmptyEnvironmentValue(process.env.COMPRESSION_THRESHOLD) ??
            jsonConfig.compressionThreshold,
        preflightCompressionThreshold:
            getNonEmptyEnvironmentValue(process.env.PREFLIGHT_COMPRESSION_THRESHOLD) ??
            jsonConfig.preflightCompressionThreshold,
        maxRPM:
            getNonEmptyEnvironmentValue(process.env.TARS_MAX_RPM) ??
            getNonEmptyEnvironmentValue(process.env.GEMINI_MAX_RPM) ??
            jsonConfig.maxRPM,
        maxTPM:
            getNonEmptyEnvironmentValue(process.env.TARS_MAX_TPM) ??
            getNonEmptyEnvironmentValue(process.env.GEMINI_MAX_TPM) ??
            jsonConfig.maxTPM,
        channels,
        primaryChannel: jsonConfig.primaryChannel,
        discordToken: process.env.DISCORD_TOKEN ?? jsonConfig.discordToken ?? discord.token ?? '',
        discordOwnerId:
            process.env.DISCORD_OWNER_ID ?? jsonConfig.discordOwnerId ?? discord.ownerId ?? null
    });
}

export class Config {
    private static instance: Config;

    public readonly homeDir: string;
    public readonly taskFilePath: string;
    public readonly sessionFilePath: string;
    public readonly configFilePath: string;
    public readonly memoryDbPath: string;
    public discordToken: string;
    public discordOwnerId: string | null;
    public readonly channels: Record<string, ChannelConfig>;
    public primaryChannel: string;
    public readonly geminiModel: string;
    public readonly assistantName: string;
    public readonly instanceName: string;
    public readonly instanceRole: string;
    public readonly heartbeatIntervalMs: number;
    public readonly initiative: RuntimeConfig['initiative'];
    public readonly piProvider: string;
    public readonly piModel: string;
    public readonly piBaseUrl: string;
    public readonly inferenceBackend: 'tars' | 'llamacpp';
    public readonly localInferenceUrl: string;
    public readonly statusUpdates: Readonly<{ tars: boolean; llamacpp: boolean }>;
    public readonly contextWindowTokens: number;
    public readonly compressionThreshold: number;
    public readonly preflightCompressionThreshold: number;
    public readonly maxRPM: number;
    public readonly maxTPM: number;
    public readonly systemPromptPath: string;

    private constructor() {
        this.homeDir = getTarsHome();
        this.configFilePath = path.join(this.homeDir, 'config.json');

        const secrets = new SecretsManager(this.homeDir).load();
        for (const [key, value] of Object.entries(secrets)) {
            if (process.env[key] === undefined) process.env[key] = value;
        }

        let jsonConfig: Record<string, unknown> = {};
        try {
            jsonConfig = readConfigFile(this.configFilePath);
        } catch (error: unknown) {
            throw new Error(
                `Invalid Tars configuration at ${this.configFilePath}: ${getErrorMessage(error)}`
            );
        }

        let config: RuntimeConfig;
        try {
            config = resolveRuntimeConfig(jsonConfig);
        } catch (error: unknown) {
            throw new Error(`Invalid Tars configuration: ${getErrorMessage(error)}`);
        }

        this.assistantName = config.assistantName;
        this.instanceName = config.instanceName;
        this.instanceRole = config.instanceRole;
        this.geminiModel = config.geminiModel;
        this.piProvider = config.piProvider;
        this.piModel = config.piModel;
        this.piBaseUrl = config.piBaseUrl;
        this.inferenceBackend = config.inferenceBackend;
        this.localInferenceUrl = config.localInferenceUrl;
        this.statusUpdates = config.statusUpdates;
        this.heartbeatIntervalMs = config.heartbeatIntervalSec * 1_000;
        this.initiative = config.initiative;
        this.contextWindowTokens = config.contextWindowTokens;
        this.compressionThreshold = config.compressionThreshold;
        this.preflightCompressionThreshold = config.preflightCompressionThreshold;
        this.maxRPM = config.maxRPM;
        this.maxTPM = config.maxTPM;
        this.channels = config.channels;
        this.primaryChannel = config.primaryChannel;
        this.discordToken = config.discordToken;
        this.discordOwnerId = config.discordOwnerId;

        if (this.discordToken && !this.channels.discord) {
            this.channels.discord = {
                enabled: true,
                ownerId: this.discordOwnerId || undefined
            };
        }

        this.taskFilePath = path.join(this.homeDir, 'data', 'tasks.json');
        this.sessionFilePath = path.join(this.homeDir, 'data', 'session.json');
        this.systemPromptPath = path.join(this.homeDir, 'system.md');
        this.memoryDbPath = path.join(this.homeDir, 'data', 'knowledge.db');

        if (
            !this.discordToken &&
            !Object.values(this.channels).some((channel) => channel.enabled)
        ) {
            logger.warn('⚠️ No active communication channels found. Please run `tars setup`.');
        }
    }

    public static getInstance(): Config {
        if (!Config.instance) Config.instance = new Config();
        return Config.instance;
    }

    public isStatusUpdatesEnabled(): boolean {
        return this.statusUpdates[this.inferenceBackend] ?? false;
    }

    public saveSettings(): void {
        try {
            const currentConfig = readConfigFile(this.configFilePath);
            if (this.channels.discord && this.discordOwnerId) {
                this.channels.discord.ownerId = this.discordOwnerId;
            }

            const updatedConfig = {
                ...currentConfig,
                discordOwnerId: this.discordOwnerId,
                channels: this.channels,
                primaryChannel: this.primaryChannel
            };
            const tempPath = `${this.configFilePath}.${process.pid}.${randomUUID()}.tmp`;
            fs.mkdirSync(path.dirname(this.configFilePath), { recursive: true });
            fs.writeFileSync(tempPath, JSON.stringify(updatedConfig, null, 2), {
                encoding: 'utf-8',
                mode: 0o600
            });
            fs.renameSync(tempPath, this.configFilePath);
            logger.info('💾 Config updated successfully.');
        } catch (error: unknown) {
            const message = getErrorMessage(error);
            logger.error(`❌ Failed to save config: ${message}`);
            throw new Error(`Failed to save Tars configuration: ${message}`);
        }
    }
}
