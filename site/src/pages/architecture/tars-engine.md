---
layout: ../../layouts/DocLayout.astro
title: Tars Engine Core
description: How Tars integrates with the Pi Agent SDK.
section: Architecture
---

## Overview

Tars core logic is built on top of the **Pi Agent SDK** (`@earendil-works/pi-agent-core` & `@earendil-works/pi-ai`). This provides native tool execution, built-in context window management, and robust streaming capabilities, completely replacing the deprecated Google companion core libraries.

## Integration Architecture

The `TarsEngine` class wraps the Pi SDK's `Agent` class to handle:

- **Session Lifecycle**: Initializing conversation state, loading messages, and managing prompt execution.
- **Model Inference**: Resolving the target model via `@earendil-works/pi-ai` and local credentials.
- **Tool Registration**: Converting and exposing local and MCP tools to the agent runner.

## Core Dependencies

Tars utilizes the following Pi SDK packages:

| Package                           | Purpose                                                                |
| --------------------------------- | ---------------------------------------------------------------------- |
| `@earendil-works/pi-agent-core`   | Core `Agent` class, streaming loop, and tool execution protocol.       |
| `@earendil-works/pi-ai`           | Model definition, providers configuration, and token count utilities.  |
| `@earendil-works/pi-coding-agent` | Native tools for workspace interaction (reading, writing, grep, etc.). |

## Extension & MCP Bridge

Because the Pi Agent SDK operates on a native `AgentTool` protocol, Tars implements a custom `McpBridge` (`src/supervisor/mcp-bridge.ts`).

1. **Discovery**: The bridge scans `~/.tars/extensions/` for active MCP configurations.
2. **Translation**: Converts each MCP server schema into a schema-valid Zod definition and native `AgentTool`.
3. **Execution**: Intercepts tool calls, forwards them to the underlying MCP server over Stdio, and returns the parsed output to the agent loop.

## Event Stream Mapping

The supervisor listens to the `Agent.subscribe()` stream and maps events into standard `TarsEngineEvent` payloads for consumption by the Discord channel and the Admin Dashboard:

- `assistantMessageEvent` text/thinking chunks are mapped to `text` events.
- Tool call execution starts and completions are monitored to update the in-progress status displays.
- Token metrics are extracted at completion and saved to the database.
