import path from 'path';
import os from 'os';
import fs from 'fs';
import dotenv from 'dotenv';
import logger from '../utils/logger.js';
import { SecretsManager } from '../utils/secrets-manager.js';

dotenv.config();

export class Config {
    private static instance: Config;

    // Paths
    public readonly homeDir: string;
    public readonly taskFilePath: string;
    public readonly sessionFilePath: string;
    public readonly configFilePath: string;
    public readonly memoryDbPath: string;

    // Discord
    public readonly discordToken: string;

    // Gemini
    public readonly geminiModel: string;
    public readonly heartbeatIntervalMs: number;

    // System Prompt
    public readonly systemPromptPath: string;

    private constructor() {
        // 1. Establish Home Directory (~/.tars)
        // Hardcode the base to be the real user home to avoid recursion if HOME is changed for subprocesses
        const realUserHome = process.env.REAL_HOME || os.homedir();
        this.homeDir = process.env.TARS_HOME || path.join(realUserHome.replace('/.tars', ''), '.tars');
        this.configFilePath = path.join(this.homeDir, 'config.json');

        // 1.5 Load Secrets into environment
        const secretsManager = new SecretsManager(this.homeDir);
        const secrets = secretsManager.load();
        for (const [key, value] of Object.entries(secrets)) {
            // Load into process.env so they are available globally
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
        this.discordToken = process.env.DISCORD_TOKEN || jsonConfig.discordToken || '';
        this.geminiModel = process.env.GEMINI_MODEL || jsonConfig.geminiModel || 'auto';

        const hbSec = process.env.HEARTBEAT_INTERVAL_SEC || jsonConfig.heartbeatIntervalSec || '300';
        this.heartbeatIntervalMs = parseInt(String(hbSec), 10) * 1000;

        // 4. Derived Paths
        this.taskFilePath = path.join(this.homeDir, 'data', 'tasks.json');
        this.sessionFilePath = path.join(this.homeDir, 'data', 'session.json');
        this.systemPromptPath = path.join(this.homeDir, '.gemini', 'system.md');
        this.memoryDbPath = path.join(this.homeDir, 'data', 'knowledge.db');

        // Note: validation happens in specific services if needed, but we can do a basic check
        if (!this.discordToken) {
            logger.warn('⚠️ No Discord Token found. Please run `tars setup`.');
        }
    }

    public static getInstance(): Config {
        if (!Config.instance) {
            Config.instance = new Config();
        }
        return Config.instance;
    }
}
