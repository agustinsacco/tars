---
layout: ../../layouts/DocLayout.astro
title: Memory Extension
description: Built-in durable facts, daily notes, and local search.
section: Extensions
---

The bundled `tars-memory` server exposes two tools.

## `manage_facts`

- `store` requires a stable key and value;
- `delete` requires a key;
- `list` returns current durable facts.

Facts are intentional key/value records suitable for preferences, identity, and durable rules. They
are stored in `~/.tars/data/memory/facts.json`.

## `manage_notes`

- `add` appends timestamped content to the daily journal;
- `search` searches facts, notes, and indexed eligible history.

Use notes for observations that do not deserve a stable fact key. Run `tars memory sync` to rebuild
the broader local index.

Neither tool is a credential store. Memory may be included in future model context and backup
archives, whose filtering is only best-effort, so do not put tokens, passwords, private keys, or
regulated data in it.
