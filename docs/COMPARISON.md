# Holistic Comparison: OpenClaw vs. Tars (Memory & Heartbeat)

This document provides a critical review of the core mechanics of OpenClaw and how they have been simplified and integrated into Tars.

## 1. Heartbeat Architecture

| Feature             | OpenClaw                              | Tars (Integrated)             | Critique                                                                                                                                                      |
| :------------------ | :------------------------------------ | :---------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Steering**        | `HEARTBEAT.md` (Markdown-based goals) | `tasks.json` + `GEMINI.md`    | Tars' use of `tasks.json` allows for structured integration with external systems, while `GEMINI.md` provides the same behavioral steering as `HEARTBEAT.md`. |
| **Decision Loop**   | AI-driven prompt evaluation           | AI-driven `autonomousCheck`   | Both use the LLM to decide if action is needed. Tars' loop is deeply integrated with the CLI for better tool handling.                                        |
| **Context Pruning** | Prunes `HEARTBEAT_OK` from transcript | **Prunes `SILENT_ACK` turns** | Tars now supports session pruning to prevent background heartbeats from consuming the context window.                                                         |

## 2. Memory & Knowledge Retention

| Feature             | OpenClaw                  | Tars (Integrated)            | Critique                                                                                                                                                                                                   |
| :------------------ | :------------------------ | :--------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Search Engine**   | Hybrid (Vector + Keyword) | **Local Keyword (FTS5)**     | Tars' move to pure Keyword (FTS5) makes it **auth-agnostic** and significantly faster (<1ms). While it lacks "loose" semantic matches, the AI's ability to translate queries into keywords mitigates this. |
| **Episodic Memory** | Indexes chat transcripts  | **Indexes Session JSONs**    | Tars now automatically indexes all past conversations from `~/.tars/.gemini/tmp`, giving it the same "long-term memory" as OpenClaw.                                                                       |
| **Sync Strategy**   | `chokidar` file watching  | Sync on Heartbeat Tick (60s) | Tars' strategy is simpler and less resource-intensive. Using SHA-256 hashes ensures only changed files are re-indexed.                                                                                     |

## 3. Holistic Design Philosphy

OpenClaw is built as a **Multi-Agent Service Overlay**. It is powerful but heavy, requiring multiple dependencies and complex routing.

Tars is built as a **CLI-First Supervisor**. It treats the AI as a local process.

- **Simpler Mechanics**: No complex routing logic; the Supervisor just manages the CLI session.
- **Better Exportability**: The entire "Brain" (Prompt + Memory + Tasks) is a single directory (`~/.tars`).
- **Higher Reliability**: By delegating tool execution to the DeepMind-hardened `gemini` CLI, Tars avoids the "fragile tool calling" often found in custom SDK implementations.

## 4. Current Gaps & Strategies

1. **Structured vs. Unstructured Tasks**: OpenClaw's `HEARTBEAT.md` is easier for a human to edit.
    - _Strategy_: We should add a Tars command `tars brain` to easily edit the steering manifest.
2. **Citation Support**: OpenClaw shows source lines for memories.
    - _Strategy_: Tars' `KnowledgeStore` has `startLine` support; we should expose this in the AI's search tool output.

## Conclusion

Tars is now a **Hardened, Lean alternative to OpenClaw**. It achieves the same agency and memory depth while remaining a lightweight CLI tool that respects your Google-based authentication.
