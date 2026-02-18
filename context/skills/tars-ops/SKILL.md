---
name: tars-ops
description: Operational manual for Tars self-management and configuration.
---

# Tars Operational Guide

Use this skill when you need to change Tars' configuration, manage secrets, or perform system maintenance.

## Core Commands

Always use the built binary path from the repository warning: `tars` or `npm run dev`.

### Configuration (Secrets & Env)

Tars stores its configuration (Discord tokens, API keys, intervals) in `~/.tars/.env`. Use the `secret` command to safely modify these.

```bash
# Set a configuration value
tars secret set <KEY> <VALUE>

# List keys (values are hidden)
tars secret list

# Remove a setting
tars secret remove <KEY>
```

**Common Keys:**

- `HEARTBEAT_INTERVAL_SEC`: Frequency of autonomous checks (default 300).
- `GEMINI_MODEL`: The primary model to use.
- `DISCORD_TOKEN`: Bot authentication.

### Applying Changes (Restart)

Most configuration changes (like heartbeat intervals) require a supervisor restart.

````bash
```bash
# In development (restart)
npm run dev

# Or using the global CLI
tars stop && tars start
````

````

### Knowledge Management

Use the `memory` command to search or manually trigger a sync of the long-term knowledge base.

```bash
# Search memory
tars memory search "query"

# Force a full sync of GEMINI.md and skills into the FTS index
tars memory sync
```

## Self-Maintenance (Data Hygiene)

### 1. Log Pruning
Tars generates logs in `~/.tars/logs/`. These are crucial for debugging recent issues but unnecessary to keep forever.
*   **Policy**: Keep logs for the last 7 days.
*   **Command**: `find ~/.tars/logs -type f -mtime +7 -delete`

### 2. Upload Cleanup
Files uploaded to `~/.tars/data/uploads/` are temporary staging for processing.
*   **Policy**: Remove uploads older than 24 hours.
*   **Command**: `find ~/.tars/data/uploads -type f -mtime +1 -delete`

### 3. History Management
The `~/.tars/.gemini/history/` directory contains raw JSON conversation logs. These grow rapidly.
*   **Policy**: Keep the most recent 100 conversation logs.
*   **Command**: `ls -t ~/.tars/.gemini/history/*.json | tail -n +101 | xargs -I {} rm {}` (Be careful with xargs; ensure filenames don't have special characters, or use `find` by time if preferred).

### 4. Anomaly Detection
Occasionally, bugs in code may create recursive directories (like `~/.tars/.tars` or `~/.tars/~`).
*   **Policy**: Check for and remove these specific anomalies if found.
*   **Command**: `rm -rf ~/.tars/.tars ~/.tars/\~``

## Important Safety Rules

1. **Anti-Recursion**: NEVER run `node dist/supervisor/main.js` or `npm run start` directly. This will now fail by design. Always use `tars start` (production) or `npm run dev` (local).
2. **Pathing**: The `tars` CLI handles paths automatically.
3. **Internal Reasoning**: Before changing a system-level setting (like heartbeat frequency), explain the "Why" to the user unless it is part of a self-correction heartbeat.
````
