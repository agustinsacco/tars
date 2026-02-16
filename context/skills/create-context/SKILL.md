---
name: context-manager
description: Guide for adding persistent context to extensions via GEMINI.md.
---

# create-context Guide Skill

This skill allows Tars to add persistent context and memory to Gemini CLI extensions using a `GEMINI.md` file.

## Instructions

1.  **Locate Extension**: Navigate to the target extension directory (e.g., `~/.gemini/extensions/<name>`).
2.  **Create GEMINI.md**: Create a `GEMINI.md` file in the root of the extension directory.
3.  **Define Context**:
    - **System Prompt Override**: Provide instructions on how the model should behave when using this extension.
    - **Tool Documentation**: Explain what the extension's tools do and how they should be used.
    - **Persistent Memory**: Store notes, preferences, or project-specific information.

## Template

```markdown
# My Extension Context

This file provides context for the `my-extension` extension.

## Identity & Behavior

- You are now equipped with the `my-extension` tools.
- When the user asks about X, follow these guidelines:
    1. ...
    2. ...

## Tools Overview

- `my_tool`: Use this to investigate X.
    - Caution: This tool may modify files. Always verify with the user first.

## Notes

- [2025-01-01] User prefers concise output for this extension.
```

## Usage

The content of `GEMINI.md` is automatically loaded into the context window whenever the extension is active or its tools are used.
