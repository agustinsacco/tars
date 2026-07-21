import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { type Config } from '../../config/config.js';
import { TarsDoctor } from '../../maintenance/doctor.js';

const temporaryDirectories: string[] = [];
const previousPm2Home = process.env.PM2_HOME;

afterEach(() => {
    if (previousPm2Home === undefined) delete process.env.PM2_HOME;
    else process.env.PM2_HOME = previousPm2Home;
    for (const directory of temporaryDirectories.splice(0)) {
        fs.rmSync(directory, { force: true, recursive: true });
    }
});

function createConfig(homeDir: string): Config {
    return {
        configFilePath: path.join(homeDir, 'config.json'),
        homeDir,
        sessionFilePath: path.join(homeDir, 'data', 'session.json'),
        taskFilePath: path.join(homeDir, 'data', 'tasks.json')
    } as Config;
}

describe('TarsDoctor', () => {
    it('reports blocked extensions, literal secrets, silent reminders, and unsafe permissions', async () => {
        // ARRANGE
        const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tars-doctor-'));
        temporaryDirectories.push(homeDir);
        process.env.PM2_HOME = path.join(homeDir, 'pm2');
        const config = createConfig(homeDir);
        const extensionPath = path.join(homeDir, 'extensions', 'custom-health');
        fs.mkdirSync(extensionPath, { recursive: true });
        fs.writeFileSync(
            path.join(homeDir, 'extensions', 'extension-enablement.json'),
            JSON.stringify({ 'custom-health': true }),
            { mode: 0o644 }
        );
        fs.writeFileSync(
            path.join(extensionPath, 'tars-extension.json'),
            JSON.stringify({
                name: 'custom-health',
                mcpServers: {
                    health: {
                        command: 'node',
                        env: { HEALTH_API_KEY: 'literal-secret' }
                    }
                }
            })
        );
        fs.mkdirSync(path.dirname(config.taskFilePath), { recursive: true });
        fs.writeFileSync(
            config.taskFilePath,
            JSON.stringify([
                {
                    createdAt: new Date().toISOString(),
                    enabled: true,
                    failedCount: 0,
                    id: 'birthday',
                    mode: 'silent',
                    nextRun: new Date(Date.now() + 60_000).toISOString(),
                    prompt: 'Remind me on Discord.',
                    schedule: '0 9 * * *',
                    source: 'user',
                    title: 'Birthday reminder',
                    updatedAt: new Date().toISOString()
                }
            ]),
            { mode: 0o644 }
        );

        // ACT
        const report = await new TarsDoctor(config).run();

        // ASSERT
        expect(report.status).toBe('critical');
        expect(report.findings.map(({ id }) => id)).toEqual(
            expect.arrayContaining([
                'extensions.policy.custom-health.health',
                'security.extension-secret.custom-health',
                'tasks.silent-reminder.birthday',
                'security.sensitive-file-permissions'
            ])
        );
        expect(JSON.stringify(report)).not.toContain('literal-secret');
    });
});
