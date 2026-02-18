---
title: Self-Modification
description: How Tars upgrades its own brain.
---

Tars is one of the few AI agents designed with the explicit directive to **modify its own source code and configuration**.

## The Feedback Loop

Self-modification usually occurs during a **Heartbeat** or after a specific user request:

1. **Observation**: Tars identifies a bottleneck or a missing capability (e.g., "I keep needing to convert units but don't have a tool").
2. **Drafting**: Tars writes the code for a new Extension or Skill.
3. **Verification**: Tars attempts to build or lint the new code locally.
4. **Integration**: Tars moves the new files into `~/.tars/.gemini/` and reloads its context.

## Safety Protocols

To prevent "hallucinated recursion" or breaking the supervisor, Tars follows strict safety rules:
- **Supervisor Isolation**: Tars cannot stop the Supervisor process directly.
- **Manual Approval**: For significant architectural changes, Tars will always ask for user confirmation before writing to disk.
- **Atomic Operations**: Changes to `Config` are performed via the `tars secret` command to ensure data integrity.

> [!WARNING]
> While Tars is autonomous, you always have the final say. Review Tars' logs to see the reasoning behind any self-initiated modifications.
