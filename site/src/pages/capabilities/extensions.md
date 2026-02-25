---
layout: ../../layouts/DocLayout.astro
title: Tools & Extensions
description: How extensions provide tool-level capabilities to Tars through the Model Context Protocol.
section: Capabilities
---

## Overview

Extensions are **MCP (Model Context Protocol) servers** that expose tools to Tars. They run as separate processes and communicate via stdio, allowing Tars to interact with external systems, manage files, and extend its own intelligence.

## How Extensions Work

1.  **Engine Initialization**: During startup, `GeminiEngine` scans `~/.tars/.gemini/extensions/` for `gemini-extension.json` files.
2.  **Manifest Parsing**: The engine converts the manifest into an internal `MCPServerConfig`, resolving `${extensionPath}` tokens to absolute paths.
3.  **Discovery**: High-level tools from all enabled extensions are merged into the Gemini Core's tool definition list.
4.  **Execution**: When the AI invokes a tool, the Core library manages the stdio connection to the extension's binary (e.g., `node server.js`).

## Extension Structure

Each extension is an npm package with a manifest:

```json
// gemini-extension.json
{
    "name": "tars-tasks",
    "version": "1.0.0",
    "mcpServers": {
        "main": {
            "command": "node",
            "args": ["${extensionPath}/dist/server.js"],
            "env": { "TARS_HOME": "~/.tars" }
        }
    }
}
```

## Deployment & Sync

Tars manages extensions through its internal bootstrap process:

- **Built-in Extensions**: Source code from the repository's `extensions/` directory is **copied** to `~/.tars/.gemini/extensions/` on startup.
- **Runtime Extensions**: Created via the `extension-builder` skill directly in the target directory.

### Extension Enablement

Extensions must be authorized in `~/.tars/.gemini/extensions/extension-enablement.json`. Tars uses this file to manage security overrides:

```json
{
    "tars-tasks": { "overrides": ["*"] },
    "tars-memory": { "overrides": ["*"] }
}
```

## Creating Custom Extensions

Tars is capable of self-modifying its own toolset via the `extension-builder` skill. The process involves:

1.  Generating a plain JavaScript MCP server using `@modelcontextprotocol/sdk`.
2.  Creating the `gemini-extension.json` manifest with relative path tokens.
3.  Registering the new extension in the enablement configuration.

## Core Extensions

| Extension     | Tools | Description                                    |
| ------------- | ----- | ---------------------------------------------- |
| `tars-tasks`  | 5     | Goal-oriented task scheduling and management   |
| `tars-memory` | 5     | Fact storage, daily logs, and knowledge search |

Detailed documentation for each can be found in the [Extensions section](/extensions/tars-tasks).
