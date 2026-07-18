---
layout: ../../layouts/DocLayout.astro
title: Skills
description: Reusable local instructions for specific workflows.
section: Capabilities
---

A skill is a directory under `~/.tars/skills/` whose `SKILL.md` explains when and how to perform a
repeatable task.

```text
~/.tars/skills/example-skill/
└── SKILL.md
```

```markdown
---
name: example-skill
description: Performs one clearly defined workflow when requested.
---

# Example skill

## Preconditions

- Required access or input.

## Steps

1. Inspect current state.
2. Apply the smallest safe change.
3. Validate the result.
```

Use a lowercase hyphenated name, keep the description specific enough to trigger correctly, and put
safety preconditions before commands. Never embed credentials or silently broaden the user's
authority.

After adding or updating a skill, run `tars memory sync`. Skills are trusted prompt instructions,
not executable isolation or deterministic access control.
