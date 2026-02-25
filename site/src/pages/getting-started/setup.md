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

### 1. Google Authentication

Tars uses the **Gemini Core engine** for intelligence. The wizard will open a browser window for you to sign in with your Google account. This grants Tars direct access to Gemini models via the official Node.js Core library.

### 2. Discord Bot Connection

You will need a **Discord Bot Token**.

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications).
2. Create a new application and add a Bot.
3. Reset/Copy the **Token**.
4. Enable the **Message Content Intent** under the Bot settings.

### 3. Model & Heartbeat

Choose your preferred Gemini model (e.g., `gemini-2.0-flash`) and set the **Heartbeat Interval**. The heartbeat is how often Tars checks for scheduled tasks or performs autonomous system checks.

### 4. Initialization

Tars will provision its workspace at `~/.tars/`. This directory stores its memory, task list, and configuration.

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
