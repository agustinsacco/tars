# Tars: Personal AI Robot

<div align="center">
  <img src="assets/logo.png" alt="Tars Logo" width="300" />
</div>

<div align="center">
  
  "Its cue for sarcasm is 100%."
  
  [License: MIT](https://opensource.org/licenses/MIT) | [TypeScript](https://www.typescriptlang.org/) | [Powered by Gemini](https://deepmind.google/technologies/gemini/)

</div>

---

Tars is an autonomous, bare-metal AI assistant inspired by the functional minimalism of Interstellar. The design is strictly functional, and the capability is modular. Tars operates in the terminal, retains user preferences, and manages workspaces through a supervisor-subagent architecture.

## The Vision

Unlike cloud-only assistants, Tars integrated into the operating system. It possesses a persistent Brain-a collection of memories, tasks, and learned skills stored locally and transparently.

- **Private**: Data remains on the local machine.
- **Portable**: Export the entire brain and configuration for immediate restoration on new hardware.
- **Extensible**: Tars constructs its own MCP extensions and skills to adapt to workflows.

---

## Key Features

- **Multi-Agent Orchestration**: Delegation of specialized research or complex engineering tasks to background Subagents (Experts).
- **Workspace Management**: Centralized, portable workspace at `~/.tars/workspace/` for AI-built applications, documented via `TARS.md`.
- **Bare-Metal Runtime**: Native execution on Node.js without the overhead of containerization. Full access to local toolchains (Git, npm, gh).
- **Autonomous Persistence**: Background Heartbeat service for scheduled task execution and system maintenance.
- **Context-Aware Memory**: Dynamic memory evolution via `GEMINI.md` for long-term project context.

---

## Installation and Setup

### Prerequisites
- Node.js: ≥ 22.0.0
- Gemini CLI: `npm i -g @google/gemini-cli-beta`

### Installation
```bash
npm install -g @saccolabs/tars
```

### Initial Setup
Run the setup wizard to authorize Gemini and connect your Discord bot:
```bash
tars setup
```

---

## Usage

### Commands
- `tars start`: Launch the Tars supervisor.
- `tars status`: View system health and brain statistics.
- `tars export`: Compress the brain and configuration for portability.
- `tars import <path>`: Restore a brain with automatic path re-homing.
- `tars secret set <key> <value>`: Securely store platform credentials.

### Interaction
Communication occurs via a private Discord channel. Tars supports file processing, background task management, and expert delegation.

> **!tars** Initialize a Next.js project in the workspace and delegate the repository setup to a GitHub subagent.

---

## Architecture

Tars utilizes a Supervisor-Orchestrator model:

1. **Supervisor**: Manages persistent sessions and Discord communication.
2. **Subagents**: Specialized expert agents invoked dynamically for specific technical domains.
3. **Heartbeat**: Cron-based engine for autonomous execution and cleanup.
4. **Extensions**: MCP servers that provide tool-level capabilities to the intelligence core.

---

## License

MIT Copyright Agustin Sacco
