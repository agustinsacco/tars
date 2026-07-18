import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        globals: true,
        environment: 'node',
        include: ['src/tests/**/*.test.ts'],
        coverage: {
            provider: 'v8',
            include: ['src/**/*.ts'],
            exclude: ['src/tests/**'],
            reporter: ['text', 'json-summary', 'html'],
            reportsDirectory: 'coverage',
            thresholds: {
                statements: 45,
                branches: 39,
                functions: 50,
                lines: 46
            }
        }
    }
});
