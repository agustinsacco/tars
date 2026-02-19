---
layout: ../../layouts/DocLayout.astro
title: Installation
description: Prerequisites and global installation of Tars.
section: Get Started
---

## Prerequisites

- **Node.js** ≥ 22.0.0 (required for native SQLite and ES module support)
- **Gemini CLI** — the Google AI command-line interface

Install Gemini CLI if you haven't already:

```bash
npm install -g @google/gemini-cli
```

## Install Tars

Install globally via npm:

```bash
npm install -g @saccolabs/tars
```

This installs the `tars` CLI binary, which acts as a wrapper around PM2 for process management.

## What Gets Installed

The npm package includes:

| Component       | Description                                                                 |
| --------------- | --------------------------------------------------------------------------- |
| `tars` CLI      | Entry point for all commands (`start`, `stop`, `setup`, etc.)               |
| System Prompt   | Custom persona prompt installed to `~/.tars/.gemini/system.md`              |
| Built-in Skills | `tars-ops`, `create-extension`, `create-skill` in `~/.tars/.gemini/skills/` |
| MCP Extensions  | `tars-tasks` symlinked to `~/.tars/.gemini/extensions/`                     |

## Verify Installation

```bash
tars --version
```

## Next Steps

Run the [Setup Wizard](/getting-started/setup) to configure authentication and connect your Discord bot.
