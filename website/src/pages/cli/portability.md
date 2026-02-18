---
layout: ../../layouts/DocLayout.astro
title: Brain Portability
description: Exporting and importing Tars' complete state for backup or machine migration.
section: CLI Reference
---

## Overview

Tars' entire state — configuration, memory, tasks, session data, and extensions — lives in `~/.tars/`. The export/import commands create and restore compressed archives for backup or migration.

## tars export

Creates a compressed archive of `~/.tars/`:

```bash
tars export
```

### Output

```
📦 Exporting Tars brain to ./tars-brain-2025-01-15T10-30-00.tar.gz...

✅ Brain exported successfully!
Keep this file safe: /home/user/tars-brain-2025-01-15T10-30-00.tar.gz
```

### Custom Output Path

```bash
tars export --output /backup/tars-backup.tar.gz
```

### Excluded Directories

The archive automatically excludes heavy directories:

| Directory         | Reason                      |
| ----------------- | --------------------------- |
| `node_modules`    | Reinstalled via npm         |
| `dist`, `build`   | Regenerated from source     |
| `.next`, `.cache` | Build cache                 |
| `venv`, `.venv`   | Python virtual environments |
| `target`          | Rust build output           |
| `vendor`          | PHP/Go dependencies         |

## tars import

Restores a brain archive:

```bash
tars import /path/to/tars-brain-2025-01-15T10-30-00.tar.gz
```

The import process:

1. Extracts the archive to `~/.tars/`
2. Performs **automatic path re-homing** — updates any absolute paths in configuration files to match the new home directory
3. Restores all data: config, tasks, session, memory database, GEMINI.md, skills, and extensions

### Migration Workflow

Moving Tars to a new machine:

```bash
# On the old machine
tars export --output ~/tars-brain.tar.gz

# Transfer the file to the new machine
scp ~/tars-brain.tar.gz newmachine:~

# On the new machine
npm install -g @saccolabs/tars
tars import ~/tars-brain.tar.gz
tars start
```

The re-homing ensures paths like `/home/olduser/.tars/` are updated to `/home/newuser/.tars/`.
