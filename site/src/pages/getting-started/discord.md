---
layout: ../../layouts/DocLayout.astro
title: Discord Integration
description: Interact with Tars through your own secure command center.
section: Get Started
---

Discord serves as the primary interface for Tars. It provides a secure, cross-platform environment to monitor and control your infrastructure from any device.

### Message Triggers

Tars monitors your Discord channels and responds to specific triggers:

| Trigger            | Use Case             | Example                         |
| ------------------ | -------------------- | ------------------------------- |
| **Direct Message** | Private Commands     | _(No prefix needed)_            |
| **@Mention**       | Public Multi-tasking | `@Tars check the server status` |
| **!tars** Prefix   | Channel Commands     | `!tars summarize recent logs`   |

### File Attachments

You can send files directly to Tars in Discord. Tars will download the attachment, analyze its content, and include it in the conversation context. This is ideal for:

- Analyzing log files
- Explaining code snippets
- Processing images or documents

_Note: Uploaded files are automatically purged from the local cache after 24 hours._

### Bot Permissions

To function correctly, your Discord bot requires the following **Gateway Intents** enabled in the [Developer Portal](https://discord.com/developers/applications):

- **Guild Messages**
- **Message Content** (Privileged)
- **Direct Messages**

The `tars setup` wizard will verify these permissions automatically during configuration.

### Inviting the Bot

Once configured, generate a secure invite link to add Tars to your server:

```bash
tars discord
```

This command opens a browser tab with the required permissions pre-configured for your bot.
