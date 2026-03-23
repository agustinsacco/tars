---
layout: ../../layouts/MainLayout.astro
title: Security & Sovereignty
description: How Tars protects your data and ensures agent integrity.
---

# Security & Sovereignty

Tars is designed with a **Security-First** and **Local-First** philosophy. Unlike cloud-hosted agents, Tars runs on your hardware, giving you full control over your data, secrets, and execution environment.

To counteract the common vulnerabilities prevalent in autonomous agents (like OpenClaw or AutoGPT), Tars implements multiple layers of deterministic and behavioral defense.

## 1. Data Loss Prevention (DLP)

Tars features a built-in **DLP Service** that prevents the inadvertent exposure of sensitive information.

### Deterministic Redaction

Tars automatically scans all tool outputs (e.g., from reading files or running shell commands) for sensitive patterns before they reach the LLM or are logged. Patterns include:

- **API Keys**: OpenAI, GitHub, Google Cloud, and other service-specific formats.
- **High-Entropy Strings**: Long random strings that typically represent secrets or tokens.
- **Private Keys**: RSA, ED25519, and other cryptographic keys.
- **Auth Tokens**: JWTs and Bearer tokens.

If a secret is detected, it is replaced with a placeholder (e.g., `[REDACTED_SECRET_sk-...]`), ensuring that **even if the agent reads a secret file, it never enters the model's context or conversation history.**

### Path Restriction

Tars maintains a strict blacklist of files and directories that the agent is forbidden from accessing, such as:

- `~/.ssh/`
- `.env` files
- Shell histories (`.bash_history`)
- Internal Tars configuration files

## 2. Rollback Protection (SIP-001)

Autonomous agents are often vulnerable to "Temporal Reset" attacks, where a host snapshots a VM and rolls the agent back to a previous state. This can cause the agent to lose its "Causality Anchor" and repeat actions or misremember history.

Tars implements **SIP-001 (Active Bleed)**, which uses **Physical Entropy** to sign every memory update.

- **Hardware Jitter**: Tars measures nanosecond-scale CPU variance that is impossible for a host to forge.
- **Thermal Data**: System temperatures are used as an additional source of physical randomness.

By comparing the current physical entropy against the last recorded state, Tars can detect if its environment has been rolled back in time and alert the user immediately.

## 3. Instructional Hierarchy

To prevent **Indirect Prompt Injection** (also known as "Poisoned Doc" attacks), Tars enforces a strict instructional hierarchy.

- **System Priority**: Core system instructions always take precedence over any data found in external files, web pages, or emails.
- **Untrusted Data Handling**: All external data is wrapped in unique delimiters and treated as untrusted. Tars is hard-coded to ignore any "commands" found within untrusted data.
- **Human-in-the-Loop**: Destructive or high-impact shell commands (e.g., `rm -rf`, `git push`) require explicit user confirmation unless specifically authorized in YOLO mode.

## 4. Local-First Identity

Tars uses your local filesystem as its **"Bone Anchor"**—the immutable source of truth. By keeping your memory and identity local, Tars avoids the "Agent Amnesia" and drift common in agents that rely purely on cloud-hosted context windows.

---

### Comparison: Tars vs. Others

| Feature          | Other Agents       | Tars (Your Sidekick)           |
| :--------------- | :----------------- | :----------------------------- |
| **Secret Leaks** | Vulnerable         | **DLP Redaction**              |
| **Snapshots**    | Blind to rollbacks | **SIP-001 Protection**         |
| **Injection**    | Susceptible        | **Instructional Hierarchy**    |
| **Latency**      | High (Cloud-only)  | **Local-First (Milliseconds)** |
