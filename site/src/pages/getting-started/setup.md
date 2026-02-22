---
layout: ../../layouts/DocLayout.astro
title: Setup Wizard
description: The four-step onboarding wizard that configures Tars for first use.
section: Get Started
---

## Running Setup

```bash
tars setup
```

The setup wizard walks through four steps:

## Step 1: Google Authentication

Tars checks for the Gemini CLI and existing OAuth credentials at `~/.gemini/oauth_creds.json`.

- If already authenticated, you can skip or re-authenticate with a different account
- If not authenticated, a browser window opens for Google OAuth sign-in
- Credentials are validated by checking for the `oauth_creds.json` file or running `gemini auth print-access-token`

## Step 2: Discord Bot Token

You'll be prompted to enter your Discord bot token from the [Discord Developer Portal](https://discord.com/developers/applications).

The wizard validates the token by:

1. Creating a temporary Discord client with the required intents
2. Attempting to log in with the provided token
3. Verifying the **Message Content Intent** is enabled

If the intent is missing, the wizard displays step-by-step instructions to enable it in the Developer Portal.

## Step 3: Configuration

Interactive prompts for:

| Setting                | Default | Description                                |
| ---------------------- | ------- | ------------------------------------------ |
| **Gemini Model**       | `auto`  | Model selection (auto, flash, pro, custom) |
| **Heartbeat Interval** | `60s`   | How often the background heartbeat runs    |

Available models: Auto (recommended), Gemini 2.0 Flash, Gemini 2.0 Flash Lite, Gemini 2.0 Pro, Gemini 1.5 Pro, Gemini 1.5 Flash, or a custom model name.

## Step 4: Environment Provisioning

The wizard will quietly build the Tars home directory (`~/.tars/`) on your machine. This folder acts as your bot's brain. It holds its persistent memory, its task list, and its connection secrets.

## Starting Tars

Once the setup wizard finishes, you are ready to turn on the bot:
```bash
tars start
```

If the bot connects successfully, you will see it come online in your Discord server.
Send it a message in Discord saying `$ping` and it will reply, confirming that it has full access to the machine.

## Stopping Tars

To turn the bot off, run:
```bash
tars stop
```

## Next Steps

Now that Tars is running, you can explore the [Use Cases](/use-cases/personal-assistant) to see what it's capable of!
