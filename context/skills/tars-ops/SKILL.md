---
name: tars-ops
description: Operates and maintains a Tars installation through supported CLI commands.
---

# Tars operations

Use supported `tars` commands for configuration, secrets, backup, and maintenance. Do not start the
compiled supervisor directly or use `npm run start` to control an installed instance.

## Inspect before changing

```bash
tars status
tars logs
tars quota
tars extensions audit
tars doctor
```

`status` reports the PM2 process and active session. Use logs for heartbeat, cron, extension, and
task diagnostics.

## Secrets

Ask the operator to run secret entry in their own interactive shell. Do not request the value in
chat or execute secret entry through a model-visible tool call.

```bash
read -rs TARS_SECRET_VALUE
printf '%s' "$TARS_SECRET_VALUE" | tars secret set KEY
unset TARS_SECRET_VALUE
tars secret list
tars secret remove KEY
```

Secrets live in `~/.tars/.env` with restricted permissions. The list command prints names only.
Common provider keys include `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, and `TARS_API_KEY`; Discord uses
`DISCORD_TOKEN`. Never place a secret value in a command argument, prompt, memory, or log. Ask the
operator to restart after a secret change.

## Memory

```bash
tars memory search relevant terms
tars memory sync
```

Memory sync indexes durable facts, skills, and eligible chat history. Prefer the native
`manage_facts` and `manage_notes` tools when they are available in the current agent session.

## Backup and refresh

```bash
tars export --output ./tars-backup.tar.gz
tars import ./tars-backup.tar.gz
tars refresh
```

Exports filter known credential paths and recognized JSON keys on a best-effort basis; always treat
the archive as sensitive. Import and refresh stage, validate, and atomically swap data with rollback.
Do not manually extract an untrusted archive into `~/.tars/`.

## Restart boundary

An assistant running inside the supervisor must not stop or restart its own process. Explain the
reason and ask the operator to run:

```bash
tars restart
```

Restart automatically opens the guided extension-policy migration when an enabled custom MCP
server still uses a legacy environment policy. The operator must make those trust decisions in an
interactive shell. For a standalone review or migration, use:

```bash
tars extensions audit
tars extensions migrate
```

Stop the daemon before using `tars chat --no-discord` for foreground troubleshooting. The CLI
refuses to start a second engine against an active Tars home.

## Safety rules

- Treat `~/.tars/extensions/` as trusted executable code and maintain an explicit enablement file.
- Do not recursively delete Tars directories. Use the guarded `tars uninstall` flow when removal is
  requested and confirm backup expectations first.
- Do not log or echo secret values.
- Heartbeat maintenance continues while the owner is idle. The initiative service may observe,
  propose, or apply registered safe repairs according to the configured initiative mode; cron still
  runs explicit scheduled tasks.
- Use the tool names actually present in the session. Built-ins are consolidated as `manage_tasks`,
  `manage_facts`, and `manage_notes`.
