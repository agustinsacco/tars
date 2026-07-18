---
layout: ../../layouts/DocLayout.astro
title: Pi SDK Migration
description: Historical compatibility notes for the current provider-neutral engine.
section: Architecture
---

Tars uses the Pi Agent SDK for provider selection, model messages, streaming events, history, and
tool execution. Older installations used vendor-specific workspace directories and prompt files.

## Automatic migration

During setup, the migration path can:

- move recognized legacy chats into `~/.tars/chats/`;
- preserve current durable memory and custom skills;
- remove obsolete provider-specific runtime files after migration;
- install a neutral permission-aware system prompt only when the prompt is missing or matches a
  recognizable old bundled prompt.

An operator-written `~/.tars/system.md` is preserved.

## Current paths

Use `~/.tars/config.json` and `.env` for provider configuration and credentials. Skills and
extensions live directly in `~/.tars/skills/` and `~/.tars/extensions/`; no hidden vendor workspace
is part of the current layout.

Back up the installation with `tars export` before migrating an older machine, then verify model,
owner, extension enablement, session, and memory behavior after setup.
