---
layout: ../../layouts/DocLayout.astro
title: What is Tars?
description: A compact, local-first assistant for Discord and terminal workflows.
section: Get Started
---

Tars is a self-hosted Node.js assistant that runs directly on your machine. A PM2-managed
supervisor connects one active agent to Discord, while `tars chat --no-discord` provides a
foreground terminal session without daemon-only services. Both modes use the configured
`TARS_HOME`; do not send concurrent prompts through both.

## Local-first, not necessarily offline

Configuration, conversations, selected memory, tasks, skills, extensions, and logs are stored under
`~/.tars/` by default. Model requests still leave the machine when you choose a cloud provider. Use a
compatible local endpoint when inference must remain on your network.

## Focus

Tars intentionally focuses on a smaller operating model:

- bare-metal Node.js and PM2 instead of a containerized runtime;
- Discord and terminal access;
- provider choice through the Pi Agent SDK;
- durable facts, notes, and explicit scheduled tasks;
- trusted local skills and MCP extensions;
- inspectable configuration and state.

[OpenClaw](https://docs.openclaw.ai/) is an example of a broader self-hosted gateway with a larger
channel and platform ecosystem. Tars does not currently provide sub-agent orchestration, mobile or
voice clients, or broad multi-channel parity.

## Boundaries

Tars is not a sandbox. Its model tools and extensions have the permissions of the operating-system
user. The heartbeat performs maintenance rather than inventing background work. Recurring work runs
only after an explicit task is created.

Start with a dedicated least-privilege account and read the [security model](/capabilities/security)
before granting access to sensitive files, commands, or services.
