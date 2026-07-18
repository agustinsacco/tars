import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { getTarsHome } from '../../utils/paths.js';

describe('Tars home path safety', () => {
    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it('normalizes a configured data directory to an absolute path', () => {
        vi.stubEnv('TARS_HOME', path.join('.', 'tmp', 'tars-data'));

        expect(getTarsHome()).toBe(path.resolve('tmp', 'tars-data'));
    });

    it('rejects a filesystem root', () => {
        vi.stubEnv('TARS_HOME', path.parse(process.cwd()).root);

        expect(() => getTarsHome()).toThrow(/filesystem root/);
    });

    it('rejects the user home directory', () => {
        vi.stubEnv('TARS_HOME', os.homedir());

        expect(() => getTarsHome()).toThrow(/user home directory/);
    });

    it('rejects REAL_HOME when a launcher has rewritten HOME', () => {
        const realHome = path.join(os.tmpdir(), 'protected-real-home');
        vi.stubEnv('REAL_HOME', realHome);
        vi.stubEnv('TARS_HOME', realHome);

        expect(() => getTarsHome()).toThrow(/user home directory/);
    });
});
