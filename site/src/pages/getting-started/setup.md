---
layout: ../../layouts/DocLayout.astro
title: Setup Wizard
description: Configure your autonomous AI agent.
section: Get Started
---

Run the setup wizard to connect Tars to your Google and Discord accounts:

```bash
tars setup
```

The wizard will guide you through the following steps:

### 1. Model Provider & Credentials

Tars uses the **Pi Agent SDK** for multi-provider intelligence. The setup wizard will prompt you to select your preferred AI provider:

- **Google (Gemini SDK)**: Requires `TARS_API_KEY` (Google Cloud API Key). Defaults to `gemini-2.5-flash`.
- **OpenAI**: Requires `OPENAI_API_KEY`. Defaults to `gpt-4o`.
- **Anthropic**: Requires `ANTHROPIC_API_KEY`. Defaults to `claude-3-5-sonnet-latest`.
- **Local Stark**: Connects to your local model endpoint (e.g., `http://stark:8086/v1`). Defaults to Qwen 3.6.
- **Custom**: Connects to any OpenAI-compatible proxy or local endpoint.

### 2. Communication Channel

Tars uses Discord as its communication interface.

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications).
2. Create a new application, add a Bot, and copy the **Token**.
3. Enable the **Message Content Intent** under the Bot settings.

The wizard will validate your bot token in real-time before saving.

### 3. Identity & Heartbeat

Choose the Bot's display name (e.g., `Tars`) and the **Heartbeat Interval** (how often Tars checks for scheduled tasks or performs autonomous system health checks; recommended default is 30 minutes).

### 4. Tars Dashboard

Choose whether to enable the built-in **Tars Dashboard** (Web UI), customize the port (defaults to `3000`), and set an access password.

### 5. Initialization

Tars will provision its workspace at `~/.tars/`. This directory stores its memory database, task list, and local configurations.

> **Tip**: If you are migrating from another machine, run `tars import <path>` **before** starting `tars setup` to restore your existing memory and tasks.

---

### Lifecycle Commands

**Start the agent:**

```bash
tars start
```

**Stop the agent:**

```bash
tars stop
```

Once running, your bot will appear online in Discord. Type `$ping` to confirm it responded efficiently.
