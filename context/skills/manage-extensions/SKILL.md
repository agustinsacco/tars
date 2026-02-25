---
name: extension-manager
description: Enable, disable, list, and install MCP extensions at runtime.
---

# manage-extensions Guide Skill

Use this skill when you need to manage Tars' MCP extensions. Tars integrates extensions from `~/.tars/.gemini/extensions/`.

## How It Works

Tars performs **Extension Discovery** at startup. It scans the extensions directory for `gemini-extension.json` files. Enablement state and safety overrides are persisted in `~/.tars/.gemini/extensions/extension-enablement.json`.

## Operational Tasks

### 1. List Installed Extensions

Check the contents of the extensions directory and the enablement file.

```bash
# List all extension directories
ls -F ~/.tars/.gemini/extensions/

# Check enablement and safety overrides
cat ~/.tars/.gemini/extensions/extension-enablement.json
```

### 2. Enable/Disable an Extension

Modify `~/.tars/.gemini/extensions/extension-enablement.json`.

To **enable** or reconfigure an extension, add an entry with trusted path overrides:

```json
{
    "extension-name": {
        "overrides": ["/home/user/src/*"]
    }
}
```

To **disable**, simply remove its key from the JSON object.

### 3. Install a New Extension

1. Create a directory in `~/.tars/.gemini/extensions/<name>`.
2. Add a `gemini-extension.json` manifest.
3. Add the extension server code (prefer plain JavaScript for runtime extensions).
4. Register it in `extension-enablement.json`.
5. Restart Tars.

### 4. Restart Tars

Changes to extensions (installing or modifying manifests) require a system restart to be picked up by the Gemini Core.

```bash
tars stop && tars start
```

## Important Notes

1. **JS vs TS**: Extensions created at runtime should use **plain JavaScript** with ESM (`type: "module"` in `package.json` or `.js` extension with `import`/`export`) to avoid a compilation step.
2. **Path Substitution**: Use `${extensionPath}` in your `gemini-extension.json` `args` or `env` to ensure paths resolve correctly regardless of the host's absolute path.
3. **Safety**: Always include appropriate path patterns in the `overrides` array in `extension-enablement.json` to allow the extension to access your workspace.
