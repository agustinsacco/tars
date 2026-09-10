---
layout: ../../layouts/DocLayout.astro
title: Setup Wizard
description: Configure a model provider, Discord, identity, and optional local services.
section: Get Started
---

Run the interactive wizard after installation:

```bash
tars setup
```

## Model provider

The first step offers every provider in the pi model registry (OpenAI Codex/ChatGPT, Anthropic,
OpenAI, Google, GitHub Copilot, OpenRouter, and more) plus local and custom OpenAI-compatible
endpoints. For the selected provider the wizard shows which sign-in methods exist and whether you
are already signed in:

- **OAuth** — providers with a native pi OAuth flow (ChatGPT Plus/Pro, Claude Pro/Max, GitHub
  Copilot) open a browser sign-in and store the token in `~/.tars/auth.json`.
- **API key** — any other registry provider stores the key in `~/.tars/auth.json`.
- **Import from pi** — if you already signed in with the standalone `pi` CLI, the wizard offers to
  copy that credential.

After credentials are confirmed the wizard discovers the models your account can use and lets you
pick one from the list. Reasoning-capable models then ask for a thinking level (`off`, `minimal`,
`low`, `medium`, `high`, `xhigh`, `max`; `medium` is suggested). The context window is taken from
the model catalog.

Local and custom endpoints ask for the base URL and an optional key, query the endpoint's `/models`
listing, and fall back to manual model entry when the endpoint does not list models.

Change the provider or model later without repeating the rest of the wizard:

```bash
tars model
tars model --provider openai-codex --model gpt-5.6-luna --thinking medium
tars restart
```

Tars validates and bounds context, compression, rate-limit, and heartbeat values when configuration
loads.

## Discord

Provide a Discord bot token with Message Content intent enabled and your 17–20 digit Discord user
ID. The wizard requires that owner ID and stores it in `config.json`. Tars accepts messages only from
the preconfigured owner; if a migrated configuration has no owner ID, every Discord message is
ignored until you rerun `tars setup` or set `DISCORD_OWNER_ID`. No direct or guild message can claim
ownership. An explicit `channels.discord.enabled: false` keeps the channel disabled even when a
token is configured.

See [Discord](/getting-started/discord) for bot permissions and interaction behavior.

## Dashboard

The dashboard is optional and disabled by default. Enabling it creates a strong password unless an
existing password already meets the current policy. It binds to `127.0.0.1` by default and refuses to
start with a missing, known-default, or shorter-than-16-character password.

Keep it on loopback and use an authenticated tunnel for remote access.

## Extensions

Setup refreshes the bundled extensions and audits enabled custom MCP policies. If an older custom
extension lacks an explicit environment allowlist, setup opens the guided migration. Review every
suggested variable name; suggestions come from extension source and are not automatically trusted.

You can repeat the read-only check at any time:

```bash
tars extensions audit
```

## Verify

```bash
tars extensions audit
tars start
tars status
tars logs
```

`status` confirms the PM2 process and session metrics. Use logs to inspect channel, extension,
heartbeat, or cron startup.
