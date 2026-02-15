import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Config } from '../../config/config';
import path from 'path';
import os from 'os';

describe('Config', () => {
    beforeEach(() => {
        // Reset singleton and env
        vi.resetModules();
        (Config as any).instance = undefined;
        delete process.env.TARS_HOME;
        delete process.env.DISCORD_TOKEN;
        delete process.env.HEARTBEAT_INTERVAL_SEC;
    });

    it('should use default home directory if TARS_HOME is not set', () => {
        const config = Config.getInstance();
        const expectedHome = path.join(os.homedir(), '.tars');
        expect(config.homeDir).toBe(expectedHome);
    });

    it('should respect TARS_HOME environment variable', () => {
        process.env.TARS_HOME = '/tmp/tars-test';
        const config = Config.getInstance();
        expect(config.homeDir).toBe('/tmp/tars-test');
    });

    it('should parse HEARTBEAT_INTERVAL_SEC to milliseconds', () => {
        process.env.HEARTBEAT_INTERVAL_SEC = '30';
        const config = Config.getInstance();
        expect(config.heartbeatIntervalMs).toBe(30000);
    });

    it('should use default interval if env var is missing', () => {
        const config = Config.getInstance();
        expect(config.heartbeatIntervalMs).toBe(60000); // Default 60s
    });
});
