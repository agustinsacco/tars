---
layout: ../../layouts/DocLayout.astro
title: Scheduled Tasks
description: Run explicit one-time or cron-scheduled prompts through the supervisor.
section: Capabilities
---

The `tars-tasks` extension exposes one consolidated tool, `manage_tasks`. Its actions are `create`,
`list`, `delete`, `toggle`, and `modify`.

## Create a task

A task needs a title, prompt, and either a five-field cron expression or an ISO date/time. For
example:

```text
Create a notify task named "weekly report" with schedule "0 9 * * 1" and prompt
"Summarize the build failures recorded in the approved report directory."
```

The task store persists to `~/.tars/data/tasks.json` using cross-process locking and atomic writes.

## Execution

The cron service polls every 60 seconds. Due tasks execute through the active supervisor, so a busy
interactive run can defer scheduled work. A successful one-time task is disabled; a recurring task
computes its next run.

Modes control result delivery:

- `notify` sends the completed result through the configured channel;
- `silent` records execution without sending the result.

## Limits

Tars does not invent tasks from heartbeat activity. It is not a durable distributed job queue and
does not guarantee second-level scheduling. Tasks inherit the permissions, model access, session
constraints, and trusted tools of the running supervisor.

Use narrow prompts, avoid embedded secrets, and keep destructive automation behind deterministic
confirmation or an external policy boundary.
