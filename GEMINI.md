# Tars - Memory & Context

This file is my dynamic memory. I can update it at any time using `save_memory` to store preferences, context, and learned information. My core identity and operational rules live in my system prompt and cannot be changed here.

## Application Context (Tars Internal)

Tars is an autonomous AI assistant built with a **Supervisor-Orchestrator** model. It runs as a bare-metal Node.js application, eschewing containerization in favor of direct local integration.

### 🏗️ Architecture & Philosophy

- **Process Management**: Managed by **PM2**. The CLI (`tars start/stop`) acts as a wrapper around PM2.
- **Brain vs. Home**:
    - `~/.tars/`: Operational data (config, tasks, session metadata).
    - `~/.gemini/`: The actual "Intelligence" (System Prompt, Skills, MCP Extensions, Session History).
- **Core Logic**: `src/supervisor/` handles session management, token tracking, and the heartbeat loop.
- **Communication**: Discord bot via `discord.js`.
- **Data Layout**: `~/.tars` (operational data, config, tasks) vs `~/.gemini` (the AI brain, prompt, skills, extensions).
- **Agency**: `HeartbeatService.ts` runs on an interval (default 300s) to execute scheduled tasks and perform "Autonomous Health Checks".

### 💻 Development Standards

- **Stack**: TypeScript, ES Modules, Node.js 22+.
- **Git**: Strictly follow **Conventional Commits** (`feat:`, `fix:`, `doc:`, `refactor:`, `chore:`). Use `feat:` for most changes as per project rules.
- **Extension System**: Uses **Model Context Protocol (MCP)**. Repository extensions in `extensions/` are symlinked to `~/.gemini/extensions/` during bootstrapping.
- **Memory**: The agent maintains the workspace via `TARS.md` and personal history via `GEMINI.md`.
- **Self-Management**: Use the `tars-ops` skill for all CLI interactions (secrets, configuration, memory sync). NEVER use `npm run start` to modify configuration as it causes recursive deadlocks.

### 📚 Documentation

- **Stack**: Astro 5 + React + Tailwind CSS v4.
- **Source**: `website/src/pages/` containing markdown (`.md`) content.
- **Theme**: "Terminal Console" — Dark mode (#050505), JetBrains Mono, minimal.
- **Commands**:
    - `npm run docs:dev`: Start local dev server (http://localhost:4321).
    - `npm run docs:build`: Build static site to `website/dist/`.
- **Deployment**: Automatic via GitHub Actions on push to `main`.

### 🛠️ Operational Skills

- `tars-ops`: Standardized command list for configuration and maintenance.
- `context-manager`: Guide for adding persistent context to extensions.

### 🔍 Debugging Guide

When building features or troubleshooting, follow this checklist:

1.  **Supervisor Logs**: Run `tars logs` (or `pm2 logs tars-supervisor`) to see the main application flow and tool execution status.
2.  **Raw CLI Output**: Check `/tmp/gemini-debug-*.log`. The `GeminiCli` streams all raw output to these timestamped files, which is invaluable for debugging JSON parsing errors or model hallucinations.
3.  **Session Integrity**: Review `~/.tars/data/session.json`. If context usage is higher than expected, check if `pruneLastTurn` is being called correctly (especially for heartbeats).
4.  **Task State**: Check `~/.tars/data/tasks.json` to verify cron schedules and last/next run timestamps.
5.  **Dev Mode**: Use `npm run dev` to run the supervisor in the foreground with `tsx watch` for immediate feedback during development.

### ⚠️ Critical Gotchas

- **Shell Escaping**: Always ensure prompts are quoted with `'` and internal quotes are escaped when spawning the shell in `GeminiCli.ts`. Failure to do so breaks multi-line prompts.
- **MCP Enablement**: New extensions must be added to `~/.gemini/extensions/extension-enablement.json`. The `installExtensions` function in `main.ts` handles this automatically for repository-managed extensions.
