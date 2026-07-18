---
name: create-extension
description: Creates a trusted local MCP extension with bounded tools and explicit enablement.
---

# Create an MCP extension

Use this guide only when the user asks for a new local tool or integration. MCP extensions execute
as trusted subprocesses with the permissions of the Tars operating-system user.

## Plan first

1. Define the minimum operations and external systems required.
2. Prefer one cohesive action-based tool over many granular tools.
3. Specify input validation, timeouts, output limits, credential handling, and recovery behavior.
4. Ask before installing dependencies or contacting an external service if that authority was not
   already part of the request.

## Layout

Create the extension under `~/.tars/extensions/<name>/`:

```text
<name>/
├── package.json
├── server.js
└── tars-extension.json
```

Plain ESM JavaScript avoids a build step for user-created extensions. Validate untrusted inputs with
Zod or an equivalent schema and return structured MCP errors.

## Manifest

```json
{
    "name": "example-extension",
    "version": "1.0.0",
    "mcpServers": {
        "main": {
            "command": "node",
            "args": ["${extensionPath}/server.js"],
            "cwd": "${extensionPath}",
            "envAllowlist": ["EXAMPLE_API_KEY"],
            "startupTimeoutMs": 30000,
            "toolTimeoutMs": 60000
        }
    }
}
```

Use `process.env.EXAMPLE_API_KEY` in code. Ask the operator to store the value from their own
interactive shell; do not request it in chat or pass it through a model-visible tool call:

```bash
read -rs TARS_SECRET_VALUE
printf '%s' "$TARS_SECRET_VALUE" | tars secret set EXAMPLE_API_KEY
unset TARS_SECRET_VALUE
```

Never hardcode, log, or pass a credential as a command argument. Only variables named in
`envAllowlist`, manifest-defined values, and the minimal runtime environment are passed to the
subprocess.

## Enable and verify

Add an explicit entry to `~/.tars/extensions/extension-enablement.json`:

```json
{
    "example-extension": {
        "enabled": true,
        "envAllowlist": ["EXAMPLE_API_KEY"]
    }
}
```

Then ask the operator to restart Tars. Confirm the expected tool appears, exercise a read-only call,
and test invalid input and timeout behavior before any state-changing call.
