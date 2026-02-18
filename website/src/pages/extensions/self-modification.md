---
layout: ../../layouts/DocLayout.astro
title: Self-Modification
description: How Tars evolves its own capabilities through memory, skills, and extensions.
section: Extensibility
---

## Overview

One of Tars' defining features is its ability to modify and extend itself. Through the combination of writable memory, skill creation, and extension development, Tars forms a feedback loop that enhances its capabilities over time.

## GEMINI.md: The Living Brain

The `GEMINI.md` file is not just a static configuration — it's a document the AI actively reads and writes during conversations. When Tars learns something new about the user or a project, it updates this file.

Examples of self-modification:

- Recording user preferences (code style, preferred tools)
- Noting project context (repo structure, deployment targets)
- Tracking operational state (ongoing tasks, blockers)

## Skill Generation

When Tars encounters a recurring task or a complex workflow, it can create a new skill:

1. User asks Tars to do something complex
2. Tars solves it and recognizes the pattern
3. Tars writes a new `SKILL.md` in `~/.tars/.gemini/skills/`
4. Future invocations reference the skill for consistent execution

## Extension Development

Tars can create entirely new MCP extensions:

1. Tars identifies a need for a new tool capability
2. Uses the `create-extension` skill as a template
3. Generates a TypeScript MCP server with tool definitions
4. Creates the manifest and package configuration
5. Symlinks the extension to `~/.tars/.gemini/extensions/`
6. The new tools are available on the next Gemini CLI invocation

## The Feedback Loop

```
User Request → AI Processes → Learns Pattern
      ↓                            ↓
  Responds                  Updates GEMINI.md
                              Creates Skill
                            Builds Extension
      ↓                            ↓
  Next Request ← Enhanced Capabilities ←
```

This loop means Tars becomes more capable over time, tailored specifically to the user's workflow and preferences.

## Safety

- GEMINI.md changes are transparent — it's a plain markdown file you can review
- Skills are human-readable markdown documents
- Extensions are TypeScript source code you can audit
- All modifications happen in `~/.tars/`, isolated from system files
