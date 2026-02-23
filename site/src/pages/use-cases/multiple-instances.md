---
layout: ../../layouts/DocLayout.astro
title: Multiple Instances
description: Running multiple, specialized Tars agents concurrently on the same machine.
section: Use Cases
---

Because Tars is incredibly lightweight and operates as a standalone Node.js process managed by PM2, it is fundamentally designed to be multiplied.

You are not restricted to one Tars bot. A single server or workstation can comfortably host 5 or 10 independent Tars agents, each uniquely specialized.

## How to Set Up Multiple Instances

Setting up a second instance requires pointing Tars to a different "home" directory before running the `start` command. By manipulating the `TARS_HOME` environment variable, Tars spins up a completely isolated brain, system prompt, task registry, and Discord connection.

### Example: Deploying a "SecOps" Agent alongside a "DevOps" Agent

1. **Bootstrap the DevOps Agent (Default)**

```bash
# This uses the default ~/.tars directory
tars setup
tars start
```

_At this point, you have "DevOps-Bot" running on Discord._

2. **Bootstrap the SecOps Agent (Custom Path)**

```bash
# Redirect Tars to build a new environment in ~/.tars-secops
export TARS_HOME=~/.tars-secops
tars setup
```

3. **Configure the new Agent**
   When `tars setup` prompts you for a Discord token, provide a brand new token for "SecOps-Bot". Then, edit the system prompt specifically for this agent:

```bash
nano ~/.tars-secops/.gemini/system.md
```

_(Teach it to be paranoid and focused purely on security logs)_

4. **Start the second Agent**

```bash
export TARS_HOME=~/.tars-secops
tars start
```

## Management

You now have two entirely distinct AI workers operating on the exact same server.

- They have different Discord accounts.
- They have completely isolated Memory (`~/.tars/data/memory` vs `~/.tars-secops/data/memory`).
- They schedule separate cron tasks.
- They have different personalities dictated by their unique `system.md` prompts.

To manage them, just supply the `TARS_HOME` variable before running the CLI:

```bash
TARS_HOME=~/.tars-secops tars logs
TARS_HOME=~/.tars tars stop
```
