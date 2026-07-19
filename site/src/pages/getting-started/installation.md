---
layout: ../../layouts/DocLayout.astro
title: Installation
description: Install the Tars CLI and verify its runtime prerequisites.
section: Get Started
---

## Requirements

- Node.js 22.19 or newer
- npm 10.9 or newer
- A supported model API key or an OpenAI-compatible endpoint
- A Discord bot token when using the Discord channel

## Install from npm

```bash
npm install -g @saccolabs/tars
tars --version
```

The package includes the CLI, supervisor, built-in extensions, and optional dashboard assets. Tars
does not require Docker for its application runtime.

## Configure and start

```bash
tars setup
tars extensions audit
tars start
tars status
```

The setup wizard creates `~/.tars/`, stores non-secret settings in `config.json`, and stores
credentials in `.env` with restricted permissions. The supervisor is registered with PM2 as
`tars-supervisor`.

For terminal-only troubleshooting after setup:

```bash
tars chat --no-discord
```

This foreground mode does not connect Discord or start the dashboard, heartbeat, or cron service.

## Upgrade

Use `tars update` to stage, preflight, and install an available package update. Do not stop Tars
first; active processes are restarted after a successful update. If preflight pauses for a custom
extension policy, run `tars extensions migrate` and retry. No package or configuration is changed by
a paused preflight.

Use `tars refresh` only to rebuild the dashboard and built-in extensions from the package already
installed.
