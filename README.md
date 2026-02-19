# Tars: Personal AI Robot

<div align="center">
  <img src="assets/logo.png" alt="Tars Logo" width="300" />
</div>

<div align="center">
  
  "Its cue for sarcasm is 100%."
  
  [License: MIT](https://opensource.org/licenses/MIT) | [TypeScript](https://www.typescriptlang.org/) | [Powered by Gemini](https://deepmind.google/technologies/gemini/)

</div>

---

Tars is a Gemini-first autonomous AI assistant—because apparently, everyone else needs a credit card or a server farm just to run `hello world`.

Leveraging the free tier of Google's Gemini models (you _do_ have a Gmail account, right?), Tars gives you a personal assistant without the token bloat or the surprise bill at the end of the month. It knows its limits, keeps your data on _your_ machine (groundbreaking concept), and can even pack itself up to move computers. It’s like a digital hermit crab, but useful.

## The Reality

Most assistants live in the cloud and forget you exist when the tab closes. OpenClaw lives in 5 different messaging apps and requires a GPU the size of a toaster to run locally. Tars lives in your terminal. It has a persistent **Brain**—a local database of memories, tasks, and skills.

- **Private**: Your data stays here. Unless you post it on Twitter. That's on you.
- **Portable**: `tars export` packs up the entire brain. Moving to a new laptop? Tars comes with you.
- **Extensible**: It builds its own tools. If it can't do something, it writes the code to do it.

### Tars vs. The Competition (OpenClaw)

OpenClaw is great if you want to chat with your AI on WhatsApp while burning your GPU or your wallet. Tars is for when you want to get work done without the overhead.

| Feature        | Tars (The Smart Choice)     | OpenClaw (The Expensive Habit)                          |
| :------------- | :-------------------------- | :------------------------------------------------------ |
| **Cost**       | **Free** (Gemini Free Tier) | **$$$** (Claude/GPT-4 or agonizingly slow local models) |
| **Hardware**   | Runs on a potato (Node.js)  | Requires a gaming rig for local LLMs                    |
| **Speed**      | Instant (Cloud Inference)   | Tokens per _minute_ on consumer hardware                |
| **Focus**      | Terminal & Code             | Spreads itself thin across 10 chat apps                 |
| **Philosophy** | "Get it done."              | "Let's chat about getting it done."                     |

---

## Key Features

- **Multi-Agent Orchestration**: Delegates complex work to specialized sub-agents because even AI shouldn't have to context-switch this much.
- **Bare-Metal Runtime**: Native execution on Node.js. No Docker containers eating 8GB of RAM just to check the time.
- **Autonomous Persistence**: A background "Heartbeat" service that runs scheduled tasks and cleans up after itself. It works while you sleep.
- **Context-Aware Memory**: Uses `GEMINI.md` to track long-term project context, so you don't have to explain the architecture for the 50th time.

---

## Documentation

Full documentation is available in the `website/` directory.

- **Development**: `npm run docs:dev`
- **Build**: `npm run docs:build`
- **Live Deployment**: `http://<ULTRON_IP>:5252`

## Installation and Setup

### Prerequisites

- Node.js: ≥ 22.0.0 (If you're still on v14, we need to talk.)
- Gemini CLI: `npm i -g @google/gemini-cli`

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

You talk to Tars via a private Discord channel. It supports file processing, background tasks, and pretending to care about your deadlines.

> **!tars** "Initialize a Next.js project and don't use Tailwind unless I ask."

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
