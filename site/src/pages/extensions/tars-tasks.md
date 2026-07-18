---
layout: ../../layouts/DocLayout.astro
title: Tasks Extension
description: The built-in MCP tool for durable one-time and recurring tasks.
section: Extensions
---

The bundled `tars-tasks` server exposes one tool: `manage_tasks`.

## Actions

| Action   | Required input                | Effect                               |
| -------- | ----------------------------- | ------------------------------------ |
| `create` | `title`, `prompt`, `schedule` | Add an enabled task                  |
| `list`   | none                          | List tasks; `enabledOnly` can filter |
| `modify` | `id` plus changed fields      | Update an existing task              |
| `toggle` | `id`, `enabled`               | Enable or disable a task             |
| `delete` | `id`                          | Remove a task                        |

`schedule` accepts a five-field cron expression or an ISO date/time. `mode` is `silent` by default;
set it to `notify` to send the completed result to the owner.

Task data is stored at `~/.tars/data/tasks.json` with cross-process locking and atomic replacement.
The separate cron service polls once per minute and executes due tasks through the supervisor.

This is not a distributed queue or a real-time scheduler. Use narrow prompts and keep destructive
work behind deterministic safeguards.
