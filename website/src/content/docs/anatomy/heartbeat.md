---
title: The Autonomic System (Heartbeat)
description: Proactive maintenance and autonomous checks.
---

The **Heartbeat** is the pulse of Tars. It ensures the agent is alive and thinking, even when you aren't talking to it.

## The Cardiac Cycle

Tars' heartbeat follows a recursive loop (defaulting to once every 300 seconds):

1. **Stage 1: Survival (Maintenance)**: Prunes logs, cleans temporary uploads, and ensures the knowledge base is synchronized.
2. **Stage 2: Duty (Scheduled Tasks)**: Executes explicit cron jobs defined in `tasks.json`.
3. **Stage 3: Reflex (Autonomous Health Check)**: Performs a semantic scan of recent state to see if proactive action is required.

## Proactive Reasoning

Unlike traditional bots that only respond to triggers, the Heartbeat allows Tars to:
- **Self-Correct**: Note when a previously failed task needs a retry.
- **Learn**: Index new files or code changes discovered in the workspace.
- **Anticipate**: Offer suggestions or prepare data before you ask for it.

> [!TIP]
> You can adjust the heartbeat frequency via the `HEARTBEAT_INTERVAL_SEC` setting using `tars secret set`.
