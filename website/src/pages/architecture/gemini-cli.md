---
layout: ../../layouts/DocLayout.astro
title: Gemini CLI Wrapper
description: How Tars spawns and manages the Gemini CLI as an isolated subprocess.
section: Architecture
---

## Overview

The `GeminiCli` class wraps the `gemini` command-line tool as a child process. It manages an isolated environment, streams JSON events, and handles timeouts and session compaction.

## Environment Isolation

Tars runs Gemini CLI in its own isolated home directory to prevent conflicts with the user's personal Gemini configuration:

```bash
HOME=~/.tars
GEMINI_CLI_HOME=~/.tars
```

This means Gemini CLI looks for settings, extensions, and history in `~/.tars/.gemini/` rather than `~/.gemini/`.

## Streaming Architecture

The `run()` method spawns `gemini` with a prompt piped to its stdin. The CLI outputs **JSON lines** — one JSON object per line — which are parsed into typed events:

| Event Type   | Description                          |
| ------------ | ------------------------------------ |
| `text`       | A chunk of the AI's text response    |
| `message`    | A complete message block             |
| `toolCall`   | Tool invocation (MCP extension call) |
| `toolResult` | Tool execution result                |
| `error`      | An error from the CLI                |
| `done`       | Stream complete                      |

### Session Resumption

On first run, Gemini CLI creates a new session and returns a session ID. Tars persists this ID via `SessionManager`. On subsequent calls, the session is resumed with `--session <id>`, maintaining full conversation context.

## Timeouts

Two timeout mechanisms prevent hangs:

- **Idle Timeout** (120s) — If no output is received for 2 minutes, the process is killed
- **Absolute Timeout** (300s) — Maximum total execution time per prompt

## Context Compaction

When sessions grow beyond 50KB, the `compactSession()` method triggers Gemini CLI's built-in compression:

```bash
gemini --session <id> --compact
```

This summarizes older turns while preserving recent context, reducing token usage significantly.

## Debug Logging

All raw CLI output is logged to timestamped files:

```
/tmp/gemini-debug-<timestamp>.log
```

These files capture the raw JSON line stream, making them invaluable for debugging JSON parsing errors or unexpected model behavior.

## Synchronous Execution

The `runSync(prompt)` method collects the full response into a string. Used by the Heartbeat for background tasks where streaming isn't needed.
