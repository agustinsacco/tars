---
layout: ../../layouts/DocLayout.astro
title: Heartbeat Service
description: The autonomous background loop that drives task execution and self-correction.
section: Architecture (Advanced)
---

## Overview

The `HeartbeatService` is Tars' autonomous background engine. It runs on a configurable interval (default: 60 seconds) and manages scheduled tasks, memory synchronization, and self-correcting health checks.

## The Tick Loop

Each tick follows this sequence:

1. **Cleanup** — `AttachmentProcessor.cleanup()` removes old temp files (1h) and uploads (24h)
2. **Memory Sync** — `MemoryManager.fullSync()` re-indexes the brain (GEMINI.md, skills, sessions)
3. **Load Tasks** — Reads `tasks.json` and filters for due tasks
4. **Execute** — If due tasks exist, run them. Otherwise, perform an autonomous check.

```
tick()
 ├── cleanup()           # Remove stale files
 ├── fullSync()          # Re-index knowledge
 ├── loadTasks()         # Read tasks.json
 ├── due tasks found?
 │   ├── YES → runTask() for each
 │   └── NO  → autonomousCheck()
 └── save updated tasks
```

## The SILENT_ACK Protocol

When no scheduled tasks are due, the heartbeat sends a special prompt to the AI to verify the system's state.

This interaction happens in an **Ephemeral Session**. It does not use the user's active conversation ID, which means background autonomous checks **never bloat your main context window** or interfere with your chat history.

Two outcomes:

- **SILENT_ACK response** — Everything is fine. The ephemeral session is discarded.
- **Any other response** — The AI detected something that needs attention. The action is logged and the Supervisor handles the resulting tool calls or notifications.

This creates a self-correcting feedback loop where the AI periodically reviews its own state and takes initiative when needed.

## Concurrency Guard

A boolean `isExecuting` flag prevents overlapping ticks. If a tick is still running when the next interval fires, it's skipped.

## Configuration

| Setting            | Default | Environment Variable     |
| ------------------ | ------- | ------------------------ |
| Heartbeat Interval | 300s    | `HEARTBEAT_INTERVAL_SEC` |

Adjust via `tars setup` or edit `~/.tars/config.json` directly.

Adjust via `tars setup` or edit `~/.tars/config.json` directly.
