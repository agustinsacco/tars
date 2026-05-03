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

The supervisor sets `TARS_ACTIVATED=true` in its environment. If you accidentally run the supervisor directly (`npm run start`), it checks for this environment variable and terminates immediately.

## tars restart

Checks for updates and restarts the supervisor service.

```bash
tars restart
```

This command performs an auto-update:

1. Checks the npm registry for the latest version of `@saccolabs/tars`.
2. If a newer version is found, it installs it globally.
3. Stops the running supervisor.
4. Starts the supervisor again (using the new version if updated).

## tars update

Force checks for a new version on npm, upgrades the package, **refreshes all components**, and restarts.

```bash
tars update
```

This is the recommended way to upgrade Tars. It performs:

1. Checks npm for the latest `@saccolabs/tars` version.
2. If a newer version exists, installs it globally.
3. **Automatically refreshes** the dashboard and extensions from the new package (see `tars refresh`).
4. If Tars is currently running, restarts the supervisor to apply changes.

> **Note:** Unlike `tars setup`, this command does not re-prompt for configuration. It only upgrades the package and rebuilds components.

## tars refresh

Rebuilds the dashboard and extensions from the currently installed package without changing any configuration.

```bash
tars refresh
```

This is useful when:

- You've updated Tars and the dashboard didn't get rebuilt.
- You want to force-reinstall extensions after a manual change.
- You're developing extensions locally and want to re-hydrate.

### Options

| Flag                | Description                |
| ------------------- | -------------------------- |
| `--dashboard-only`  | Only refresh the dashboard |
| `--extensions-only` | Only refresh extensions    |

### Examples

```bash
# Refresh everything
tars refresh

# Only rebuild the dashboard
tars refresh --dashboard-only

# Only rebuild extensions
tars refresh --extensions-only
```

The refresh process:

1. Locates the bundled source (`dash/`, `extensions/`) inside the installed npm package.
2. Deletes the existing copies at `~/.tars/apps/dashboard/` and `~/.tars/.gemini/extensions/`.
3. Copies the latest source and runs `npm install` + `npm run build`.

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
- Heartbeat and **Cron Service** intervals
- Number of active background tasks monitored
- Last tick time for both maintenance and task runners

## tars logs

Streams real-time logs from the supervisor.

```bash
tars logs
```

Equivalent to `pm2 logs tars-supervisor`. Shows all supervisor output including:

- Discord message handling
- Heartbeat ticks and **Cron Service task checks**
- Memory sync operations
- Gemini CLI interactions
- Extension hydration and build logs
- Error traces

### Debug logs

For deeper debugging, check the raw Gemini CLI output:

```bash
ls /tmp/gemini-debug-*.log
```

These timestamped files contain the raw JSON line stream from the CLI subprocess.
