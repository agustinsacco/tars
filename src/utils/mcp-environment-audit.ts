import fs from 'node:fs';
import path from 'node:path';

const MAX_SCANNED_FILES = 250;
const MAX_SCANNED_ENTRIES = 5_000;
const MAX_SCANNED_FILE_BYTES = 1024 * 1024;
const SOURCE_EXTENSIONS = new Set(['.cjs', '.js', '.jsx', '.mjs', '.ts', '.tsx']);
const IGNORED_DIRECTORIES = new Set([
    '.git',
    '.next',
    '__tests__',
    'coverage',
    'node_modules',
    'test',
    'tests'
]);
const IMPLICIT_ENVIRONMENT_NAMES = new Set([
    'HOME',
    'PATH',
    'SHELL',
    'SystemRoot',
    'TARS_HOME',
    'TERM',
    'TMPDIR',
    'USER',
    'WINDIR'
]);

export interface EnvironmentReferenceScan {
    readonly names: readonly string[];
    readonly truncated: boolean;
}

interface MutableScanState {
    readonly names: Set<string>;
    scannedEntries: number;
    scannedFiles: number;
    truncated: boolean;
}

function scanSourceFile(filePath: string, state: MutableScanState): void {
    if (state.scannedFiles >= MAX_SCANNED_FILES) {
        state.truncated = true;
        return;
    }

    try {
        const stats = fs.statSync(filePath);
        if (!stats.isFile() || stats.size > MAX_SCANNED_FILE_BYTES) return;
        state.scannedFiles += 1;
        const source = fs.readFileSync(filePath, 'utf8');
        const references = source.matchAll(
            /\bprocess\.env(?:\.([A-Za-z_][A-Za-z0-9_]*)|\[\s*['"]([A-Za-z_][A-Za-z0-9_]*)['"]\s*\])/g
        );
        for (const reference of references) {
            const name = reference[1] ?? reference[2];
            if (name) state.names.add(name);
        }
    } catch {
        // Suggestions are best-effort. The policy audit remains authoritative without them.
    }
}

function scanDirectory(directoryPath: string, state: MutableScanState): void {
    if (state.truncated) return;

    let entries: fs.Dirent[];
    try {
        entries = fs
            .readdirSync(directoryPath, { withFileTypes: true })
            .sort((left, right) => left.name.localeCompare(right.name));
    } catch {
        return;
    }

    for (const entry of entries) {
        state.scannedEntries += 1;
        if (state.scannedFiles >= MAX_SCANNED_FILES || state.scannedEntries > MAX_SCANNED_ENTRIES) {
            state.truncated = true;
            return;
        }
        if (entry.isSymbolicLink()) continue;

        const entryPath = path.join(directoryPath, entry.name);
        if (entry.isDirectory()) {
            if (!IGNORED_DIRECTORIES.has(entry.name)) scanDirectory(entryPath, state);
            continue;
        }
        if (entry.isFile() && SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
            scanSourceFile(entryPath, state);
        }
    }
}

export function scanExtensionEnvironmentReferences(
    extensionPath: string,
    excludedNames: readonly string[] = []
): EnvironmentReferenceScan {
    const state: MutableScanState = {
        names: new Set<string>(),
        scannedEntries: 0,
        scannedFiles: 0,
        truncated: false
    };
    scanDirectory(extensionPath, state);

    const excluded = new Set([...IMPLICIT_ENVIRONMENT_NAMES, ...excludedNames]);
    return {
        names: [...state.names].filter((name) => !excluded.has(name)).sort(),
        truncated: state.truncated
    };
}
