---
title: Learned Skills & Extensions
description: How Tars expands its capabilities.
---

Tars is designed to be **Self-Modifying**. It can learn new ways to interact with the world through Skills and Extensions.

## Learned Motor Skills (Skills)

Skills are instructional templates that teach Tars how to perform specific operational tasks. They are stored in `~/.tars/.gemini/skills/`.

- **`tars-ops`**: The primary skill for self-management, secret configuration, and memory sync.
- **`create-skill`**: A skill that allows Tars to write *new skills* for itself.

## Neural Augmentation (MCP Extensions)

Tars leverages the **Model Context Protocol (MCP)** to connect to external tools and data sources.

- **`tars-tasks`**: The built-in task manager that handles the Heartbeat scheduling.
- **Custom Extensions**: Tars can use the `create-extension` skill to write and link new JavaScript-based MCP servers at runtime.

## The Evolution Loop

When you ask Tars to do something it doesn't know how to do, it might suggest:
*"I don't have a tool for that yet. Should I build a new skill to handle this task in the future?"*
