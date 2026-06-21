import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import logger from '../utils/logger.js';
import { SecretsManager } from '../utils/secrets-manager.js';
import { getTarsHome } from '../utils/paths.js';

dotenv.config();

export interface ChannelConfig {
    enabled: boolean;
    token?: string;
    ownerId?: string;
}

export class Config {
    private static instance: Config;

    // Paths
    public readonly homeDir: string;
    public readonly taskFilePath: string;
    public readonly sessionFilePath: string;
    public readonly configFilePath: string;
    public readonly memoryDbPath: string;

    // Discord (Legacy support)
    public discordToken: string;
    public discordOwnerId: string | null;

    // Multi-Channel
    public readonly channels: Record<string, ChannelConfig> = {};
    public primaryChannel: string = 'discord';

    // Gemini (Legacy fallback/compatibility)
    public readonly geminiModel: string;
    public readonly assistantName: string;
    public readonly instanceName: string;
    public readonly instanceRole: string;
    public readonly heartbeatIntervalMs: number;

    // Pi Agent SDK Configuration
    public readonly piProvider: string;
    public readonly piModel: string;
    public readonly piBaseUrl: string;

    // Inference Backend
    public readonly inferenceBackend: 'tars' | 'llamacpp';
    public readonly localInferenceUrl: string;

    // Feature Flags — per-backend toggles for optional features
    public readonly statusUpdates: {
        tars: boolean;
        llamacpp: boolean;
    };

    // Context & Compression
    public readonly contextWindowTokens: number;
    public readonly compressionThreshold: number;

    // Rate Limiting
    public readonly maxRPM: number;
    public readonly maxTPM: number;

    // System Prompt
    public readonly systemPromptPath: string;

    private constructor() {
        // 1. Establish Home Directory
        this.homeDir = getTarsHome();
        this.configFilePath = path.join(this.homeDir, 'config.json');

        // 1.5 Load Secrets into environment
        const secretsManager = new SecretsManager(this.homeDir);
        const secrets = secretsManager.load();
        for (const [key, value] of Object.entries(secrets)) {
            process.env[key] = value;
        }

        // 2. Load JSON Config if exists
        let jsonConfig: any = {};
        try {
            if (fs.existsSync(this.configFilePath)) {
                jsonConfig = JSON.parse(fs.readFileSync(this.configFilePath, 'utf-8'));
            }
        } catch (error) {
            logger.warn(`Could not read config file: ${this.configFilePath}`);
        }

        // 3. Set values (Env vars override JSON config)
        this.assistantName = process.env.ASSISTANT_NAME || jsonConfig.assistantName || 'Tars';
        this.instanceName = process.env.TARS_INSTANCE_NAME || 'tars-supervisor';
        this.instanceRole = process.env.TARS_INSTANCE_ROLE || 'General purpose';
        this.geminiModel = process.env.GEMINI_MODEL || jsonConfig.geminiModel || 'auto';
        this.piProvider = process.env.PI_PROVIDER || jsonConfig.piProvider || 'google';
        this.piModel = process.env.PI_MODEL || jsonConfig.piModel || 'gemini-2.5-flash';
        this.piBaseUrl = process.env.PI_BASE_URL || jsonConfig.piBaseUrl || '';
        const rawBackend = (
            process.env.INFERENCE_BACKEND ||
            jsonConfig.inferenceBackend ||
            'tars'
        ).toLowerCase();
        this.inferenceBackend =
            rawBackend === 'pi' || rawBackend === 'gemini' || rawBackend === 'tars'
                ? 'tars'
                : 'llamacpp';
        this.localInferenceUrl =
            process.env.LOCAL_INFERENCE_URL ||
            jsonConfig.localInferenceUrl ||
            'http://localhost:8080';

        // Feature flags: per-backend status update toggles (default: enabled)
        const parseBool = (val: string | boolean | undefined): boolean => {
            if (typeof val === 'boolean') return val;
            if (val === 'true' || val === '1') return true;
            if (val === 'false' || val === '0') return false;
            return true; // default on
        };
        const suJson = jsonConfig.statusUpdates || {};
        this.statusUpdates = {
            tars: parseBool(
                process.env.STATUS_UPDATES_TARS ??
                    process.env.STATUS_UPDATES_GEMINI ??
                    suJson.tars ??
                    suJson.gemini
            ),
            llamacpp: parseBool(process.env.STATUS_UPDATES_LLAMACPP ?? suJson.llamacpp)
        };

        const hbSec =
            process.env.HEARTBEAT_INTERVAL_SEC || jsonConfig.heartbeatIntervalSec || '300';
        this.heartbeatIntervalMs = parseInt(String(hbSec), 10) * 1000;

        this.contextWindowTokens = parseInt(
            String(process.env.CONTEXT_WINDOW_TOKENS || jsonConfig.contextWindowTokens || '128000'),
            10
        );
        this.compressionThreshold = parseFloat(
            String(process.env.COMPRESSION_THRESHOLD || jsonConfig.compressionThreshold || '0.625')
        );

        this.maxRPM = parseInt(String(process.env.GEMINI_MAX_RPM || jsonConfig.maxRPM || '14'), 10);
        this.maxTPM = parseInt(
            String(process.env.GEMINI_MAX_TPM || jsonConfig.maxTPM || '900000'),
            10
        );

        // 4. Initialize Channels
        this.channels = jsonConfig.channels || {};
        this.primaryChannel = jsonConfig.primaryChannel || 'discord';

        // 5. Legacy Mapping & Env Overrides
        this.discordToken = process.env.DISCORD_TOKEN || jsonConfig.discordToken || '';
        this.discordOwnerId = process.env.DISCORD_OWNER_ID || jsonConfig.discordOwnerId || null;

        // Sync legacy to structured config if missing
        if (this.discordToken && !this.channels.discord) {
            this.channels.discord = {
                enabled: true,
                token: this.discordToken,
                ownerId: this.discordOwnerId || undefined
            };
        }

        // 6. Derived Paths
        this.taskFilePath = path.join(this.homeDir, 'data', 'tasks.json');
        this.sessionFilePath = path.join(this.homeDir, 'data', 'session.json');
        this.systemPromptPath = path.join(this.homeDir, 'system.md');
        this.memoryDbPath = path.join(this.homeDir, 'data', 'knowledge.db');

        if (!this.discordToken && !Object.values(this.channels).some((c) => c.enabled)) {
            logger.warn('⚠️ No active communication channels found. Please run `tars setup`.');
        }
    }

    public static getInstance(): Config {
        if (!Config.instance) {
            Config.instance = new Config();
        }
        return Config.instance;
    }

    /**
     * Check if a feature flag is enabled for the current inference backend.
     */
    public isStatusUpdatesEnabled(): boolean {
        return this.statusUpdates[this.inferenceBackend] ?? false;
    }

    /**
     * Persists runtime changes back to config.json
     */
    public saveSettings(): void {
        try {
            let currentConfig: any = {};
            if (fs.existsSync(this.configFilePath)) {
                currentConfig = JSON.parse(fs.readFileSync(this.configFilePath, 'utf-8'));
            }

            // Sync legacy discordOwnerId into structured config
            if (this.channels.discord && this.discordOwnerId) {
                this.channels.discord.ownerId = this.discordOwnerId;
            }

            // Update fields
            currentConfig.discordOwnerId = this.discordOwnerId;
            currentConfig.channels = this.channels;
            currentConfig.primaryChannel = this.primaryChannel;

            fs.writeFileSync(this.configFilePath, JSON.stringify(currentConfig, null, 2));
            logger.info('💾 Config updated successfully.');
        } catch (error: any) {
            logger.error(`❌ Failed to save config: ${error.message}`);
        }
    }
}
