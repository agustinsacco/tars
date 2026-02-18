---
layout: ../../layouts/DocLayout.astro
title: tars-tasks Extension
description: The built-in MCP server for creating, managing, and scheduling autonomous tasks.
section: Extensibility
---

## Overview

`tars-tasks` is Tars' built-in MCP extension that provides task scheduling capabilities. It exposes 5 tools that the AI can call through natural language.

## Tools

### create_task

Creates a new scheduled task.

| Parameter  | Type   | Required | Description                         |
| ---------- | ------ | -------- | ----------------------------------- |
| `title`    | string | ✓        | Human-readable task name            |
| `prompt`   | string | ✓        | The prompt to execute               |
| `schedule` | string | ✓        | Cron expression or ISO date         |
| `mode`     | string | —        | `silent` (default) or `interactive` |

```
"Schedule a daily check of my GitHub notifications at 9 AM"
→ create_task("GitHub Notifications", "Check my GitHub...", "0 9 * * *")
```

### list_tasks

Lists all tasks with optional filtering.

| Parameter     | Type    | Required | Description             |
| ------------- | ------- | -------- | ----------------------- |
| `enabledOnly` | boolean | —        | Only show enabled tasks |

Returns: task ID, title, schedule, next run, enabled status, and failure count.

### delete_task

Permanently removes a task.

| Parameter | Type   | Required | Description |
| --------- | ------ | -------- | ----------- |
| `id`      | string | ✓        | Task UUID   |

### toggle_task

Enables or disables a task without deleting it.

| Parameter | Type    | Required | Description       |
| --------- | ------- | -------- | ----------------- |
| `id`      | string  | ✓        | Task UUID         |
| `enabled` | boolean | ✓        | New enabled state |

### modify_task

Updates task properties.

| Parameter  | Type   | Required | Description          |
| ---------- | ------ | -------- | -------------------- |
| `id`       | string | ✓        | Task UUID            |
| `title`    | string | —        | New title            |
| `prompt`   | string | —        | New prompt           |
| `schedule` | string | —        | New cron or ISO date |

## Storage

Tasks are stored in `~/.tars/data/tasks.json` as a JSON array. The extension reads and writes this file directly using the `TaskStore` class.

## Architecture

The extension runs as a standalone Node.js MCP server using `@modelcontextprotocol/sdk`:

```
StdioServerTransport → Server → Tool Handlers → TaskStore → tasks.json
```

The Gemini CLI spawns this server on-demand when the AI invokes any task-related tool.
