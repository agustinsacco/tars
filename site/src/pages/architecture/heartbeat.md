---
layout: ../../layouts/DocLayout.astro
title: Heartbeat and Cron
description: Maintenance, bounded initiative, and explicit scheduling services.
section: Architecture
---

Tars has separate background responsibilities for maintenance, initiative, and explicit schedules.

## Maintenance heartbeat

The heartbeat runs at the validated `heartbeatIntervalSec` interval. It:

- reports a supervisor run that has remained busy for more than ten minutes without unlocking it;
- cleans eligible temporary attachments;
- synchronizes the knowledge index at most once per hour;
- garbage-collects eligible old files under `~/.tars/chats/`.

Maintenance continues while the owner is idle.

## Initiative service

Initiative evaluates new health findings and explicit objective review dates without adding prompts
to the interactive chat history. `initiative.mode` supports `off`, `observe`, `propose`, `safe-auto`,
and `delegated`. The default is `observe`.

Notifications are deduplicated, respect quiet hours, and use a daily attention budget. `safe-auto`
can run only registered reversible repairs, such as reconciling the derived memory index or applying
owner-only permissions to known sensitive files. Consequential work still requires explicit scope
and approval. Objective contracts record desired outcomes, success criteria, allowed actions, and
actions that require approval.

## Cron service

The cron service polls `~/.tars/data/tasks.json` every 60 seconds and executes due, enabled tasks
through the supervisor. A schedule can be a five-field cron expression or an ISO date/time.

Task state uses cross-process locking and atomic writes. A successful one-time task is disabled;
recurring tasks receive a new `nextRun`. Busy interactive work can defer a task until a later poll.
The scheduler owns result delivery and supports always, failure-only, change-only, action-required,
digest, and silent policies.

Because polling is minute-based, do not use Tars for second-level, hard real-time, or safety-critical
scheduling.
