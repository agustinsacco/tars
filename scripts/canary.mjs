import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tars-canary-'));
const source = path.join(root, 'source');
const destination = path.join(root, 'destination');
const archive = path.join(root, 'brain.tar.gz');
let canaryPm2;

try {
    process.env.PM2_HOME = path.join(root, 'pm2');
    const [{ exportBrain }, { importBrain }, pm2Module] = await Promise.all([
        import('../dist/cli/commands/export.js'),
        import('../dist/cli/commands/import.js'),
        import('pm2')
    ]);
    canaryPm2 = pm2Module.default;

    await fs.mkdir(path.join(source, 'data', 'memory'), { recursive: true });
    await fs.mkdir(path.join(source, 'extensions', 'custom', 'dist'), { recursive: true });
    await fs.mkdir(path.join(source, 'extensions', 'custom', 'node_modules', 'dependency'), {
        recursive: true
    });
    await fs.writeFile(
        path.join(source, 'metadata.json'),
        JSON.stringify({ lastAudit: new Date().toISOString(), version: '1.0.0-canary' })
    );
    await fs.writeFile(
        path.join(source, 'config.json'),
        JSON.stringify({ assistantName: 'Canary' })
    );
    await fs.writeFile(
        path.join(source, 'data', 'memory', 'facts.json'),
        JSON.stringify({
            facts: {
                canary: { key: 'canary', value: 'healthy', updatedAt: new Date().toISOString() }
            }
        })
    );
    await fs.writeFile(path.join(source, 'extensions', 'custom', 'dist', 'server.js'), '// ready');
    await fs.writeFile(
        path.join(source, 'extensions', 'custom', 'node_modules', 'dependency', 'index.js'),
        'export default true;'
    );

    process.env.TARS_HOME = source;
    await exportBrain({ output: archive });
    assert.equal((await fs.stat(archive)).mode & 0o777, 0o600);

    await fs.mkdir(destination);
    await fs.writeFile(
        path.join(destination, 'metadata.json'),
        JSON.stringify({ lastAudit: new Date().toISOString(), version: '1.0.0-previous' })
    );
    await fs.writeFile(path.join(destination, 'old.txt'), 'rollback sentinel');
    process.env.TARS_HOME = destination;

    const backupPath = await importBrain(archive);
    assert.ok(backupPath);
    assert.equal(await fs.readFile(path.join(backupPath, 'old.txt'), 'utf8'), 'rollback sentinel');
    assert.equal(
        await fs.readFile(
            path.join(
                destination,
                'extensions',
                'custom',
                'node_modules',
                'dependency',
                'index.js'
            ),
            'utf8'
        ),
        'export default true;'
    );
    const facts = JSON.parse(
        await fs.readFile(path.join(destination, 'data', 'memory', 'facts.json'), 'utf8')
    );
    assert.equal(facts.facts.canary.value, 'healthy');

    console.log(
        'Canary passed: export, staged import, offline artifact restore, and rollback backup.'
    );
} finally {
    if (canaryPm2) {
        await new Promise((resolve) => canaryPm2.killDaemon(() => resolve()));
        canaryPm2.disconnect();
    }
    delete process.env.TARS_HOME;
    delete process.env.PM2_HOME;
    await fs.rm(root, { recursive: true, force: true });
}

// PM2 retains internal sockets after its isolated daemon is removed. All assertions and cleanup
// have completed at this point, so terminate the standalone canary deterministically.
process.exit(0);
