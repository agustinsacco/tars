---
layout: ../../layouts/DocLayout.astro
title: Memory & Knowledge
description: Two-tier memory system — working memory (GEMINI.md) and indexed knowledge (SQLite FTS5).
section: Autonomous Systems
---

## Overview

Tars has a two-tier memory architecture combining human-readable working memory with a high-speed indexed knowledge store.

## Tier 1: Working Memory (GEMINI.md)

The file `~/.tars/.gemini/GEMINI.md` serves as Tars' dynamic working memory. It's a markdown file that the AI reads and updates itself, containing:

- User preferences and style notes
- Project context and status
- Learned patterns and conventions
- Operational notes

This file is always included in the Gemini CLI context, making it immediately accessible to the AI.

## Tier 2: Knowledge Store (SQLite FTS5)

The `KnowledgeStore` uses **SQLite Full-Text Search 5** to provide keyword-based search across all indexed content, ranked by **BM25** relevance.

### Database Location

```
~/.tars/data/knowledge.db
```

### Schema

```sql
-- File tracking
CREATE TABLE files (
  id INTEGER PRIMARY KEY,
  path TEXT UNIQUE,
  hash TEXT,
  updated_at INTEGER
);

-- Content chunks
CREATE TABLE chunks (
  id INTEGER PRIMARY KEY,
  file_id INTEGER,
  content TEXT,
  start_line INTEGER,
  FOREIGN KEY(file_id) REFERENCES files(id)
);

-- FTS5 search index
CREATE VIRTUAL TABLE chunks_fts USING fts5(content);
```

Content is automatically split into paragraph-level chunks (separated by double newlines, minimum 20 characters).

### Change Detection

Files are tracked by SHA-256 hash. On each sync, the hash is compared — if unchanged, the file is skipped. This makes `fullSync()` efficient even when called every heartbeat tick.

## The fullSync Pipeline

Called by the Heartbeat on every tick:

1. **Index GEMINI.md** — The working memory file
2. **Index Skills** — All `.md` files in `~/.tars/.gemini/skills/` (recursive)
3. **Index Session Transcripts** — Past conversation JSON files from `~/.tars/.gemini/tmp/*/chats/*.json`

Session transcripts are parsed into `USER: ... ASSISTANT: ...` format for better search relevance.

## Searching Memory

### CLI

```bash
tars memory search "deployment process"
```

Returns matching chunks with their source file and relevance score (0-1).

### Manual Sync

```bash
tars memory sync
```

Triggers a full re-index of the knowledge base.

## BM25 Ranking

Search results are ranked using BM25 (Best Matching 25), a probabilistic ranking function that considers:

- **Term frequency** — How often the search term appears in a chunk
- **Inverse document frequency** — How rare the term is across all chunks
- **Document length** — Shorter, more focused chunks rank higher

The raw FTS rank is normalized to a 0-1 score: `1 / (1 + |rank|)`.
