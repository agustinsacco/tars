---
layout: ../../layouts/DocLayout.astro
title: Gemini Native Core
description: How Tars integrates directly with the Gemini CLI Core library.
section: Architecture
---

## Overview

Tars has transitioned from a CLI-based wrapper to a **bare-metal Node.js integration** using the `@google/gemini-cli-core` library. This eliminates subprocess overhead, improves event streaming reliability, and allows for deeper integration with the Gemini ecosystem.

## Integration Architecture

The `GeminiEngine` class acts as the bridge between Tars and the Gemini Core. It manages the lifecycle of the `GeminiClient` and handles session initialization, authentication, and tool discovery.

## Environment & Discovery

Tars maintains an isolated environment in `~/.tars/.gemini/`. During initialization, the engine performs the following:

1.  **Extension Discovery**: Scans `~/.tars/.gemini/extensions/` for `gemini-extension.json` files.
2.  **Path Resolution**: Automatically resolves `${extensionPath}` placeholders in extension configurations to ensure MCP servers start correctly.
3.  **Folder Trust**: Configures the Core library to trust the Tars home directory, enabling privileged tool execution.

## Event Stream

The engine exposes a streaming interface that emits typed events directly from the Core library:

| Event Type   | Description                          |
| ------------ | ------------------------------------ |
| `text`       | A chunk of the AI's text response    |
| `tool_call`  | Tool invocation (MCP extension call) |
| `tool_response` | Tool execution result             |
| `error`      | An error from the Core library       |
| `done`       | Stream complete (includes usage stats)|

### Session Management

Sessions are managed natively by the Core library. Tars tracks the `sessionId` and persists it via `SessionManager`. This ensures that conversation history is preserved across restarts without manual file surgery.

## Tool Discovery

Extensions are loaded via the `SimpleExtensionLoader`. Once registered, the Core library automatically discovers and integrates all tools defined in the extensions' MCP servers. This is how Tars gains capabilities like `tars-memory` and `tars-tasks`.

## Synchronous Execution

For background tasks (like memory indexing or health checks), the engine provides a `runSync(prompt)` method that returns the full text response once completion is reached, simplifying logic for non-interactive routines.
