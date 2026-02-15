---
name: extension-manager
description: Enable, disable, list, and install Gemini CLI extensions at runtime.
---

# manage-extensions Guide Skill

This skill allows Tars to manage Gemini CLI extensions — listing, enabling, disabling, and installing them.

## How It Works

Extensions are managed via the `gemini extensions` CLI commands. Because Tars spawns a fresh `gemini chat` process for each interaction, any changes made during one message take effect on the **next message** automatically.

Extension enablement state is persisted in:
`~/.tars/.gemini/extensions/extension-enablement.json`

## Commands

All commands below should be executed via `run_shell_command`. The `GEMINI_CLI_HOME` environment variable is already set in your shell environment.

### List Extensions

```bash
gemini extensions list
```

Shows all installed extensions, their enabled/disabled state, and their MCP servers.

### Disable an Extension

```bash
gemini extensions disable <name>
```

Disables the extension for the current user scope. It will no longer load on the next interaction.

- `--scope user` — Disable for the user (default).
- `--scope workspace` — Disable only for the current project.

### Enable an Extension

```bash
gemini extensions enable <name>
```

Re-enables a previously disabled extension.

### Install an Extension

```bash
gemini extensions install <path-or-url>
```

Installs a new extension from a local directory or remote URL.

### Link an Extension (Development)

```bash
gemini extensions link <path>
```

Creates a symlink to a local extension directory. Changes to the source are reflected immediately without reinstalling.

## Important Notes

1. **Changes are deferred**: Enable/disable only takes effect on the **next** `gemini chat` invocation. Since Tars spawns a fresh process per Discord message, changes apply on the next message.
2. **State file**: The enablement state is stored in `extension-enablement.json`, not in `settings.json`.
3. **Scope**: Use `--scope workspace` if you only want to toggle an extension for a specific project context.
4. **Discovery**: If an extension's MCP server fails to connect at startup, it will show an error in the logs but won't crash the session.
