---
layout: ../../layouts/DocLayout.astro
title: Engine
description: The Pi SDK adapter for model messages, tools, events, and history.
section: Architecture
---

`TarsEngine` adapts the Pi Agent SDK to the supervisor. It initializes the configured provider,
loads the active history and system instructions, exposes authorized MCP tools, and streams typed
events for text, status, tool calls, tool results, images, errors, and usage.

## Request flow

1. The channel manager normalizes an owner-authorized message and validated attachments.
2. The supervisor acquires the active-run lock.
3. The session manager performs token-aware preflight compression when required.
4. The engine sends the request to the configured provider and executes requested tools.
5. Events stream to the channel and redacted logs.
6. History and session usage are saved atomically before the lock releases.

## Model selection

The engine can use supported cloud providers or an OpenAI-compatible base URL. Provider and model
configuration is validated before startup. A custom endpoint is responsible for correctly
implementing the expected protocol and context limits.

Tool output remains untrusted model input. Extension enablement and OS policy—not the model—define
which capabilities are available.
