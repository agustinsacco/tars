# Tars — Your Native AI Assistant

<div align="center">
  <img src="assets/logo.png" alt="Tars Logo" width="200" />
</div>

<div align="center">

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue.svg)](https://www.typescriptlang.org/)
[![Gemini](https://img.shields.io/badge/Powered%20by-Gemini-8E44AD.svg)](https://deepmind.google/technologies/gemini/)

</div>

Tars is an autonomous personal AI assistant designed to manage your tasks, remember your preferences, and extend its own capabilities. It lives in your terminal and communicates via Discord.

## Quick Start

### Installation

```bash
npm install -g @saccolabs/tars
```

### Setup

```bash
tars setup
```
Unlike traditional chatbots, Tars has a persistent "Brain" (memories, tasks, skills) that is stored locally as simple files, making it completely private, portable, and transparent.

---

## ✨ Key Features

- **🧠 Persistent Memory**: Tars remembers you. It maintains a `GEMINI.md` file that evolves as it learns about your preferences and projects.
- **⚡ Bare-Metal Speed**: Runs natively on your OS. No Docker containers, no virtualization overhead.
- **🔌 Self-Extending**: Tars can write its own extensions in JavaScript to add new capabilities on the fly.
- **⏰ Autonomous Tasks**: A built-in heartbeat service allows Tars to schedule and execute tasks in the background (e.g., "Check stock prices every morning").
- **📱 Discord Interface**: Interact with Tars from any device via a private Discord channel.
- **📦 Portable Brain**: Your entire assistant configuration can be exported (`tars export`) and moved to a new machine easily.

---

## 🚀 Getting Started

### Prerequisites
- Node.js ≥ 22.0.0
- Gemini CLI (`npm i -g @google/gemini-cli-beta`)

### Installation

```bash
# Install Tars globally
npm install -g tars-pa
```

### Setup

Run the interactive wizard to connect your accounts:

```bash
tars setup
```
*This will guide you through Google OAuth and Discord Bot configuration.*

### Usage

Start Tars in the background:
```bash
tars start
```

Check status:
```bash
tars status
```

Chat with Tars in Discord:
> **!tars** Create a new task to remind me to drink water every 2 hours.

---

## 🆚 Tars vs. OpenClaw

Tars is inspired by the vision of **OpenClaw** but takes a fundamentally different architectural approach to prioritize simplicity and native integration.

| Feature | OpenClaw | Tars |
|:---|:---|:---|
| **Runtime** | Docker Containers | **Bare Metal (Node.js)** |
| **Philosophy** | Isolation & Service Mesh | **Native Integration & OS Access** |
| **Complexity** | High (Kubernetes/Docker Compose) | **Low (Single npm package)** |
| **Extension Lang** | Python / Multi-polyglot | **JavaScript / TypeScript** |
| **Identity** | Config files | **Evolving Markdown (`GEMINI.md`)** |

**Why Tars?**
We believe that a personal assistant should feel like a part of your operating system, not a foreign service running in a container. Tars is designed for developers who want an agent that lives *with* them on their machine, using the tools they already use (npm, git, fs), without the friction of containerization.

---

## 🛠️ Architecture

Tars uses a **Supervisor-Orchestrator** model:

1.  **Supervisor**: A lightweight process that manages the session and Discord connection.
2.  **Heartbeat**: A chron-job scheduler that wakes the brain for background tasks.
3.  **Gemini CLI**: The core intelligence engine that processes prompts and executes tools.
4.  **Extensions**: MCP servers that provide capabilities (like file access or task management).

For more details, see [ARCHITECTURE.md](docs/ARCHITECTURE.md).

## 📜 License

MIT © Agustin Sacco
