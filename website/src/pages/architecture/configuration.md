---
layout: ../../layouts/DocLayout.astro
title: Configuration
description: Configuration hierarchy, secrets management, and environment variables.
section: Architecture
---

## Overview

Tars uses a layered configuration system. Values are resolved in this priority order:

1. **Environment variables** (highest priority)
2. **`config.json`** settings
3. **Built-in defaults** (lowest priority)

## Config File

Located at `~/.tars/config.json`:

```json
{
    "discordToken": "...",
    "geminiModel": "auto",
    "heartbeatIntervalSec": 60
}
```

This file is created by `tars setup` and can be edited manually.

## All Configuration Fields

| Field                  | Env Variable             | Default | Description             |
| ---------------------- | ------------------------ | ------- | ----------------------- |
| `discordToken`         | `DISCORD_TOKEN`          | —       | Discord bot token       |
| `geminiModel`          | `GEMINI_MODEL`           | `auto`  | Gemini model to use     |
| `heartbeatIntervalSec` | `HEARTBEAT_INTERVAL_SEC` | `300`   | Heartbeat tick interval |

## Derived Paths

These are computed automatically from the home directory (`~/.tars`):

| Path               | Value                       |
| ------------------ | --------------------------- |
| `taskFilePath`     | `~/.tars/data/tasks.json`   |
| `sessionFilePath`  | `~/.tars/data/session.json` |
| `systemPromptPath` | `~/.tars/.gemini/system.md` |
| `memoryDbPath`     | `~/.tars/data/knowledge.db` |

## Secrets Management

Tars stores sensitive values in `~/.tars/.env` with **0o600 file permissions** (owner read/write only).

### CLI Interface

```bash
# Store a secret
tars secret set GITHUB_TOKEN ghp_abc123

# List stored secret keys (values are never shown)
tars secret list

# Remove a secret
tars secret remove GITHUB_TOKEN
```

### How Secrets Are Loaded

At startup, the `Config` constructor:

1. Instantiates `SecretsManager` with the home directory path
2. Reads all key-value pairs from `~/.tars/.env`
3. Loads them into `process.env` so they're available globally
4. The Gemini CLI subprocess inherits these environment variables

### File Format

The `.env` file uses standard dotenv format:

```
GITHUB_TOKEN="ghp_abc123"
DISCORD_TOKEN="MTI..."
```

Values with special characters are automatically escaped.

## Singleton Pattern

`Config` uses a singleton pattern via `Config.getInstance()`. It's instantiated once and shared across all services (Supervisor, HeartbeatService, DiscordBot, MemoryManager).
