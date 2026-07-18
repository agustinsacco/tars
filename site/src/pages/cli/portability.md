---
layout: ../../layouts/DocLayout.astro
title: Backup and Restore
description: Create a credential-filtered workspace archive and restore it transactionally.
section: CLI
---

Tars state lives under `TARS_HOME`, normally `~/.tars/`.

## Export

```bash
tars export
tars export --output ./tars-backup.tar.gz
```

The default export includes configuration structure, memory, tasks, sessions, skills, and
extensions. It excludes known credential files and redacts recognized secret-bearing JSON keys on a
best-effort basis. This is not comprehensive DLP: notes, malformed or large JSON, and custom
extension build artifacts may contain sensitive values. Treat every archive as sensitive.

If an installed CLI exposes `--include-secrets`, it is an explicit high-risk opt-in. Use it only for
an encrypted, access-controlled transfer and remove the archive after restoration.

## Import

Stop the supervisor, then import a trusted archive:

```bash
tars stop
tars import ./tars-backup.tar.gz
tars status
```

Import preflights archive paths and links, extracts to a staging directory, validates the Tars
marker and layout, backs up the current home, and swaps atomically. A failed validation or swap
leaves the current installation intact or rolls it back.

Do not manually extract an untrusted archive into `~/.tars/`.

## Machine migration

Install the same or newer Tars version on the destination, copy the archive over a protected
channel, import it, then re-enter excluded secrets with `tars secret set`. Review extension paths and
enablement before starting the supervisor.
