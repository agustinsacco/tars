# Tars

<p align="center">
  <img src="https://raw.githubusercontent.com/agustinsacco/tars/main/assets/logo.png" alt="Tars" width="260" />
</p>

Tars is a compact, local-first AI assistant for Discord and terminal workflows. It runs as a
bare-metal Node.js process managed by PM2, supports cloud providers and OpenAI-compatible local
endpoints, and adds durable memory, explicit scheduled tasks, local skills, and MCP extensions.

Tars is designed for operators who want a small self-hosted assistant with a transparent workspace
at `~/.tars/`. It is competitive with broader local-assistant projects such as
[OpenClaw](https://docs.openclaw.ai/) in this narrower operating model; it does not claim parity with
their multi-agent, mobile, voice, or broad multi-channel ecosystems.

## What it provides

- Discord and interactive terminal interfaces backed by one active agent.
- Google, OpenAI, Anthropic, local, and custom OpenAI-compatible model configuration.
- Durable facts, searchable notes, and scheduled tasks through built-in MCP extensions.
- A PM2-managed supervisor with explicit cron execution, maintenance, and bounded initiative modes.
- Local skills and explicitly enabled MCP servers with restricted subprocess environments.
- Backup and restore commands with secret exclusion by default and transactional imports.
- Defensive defaults for Discord ownership, dashboard access, outbound fetching, attachments, and
  sensitive log redaction.

Tars is not a sandbox. Model tools and trusted extensions run with the permissions of the operating
system user. Use a dedicated least-privilege account, review installed skills and extensions, and
keep credentials out of prompts and repositories. See the [security model](https://tars.saccolabs.com/capabilities/security/).

## Install

Prerequisites:

- Node.js 22.19 or newer
- npm 10.9 or newer
- A supported model provider or an OpenAI-compatible endpoint
- A Discord bot token and preconfigured owner user ID for the Discord channel

```bash
npm install -g @saccolabs/tars
tars setup
tars extensions audit
tars start
tars status
```

Use `tars chat --no-discord` for a foreground terminal session with Discord disabled. It does not
start the background heartbeat, cron service, dashboard, or a second Discord connection. It still
uses the configured `TARS_HOME`. Run `tars stop` first: Tars refuses foreground chat while a matching
PM2 engine is active and holds a cross-process home lease for the full terminal session. Exit chat
before running setup, start, stop, restart, import, export, refresh, update, uninstall, secret
writes, or memory index operations; those commands refuse a live lease.

## Common commands

| Command                            | Purpose                                                    |
| ---------------------------------- | ---------------------------------------------------------- |
| `tars setup`                       | Create or update the local configuration.                  |
| `tars start` / `tars stop`         | Start or stop PM2 processes for the configured Tars home.  |
| `tars restart`                     | Review policies if needed, then restart active processes.  |
| `tars status`                      | Show process and active-session metrics.                   |
| `tars doctor`                      | Run read-only health and security diagnostics.             |
| `tars repair plan`                 | Show registered safe repairs without changing state.       |
| `tars logs`                        | Follow logs for the configured supervisor.                 |
| `tars chat --no-discord`           | Start foreground chat without Discord or schedulers.       |
| `tars secret set KEY`              | Store a secret read from standard input in `~/.tars/.env`. |
| `tars extensions audit`            | Inspect custom MCP environment and working-dir policies.   |
| `tars extensions migrate`          | Interactively migrate legacy custom extension policies.    |
| `tars memory search QUERY`         | Search the local knowledge index.                          |
| `tars export` / `tars import FILE` | Back up or restore the Tars workspace.                     |
| `tars update`                      | Stage, validate, install, and restart an available update. |
| `tars refresh`                     | Rebuild packaged dashboard and extensions transactionally. |

Run `tars --help` for the complete command reference.

Keep secret values out of shell history, process arguments, and tool logs. Read a value without
echoing it, pipe it to Tars, and then clear the temporary shell variable:

```bash
read -rs TARS_SECRET_VALUE
printf '%s' "$TARS_SECRET_VALUE" | tars secret set KEY
unset TARS_SECRET_VALUE
```

Custom extensions must explicitly list the host environment-variable names they receive. Audit
them with `tars extensions audit`; use the guided `tars extensions migrate` flow for older entries.
The migration scans extension source for likely names but requires an operator decision and never
prints or copies secret values. `tars restart` launches the same review when required and continues
the restart only after every blocking policy is resolved.

Common memory, search, and task tools stay directly available to the model. Specialized MCP schemas
are discovered and invoked through a compact catalog, avoiding the recurring context cost of every
browser, brokerage, commerce, and health tool definition on unrelated turns.

## Runtime layout

```text
Discord / terminal
        │
        ▼
Channel manager ──► Supervisor ──► Tars engine / model
                         │                    │
                         │                    └── MCP extensions
                         ├── active session
                         ├── cron service
                         └── maintenance heartbeat

~/.tars/
├── config.json          non-secret settings
├── .env                 local secrets (restricted permissions)
├── system.md            system instructions
├── skills/              trusted instruction packages
├── extensions/          trusted MCP servers
├── chats/               conversation history
├── data/                sessions, tasks, memory, and indexes
└── logs/                redacted operational logs
```

Configuration precedence is exported environment variables, then `~/.tars/.env`, then
`~/.tars/config.json`, then validated defaults. Values such as intervals, context limits,
compression thresholds, and rate limits are bounded during loading.

## Documentation

- [User documentation](https://tars.saccolabs.com/)
- [Architecture](https://github.com/agustinsacco/tars/blob/main/docs/ARCHITECTURE.md)
- [Development guide](https://github.com/agustinsacco/tars/blob/main/docs/DEVELOPMENT.md)
- [Operations guide](https://github.com/agustinsacco/tars/blob/main/docs/OPERATIONS.md)
- [Contributing](https://github.com/agustinsacco/tars/blob/main/CONTRIBUTING.md)

Build the documentation locally with `npm run docs:build` or run it with `npm run docs:dev`.

## Project status and boundaries

- Discord is the supported daemon channel; terminal chat is available in the foreground.
- Foreground chat uses the same `TARS_HOME`; daemon/chat and chat/mutation exclusivity are enforced.
- Heartbeat maintenance continues while the owner is idle. The initiative service can observe,
  propose, or apply registered safe repairs from explicit objectives and runtime findings.
- Scheduled tasks are explicit and poll on a separate cron loop.
- Tars has one active agent and does not implement sub-agent orchestration.
- Multiple PM2 process names can be created, but the convenience lifecycle commands are not fully
  instance-aware. Treat multi-instance deployments as advanced and isolate each `TARS_HOME`.
- Redaction reduces accidental disclosure in logs and events; it is not data-loss prevention,
  prompt-injection protection, or a security boundary.

## Development

```bash
npm ci
npm run ci:extensions
npm run check
npm run build
npm run test:extensions
```

See [CONTRIBUTING.md](CONTRIBUTING.md) before submitting a change. Releases and npm publishing are
managed by Release Please; do not edit the package version manually.

## License

[MIT](LICENSE) © Agustin Sacco
