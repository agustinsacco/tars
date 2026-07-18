---
layout: ../../layouts/DocLayout.astro
title: Heartbeat and Cron
description: Separate maintenance and explicit scheduling services.
section: Architecture
---

Tars has two background loops with different responsibilities.

## Maintenance heartbeat

The heartbeat runs at the validated `heartbeatIntervalSec` interval. It:

- reports a supervisor run that has remained busy for more than ten minutes without unlocking it;
- cleans eligible temporary attachments;
- synchronizes the knowledge index at most once per hour;
- garbage-collects eligible old files under `~/.tars/chats/`;
- skips heavier maintenance after more than two hours without a user interaction.

It does not ask the model to invent work, continuously monitor the host, or execute scheduled tasks.

## Cron service

The cron service polls `~/.tars/data/tasks.json` every 60 seconds and executes due, enabled tasks
through the supervisor. A schedule can be a five-field cron expression or an ISO date/time.

Task state uses cross-process locking and atomic writes. A successful one-time task is disabled;
recurring tasks receive a new `nextRun`. Busy interactive work can defer a task until a later poll.

Because polling is minute-based, do not use Tars for second-level, hard real-time, or safety-critical
scheduling.
