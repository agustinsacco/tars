---
layout: ../../layouts/DocLayout.astro
title: Execution Model
description: One active agent coordinated by a deterministic supervisor.
section: Capabilities
---

Tars currently runs one active agent. The supervisor serializes inbound work, preserves the active
session, invokes the configured model, and routes tool and text events back to the originating
channel.

## What the supervisor coordinates

- Discord or terminal messages;
- one active conversation history;
- model streaming and tool calls;
- explicit scheduled tasks;
- memory refresh after fact mutations;
- background maintenance and cleanup.

Scheduled tasks use the same supervised execution path. They are not delegated to independent
workers or isolated sessions.

## No sub-agent orchestration

Tars does not currently spawn specialist agents, route work among roles, or provide a multi-agent
task graph. `TARS_INSTANCE_ROLE` is operator metadata for a named process; it does not create a
specialized agent architecture.

If a workflow needs separation, use explicit tools, narrow skills, separate OS accounts, or an
external job system. Do not assume model-written delegation provides a security or concurrency
boundary.
