---
layout: ../../layouts/DocLayout.astro
title: Process Management
description: Starting, stopping, and monitoring the Tars supervisor process.
section: CLI Reference
---

## tars start

Launches the Tars supervisor as a PM2-managed background process.

```bash
tars start
```

Behind the scenes, this runs:

```bash
pm2 start tars-supervisor
```

The supervisor starts the Heartbeat, connects to Discord, and begins processing messages.

### Safety Check

The supervisor sets `TARS_ACTIVATED=true` in its environment. If you accidentally run the supervisor directly (`npm run start`), it checks for this variable and refuses to start without it. This prevents configuration deadlocks.

## tars stop

Stops the background process.

```bash
tars stop
```

Equivalent to `pm2 stop tars-supervisor`. The Discord bot disconnects and the heartbeat stops.

## tars status

Displays system health and session statistics.

```bash
tars status
```

Shows:

- PM2 process status (online/stopped)
- Current session ID and uptime
- Token usage (input, output, cached, net)
- Interaction count
- Heartbeat interval and last tick time

## tars logs

Streams real-time logs from the supervisor.

```bash
tars logs
```

Equivalent to `pm2 logs tars-supervisor`. Shows all supervisor output including:

- Discord message handling
- Heartbeat ticks and task execution
- Memory sync operations
- Gemini CLI interactions
- Error traces

### Debug logs

For deeper debugging, check the raw Gemini CLI output:

```bash
ls /tmp/gemini-debug-*.log
```

These timestamped files contain the raw JSON line stream from the CLI subprocess.
