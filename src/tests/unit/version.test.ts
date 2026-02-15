import { describe, it, expect } from 'vitest';
import { versionString, pkg, isDev } from '../../utils/version.js';

describe('Version Utility', () => {
    it('should have a valid version format', () => {
        expect(pkg.version).toMatch(/^\d+\.\d+\.\d+/);
    });

    it('should identify environment', () => {
        // In test environment, it should be dev mode unless we're running from node_modules
        expect(typeof isDev).toBe('boolean');
    });

    it('should format version string correctly', () => {
        if (isDev) {
            expect(versionString).toContain('(dev)');
        }
        expect(versionString).toContain(pkg.version);
    });
});
