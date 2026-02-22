---
layout: ../../layouts/DocLayout.astro
title: Memory & Context
description: How Tars manages its token window and remembers things forever.
section: Capabilities
---

Tars solves the "infinite context window" problem by using an **Episodic Session** architecture combined with a dedicated **Memory Management** extension.

Instead of keeping one giant, never-ending chat log that eventually slows down and crashes, Tars continuously starts fresh sessions while preserving the important things you've told it.

## Episodic Sessions

When you speak to Tars, you are interacting within a "Session".

- **Active Window**: While you are actively talking to Tars, your session stays alive. It remembers exactly what was said 10 minutes ago, allowing you to iterate on code or have a flowing conversation.
- **Idle Expiry**: If you stop talking to Tars for 2 hours, the session expires. The next time you message Tars, it will secretly start a brand new session with zero baggage. This means you always start your day with a lightning-fast, cheap, empty context window.
- **Memory Invalidation**: If you explicitly tell Tars to "remember" something, the current session is immediately flagged as stale. As soon as you send your next message, Tars will reboot its session so it can load your newly saved fact into its core instructions.

## The Memory System

To survive these frequent session wipes, Tars uses the built-in `tars-memory` MCP extension. It divides its memory into two distinct tiers:

### 1. Core Facts (`facts.json`)
Core facts are injected directly into Tars's system prompt every time a session boots up. This is used for critical context that Tars should *always* know.

```text
User: "Remember that my preferred framework is React with Tailwind v4."
Tars: "✅ I have stored this fact."
```
Behind the scenes, Tars calls the `memory_store_fact` tool. Because this requires immediate awareness, the session is invalidated, and your next prompt will boot up with "React with Tailwind v4" hardcoded into its brain.

### 2. Daily Notes (`notes/YYYY-MM-DD.md`)
For less critical information (like meeting summaries, error logs, or ideas), Tars uses Daily Notes.

```text
User: "Write down that the bug in the auth service was caused by a trailing slash."
Tars: "✅ I have added this to my daily notes."
```
Tars calls `memory_add_note`. This information is *not* injected into the system prompt to save tokens. Instead, it is written to a markdown file timestamped with today's date. If Tars ever needs to recall how it fixed that bug, it can use the `memory_search` tool to look through its historical daily notes.

## Storage Locations

If you ever need to manually edit or backup your AI's brain, you can find the raw files here:

- **Facts:** `~/.tars/data/memory/facts.json`
- **Notes:** `~/.tars/data/memory/notes/`
