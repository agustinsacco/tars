---
layout: ../../layouts/DocLayout.astro
title: Discord
description: Connect a Discord bot and configure a single preauthorized owner.
section: Get Started
---

Discord is the supported background channel. Tars responds to direct messages and addressed guild
messages, then streams the supervised model response back to the same channel.

## Bot setup

1. Create an application and bot in the Discord Developer Portal.
2. Enable the Message Content privileged intent.
3. Invite the bot with only the permissions it needs: view channels, read message history, send
   messages, and attach files if you use attachments.
4. Enable Developer Mode in Discord, copy your own user ID, then run `tars setup` and provide both
   the bot token and that 17–20 digit owner ID.

`tars discord` prints setup and invitation guidance; it does not open a browser automatically.

## Owner authorization

Preconfigure `channels.discord.ownerId` or the legacy `discordOwnerId`. The setup wizard writes both
fields for compatibility. Tars accepts Discord messages only when their author matches that owner.

If no owner ID is configured, every Discord message is ignored. Direct messages never establish or
replace the owner. Run `tars setup` again, or set `DISCORD_OWNER_ID` before restarting the process.
Use `tars discord` to check whether the local workspace currently has an owner ID configured.

Set `channels.discord.enabled` to `false` to keep the Discord channel off. An explicit false value
wins even when `DISCORD_TOKEN` is present.

## Message commands

Send these as messages to the bot:

- `/help` — show supported message commands;
- `/stats` — show active-session usage;
- `/quota` — show provider rate-limit information;
- `/reset` or `/clear` — immediately delete the active conversation and start a new session.

There is no `$ping` command.

## Attachments

Tars constrains the Discord CDN source, filename, declared and streamed size, download time, and
local destination before placing a file in its temporary area. Treat every attachment type and its
content as untrusted prompt input. Do not upload credentials, private keys, or data the configured
model provider should not receive.
