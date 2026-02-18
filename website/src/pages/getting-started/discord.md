---
layout: ../../layouts/DocLayout.astro
title: Discord Integration
description: How Tars communicates through Discord — triggers, attachments, and message formatting.
section: Get Started
---

## Overview

Discord is Tars' primary communication interface. The `DiscordBot` class wraps the `discord.js` library and connects to the Supervisor for all AI interactions.

## Message Triggers

Tars responds to three types of triggers:

| Trigger        | Context     | Example                             |
| -------------- | ----------- | ----------------------------------- |
| `!tars` prefix | Any channel | `!tars summarize this project`      |
| @mention       | Any channel | `@Tars check the deployment status` |
| Direct Message | DM channel  | Any message (no prefix needed)      |

The prefix and mention text are stripped before passing the prompt to the Supervisor.

## Attachment Processing

When a user sends a file attachment, the `AttachmentProcessor`:

1. **Downloads** the file to `~/.tars/data/uploads/` with the original filename
2. **Injects context** into the prompt: `[User attached file (image/png): /path/to/file]`
3. **Cleans up** uploads after 24 hours automatically

Supported attachments include images, documents, code files, and any other Discord-supported format.

## Response Handling

### Normal responses (< 1900 chars)

Messages are formatted and split into Discord-friendly chunks, preserving code blocks and formatting.

### Long responses (> 1900 chars)

The response is saved as a `.md` file in `~/.tars/data/tmp/` and uploaded as an attachment with a summary message.

### Typing Indicator

While processing, Tars sends a typing indicator every 9 seconds to keep the status active in Discord (Discord's typing status expires after 10s).

## Required Bot Permissions

Your Discord bot needs these intents enabled in the [Developer Portal](https://discord.com/developers/applications):

- **Guilds** — Access to server information
- **Guild Messages** — Read messages in channels
- **Message Content** — Access message text (Privileged Intent)
- **Direct Messages** — Receive DMs

The `tars setup` wizard validates these intents during token verification. If **Message Content Intent** is missing, you'll see a specific error with instructions to enable it.

## Invite Your Bot

After setup, generate an invite link:

```bash
tars discord
```

This opens the Discord OAuth2 URL in your browser with the correct permissions pre-selected.
