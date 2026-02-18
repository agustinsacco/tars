---
layout: ../../layouts/DocLayout.astro
title: Skills System
description: How Tars manages built-in and user-created skills for specialized capabilities.
section: Extensibility
---

## Overview

Skills are structured instruction sets stored as markdown files in `~/.tars/.gemini/skills/`. They extend Tars' capabilities by providing step-by-step guides for specific tasks.

## Skill Structure

Each skill lives in its own directory:

```
~/.tars/.gemini/skills/
├── tars-ops/
│   └── SKILL.md
├── create-extension/
│   └── SKILL.md
└── create-skill/
    └── SKILL.md
```

### SKILL.md Format

```yaml
---
name: tars-ops
description: Standardized command list for Tars configuration and maintenance
---
## Instructions

Step-by-step operational guide...
```

The YAML frontmatter provides metadata, and the markdown body contains the actual instructions.

## Built-in Skills

| Skill              | Description                                                           |
| ------------------ | --------------------------------------------------------------------- |
| `tars-ops`         | Standardized command list for configuration, secrets, and maintenance |
| `create-extension` | Guide for creating new MCP extension servers                          |
| `create-skill`     | Guide for creating new skills                                         |

## Skill Synchronization

The `installSkills()` function runs on every `tars start`:

1. Scans the repository's `skills/` directory for built-in skills
2. Copies them to `~/.tars/.gemini/skills/`, **overwriting** existing built-in skills
3. **Preserves** any user-created skills that don't conflict with built-in names

This ensures built-in skills are always up-to-date after a package update, while user skills remain untouched.

## Creating Custom Skills

Tars can create new skills through the `create-skill` built-in skill. When asked, it generates a new `SKILL.md` file with appropriate frontmatter and instructions.

Users can also manually create skill directories in `~/.tars/.gemini/skills/`.
