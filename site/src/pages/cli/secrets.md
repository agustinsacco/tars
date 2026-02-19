---
layout: ../../layouts/DocLayout.astro
title: Secrets Management
description: Securely storing and managing platform credentials.
section: CLI Reference
---

## Overview

Tars provides a built-in secrets manager for storing sensitive values like API keys and tokens. Secrets are stored locally with restricted file permissions.

## Commands

### Set a Secret

```bash
tars secret set GITHUB_TOKEN ghp_abc123def456
```

Stores the key-value pair in `~/.tars/.env`. The supervisor must be restarted to pick up new secrets.

### List Secrets

```bash
tars secret list
```

Displays all stored secret **keys only** — values are never shown:

```
🔒 Stored Secrets (Keys only)
──────────────────────────
- DISCORD_TOKEN
- GITHUB_TOKEN
- OPENAI_API_KEY
```

### Remove a Secret

```bash
tars secret remove GITHUB_TOKEN
```

Deletes the key-value pair from the `.env` file.

## Security

### File Permissions

The `.env` file is written with **`0o600` permissions** (owner read/write only). This prevents other users on the system from reading your secrets.

### Storage Format

Standard dotenv format with escaped quotes:

```
GITHUB_TOKEN="ghp_abc123def456"
DISCORD_TOKEN="MTI..."
```

### Environment Loading

At supervisor startup:

1. `SecretsManager.load()` reads `~/.tars/.env`
2. All key-value pairs are injected into `process.env`
3. The Gemini CLI subprocess inherits these environment variables
4. Tars (and its extensions) can access secrets via `process.env.KEY_NAME`

This means secrets are available to both Tars and any MCP extensions it runs.
