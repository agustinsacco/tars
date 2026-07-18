import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { createRequire } from 'module';
import { afterEach, describe, expect, it, vi } from 'vitest';

interface PathResolution {
    path?: string;
    status: number;
}

interface AuthRateLimiter {
    isBlocked(clientKey: string): boolean;
    recordFailure(clientKey: string): void;
    reset(clientKey: string): void;
}

interface DashboardSecurity {
    createAuthRateLimiter(): AuthRateLimiter;
    isAuthorized(authHeader: string | undefined, expectedPassword: string): boolean;
    parseDashboardPort(value: string): number;
    readTextPreview(filePath: string): {
        content?: string;
        maxBytes?: number;
        size: number;
        status: number;
    };
    resolveReadablePath(rootPath: string, requestedPath: unknown): PathResolution;
    validateDashboardPassword(password: string | undefined): void;
}

const require = createRequire(import.meta.url);
const dashboardSecurity: DashboardSecurity = require(path.join(process.cwd(), 'dash', 'server.js'));
const temporaryDirectories: string[] = [];

async function makeTemporaryDirectory(): Promise<string> {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'tars-dashboard-test-'));
    temporaryDirectories.push(directory);
    return directory;
}

afterEach(async () => {
    // ARRANGE
    vi.resetAllMocks();

    // ACT
    await Promise.all(
        temporaryDirectories
            .splice(0)
            .map((directory) => fs.rm(directory, { recursive: true, force: true }))
    );
});

describe('dashboard security helpers', () => {
    it.each([undefined, '', '   ', 'changeme', ' tars123 ', 'too-short'])(
        'rejects an unsafe dashboard password (%s)',
        (password) => {
            // ARRANGE / ACT / ASSERT
            expect(() => dashboardSecurity.validateDashboardPassword(password)).toThrow(
                /configure a strong DASH_PASSWORD/
            );
        }
    );

    it('accepts valid dashboard ports and rejects named-pipe or out-of-range values', () => {
        // ARRANGE / ACT / ASSERT
        expect(dashboardSecurity.parseDashboardPort('3000')).toBe(3000);
        expect(() => dashboardSecurity.parseDashboardPort('dashboard.sock')).toThrow(/DASH_PORT/);
        expect(() => dashboardSecurity.parseDashboardPort('70000')).toThrow(/DASH_PORT/);
    });

    it('accepts only matching Basic credentials', () => {
        // ARRANGE
        const expectedPassword = 'long-random-dashboard-password';
        const valid = `Basic ${Buffer.from(`admin:${expectedPassword}`).toString('base64')}`;
        const invalid = `Basic ${Buffer.from('admin:wrong-password').toString('base64')}`;

        // ACT
        const validResult = dashboardSecurity.isAuthorized(valid, expectedPassword);
        const invalidResult = dashboardSecurity.isAuthorized(invalid, expectedPassword);

        // ASSERT
        expect(validResult).toBe(true);
        expect(invalidResult).toBe(false);
    });

    it('blocks a client after repeated authentication failures and permits reset', () => {
        // ARRANGE
        const limiter = dashboardSecurity.createAuthRateLimiter();

        // ACT
        for (let attempt = 0; attempt < 5; attempt += 1) {
            limiter.recordFailure('client');
        }

        // ASSERT
        expect(limiter.isBlocked('client')).toBe(true);
        limiter.reset('client');
        expect(limiter.isBlocked('client')).toBe(false);
    });

    it('allows ordinary files but denies traversal, credentials, and escaping symlinks', async () => {
        // ARRANGE
        const root = await makeTemporaryDirectory();
        const outside = await makeTemporaryDirectory();
        await fs.writeFile(path.join(root, 'notes.txt'), 'safe');
        await fs.writeFile(path.join(root, '.env'), 'TOKEN=secret');
        await fs.writeFile(path.join(root, 'config.json'), '{}');
        await fs.writeFile(path.join(outside, 'outside.txt'), 'unsafe');
        await fs.symlink(path.join(outside, 'outside.txt'), path.join(root, 'escape.txt'));

        // ACT
        const ordinary = dashboardSecurity.resolveReadablePath(root, 'notes.txt');
        const traversal = dashboardSecurity.resolveReadablePath(root, '../outside.txt');
        const environment = dashboardSecurity.resolveReadablePath(root, '.env');
        const config = dashboardSecurity.resolveReadablePath(root, 'config.json');
        const escapingLink = dashboardSecurity.resolveReadablePath(root, 'escape.txt');

        // ASSERT
        expect(ordinary.status).toBe(200);
        expect(traversal.status).toBe(403);
        expect(environment.status).toBe(403);
        expect(config.status).toBe(403);
        expect(escapingLink.status).toBe(403);
    });

    it('refuses to load oversized files into the dashboard process', async () => {
        // ARRANGE
        const root = await makeTemporaryDirectory();
        const largeFile = path.join(root, 'large.txt');
        await fs.writeFile(largeFile, Buffer.alloc(2 * 1024 * 1024 + 1));

        // ACT
        const preview = dashboardSecurity.readTextPreview(largeFile);

        // ASSERT
        expect(preview).toMatchObject({ status: 413, size: 2 * 1024 * 1024 + 1 });
        expect(preview.content).toBeUndefined();
    });
});
