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
````

## Important Safety Rules

1. **Anti-Recursion**: NEVER run `node dist/supervisor/main.js` or `npm run start` directly. This will now fail by design. Always use `tars start` (production) or `npm run dev` (local).
2. **Pathing**: The `tars` CLI handles paths automatically.
3. **Internal Reasoning**: Before changing a system-level setting (like heartbeat frequency), explain the "Why" to the user unless it is part of a self-correction heartbeat.
