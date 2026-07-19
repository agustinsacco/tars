import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
    {
        ignores: ['**/dist/**', '**/node_modules/**', 'coverage/**', 'dash/**', 'site/**']
    },
    eslint.configs.recommended,
    ...tseslint.configs.recommended,
    {
        linterOptions: {
            reportUnusedDisableDirectives: 'error'
        },
        rules: {
            '@typescript-eslint/consistent-type-imports': [
                'error',
                { fixStyle: 'inline-type-imports', prefer: 'type-imports' }
            ],
            '@typescript-eslint/no-explicit-any': 'error',
            '@typescript-eslint/no-unused-vars': [
                'error',
                { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }
            ]
        }
    },
    {
        files: ['**/*.test.ts'],
        rules: {
            '@typescript-eslint/no-explicit-any': 'off',
            'no-control-regex': 'off'
        }
    },
    {
        files: ['scripts/**/*.mjs'],
        languageOptions: {
            globals: {
                console: 'readonly',
                process: 'readonly'
            }
        }
    },
    {
        files: [
            'src/channels/tui/tui-renderer.ts',
            'src/cli/commands/import.ts',
            'src/utils/attachment-processor.ts'
        ],
        rules: {
            'no-control-regex': 'off'
        }
    }
);
