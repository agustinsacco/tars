# Development guide

## Requirements

- Node.js 22.19 or newer (22.23.4 or newer for documentation)
- npm 10.9 or newer
- Git

No vendor-specific model CLI is required. Tars integrates providers through the Pi Agent SDK.

## Bootstrap

```bash
git clone https://github.com/agustinsacco/tars.git
cd tars
npm ci
npm run ci:extensions
npm run check
npm run build
npm run test:extensions
```

`npm link` is optional if you want the local build available as the global `tars` command.

## Run locally

Use watch mode for supervisor development:

```bash
npm run dev
```

The production entry point is guarded by `TARS_SUPERVISOR_MODE`; use `tars start` for a PM2-managed
installation. Do not use `npm run start` to change a running installation's configuration or
lifecycle.

To exercise the engine and tool event stream without Discord:

```bash
TARS_SUPERVISOR_MODE=true npx tsx src/scripts/debug-cli.ts "summarize the current session"
```

For the user-facing terminal interface, use:

```bash
tars chat --no-discord
```

## Repository map

```text
src/cli/            command definitions and lifecycle operations
src/channels/       Discord and terminal adapters
src/config/         schema-validated runtime configuration
src/supervisor/     engine, sessions, heartbeat, cron, MCP bridge, and routing
src/memory/         knowledge indexing
src/utils/          paths, logging, process discovery, migration, and safety helpers
src/tests/          unit and integration tests
extensions/         built-in MCP packages (memory, tasks, search)
context/            files and built-in skills installed into TARS_HOME
dash/               optional Next.js dashboard
site/               Astro documentation site
```

## Validation

Core:

```bash
npm run check
npm run build:src
npm run test:extensions
```

Built-in extensions:

```bash
for extension in memory tasks search; do
  npm ci --prefix "extensions/$extension"
  npm run build --prefix "extensions/$extension"
done
```

Dashboard and documentation:

```bash
npm ci --prefix dash
npm run dashboard:lint
npm run dashboard:typecheck
npm run dashboard:build

npm ci --prefix site
npm run docs:check
npm run docs:build
```

## Pinned Pi dependency security

Pi stays pinned to `0.85.1` for the worker RPC contract. Its published shrinkwrap
can reinstall vulnerable nested dependencies even when the root lockfile and npm
overrides select patched versions. Root `npm ci` runs a fail-closed postinstall
that replaces those nested copies with the installed, integrity-checked root
packages. Do not skip root lifecycle scripts when running Pi.

After intentionally updating dependencies, run `npm run deps:repair-pi` to align
Pi's nested lock entries with those same npm-resolved replacements, then repeat
a clean `npm ci`, `npm audit --include=dev --audit-level=high`, and the complete
validation suite. The repair does not download packages, change Pi's source or
version, remove audit entries, or weaken the security checks. Older minimatch and
Undici major versions are not globally replaced: overrides target only the
vulnerable ranges; Discord retains patched Undici 6.

## Development conventions

- Use TypeScript and ES modules.
- Validate data at file, network, process, and message boundaries.
- Avoid `any` and unchecked type assertions.
- Prefer atomic writes for state and safe staging for archive/package replacement.
- Keep secrets out of command arguments, logs, tests, fixtures, and committed files.
- Add regression tests for access control, path containment, SSRF, archive handling, and recovery
  behavior when those areas change.
- Use Conventional Commits. Release Please owns package versions and releases.

## Debugging

```bash
tars status
tars logs
pm2 logs tars-supervisor --raw
```

Inspect `~/.tars/data/session.json` for session metadata and `~/.tars/data/tasks.json` for scheduled
task state. Durable facts are under `~/.tars/data/memory/`. Logs redact common secret material, so
diagnostics may intentionally omit sensitive tool arguments or output.

When a built-in extension or dashboard asset changes, rebuild the installed copy with `tars refresh`
and restart as directed. Refresh stages and validates the replacement before swapping it into place.
Bundled extensions use managed copies by default. Set `TARS_DEV_EXTENSION_LINKS=true` only when a
source-development installation intentionally needs links back to this checkout.
