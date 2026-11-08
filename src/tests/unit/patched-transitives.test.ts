import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const roots: string[] = [];
const versions = {
    'brace-expansion': ['5.0.9', '5.0.12'],
    protobufjs: ['7.5.0', '7.6.5'],
    undici: ['8.9.0', '8.12.4'],
    minimatch: ['10.2.5', '11.0.2']
};
const script = pathToFileURL(path.resolve('scripts/enforce-patched-transitives.mjs')).href;

function writePackage(directory: string, version: string) {
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, 'package.json'), JSON.stringify({ version }));
}

function fixture() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tars-patched-deps-'));
    roots.push(root);
    const pi = path.join(root, 'node_modules/@earendil-works/pi-coding-agent');
    writePackage(pi, '0.85.1');
    const packages: Record<string, Record<string, unknown>> = {};
    for (const [name, [oldVersion, patchedVersion]] of Object.entries(versions)) {
        const direct = `node_modules/${name}`;
        const nested = `node_modules/@earendil-works/pi-coding-agent/node_modules/${name}`;
        writePackage(path.join(root, direct), patchedVersion);
        writePackage(path.join(root, nested), oldVersion);
        packages[direct] = {
            version: patchedVersion,
            resolved: `https://registry.npmjs.org/${name}/-/${name}-${patchedVersion}.tgz`,
            integrity: `sha512-fixture-${name}`
        };
        packages[nested] = { version: oldVersion };
    }
    fs.writeFileSync(path.join(root, 'package-lock.json'), JSON.stringify({ packages }));
    return { root, pi };
}

function run(root: string, repairLockfile = false) {
    return execFileSync(
        process.execPath,
        [
            '--input-type=module',
            '--eval',
            `const { enforcePatchedTransitives } = await import(${JSON.stringify(script)}); enforcePatchedTransitives(${JSON.stringify(root)}, { repairLockfile: ${repairLockfile} });`
        ],
        { encoding: 'utf8', stdio: 'pipe' }
    );
}

function version(directory: string) {
    return JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8')).version;
}

afterEach(() => {
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe('pinned Pi transitive dependency repairs', () => {
    it('repairs installed dependencies and copies real lock metadata without upgrading Pi', () => {
        const { root, pi } = fixture();
        run(root, true);
        const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
        for (const [name, [, patched]] of Object.entries(versions)) {
            expect(version(path.join(pi, 'node_modules', name))).toBe(patched);
            expect(version(path.join(root, 'node_modules', name))).toBe(patched);
            expect(
                lock.packages[`node_modules/@earendil-works/pi-coding-agent/node_modules/${name}`]
            ).toEqual(lock.packages[`node_modules/${name}`]);
        }
        expect(version(pi)).toBe('0.85.1');
        const before = fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8');
        expect(run(root, true)).toBe('');
        expect(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8')).toBe(before);
    });

    it('normal postinstall fixes actual packages without rewriting the committed lockfile', () => {
        const { root, pi } = fixture();
        const before = fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8');
        run(root);
        expect(version(path.join(pi, 'node_modules/undici'))).toBe('8.12.4');
        expect(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8')).toBe(before);
    });

    it('validates all replacement versions before changing any nested package', () => {
        const { root, pi } = fixture();
        writePackage(path.join(root, 'node_modules/undici'), '8.9.0');
        expect(() => run(root)).toThrow('below the required patched version');
        expect(version(path.join(pi, 'node_modules/brace-expansion'))).toBe('5.0.9');
    });

    it('rejects lockfile repair without matching integrity metadata before changing packages', () => {
        const { root, pi } = fixture();
        const lockPath = path.join(root, 'package-lock.json');
        const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
        delete lock.packages['node_modules/undici'].integrity;
        fs.writeFileSync(lockPath, JSON.stringify(lock));
        expect(() => run(root, true)).toThrow('Missing matching registry lock metadata');
        expect(version(path.join(pi, 'node_modules/brace-expansion'))).toBe('5.0.9');
    });

    it('replaces a vulnerable symlink without traversing or deleting its target', () => {
        const { root, pi } = fixture();
        const oldTarget = path.join(root, 'old-undici');
        writePackage(oldTarget, '8.9.0');
        const nested = path.join(pi, 'node_modules/undici');
        fs.rmSync(nested, { recursive: true });
        fs.symlinkSync(oldTarget, nested, process.platform === 'win32' ? 'junction' : 'dir');
        run(root);
        expect(version(nested)).toBe('8.12.4');
        expect(version(oldTarget)).toBe('8.9.0');
    });
});
