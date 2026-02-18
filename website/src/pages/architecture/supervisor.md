---
layout: ../../layouts/DocLayout.astro
title: Supervisor
description: The core orchestrator that manages sessions, tasks, and Discord communication.
section: Architecture
---

## Overview

The `Supervisor` class is Tars' central orchestrator. It manages the Gemini CLI process, routes Discord messages, and coordinates background tasks through the Heartbeat service.

## Key Responsibilities

- **Session Lifecycle** — Creating, maintaining, and compacting Gemini CLI sessions
- **Message Routing** — Processing Discord prompts and streaming responses back
- **Task Execution** — Running scheduled tasks via the Heartbeat service
- **Context Hygiene** — Pruning turns and compacting sessions to prevent context bloat

## Core Methods

### `run(prompt, callback)`

The primary method for interactive prompts from Discord. It:

1. Acquires a processing lock (`isProcessing` flag) to prevent concurrent access
2. Passes the prompt to the `GeminiCli` wrapper
3. Streams events back to the callback (text chunks, errors, done signals)
4. Updates session usage stats after completion

```typescript
await supervisor.run('Check deployment status', async (event) => {
    if (event.type === 'text') console.log(event.content);
    if (event.type === 'done') console.log('Complete');
});
```

### `executeTask(prompt)`

Used by the Heartbeat for background task execution. Unlike `run()`, this uses `runSync()` which collects the full response and returns it as a string — no streaming.

### `pruneLastTurn()`

Removes the most recent conversation turn from the Gemini CLI session. Used after autonomousCheck when the AI responds with `SILENT_ACK` to prevent heartbeat noise from bloating the context window.

## Session Lock

The Supervisor uses an `isProcessing` boolean to prevent concurrent access to the Gemini CLI. If a second prompt arrives while the first is still processing, the caller gets a "busy" response.

## Startup Flow

When `tars start` launches the Supervisor, it runs these bootstrap functions in order:

1. **installSystemPrompt** — Deploys `system.md` to `~/.tars/.gemini/`
2. **installSkills** — Syncs built-in skills, preserves user skills
3. **installExtensions** — Validates and re-links extension symlinks
4. **installDefaultSettings** — Ensures `settings.json` exists
5. Initializes `SessionManager`, `MemoryManager`, `GeminiCli`
6. Starts `HeartbeatService`
7. Starts `DiscordBot`
