---
layout: ../../layouts/DocLayout.astro
title: Process and Chat
description: Manage the configured supervisor and run a foreground terminal session.
section: CLI
---

## Supervisor lifecycle

```bash
tars start
tars status
tars logs
tars restart
tars stop
```

`start` registers the compiled supervisor with PM2 as `tars-supervisor`. `restart` restarts active
processes for the configured `TARS_HOME` without installing an update; use `tars update` explicitly
when you intend to change the package. `logs` follows the configured process. `status` reports process
and active-session metrics; it does not prove that heartbeat, cron, or a particular task tick
succeeded.

Use lifecycle commands from an operator shell. A running assistant should not stop its own process
mid-response.

## Terminal chat

```bash
tars chat --no-discord
```

This foreground mode starts the terminal channel without Discord, dashboard, heartbeat, cron, or
other duplicate daemon services. It still uses the configured `TARS_HOME`, so avoid sending
concurrent prompts to a running daemon. Press Ctrl+C to exit.

## Updates and refresh

```bash
tars update
tars refresh
tars refresh --dashboard-only
tars refresh --extensions-only
```

`update` installs a newer npm package when available. `refresh` rebuilds packaged assets from the
current installation using staged builds, atomic replacement, and rollback on failure.

## Other diagnostics

```bash
tars quota
tars discord
```

`quota` reports tracked provider rate-limit information. `discord` prints setup instructions.

## Named processes

`tars start --name NAME --role ROLE` can create a named PM2 process, but the convenience lifecycle
and log commands are not all instance-aware. Do not point two processes at the same `TARS_HOME`; see
[Multiple Instances](/use-cases/multiple-instances).
