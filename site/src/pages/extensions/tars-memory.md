---
layout: ../../layouts/DocLayout.astro
title: tars-memory Extension
description: Long-term knowledge storage, fact recording, and daily notes for Tars.
section: Extensibility
---

## Overview

`tars-memory` is Tars' core extension for maintaining long-term context beyond the active conversation window. It provides tools for storing specific facts, recording daily observations, and searching across high-volume knowledge.

## Tools

### memory_store_fact

Stores or overwrites a core fact about the user or environment. Facts are injected into every new session's system prompt.

| Parameter | Type   | Required | Description                                  |
| --------- | ------ | -------- | -------------------------------------------- |
| `key`     | string | ✓        | A unique identifier (e.g., `git_user_email`) |
| `value`   | string | ✓        | The information to remember                  |

```
"Remember that I prefer using tabs for indentation in this project."
→ memory_store_fact("indentation_preference", "tabs")
```

### memory_list_facts

Lists all stored core facts. Useful for auditing what Tars knows about you.

### memory_delete_fact

Deletes a stored fact by its key.

### memory_add_note

Appends a timestamped entry to today's daily log. Use for project context, decisions, and observations that don't need to be in every prompt but should be searchable.

| Parameter | Type   | Required | Description             |
| --------- | ------ | -------- | ----------------------- |
| `content` | string | ✓        | The note text to record |

### memory_search

Performs a keyword search across three knowledge tiers:

1. **Core Facts** (`facts.json`)
2. **Daily Notes** (Markdown files from the last 30 days)
3. **Episodic Memory** (Indexed transcripts of past sessions)

## Knowledge Tiers

| Tier         | Storage        | Persistence | Retrieval                   |
| ------------ | -------------- | ----------- | --------------------------- |
| **Facts**    | `facts.json`   | Infinite    | Injected into System Prompt |
| **Notes**    | `notes/*.md`   | Infinite    | Searchable via tool         |
| **Episodic** | `knowledge.db` | Rolling     | Searchable via tool         |

## Data Location

All memory data is stored in `~/.tars/data/memory/`.

- `facts.json`: Key-value storage.
- `notes/`: Directory of daily markdown files.
- `knowledge.db`: SQLite FTS index populated by the [Heartbeat Service](/architecture/heartbeat).
