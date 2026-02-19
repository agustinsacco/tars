---
layout: ../../layouts/DocLayout.astro
title: Memory CLI
description: Searching and synchronizing the knowledge store from the command line.
section: CLI Reference
---

## tars memory search

Search the indexed knowledge store using BM25 keyword matching.

```bash
tars memory search "deployment process"
```

### Output

```
🧠 Search Results for: "deployment process"

[1] GEMINI.md (Score: 0.85)
The deployment process uses GitHub Actions with a staging → production pipeline...

[2] history/session-2025-01-15.json (Score: 0.72)
USER: How do I deploy to production?
ASSISTANT: The deployment follows these steps...

[3] skills/tars-ops/SKILL.md (Score: 0.45)
## Deployment Commands
- `tars deploy staging` — Deploy to staging environment...
```

Each result shows the source file path, relevance score (0-1), and matching content chunk.

## tars memory sync

Triggers a full re-index of the knowledge base.

```bash
tars memory sync
```

This manually runs the same `fullSync()` pipeline that the Heartbeat executes on every tick:

1. Indexes `~/.tars/.gemini/GEMINI.md`
2. Indexes all `.md` files in `~/.tars/.gemini/skills/` (recursive)
3. Indexes session transcripts from `~/.tars/.gemini/tmp/*/chats/*.json`

### When to Use

You typically don't need to manually sync — the Heartbeat handles this automatically. Manual sync is useful when:

- You've manually edited GEMINI.md or skill files
- You want to verify the knowledge store is up-to-date
- Debugging search results that seem stale
