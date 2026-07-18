---
layout: ../../layouts/DocLayout.astro
title: Sessions
description: Active history, token-aware compression, persistence, and cleanup.
section: Architecture
---

Tars maintains one active conversation history. Session metadata tracks identity, last activity,
interactions, and token usage in `~/.tars/data/session.json`; conversation files live under
`~/.tars/chats/`.

## Compression

Before a request or when the configured threshold is reached, Tars can summarize older history to
fit the selected context window. Compression is:

- associated with the explicit active session;
- based on token usage rather than file length alone;
- written atomically;
- abandoned without replacing the original history when summary generation fails.

Compression is lossy summarization, not durable memory. Store facts or notes explicitly when exact
future retrieval matters.

## Cleanup

The maintenance heartbeat can remove eligible old chat files according to retention limits. It does
not rotate to a new agent merely because two hours have passed, and scheduled tasks use the active
supervised execution path.

Use `/reset` or `/clear` through Discord when you intentionally want to clear the current
conversation. Back up important state before manual file intervention.
