---
layout: ../../layouts/DocLayout.astro
title: Task Scheduling
description: Cron-based and date-based task scheduling with automatic retry.
section: Autonomous Systems
---

## Overview

Tars supports autonomous task execution through a file-based scheduling system. Tasks are defined with cron expressions or ISO dates and executed by the Heartbeat service.

## Task Structure

Each task in `~/.tars/data/tasks.json`:

```json
{
    "id": "uuid-v4",
    "title": "Daily Status Report",
    "prompt": "Generate a summary of today's activities",
    "schedule": "0 18 * * *",
    "nextRun": "2025-01-15T18:00:00.000Z",
    "enabled": true,
    "mode": "silent",
    "lastRun": "2025-01-14T18:00:00.000Z",
    "failedCount": 0,
    "createdAt": "2025-01-01T00:00:00.000Z",
    "updatedAt": "2025-01-14T18:00:12.000Z"
}
```

## Schedule Formats

### Cron Expressions

Standard 5-field cron format parsed by `cron-parser`:

| Expression     | Meaning                           |
| -------------- | --------------------------------- |
| `*/30 * * * *` | Every 30 minutes                  |
| `0 9 * * 1-5`  | 9 AM on weekdays                  |
| `0 18 * * *`   | 6 PM daily                        |
| `0 0 1 * *`    | Midnight on the 1st of each month |

### ISO Date Strings

For one-time tasks:

```
2025-03-15T14:00:00.000Z
```

### Fallback Behavior

If a schedule is unparseable (not valid cron or ISO), the task falls back to running in **24 hours**. This prevents tasks from getting stuck or looping infinitely.

## Task Lifecycle

1. **Create** — Via the `tars-tasks` MCP extension or directly editing `tasks.json`
2. **Schedule** — `nextRun` is calculated from the cron/date schedule
3. **Execute** — When the heartbeat tick detects `nextRun <= now`, the task prompt is sent to `supervisor.executeTask()`
4. **Update** — After execution, `lastRun` is set to now, `nextRun` is recalculated, and `failedCount` is reset (or incremented on failure)

## Error Handling

Failed tasks increment `failedCount` but remain enabled. The `nextRun` is still recalculated so the task retries on its next scheduled time. This ensures transient failures don't permanently stop a task.

## Creating Tasks

Tasks are typically created through the [tars-tasks MCP Extension](/extensions/tars-tasks), which Tars can invoke through natural language:

> _"Schedule a task to check my email every morning at 9 AM"_

Tars will call `create_task` with the appropriate cron expression.
