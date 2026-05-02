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

export interface SwarmConfig {
    enabled: boolean;
    port: number;
    description: string;
    skills: string[];
    apiKey: string;
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

    // Gemini
    public readonly geminiModel: string;
    public readonly assistantName: string;
    public readonly instanceName: string;
    public readonly instanceRole: string;
    public readonly heartbeatIntervalMs: number;

    // Inference Backend
    public readonly inferenceBackend: 'gemini' | 'llamacpp';
    public readonly localInferenceUrl: string;

    // Swarm (A2A)
    public readonly swarm: SwarmConfig;

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
        this.inferenceBackend = (process.env.INFERENCE_BACKEND ||
            jsonConfig.inferenceBackend ||
            'gemini') as 'gemini' | 'llamacpp';
        this.localInferenceUrl =
            process.env.LOCAL_INFERENCE_URL ||
            jsonConfig.localInferenceUrl ||
            'http://localhost:8080';

        const hbSec =
            process.env.HEARTBEAT_INTERVAL_SEC || jsonConfig.heartbeatIntervalSec || '300';
        this.heartbeatIntervalMs = parseInt(String(hbSec), 10) * 1000;

        this.contextWindowTokens = parseInt(
            String(
                process.env.CONTEXT_WINDOW_TOKENS || jsonConfig.contextWindowTokens || '1048576'
            ),
            10
        );
        this.compressionThreshold = parseFloat(
            String(process.env.COMPRESSION_THRESHOLD || jsonConfig.compressionThreshold || '0.5')
        );

        this.maxRPM = parseInt(String(process.env.GEMINI_MAX_RPM || jsonConfig.maxRPM || '14'), 10);
        this.maxTPM = parseInt(
            String(process.env.GEMINI_MAX_TPM || jsonConfig.maxTPM || '900000'),
            10
        );

        // Swarm Config (A2A remote agent support)
        const swarmJson = jsonConfig.swarm || {};
        this.swarm = {
            enabled:
                (process.env.SWARM_ENABLED || swarmJson.enabled) === true ||
                process.env.SWARM_ENABLED === 'true' ||
                swarmJson.enabled === true,
            port: parseInt(String(process.env.SWARM_PORT || swarmJson.port || '3100'), 10),
            description: process.env.SWARM_DESCRIPTION || swarmJson.description || '',
            skills: swarmJson.skills || [],
            apiKey: ''
        };

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
        this.systemPromptPath = path.join(this.homeDir, '.gemini', 'system.md');
        this.memoryDbPath = path.join(this.homeDir, 'data', 'knowledge.db');

        // Load swarm API key from secrets (after secrets are loaded into env)
        if (this.swarm.enabled) {
            this.swarm = {
                ...this.swarm,
                apiKey: process.env.SWARM_API_KEY || secrets.SWARM_API_KEY || ''
            };
        }

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
