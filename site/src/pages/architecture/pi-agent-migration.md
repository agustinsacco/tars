---
layout: ../../layouts/DocLayout.astro
title: Pi Agent SDK Migration Guide
description: Documentation of the Tars migration to the Pi Coding Agent SDK.
section: Architecture
---

## Background & Motivation

To support advanced coding capabilities, improve session longevity, and reduce maintenance overhead, Tars has transitioned its core execution engine from the legacy `@google/gemini-cli-core` package to the **Pi Coding Agent SDK** (`@earendil-works/pi-agent-core`, `@earendil-works/pi-ai`, and `@earendil-works/pi-coding-agent`).

This migration introduces a robust, industry-standard tool execution loop, native filesystem interactions, and automated workspace context management.

## Key Changes & Architecture Shift

### 1. Dependency Consolidation

All legacy Google companion CLI dependencies have been pruned. Tars now integrates with:

- `@earendil-works/pi-agent-core` (Agent orchestration and runtime stream events)
- `@earendil-works/pi-ai` (Model definitions and provider management)
- `@earendil-works/pi-coding-agent` (Native filesystem read/write, grep search, and bash shell execution)

### 2. Flatter Filesystem Layout

The operational layout has been simplified by deprecating nested `.gemini` directories. The workspace uses a flat directory structure under the user's home:

- **Old**: `~/.tars/.gemini/extensions/`
- **New**: `~/.tars/extensions/`
- Default settings, logs, and session files reside directly in `~/.tars/`.

### 3. Setup & Authentication Overhaul

- Deprecated the complex Google Consumer OAuth flow.
- Models and API credentials are now resolved via standard Pi config files (`~/.pi/agent/models.json` and `auth.json`).
- Automated migration managers hook into `tars setup` to safely upgrade legacy configurations and restore backups.

### 4. Custom MCP Adapter (`McpBridge`)

Since the Pi SDK uses a native `AgentTool` protocol, Tars implements `McpBridge`. It:

- Scans for symlinked or installed MCP extensions.
- Resolves dynamic parameters (e.g. replacing `${extensionPath}` with absolute paths).
- Translates MCP schemas into Zod validations.
- Marshals stdin/stdout JSON-RPC communication between the Pi Agent and local/remote MCP servers (like `tars-memory` and `tars-tasks`).

### 5. Context Compression & Limits

- Default context window size configured to **128,000 tokens**.
- Token compression threshold configured to **80,000 tokens**.
- If a session approaches the threshold, the supervisor automatically triggers the compaction layer to prevent context overflow while retaining historical summaries.

## Next Phase / Next Implementation

To build upon the Pi Agent SDK foundation, the next development cycles should focus on:

1. **Dynamic Token Telemetry**: Surface exact token usage metrics (current session, remaining context, window limit) directly on the Admin Dashboard and Discord status messages.
2. **Unified Coding Tools**: Expose the Pi Coding Agent tools directly to the interactive chat interface, allowing the bot to safely modify files or run diagnostic commands on permission.
3. **Advanced Tool Isolation**: Refine validation rules for shell-based tool invocations to ensure secure local execution.
