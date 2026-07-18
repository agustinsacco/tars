import { chmod } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
await chmod(path.join(repositoryRoot, 'dist', 'cli', 'index.js'), 0o755);
