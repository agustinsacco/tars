---
layout: ../../layouts/DocLayout.astro
title: MCP Extensions
description: Add explicitly authorized local tools through MCP subprocesses.
section: Capabilities
---

An extension is a local Model Context Protocol server described by
`~/.tars/extensions/<name>/tars-extension.json`. Tars starts authorized servers over stdio and maps
their schemas to agent tools.

## Strict enablement

`~/.tars/extensions/extension-enablement.json` is required. If it is absent, invalid, or does not
contain an extension directory, that extension does not load. Bootstrap creates and preserves the
file for bundled extensions.

Entries can be booleans or objects:

```json
{
    "tars-memory": true,
    "example": {
        "enabled": true,
        "envAllowlist": ["EXAMPLE_API_KEY"],
        "startupTimeoutMs": 30000,
        "toolTimeoutMs": 60000
    },
    "disabled-example": false
}
```

For legacy object entries, a missing `enabled` property means enabled.

Custom extensions must explicitly declare an environment policy for every server. Use
`"envAllowlist": []` when no host variables are needed, or list only the required names. Tars blocks
updates while an enabled legacy extension lacks this acknowledgment, so tools cannot disappear only
after the production restart. External working directories are no longer accepted; keep `cwd`
inside the extension directory.

Bundled extensions are installed as managed copies. Bootstrap converts legacy bundled-extension
symlinks to managed copies; `TARS_DEV_EXTENSION_LINKS=true` is an explicit source-development mode,
not a production setting.

## Process boundaries

Servers receive a minimal runtime environment, explicitly allowlisted host variables, manifest
values, and `TARS_HOME`. A manifest can also set a working directory inside its own extension path
and bounded startup/tool timeouts.

Unique tool names stay unchanged. When servers declare the same tool name, Tars applies a stable
extension namespace to the collision.

## Trust model

Process separation is not a sandbox. Extension code runs with the Tars OS user's filesystem and
network permissions. Review its source and dependencies, allowlist only required credentials, and
disable unused extensions.
