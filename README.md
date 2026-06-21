# Tars: Your Autonomous AI Assistant

<div align="center">
  <img src="assets/logo.png" alt="Tars Logo" width="300" />
</div>

<div align="center">
  <a href="https://opensource.org/licenses/MIT">License: MIT</a> | <a href="https://www.typescriptlang.org/">TypeScript</a> | <a href="https://github.com/saccolabs/tars">Powered by Pi Agent SDK</a>
</div>

---

Tars is an autonomous, local-first AI assistant powered by the **Pi Agent SDK**. It supports cloud models (Gemini, Claude, GPT) and local inference (Qwen) out of the box, running directly on your machine. Tars maintains its own database of memories, tasks, and skills, allowing it to adapt to your workflow and retain context over time.

## Philosophy

Tars is designed for developers who need an assistant that integrates deeply with their local environment without the overhead of heavy containers or expensive cloud subscriptions.

- **Private**: All data, including memories and task history, is stored locally in your home directory (`~/.tars/`).
- **Portable**: The entire "brain" can be exported and moved to a new machine seamlessly.
- **Extensible**: Tars can write its own tools and extensions to expand its capabilities.
- **Cost-Effective & Flexible**: Integrates with various cloud providers and local inference endpoints without requiring expensive subscription lock-in.

### Comparison

| Feature     | Tars                      | Traditional Cloud Assistants                      |
| :---------- | :------------------------ | :------------------------------------------------ |
| **Cost**    | Cloud APIs / Local        | Subscription / Token Usage Fees                   |
| **Runtime** | Native Node.js Process    | Often Web-based or Heavy Local LLMs               |
| **Latency** | Low (API Inference)       | High (Local Inference) or Variable (Cloud Queues) |
| **Context** | Persistent Project Memory | Session-based / Limited Context Window            |
| **Focus**   | System & Code Execution   | General Chat & Q&A                                |

---

## Key Features

- **Multi-Agent Orchestration**: Delegates specialized tasks (like coding or research) to sub-agents for better accuracy.
- **Pi Agent SDK Core**: Built on the Pi Coding Agent SDK for high-performance reasoning, autonomous task execution, and native tool-calling.
- **Autonomous Autonomy**: A background "Heartbeat" service manages scheduled tasks and system health automatically.
- **Local Inference Support**: Tars can be configured to run with local models (such as Qwen via llama-server, Ollama, LM Studio, etc.) for 100% privacy and offline capability.
- **Context-Aware Memory**: Utilizes structured memory database files (`facts.json`, `notes/`) to maintain long-term awareness of project structures and decisions.

---

## Documentation

Full documentation is available at [tars.saccolabs.com](https://tars.saccolabs.com) or in the `site/` directory.

- **Website**: [tars.saccolabs.com](https://tars.saccolabs.com)
- **Development**: `npm run docs:dev`
- **Build**: `npm run docs:build`
- **Live Deployment**: `http://<ULTRON_IP>:5252`

---

## Installation and Setup

### Prerequisites

- **Node.js**: ≥ 22.0.2

### Installation

Tars is powered by the **Pi Agent SDK**, which is automatically bundled during installation.

```bash
npm install -g @saccolabs/tars
```

### Initial Setup

Run the setup wizard to configure your preferred AI model provider and connect your Discord bot:

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

Tars communicates primarily through **Discord**. It supports file uploads, long-running task management, and complex multi-step instructions.

> **Discord**: `!tars Analyze the logs in /var/log/syslog and summarize any critical errors.`

---

## Architecture

Tars utilizes a Supervisor-Orchestrator model:

1. **Supervisor**: Manages persistent sessions and multi-channel communication.
2. **Channel Manager**: Orchestrates communication with Discord.
3. **Subagents**: Specialized expert agents invoked dynamically for specific technical domains.
4. **Heartbeat**: Cron-based engine for autonomous execution and cleanup.
5. **Extensions**: MCP servers that provide tool-level capabilities to the intelligence core.

---

## License

MIT Copyright Agustin Sacco
