---
name: manage-extensions
description: Audits, enables, disables, and refreshes trusted local MCP extensions.
---

# Manage MCP extensions

Extensions live in `~/.tars/extensions/`. Each extension directory contains a
`tars-extension.json` manifest. Authorization is stored in
`~/.tars/extensions/extension-enablement.json`.

## Inspect

Before changing state:

```bash
tars extensions audit
```

1. List extension directories and resolve symlinks.
2. Read the manifest and enablement entry.
3. Review the command, arguments, working directory, explicit environment, `envAllowlist`, and
   startup/tool timeouts.
4. Treat all extension code and dependencies as trusted native code, not sandboxed content.

For legacy entries without an explicit environment policy, use `tars extensions migrate`. Its
source scan provides suggestions only; verify every selected name against the extension code.

## Enable or disable

Use an explicit allowlist entry:

```json
{
    "extension-name": {
        "enabled": true,
        "envAllowlist": ["REQUIRED_API_KEY"],
        "startupTimeoutMs": 30000,
        "toolTimeoutMs": 60000
    }
}
```

Set `enabled` to `false` or remove the entry to prevent the extension from loading. Keep the JSON
valid and grant only variables the server needs.

## Install or refresh

For repository-packaged extensions, use the transactional refresh command:

```bash
tars refresh --extensions-only
```

For a user extension, stage and validate the directory before placing it under
`~/.tars/extensions/`. Do not execute an unreviewed install script. Ask the operator to restart Tars
after an enablement or manifest change.

`tars restart` opens the guided migration when unresolved policies exist and continues only after
the review succeeds. Non-interactive restarts fail safely instead of choosing a policy.

If a tool is missing, inspect startup logs and enablement rather than running the MCP server directly
or guessing a tool name. Unique tools keep their declared names; collisions receive deterministic
extension namespaces.
