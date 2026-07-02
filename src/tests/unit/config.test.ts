import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Config } from '../../config/config.js';
import path from 'path';
import os from 'os';

describe('Config', () => {
    beforeEach(() => {
        // Reset singleton and env
        vi.resetModules();
        (Config as any).instance = undefined;
        vi.unstubAllEnvs();
        vi.stubEnv('TARS_HOME', '/tmp/tars-unit-test');
    });

    it('should use provided home directory if TARS_HOME is set', () => {
        const config = Config.getInstance();
        expect(config.homeDir).toBe('/tmp/tars-unit-test');
    });

    it('should respect TARS_HOME environment variable', () => {
        vi.stubEnv('TARS_HOME', '/tmp/tars-test');
        const config = Config.getInstance();
        expect(config.homeDir).toBe('/tmp/tars-test');
    });

    it('should parse HEARTBEAT_INTERVAL_SEC to milliseconds', () => {
        vi.stubEnv('HEARTBEAT_INTERVAL_SEC', '30');
        const config = Config.getInstance();
        expect(config.heartbeatIntervalMs).toBe(30000);
    });

    it('should use default interval if env var is missing', () => {
        vi.stubEnv('HEARTBEAT_INTERVAL_SEC', '');
        const config = Config.getInstance();
        expect(config.heartbeatIntervalMs).toBe(300000); // Default 300s
    });

    it('should default contextWindowTokens to 128000', () => {
        const config = Config.getInstance();
        expect(config.contextWindowTokens).toBe(128000);
    });

    it('should override contextWindowTokens from env var', () => {
        vi.stubEnv('CONTEXT_WINDOW_TOKENS', '8192');
        const config = Config.getInstance();
        expect(config.contextWindowTokens).toBe(8192);
    });

    it('should default compressionThreshold to 0.6', () => {
        const config = Config.getInstance();
        expect(config.compressionThreshold).toBe(0.6);
    });

    it('should default preflightCompressionThreshold to 0.75', () => {
        const config = Config.getInstance();
        expect(config.preflightCompressionThreshold).toBe(0.75);
    });

    it('should ignore compressionThreshold overrides from env var', () => {
        vi.stubEnv('COMPRESSION_THRESHOLD', '0.9');
        const config = Config.getInstance();
        expect(config.compressionThreshold).toBe(0.6); // Should remain code-defined 0.6
    });
});
