---
layout: ../../layouts/DocLayout.astro
title: Persistent Memory
description: How Tars manages context and long-term knowledge retrieval.
section: Capabilities
---

Tars implements an **Episodic Session** architecture paired with a dedicated memory system. This approach ensures high performance by maintaining concise context windows while preserving critical knowledge across sessions.

### Episodic Sessions

To prevent context bloat and performance degradation, Tars manages short-lived conversation segments:

- **Active Sessions:** While you are actively interacting, Tars maintains full continuity of the conversation.
- **Auto-Refresh:** After 2 hours of inactivity, the session is archived. Your next interaction starts a fresh session, ensuring a clean and efficient context window.
- **Hot-Reloading:** When you instruct Tars to "remember" a key fact, the current session is re-initialized to incorporate the new information into its core instructions immediately.

### Knowledge Tiers

Tars categorizes information into two distinct tiers via the `tars-memory` extension:

#### 1. Core Facts

Critical preferences and static context that Tars must always know. These are injected directly into every new session's system prompt.

```text
User: "The production database uses PostgreSQL, but staging uses SQLite."
Tars: "✅ Fact stored. I'll maintain this context across all future sessions."
```

#### 2. Historical Notes

Higher-volume data like meeting logs, incident summaries, or technical notes. These are stored as timestamped markdown files. To save tokens, these are not injected into the prompt but are retrievable via the `memory_search` tool when relevant to a specific task.

```text
User: "Record the root cause of today's Nginx failure for future reference."
Tars: "✅ Added to historical notes."
```

### Data Portability

Your agent's knowledge resides entirely on your local machine. You can view, edit, or back up these files at any time:

- **Core Facts:** `~/.tars/data/memory/facts.json`
- **History:** `~/.tars/data/memory/notes/`
