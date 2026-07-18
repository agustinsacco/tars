---
layout: ../../layouts/DocLayout.astro
title: Customization
description: Customize identity and add reviewed local instructions or tools.
section: Get Started
---

## Identity

Set `assistantName` in `~/.tars/config.json` or `ASSISTANT_NAME` in the environment. Exported
environment values take precedence over `.env`, `config.json`, and defaults.

## System instructions

Edit `~/.tars/system.md` to change behavior and tone. Bootstrap preserves a custom prompt. Migration
replaces only a missing prompt or a recognizable legacy bundled prompt, so operator-written content
is not silently overwritten.

System instructions do not create permissions or a sandbox. Keep authorization and safety controls
in deterministic code and operating-system policy.

## Skills

Place a reviewed instruction package at `~/.tars/skills/<name>/SKILL.md`, then run:

```bash
tars memory sync
```

Skills should cover one repeatable workflow, state preconditions, and avoid embedded credentials.

## Extensions

MCP extensions live under `~/.tars/extensions/` and must be listed in
`extension-enablement.json`. Review the executable code, restrict its environment allowlist, and set
bounded startup and tool timeouts before enabling it. Restart Tars after manifest or enablement
changes.
