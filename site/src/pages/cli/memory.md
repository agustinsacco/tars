---
layout: ../../layouts/DocLayout.astro
title: Memory CLI
description: Search and rebuild the local knowledge index.
section: CLI
---

## Search

```bash
tars memory search deployment decision
```

The command searches the local knowledge index and prints matching paths, relevance scores, and
snippets. It can find indexed durable facts, skills, and eligible conversation history.

## Synchronize

```bash
tars memory sync
```

Synchronization rebuilds searchable knowledge from the current local sources. It does not send data
to a model provider and does not create new durable facts.

Within an agent session, the built-in memory extension exposes `manage_facts` for explicit durable
key/value facts and `manage_notes` for daily notes and search. Tars does not automatically preserve
every statement as permanent memory.
