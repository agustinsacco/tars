---
layout: ../../layouts/DocLayout.astro
title: Persistent Memory
description: Keep selected facts and notes beyond the active conversation.
section: Capabilities
---

Tars separates active conversation history from durable memory.

## Active session

The current session persists under `~/.tars/chats/` with metadata in
`~/.tars/data/session.json`. Token-aware compression summarizes older context atomically. If summary
generation fails, Tars preserves the original history.

An idle period does not automatically create a new agent or archive every conversation. The
heartbeat can garbage-collect eligible old chat files according to retention limits.

## Durable memory tools

The built-in memory extension exposes:

- `manage_facts` with `store`, `delete`, and `list` actions for intentional key/value facts;
- `manage_notes` with `add` and `search` actions for timestamped daily notes and retrieval.

Facts are stored under `~/.tars/data/memory/facts.json`; notes live beside them. `tars memory sync`
indexes facts, skills, and eligible chat history into the local knowledge database.

## Data discipline

Tars does not reliably remember every statement. Ask it to store a fact when persistence matters,
and periodically review or delete stale information. Do not store passwords, tokens, private keys,
or data that should not be sent to the configured model provider.
