# Tars: Your Autonomous AI Assistant

<div align="center">
  <img src="assets/logo.png" alt="Tars Logo" width="300" />
</div>

<div align="center">
  [License: MIT](https://opensource.org/licenses/MIT) | [TypeScript](https://www.typescriptlang.org/) | [Powered by Gemini](https://deepmind.google/technologies/gemini/)
</div>

---

Tars is an autonomous, local-first AI assistant powered by Google's Gemini models. It provides a persistent, free alternative to subscription-based services by running directly on your machine. Tars maintains its own database of memories, tasks, and skills, allowing it to adapt to your workflow and retain context over time.

## Philosophy

Tars is designed for developers who need an assistant that integrates deeply with their local environment without the overhead of heavy containers or expensive cloud subscriptions.

- **Private**: All data, including memories and task history, is stored locally in your home directory.
- **Portable**: The entire "brain" can be exported and moved to a new machine seamlessly.
- **Extensible**: Tars can write its own tools and extensions to expand its capabilities.
- **Cost-Effective**: Utilizes the Gemini API (including the free tier) to handle complex reasoning tasks without local GPU requirements.

### Comparison

| Feature     | Tars                      | Traditional Cloud Assistants                      |
| :---------- | :------------------------ | :------------------------------------------------ |
| **Cost**    | Free (Gemini Tier)        | Subscription / Token Usage Fees                   |
| **Runtime** | Native Node.js Process    | Often Web-based or Heavy Local LLMs               |
| **Latency** | Low (API Inference)       | High (Local Inference) or Variable (Cloud Queues) |
| **Context** | Persistent Project Memory | Session-based / Limited Context Window            |
| **Focus**   | System & Code Execution   | General Chat & Q&A                                |

---

## Key Features

- **Multi-Agent Orchestration**: Delegates specialized tasks (like coding or research) to sub-agents for better accuracy.
- **Bare-Metal Runtime**: Executes natively on Node.js for minimal system impact and direct access to local tools.
- **Autonomous persistence**: A background "Heartbeat" service manages scheduled tasks and system health automatically.
- **Context-Aware Memory**: Utilizes `GEMINI.md` files to maintain long-term awareness of project structures and decisions.

---

## Documentation

Full documentation is available in the `website/` directory or at the deployed site.

- **Development**: `npm run docs:dev`
- **Build**: `npm run docs:build`
- **Live Deployment**: `http://<ULTRON_IP>:5252`

## Installation and Setup

### Prerequisites

- **Node.js**: ≥ 22.0.0
- **Gemini CLI**: `npm i -g @google/gemini-cli`

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
- `tars restart`: Check for updates and restart the supervisor.
- `tars status`: View system health and brain statistics.
- `tars export`: Compress the brain and configuration for portability.
- `tars import <path>`: Restore a brain with automatic path re-homing.
- `tars secret set <key> <value>`: Securely store platform credentials.

### Interaction

Tars communicates primarily through a private Discord channel. It supports file uploads, long-running task management, and complex multi-step instructions.

> **!tars** "Analyze the logs in /var/log/syslog and summarize any critical errors."

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
