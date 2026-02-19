---
layout: ../../layouts/DocLayout.astro
title: MCP Extensions
description: How extensions provide tool-level capabilities to Tars through the Model Context Protocol.
section: Extensibility
---

## Overview

Extensions are **MCP (Model Context Protocol) servers** that expose tools to the Gemini CLI. They run as separate processes and communicate via stdio, allowing Tars to interact with external systems, manage data, and extend its own capabilities.

## How Extensions Work

1. Extension is registered in `~/.tars/.gemini/extensions/`
2. Gemini CLI discovers the extension via `gemini-extension.json`
3. When the AI needs a tool, Gemini CLI spawns the extension process
4. The extension receives a JSON-RPC request and returns a response

## Extension Structure

Each extension is an npm package with a manifest:

```json
// gemini-extension.json
{
    "name": "tars-tasks",
    "version": "1.0.0",
    "description": "Task scheduling for Tars",
    "tools": {
        "command": "node",
        "args": ["dist/server.js"]
    }
}
```

## Installation

Extensions are installed as **symlinks** from the repository to the Tars home:

```
~/.tars/.gemini/extensions/tars-tasks → /path/to/tars/extensions/tasks
```

### Auto-Installation on Startup

The `installExtensions()` function in `main.ts`:

1. Scans the repository's `extensions/` directory
2. For each extension, checks if a symlink exists in `~/.tars/.gemini/extensions/`
3. If missing or broken, creates a new symlink
4. Validates the symlink target still exists

### Extension Enablement

Extensions must be listed in `~/.tars/.gemini/extensions/extension-enablement.json`:

```json
{
    "tars-tasks": true
}
```

This file is managed by the bootstrap process.

## Creating Custom Extensions

Tars can create new MCP extensions through its `create-extension` skill. The AI generates:

- A TypeScript MCP server with tool definitions
- A `gemini-extension.json` manifest
- An npm `package.json` with dependencies
- Automatic symlinking to the extensions directory

## Built-in Extensions

| Extension    | Tools | Description                    |
| ------------ | ----- | ------------------------------ |
| `tars-tasks` | 5     | Task scheduling and management |

See the [tars-tasks Extension](/extensions/tars-tasks) page for details.
