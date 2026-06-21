---
layout: ../../layouts/DocLayout.astro
title: Multi-Agent Orchestration
description: delegating complex tasks to specialized sub-agents.
section: Capabilities
---

## Overview

Tars utilizes a **Supervisor-Orchestrator** model to handle complex, multi-step engineering tasks. While the Supervisor manages the primary conversation and system state, it can delegate specialized technical work to **Sub-agents**.

## How Sub-agents Work

1.  **Context Injection**: The Supervisor identifies a high-complexity task (e.g., "Build a React dashboard").
2.  **Specialized Persona**: It invokes a sub-agent with a dedicated system prompt tailored for that specific domain.
3.  **Autonomous Execution**: The sub-agent runs in an ephemeral, isolated session. It has access to the same toolset as the Supervisor but focuses entirely on the technical objective.
4.  **Handoff**: Once the task is complete, the sub-agent's findings or artifacts are returned to the Supervisor, who then presents them to the user.

## Built-in Agents

### Scaffolder Agent

The `scaffolder` is a specialized agent for structural project setup. It is capable of:

- Initializing project boilerplates (Next.js, Vite, Node.js).
- Configuring complex `tsconfig.json` or `eslint` setups.
- Creating standardized directory structures for new features.

## Creation & Management

Sub-agents are managed dynamically by the supervisor and the Pi Agent SDK runtime. Each sub-agent runs with system instructions tailored for that specific persona.

Tars can create new sub-agents at runtime if it identifies a repeating persona that would benefit from specialized isolation.

## Benefits

- **Reduced Hallucinations**: By focusing the context on a specific domain, sub-agents are less likely to conflate unrelated information.
- **Context Hygiene**: Sub-agent interactions don't bloat the main user conversation, keeping the response speed high.
- **Parallelism**: In future updates, Tars will support spawning multiple sub-agents to work on different parts of a project simultaneously.
