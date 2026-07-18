---
layout: ../../layouts/DocLayout.astro
title: Configuration
description: Validated sources, precedence, common settings, and local paths.
section: Architecture
---

## Precedence

Tars resolves configuration in this order:

1. values already exported in the process environment;
2. secrets from `~/.tars/.env`;
3. non-secret values in `~/.tars/config.json`;
4. built-in defaults.

Loading `.env` never replaces an already exported value. Configuration files are parsed through a
schema, and numeric intervals, context sizes, thresholds, and rate limits are bounded.

## Common settings

| JSON                            | Environment                       | Purpose                    |
| ------------------------------- | --------------------------------- | -------------------------- |
| `assistantName`                 | `ASSISTANT_NAME`                  | Display identity           |
| `piProvider`                    | `PI_PROVIDER`                     | Model provider             |
| `piModel`                       | `PI_MODEL`                        | Provider model ID          |
| `piBaseUrl`                     | `PI_BASE_URL`                     | Compatible custom endpoint |
| `heartbeatIntervalSec`          | `HEARTBEAT_INTERVAL_SEC`          | Maintenance cadence        |
| `contextWindowTokens`           | `CONTEXT_WINDOW_TOKENS`           | Actual model context limit |
| `compressionThreshold`          | `COMPRESSION_THRESHOLD`           | Normal compression trigger |
| `preflightCompressionThreshold` | `PREFLIGHT_COMPRESSION_THRESHOLD` | Before-request trigger     |
| `channels.discord.enabled`      | —                                 | Explicit channel toggle    |
| `channels.discord.ownerId`      | `DISCORD_OWNER_ID`                | Authorized Discord owner   |

Provider credentials and `DISCORD_TOKEN` belong in `.env` through `tars secret set`, not in
`config.json`. An explicit `channels.discord.enabled: false` takes precedence over a configured
token.

## Filesystem layout

`TARS_HOME` defaults to `~/.tars/` and contains `config.json`, `.env`, `settings.json`, `system.md`,
`skills/`, `extensions/`, `chats/`, `tmp/`, `logs/`, and `data/`. Task, session, knowledge, facts, and
notes state are under `data/`.

Changing `TARS_HOME` changes the entire installation boundary. Never point it at `/`, the OS home,
a repository, or a directory shared with another running instance.
