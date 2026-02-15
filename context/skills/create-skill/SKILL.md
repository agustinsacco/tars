# create-skill Guide Skill

This skill allows Tars to create new `SKILL.md` files for specific workflows.

## Instructions

1.  **Define the Scope**: What specific repeatable task does this skill cover?
2.  **Create Directory**: Create a directory in `~/.gemini/skills/<name>`.
3.  **Write SKILL.md**:
    - Include YAML frontmatter with `name` and `description`.
    - Provide clear, step-by-step instructions.
    - Include code snippets or command examples where relevant.

## Template

```markdown
---
name: name-of-skill
description: what this skill does
---

# name-of-skill

## Steps

1. ...
2. ...
```
