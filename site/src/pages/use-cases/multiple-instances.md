---
layout: ../../layouts/DocLayout.astro
title: Multiple Instances
description: Advanced isolation guidance and current lifecycle limitations.
section: Operational Guides
---

`tars start --name NAME --role ROLE` can create a named PM2 process and persists that identity in the
selected `TARS_HOME`. This remains an advanced deployment pattern: a role is metadata rather than an
independent agent type, and the operator must select the correct home for every command.

## Required isolation

Every concurrently running process needs:

- a distinct `TARS_HOME` containing its own session, tasks, chats, skills, and extensions;
- a distinct PM2 process name;
- its own Discord bot and preconfigured owner ID;
- a distinct dashboard port, if enabled;
- separately reviewed credentials and extension enablement.

Never point two processes at the same home. Cross-process task locking does not make the rest of the
workspace safe to share.

## Operations

Set `TARS_HOME` to the intended instance before every CLI operation. Lifecycle and destructive
commands scope PM2 discovery to that canonical home and preserve intentionally stopped state, but
you should still verify the selected home before stop, refresh, import, uninstall, or log operations.
Test backup and rollback for each instance before relying on this layout.

If strong isolation is required, use separate OS users or hosts rather than process names alone.
