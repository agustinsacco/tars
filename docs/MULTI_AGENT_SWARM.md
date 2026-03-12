# Technical Specification: Tars Multi-Agent Swarm (Tars Mesh)

## Overview

This specification defines a modular, layer-based architecture to enable multiple Tars instances to operate as a collaborative swarm or organization (e.g., a business with roles like CEO, Product Manager, and Software Engineer).

The core philosophy is to treat the Tars supervisor as a **standard unit of compute** (a "Node") and layer collaboration capabilities on top via external extensions and shared state, avoiding intrusive changes to the core Tars codebase.

---

## Architecture: The Layer Paradigm

### Layer A: The Universal Bus (State & Messaging)

The Bus is the infrastructure that allows agents to find and communicate with each other.

- **Agent Registry**: A shared SQLite table (housed in the existing `knowledge.db`) where each instance registers its presence.
    - Fields: `agent_id`, `role`, `status` (Idle/Busy), `last_heartbeat`, `mcp_endpoint`.
- **Messaging System**: A simple "Inbox/Outbox" model.
    - **Implementation**: A shared directory `~/.tars/swarm/inboxes/` containing JSON files or a shared SQLite table `swarm_messages`.
- **Concurrency**: Agents monitor their own inbox during their internal heartbeat or when triggered by a "wake-up" signal.

### Layer B: The Swarm MCP Extension (`tars-swarm`)

A specialized MCP extension installed on all swarm nodes to provide communication primitives to the LLM.

- **Tools**:
    - `list_peers()`: Returns a list of active agents, their roles, and status.
    - `send_message(target_agent_id, content)`: Deposits a message into a peer's inbox.
    - `broadcast(content)`: Sends a message to all active nodes.
    - `get_my_inbox()`: Retrieves unread messages for the current agent.

### Layer C: The Governance & Training Layer

The "Intelligence" of the swarm is managed through specialized prompts and a hierarchy of authority.

- **Lead Agent (The Trainer)**: One instance is designated as the "CEO" or "Manager."
- **Evolutionary Training**: The Lead Agent uses the `send_message` tool to provide functional instructions (SOPs) to subordinate agents.
- **Role Specialization**: Agents use their role-specific system prompts to interpret tasks (e.g., a "Coder" agent prioritizes implementation, while a "QA" agent prioritizes testing).

---

## Implementation Path (Non-Intrusive)

### 1. Swarm Discovery Extension

Create a new MCP extension in `extensions/tars-swarm` that interacts with a shared `swarm.db`. This allows any agent to "see" the rest of the organization.

### 2. Startup Multi-tenancy

Update the `tars` CLI to support named instances without clobbering existing ones:

```bash
tars start --name CEO --role "Executive management"
tars start --name Coder-1 --role "TypeScript development"
```

_(This requires removing the singleton `pkill` restriction in `src/cli/commands/start.ts`.)_

### 3. Collaboration Skills

Deploy a `swarm-collaboration` Skill across all nodes. This skill teaches the agent to:

1. Check the swarm registry on startup.
2. Check its inbox for tasks from the Lead Agent.
3. Report progress to the designated supervisor agent.

---

## Evolution and Adaptation

Because this architecture uses high-context models (Gemini 1.5/2.0 Pro), the swarm can self-organize:

- If a task is too large, the Lead Agent can spawn new "Worker" nodes.
- Agents can peer-review each other's work by passing file paths and feedback via the bus.
- The swarm remains resilient; if one agent crashes, the Lead Agent can re-spawn it using the `tars start` command via a shell tool.
