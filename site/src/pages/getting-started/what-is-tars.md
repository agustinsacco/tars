---
layout: ../../layouts/DocLayout.astro
title: What is Tars?
description: A self-hosted personal AI assistant that runs on your machine and answers to you.
section: Get Started
---

Tars is a personal AI assistant that runs as a plain Node.js process on hardware you control. A
PM2-managed supervisor connects one active agent to Discord, a foreground terminal chat, or a
loopback voice relay. Everything it knows and everything it did lives under `~/.tars/`, in files you
can open with any editor.

## What makes it different

- **It answers to one person.** The Discord bot only accepts messages from the preconfigured owner.
  Nothing anyone types in a chat can claim ownership.
- **Bring the model you already pay for.** Sign in with Claude Pro or Max, ChatGPT Plus or Pro, or
  GitHub Copilot through native OAuth, use an API key for any other provider in the pi model
  registry, or point Tars at a local OpenAI-compatible endpoint.
- **Memory that reaches the model.** Curated workspace files are injected into every prompt. Durable
  facts are flushed before context compression and consolidated nightly.
- **Background work you can audit.** Scheduled tasks are explicit and carry a delivery policy.
  Autonomous wakes follow a checklist you write, and an empty checklist costs nothing.
- **Extensible with plain files.** Skills are Markdown. Tools are MCP servers with explicit
  environment allowlists.

## Local-first, not necessarily offline

Configuration, conversations, memory, tasks, skills, extensions, and logs stay on your machine by
default. Model requests still leave the machine when you choose a cloud provider. Use a compatible
local endpoint when inference must remain on your network.

## Boundaries

Tars is not a sandbox. Its model tools and extensions have the permissions of the operating-system
user. There is one active agent and no sub-agent orchestration. Discord is the supported daemon
channel; terminal chat runs in the foreground and holds an exclusive lease on the workspace, so stop
the daemon first and do not send concurrent prompts through both.

Start with a dedicated least-privilege account and read the [security model](/capabilities/security)
before granting access to sensitive files, commands, or services.

## Next steps

- [Install Tars](/getting-started/installation) and run the setup wizard.
- [Connect Discord](/getting-started/discord) and confirm owner authorization.
- [Pick a model](/cli/models) and a thinking level.
- [Customize](/getting-started/customization) the prompt, skills, and extensions.
