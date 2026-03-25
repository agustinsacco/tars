# Tars - Memory & Context

This file is my dynamic memory. I can update it at any time using `save_memory` to store preferences, context, and learned information. My core identity and operational rules live in my system prompt and cannot be changed here.

## Application Context (Tars Internal)

Tars is an autonomous AI assistant built with a **Supervisor-Orchestrator** model. It runs as a bare-metal Node.js application, eschewing containerization in favor of direct local integration.

### 🏗️ Architecture & Philosophy

- **Process Management**: Managed by **PM2**. The CLI (`tars start/stop`) acts as a wrapper around PM2.
- **Brain vs. Home**:
    - `~/.tars/`: The primary workspace for Tars.
    - `~/.tars/.gemini/`: The actual "Intelligence" (System Prompt, Skills, MCP Extensions, Session History), isolated within the workspace.
- **Core Logic**: `src/supervisor/` handles session management, token tracking, and the heartbeat loop.
- **Communication**: Primary channel via Discord (`discord.js`). See `src/channels/`.
- **Data Layout**: `~/.tars` (operational data, config, tasks) vs `~/.tars/.gemini` (the AI brain, prompt, skills, extensions).
- **Agency**: `HeartbeatService.ts` runs on an interval (default 300s) to execute scheduled tasks and perform "Autonomous Health Checks".

### 💻 Development Standards

- **Stack**: TypeScript, ES Modules, Node.js 22+.
- **Git**: Strictly follow **Conventional Commits** (`feat:`, `fix:`, `doc:`, `refactor:`, `chore:`). Use `feat:` for most changes as per project rules.
- **Extension System**: Uses **Model Context Protocol (MCP)**. Repository extensions in `extensions/` are symlinked to `~/.gemini/extensions/` during bootstrapping.
- **Memory**: Tars has transitioned away from a flat `GEMINI.md` for daily operations. It uses the `tars-memory` MCP extension for durable facts and daily notes. The `GEMINI.md` in the repo is strictly for **Developer Context** (teaching the AI agent how to work on Tars itself).
- **Self-Management**: Use the `tars-ops` skill for all CLI interactions (secrets, configuration, memory sync). NEVER use `npm run start` to modify configuration as it causes recursive deadlocks.

### 📦 Versioning & Release

Tars uses **Release Please** for automated versioning and publishing. **Never manually update the version in `package.json`.**

1.  **Merge Features**: Merge your feature/fix PRs into `main` using conventional commits.
2.  **Release PR**: `release-please` will automatically create/update a "Release" PR on `main` that aggregates all changes.
3.  **Approve Release**: When ready to publish, merge the **Release PR**.
4.  **Automatic Publish**: The `.github/workflows/release-please.yml` workflow will automatically tag the release and publish `@saccolabs/tars` to NPM.

### 📚 Documentation

- **Stack**: Astro 5 + React + Tailwind CSS v4.
- **Source**: `site/src/pages/` containing markdown (`.md`) content.
- **Theme**: "Terminal Console" — Dark mode (#050505), JetBrains Mono, minimal.
- **Commands**:
    - `npm run docs:dev`: Start local dev server (http://localhost:4321).
    - `npm run docs:build`: Build static site to `site/dist/`.
- **Deployment**: Automatic via GitHub Actions on push to `main`.

### 🛠️ Operational Skills

- `tars-ops`: Standardized command list for configuration and maintenance.
- `context-manager`: Guide for adding persistent context to extensions.

### 🔍 Debugging Guide

When building features or troubleshooting, follow this checklist:

1.  **Supervisor Logs**: Run `tars logs` (or `pm2 logs tars-supervisor --raw`) to see the main application flow.
2.  **Native Debug CLI**: Use the internal debug script to test the model's tool calling and persona without Discord:
    `TARS_SUPERVISOR_MODE=true npx tsx src/scripts/debug-cli.ts "your prompt here"`
    This provides raw JSON events for every content chunk, tool call, and thought.
3.  **API Error Reports**: Detailed Google API errors (404s, 429s) are saved to `/tmp/gemini-client-error-*.json`.
4.  **Session Integrity**: Review `~/.tars/data/session.json`. Tars uses **Session Swapping** in `GeminiEngine.ts` to isolate context between users/tasks.
5.  **Memory Store**: Durable facts are stored in `~/.tars/data/memory/facts.json`.
6.  **Dev Mode**: Use `npm run dev` to run the supervisor in the foreground with `tsx watch` for immediate feedback during development.
7.  **Remote SSH Debugging**: If requested to debug a remote instance (e.g., `stark@stark`), use `sshpass -p <password> ssh` combined with `pm2 logs tars-supervisor --raw`. Note that the remote installation is a global NPM package, typically located at `/home/<user>/.local/share/fnm/node-versions/<version>/installation/lib/node_modules/@saccolabs/tars/`. To apply an emergency live patch, use `sed` over SSH or tell the user to run `npm install -g @saccolabs/tars@latest && pm2 restart tars-supervisor`.

### ⚠️ Critical Gotchas

- **Session Swapping**: `GeminiEngine.ts` hot-swaps sessions. If you change a session mid-run, you must call `startChat` to re-initialize the core client with the correct history.
- **Node Warnings**: Experimental SQLite warnings are silenced globally via `NODE_NO_WARNINGS=1` in `tars start`.
- **MCP Enablement**: New extensions must be added to `~/.gemini/extensions/extension-enablement.json`. The `installExtensions` function in `main.ts` handles this automatically for repository-managed extensions.
- **Publish Safety**: The automated release process handles versioning. If you need to force a release, ensure all pending PRs are merged so `release-please` can aggregate them into a single version bump. NPM will reject duplicate versions, but the automated PR prevents this by always incrementing from the latest valid tag.
