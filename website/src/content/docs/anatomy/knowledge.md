---
title: The Hippocampus (Knowledge System)
description: Long-term factual retrieval and deep search.
---

The **Knowledge System** is where Tars stores what it has learned from your workspace, conversations, and documentation.

## Short-term vs. Long-term

Tars maintains a strict separation between what it is thinking about *now* and what it knows *forever*.

- **The Vector Store**: Converts text and code into high-dimensional vectors for semantic search.
- **FTS (Full Text Search)**: Fast keyword-based retrieval across artifacts.
- **Knowledge Items (KIs)**: Distilled summaries of past research, preventing the agent from re-analyzing the same code twice.

## How Tars Remembers

1. **Discovery**: Tars reads files in your workspace using the `list_dir` or `search_web` tools.
2. **Indexing**: During a Heartbeat, Tars synchronizes these files into its internal database.
3. **Retrieval**: When you ask a question, Tars first queries its Hippocampus to find relevant context before starting a new analysis.
