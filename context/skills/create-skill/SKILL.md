---
name: create-skill
description: Creates a focused local Tars skill for a repeatable workflow.
---

# Create a Tars skill

Use this guide when the user explicitly asks to add or update a reusable local workflow.

## Steps

1. Define one concrete task and its trigger conditions.
2. Review existing directories under `~/.tars/skills/` to avoid duplicate capabilities.
3. Create `~/.tars/skills/<lowercase-hyphenated-name>/SKILL.md`.
4. Add YAML frontmatter with a matching `name` and a precise third-person `description`.
5. Write short, ordered instructions. Put safety conditions before commands that change data or
   external state.
6. Reference scripts or supporting files with paths relative to the skill directory.
7. Verify the skill contains no credentials, machine-specific secrets, or unsupported claims.
8. Run `tars memory sync` after the skill is complete so it is searchable.

## Template

```markdown
---
name: example-skill
description: Performs one clearly defined workflow when the user requests it.
---

# Example skill

## Preconditions

- Required access or input.

## Steps

1. Inspect current state.
2. Apply the smallest safe change.
3. Validate the result.
```

Skills are trusted instructions, not isolated plugins. Review generated commands and do not grant a
skill broader authority than the user requested.
