<p align="center">
  <img src="https://raw.githubusercontent.com/agustinsacco/tars/main/assets/logo.png" alt="Tars logo" width="220" />
</p>

<h1 align="center">Tars</h1>

<p align="center">
  <strong>A personal AI assistant that lives on your machine.</strong><br />
  Chat from Discord or the terminal, bring the model you already pay for, and keep every memory,
  task, and log in one folder you can read.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@saccolabs/tars"><img src="https://img.shields.io/npm/v/@saccolabs/tars?color=f97316&label=npm" alt="npm version" /></a>
  <a href="https://github.com/agustinsacco/tars/actions/workflows/validate.yml"><img src="https://github.com/agustinsacco/tars/actions/workflows/validate.yml/badge.svg" alt="CI status" /></a>
  <a href="https://github.com/agustinsacco/tars/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-f97316" alt="MIT license" /></a>
  <img src="https://img.shields.io/badge/node-%3E%3D22.19-3c873a" alt="Node.js 22.19 or newer" />
</p>

<p align="center">
  <a href="https://tars.saccolabs.com/">Documentation</a> ·
  <a href="https://tars.saccolabs.com/getting-started/installation/">Install</a> ·
  <a href="https://tars.saccolabs.com/capabilities/security/">Security model</a> ·
  <a href="https://github.com/agustinsacco/tars/blob/main/CHANGELOG.md">Changelog</a>
</p>

---

## Why Tars

Most AI assistants live in someone else's cloud. Tars is a single Node.js process on hardware you
control, supervised by PM2, with its whole world under `~/.tars/`: configuration, conversations,
memory, schedules, skills, extensions, and logs. Open the folder and you can see everything it knows
and everything it did.

- **It answers to one person.** The Discord bot only accepts messages from the preconfigured owner.
  Nothing anyone types in a chat can claim ownership.
- **Bring the model you already pay for.** Sign in with Claude Pro or Max, ChatGPT Plus or Pro, or
  GitHub Copilot through native OAuth. Use an API key for Anthropic, OpenAI, Google, OpenRouter, and
  every other provider in the pi model registry. Or point Tars at Ollama or any OpenAI-compatible
  endpoint.
- **Memory that survives restarts.** Curated workspace files are loaded into every prompt. Durable
  facts are flushed before context is compressed, and a nightly consolidation pass keeps them tidy.
- **Background work you can audit.** Scheduled tasks are explicit, each with its own delivery
  policy. Autonomous wakes follow a checklist you write. An empty checklist costs zero API calls.
- **Extensible with plain files.** Add a `SKILL.md` for a repeatable workflow. Enable an MCP server
  with an explicit environment allowlist. Specialized tool schemas load on demand so they never bloat
  an unrelated turn.
- **Defensive defaults, documented limits.** Loopback-only dashboard, SSRF-safe fetching, redacted
  logs, secret-free backups, minimal subprocess environments. Tars is not a sandbox, and the docs say
  so plainly.

## Quick start

You need Node.js 22.19 or newer, npm 10.9 or newer, a Discord bot token plus your Discord user ID,
and a model provider (a subscription, an API key, or a local endpoint).

```bash
npm install -g @saccolabs/tars
tars setup     # provider sign-in, model, Discord, workspace
tars start     # launch the PM2-managed supervisor
tars status    # confirm the process and active session
```

Then send your bot a direct message on Discord. For a terminal-only session, stop the daemon and run
`tars chat --no-discord`.

## What you get

### Channels

- **Discord.** Owner-locked direct and guild messages, streaming replies, constrained attachments,
  and `/stats`, `/quota`, and `/reset` message commands.
- **Terminal.** A stateful chat TUI with token streaming that shares the same workspace and memory.
- **Voice relay.** A loopback JSON-lines channel so a realtime voice gateway can send turns to the
  same assistant. Tars does not handle speech itself.

### Models

- Every provider in the pi model registry, plus local and custom OpenAI-compatible endpoints.
- Guided sign-in from `tars setup` and `tars model`: OAuth for Anthropic, OpenAI Codex, and GitHub
  Copilot, API keys for everyone else, or import an existing login from the standalone `pi` CLI.
- Models are discovered from the signed-in account and a thinking level is chosen per model.
- Optional per-role models route background and summarizer work to something cheaper.

### Memory

- `MEMORY.md` and `USER.md` in the workspace are injected into the system prompt as a budget-capped
  snapshot, so Tars knows you before you say a word.
- `manage_facts` and `manage_notes` tools store durable facts and dated notes, backed by a local
  full-text index you can search with `tars memory search`.
- Durable memory is flushed before context compression discards turns, and a nightly "dream" pass
  consolidates the day.

### Autonomy

- **Scheduled tasks** on a cron expression or a timestamp, with six delivery policies: notify,
  on-failure, on-change, action-required, digest, and silent.
- **Pulse wakes** driven by `~/.tars/workspace/HEARTBEAT.md`. An empty checklist makes no API
  calls, unchanged results back off exponentially, quiet wakes stay silent, and daily budgets and
  quiet hours apply.
- **Initiative modes** from observe to safe-auto, limited to registered reversible repairs.
- A maintenance heartbeat handles cleanup and index sync while you are away.

### Tools

- Bundled MCP extensions for memory, tasks, and public web search and fetch.
- Your own MCP servers under `~/.tars/extensions/` with strict enablement, environment allowlists,
  and bounded timeouts.
- Skills under `~/.tars/skills/` for repeatable workflows.
- Common tools stay in context. Specialized schemas load through a compact discovery catalog.

### Operations

- `tars doctor` runs read-only health and security diagnostics. `tars repair plan` lists registered
  safe repairs.
- `tars update` stages and preflights a release before installing it, then rolls back on failure.
- `tars export` and `tars import` produce secret-free, transactional backups.
- An optional local dashboard, disabled by default and bound to loopback.

## How it works

One PM2-managed supervisor serializes everything through a single active agent, so scheduled work,
background wakes, and your messages never trample each other.

```text
Discord / terminal / voice relay
              │
              ▼
Channel manager ──► Supervisor ──► Tars engine (pi SDK) ──► model provider
                        │                  │
                        │                  └── MCP extensions, skills, memory
                        ├── active session
                        ├── cron service (explicit tasks)
                        ├── pulse service (HEARTBEAT.md wakes)
                        └── maintenance heartbeat
```

Everything it owns lives in one place:

```text
~/.tars/
├── config.json      non-secret settings
├── .env             secrets, owner-readable only
├── auth.json        provider sign-ins
├── system.md        your instructions
├── workspace/       SOUL, MEMORY, USER, HEARTBEAT
├── skills/          SKILL.md packages
├── extensions/      enabled MCP servers
├── chats/           conversation history
├── data/            sessions, tasks, notes, index
└── logs/            redacted operational logs
```

Configuration precedence is exported environment variables, then `~/.tars/.env`, then
`~/.tars/config.json`, then validated defaults. Intervals, context limits, and rate limits are
bounded when they load.

## Security in one paragraph

Tars runs with the permissions of its operating-system user. It is not a filesystem, shell, or
network sandbox, and model output is never treated as authorization. Run it as a dedicated
least-privilege account, review every skill and extension you enable, keep the dashboard on
loopback, and keep credentials out of prompts. Redaction reduces accidental leaks; it is not
data-loss prevention. Read the full
[security model](https://tars.saccolabs.com/capabilities/security/) before granting access to
anything sensitive.

## Scope

- One active agent. Tars does not orchestrate sub-agents.
- Discord is the supported daemon channel. Terminal chat runs in the foreground and holds an
  exclusive lease on the workspace, so stop the daemon first.
- Multiple instances work with isolated `TARS_HOME` values, but the convenience lifecycle commands
  are not fully instance-aware.
- Scheduling polls once a minute. Do not use it for real-time or safety-critical work.

## Common commands

| Command                            | Purpose                                                      |
| ---------------------------------- | ------------------------------------------------------------ |
| `tars setup`                       | Create or update the local configuration.                    |
| `tars start` / `tars stop`         | Start or stop the PM2 processes for this Tars home.          |
| `tars status` / `tars logs`        | Show process and session metrics, or follow the logs.        |
| `tars chat --no-discord`           | Foreground terminal chat without Discord or schedulers.      |
| `tars model`                       | Sign in to a provider and pick a model and thinking level.   |
| `tars auth login PROVIDER`         | Log in with OAuth or an API key.                             |
| `tars secret set KEY`              | Store a secret read from standard input.                     |
| `tars doctor` / `tars repair plan` | Read-only diagnostics and registered safe repairs.           |
| `tars extensions audit`            | Inspect custom MCP environment and working-directory policy. |
| `tars memory search QUERY`         | Search the local knowledge index.                            |
| `tars export` / `tars import FILE` | Back up or restore the workspace.                            |
| `tars update`                      | Stage, validate, install, and restart an available update.   |

Run `tars --help` for the full reference. Keep secret values out of shell history by piping them:

```bash
read -rs TARS_SECRET_VALUE
printf '%s' "$TARS_SECRET_VALUE" | tars secret set KEY
unset TARS_SECRET_VALUE
```

## Documentation

- [User documentation](https://tars.saccolabs.com/)
- [Architecture](https://github.com/agustinsacco/tars/blob/main/docs/ARCHITECTURE.md)
- [Development guide](https://github.com/agustinsacco/tars/blob/main/docs/DEVELOPMENT.md)
- [Operations guide](https://github.com/agustinsacco/tars/blob/main/docs/OPERATIONS.md)
- [Contributing](https://github.com/agustinsacco/tars/blob/main/CONTRIBUTING.md)

## Development

```bash
npm ci
npm run ci:extensions
npm run check
npm run build
npm run test:extensions
```

Releases and npm publishing are managed by Release Please. Do not edit the package version by hand.
See [CONTRIBUTING.md](https://github.com/agustinsacco/tars/blob/main/CONTRIBUTING.md) before
submitting a change.

## License

[MIT](https://github.com/agustinsacco/tars/blob/main/LICENSE) © Agustin Sacco
