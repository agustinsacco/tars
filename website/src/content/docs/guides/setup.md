---
title: Setup (The Boot Sequence)
description: How to install and initialize Tars on your machine.
---

Installing Tars is like initializing the boot sequence of a new robot. It requires a few prerequisites to ensure the neural pathways are correctly formed.

## Prerequisites

Before starting, ensure you have:
- **Node.js**: ≥ 22.0.0
- **Gemini CLI**: `npm i -g @google/gemini-cli`
- **Google Account**: For API access via the Gemini CLI.

## Installation

1. **Install Tars Globally**:
   ```bash
   npm install -g @saccolabs/tars
   ```

2. **Run the Setup Wizard**:
   The setup wizard will guide you through connecting your Discord bot, selecting your Gemini model, and initializing your `GEMINI.md` memory.
   ```bash
   tars setup
   ```

3. **Start the Supervisor**:
   ```bash
   tars start
   ```

## The First "Thought"

Once Tars is running, head over to your Discord server and mention the bot.
> `!tars, are you there?`

Tars will wake up, consult its **Frontal Lobe**, and respond.
