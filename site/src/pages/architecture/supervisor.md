---
layout: ../../layouts/DocLayout.astro
title: Supervisor
description: The long-running coordinator for channels, sessions, tools, and background services.
section: Architecture
---

The supervisor is the center of the Tars runtime. PM2 runs it as `tars-supervisor`, and the CLI
provides lifecycle and diagnostics around that process.

## Responsibilities

- start configured channels and route inbound messages;
- serialize model work against the active session;
- stream engine events back through the originating channel;
- refresh system context after durable fact changes;
- execute due tasks through the same supervised engine;
- coordinate the heartbeat, cron service, and optional dashboard;
- report long-running work without unlocking an operation that is still active.

## Concurrency

Tars uses one active agent and session. A supervisor lock prevents overlapping turns from writing
inconsistent history. Scheduled work can be deferred while an interactive run is busy.

The heartbeat treats a run longer than ten minutes as diagnostically stale, but never clears its
lock while the run is still executing.

## Process modes

Production startup requires `TARS_SUPERVISOR_MODE=true`; `tars start` sets it through PM2. The
terminal chat sets a distinct chat mode and skips daemon-only heartbeat, cron, dashboard, and
optionally Discord services so it does not duplicate a background supervisor.
