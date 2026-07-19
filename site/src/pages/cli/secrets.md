---
layout: ../../layouts/DocLayout.astro
title: Secrets
description: Store credential values locally without putting them in config.json.
section: CLI
---

## Commands

```bash
read -rs TARS_SECRET_VALUE
printf '%s' "$TARS_SECRET_VALUE" | tars secret set OPENAI_API_KEY
unset TARS_SECRET_VALUE
tars secret list
tars secret remove OPENAI_API_KEY
```

Secrets are stored in `~/.tars/.env` with restricted permissions. `list` prints key names, never
values. Passing the value through standard input keeps it out of shell history, process arguments,
and tool logs. Restart the supervisor after a change.

Configuration precedence is:

1. environment already exported to the process;
2. `~/.tars/.env`;
3. `~/.tars/config.json`;
4. validated defaults.

Loading `.env` does not overwrite an already exported value.

Never put credentials in `config.json`, prompts, memory, skill files, logs, or source control. MCP
extensions receive only the minimal runtime environment plus variables explicitly listed in their
manifest or enablement `envAllowlist`.

Run `tars extensions audit` after adding an extension or changing its credentials. The audit and
guided migration handle variable names only; they never display credential values. See
[Extension Policy Audit](/cli/extensions).

Secret redaction in logs and events is a defense-in-depth measure, not comprehensive DLP. Avoid
passing a secret to a model or tool in the first place.
