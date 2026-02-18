---
layout: ../../layouts/DocLayout.astro
title: Session Management
description: Token tracking, session persistence, and usage statistics.
section: Architecture
---

## Overview

The `SessionManager` class persists Gemini CLI session data to disk, tracking token usage across interactions. This enables session resumption and provides visibility into context consumption.

## Session Data

Each session tracks the following:

| Field               | Type       | Description                                  |
| ------------------- | ---------- | -------------------------------------------- |
| `sessionId`         | string     | Gemini CLI session identifier                |
| `createdAt`         | ISO string | When the session started                     |
| `totalInputTokens`  | number     | Current context size (input tokens)          |
| `totalOutputTokens` | number     | Cumulative output tokens generated           |
| `totalCachedTokens` | number     | Currently cached tokens                      |
| `totalNetTokens`    | number     | Cumulative net input tokens (input - cached) |
| `interactionCount`  | number     | Number of prompts processed                  |
| `lastInteractionAt` | ISO string | Timestamp of last prompt                     |
| `lastInputTokens`   | number     | Input tokens from last interaction           |

## Storage

Session data is persisted at:

```
~/.tars/data/session.json
```

The file is updated after every interaction via `updateUsage()`.

## Usage Tracking

After each Gemini CLI interaction, the Supervisor calls `updateUsage()` with the latest token counts. The manager computes:

```
netInput = max(0, inputTokens - cachedTokens)
```

This gives an accurate picture of actual token consumption vs. cache hits.

## Session Lifecycle

1. **Load** — On startup, the manager checks for an existing `session.json` and returns the session ID
2. **Save** — After creating a new session, the ID and initial state are persisted
3. **Update** — After each interaction, usage stats are accumulated and saved
4. **Clear** — When a session is reset, the file is deleted and in-memory state is nulled

## Status Display

Run `tars status` to see current session stats:

```bash
tars status
```

This reads `session.json` and displays the session ID, total tokens, interaction count, and uptime.
