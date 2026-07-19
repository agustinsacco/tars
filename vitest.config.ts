import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        globals: true,
        environment: 'node',
        // node:sqlite is still marked experimental in the supported Node 22 runtime.
        execArgv: ['--disable-warning=ExperimentalWarning'],
        include: ['src/tests/**/*.test.ts'],
        coverage: {
            provider: 'v8',
            include: ['src/**/*.ts'],
            exclude: ['src/tests/**'],
            reporter: ['text', 'json-summary', 'html'],
            reportsDirectory: 'coverage',
            thresholds: {
                statements: 49,
                branches: 42,
                functions: 57,
                lines: 51
            }
        }
    }
});
