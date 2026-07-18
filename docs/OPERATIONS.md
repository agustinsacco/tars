# Operations guide

## Start and inspect Tars

```bash
tars start
tars status
tars logs
```

`status` reports PM2 process and active-session metrics. It is not a heartbeat, cron, or task-run
health report. Use logs for service-level diagnostics.

Use `tars stop` or `tars restart` only from an operator shell. An assistant running inside that
process should ask the operator to restart so it is not terminated mid-response.

## Configuration and secrets

Run `tars setup` for supported configuration. Use the secrets command for credential values:

```bash
read -rs TARS_SECRET_VALUE
printf '%s' "$TARS_SECRET_VALUE" | tars secret set OPENAI_API_KEY
unset TARS_SECRET_VALUE
tars secret list
tars secret remove OPENAI_API_KEY
tars restart
```

The list command prints keys only. `~/.tars/.env` should remain owner-readable only. Exported
environment variables take precedence over that file, followed by `config.json` and defaults.
Pass secret values through standard input so they do not appear in shell history, process arguments,
or tool logs.

## Back up and restore

```bash
tars export --output ./tars-backup.tar.gz
tars import ./tars-backup.tar.gz
```

Exports exclude known credential files and redact recognized JSON keys on a best-effort basis. They
are not guaranteed secret-free, so always use an encrypted, access-controlled transfer and remove
the archive afterward. `--include-secrets` is an explicit high-risk opt-in.

Import validates archive members and links, extracts to a staging directory, verifies the Tars
layout, backs up the current home, and swaps atomically. A failed import rolls back. Stop the
supervisor before a migration and run `tars status` after restoration.

## Refresh packaged assets

```bash
tars refresh
tars refresh --dashboard-only
tars refresh --extensions-only
```

Refresh builds in staging and replaces installed dashboard or extension assets only after a
successful build. A failed replacement rolls back. It does not update the npm package version;
`tars update` handles package updates.

## Dashboard

The optional dashboard is disabled by default. Setup generates a strong password when the dashboard
is enabled, stores `DASH_HOST=127.0.0.1`, and preserves an existing password only when it meets the
current policy. The server refuses to start with a missing, known-default, or shorter-than-16-character
password.

Keep the loopback bind and reach it through an authenticated tunnel. If you intentionally expose it,
put TLS and an additional access-control layer in front of it. Basic authentication and rate limits
reduce risk but do not make the dashboard safe for an untrusted network.

## Extensions

Review `~/.tars/extensions/extension-enablement.json` before restart. It is a strict allowlist; an
absent or invalid file disables all extensions. Omit a custom extension or set `enabled: false` to
prevent it from running. Bootstrap authorizes missing bundled-extension entries but preserves an
explicit `false` and never silently authorizes other installed directories.

Grant only required environment variables through each server's `envAllowlist`. Extension code is a
trusted local subprocess and has no sandbox.

Every custom MCP server must explicitly declare `envAllowlist`, including an empty array when it
needs no inherited variables. `tars update` blocks before installation if an enabled legacy server
has not acknowledged this policy or configures a working directory outside its extension.

Bundled extensions are installed as managed copies. Bootstrap converts legacy bundled-extension
symlinks to copies so an installed release does not depend on a source checkout. Source developers
who intentionally need live links can set `TARS_DEV_EXTENSION_LINKS=true`; production installations
should use `tars refresh --extensions-only` instead.

## Recovery and removal

Keep a recent protected export before upgrades. `tars uninstall` accepts only a recognized Tars
home and refuses broad or dangerous targets such as `/`, the OS home directory, the current
workspace, or an arbitrary unmarked `TARS_HOME`.

For an interrupted operation, inspect logs and any reported backup path before changing files
manually. Prefer restoring the generated backup over copying partial staged directories.

## Foreground ownership

Run `tars stop` before `tars chat`. This is enforced: foreground chat refuses a matching PM2 engine
and retains a cross-process lease for its entire lifetime. Exit chat before running any command that
changes the configured home or its managed process state, including setup, start, stop, restart,
import, export, refresh, update, uninstall, secret set/remove, or memory index operations. Those
commands fail closed while the lease owner is live; status and logs remain available. Memory search
is guarded because opening its local SQLite index can initialize files. A verified lease from a dead
process or an earlier boot is removed automatically.

## Multiple instances

Named PM2 processes are available through `tars start --name NAME --role ROLE`. Lifecycle commands
discover processes by canonical `TARS_HOME`, but this is still not turnkey multi-instance support.

If multiple instances are required:

1. Give every process a distinct, validated `TARS_HOME` and Discord bot/owner configuration.
2. Use distinct PM2 names and dashboard ports.
3. Export the intended `TARS_HOME` before every CLI operation and verify it before destructive work.
4. Test backup, refresh, stop, and rollback behavior for each home before production use.

Never point two running processes at the same session, task, or extension state.
