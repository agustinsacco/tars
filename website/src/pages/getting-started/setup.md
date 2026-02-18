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

The wizard creates the Tars home directory structure:

```
~/.tars/
├── .gemini/             # Isolated Gemini CLI home
│   ├── extensions/      # MCP extension symlinks
│   ├── skills/          # Built-in + user skills
│   ├── tmp/             # Gemini session temp files
│   ├── history/         # Past session data
│   ├── GEMINI.md        # Working memory (brain)
│   ├── settings.json    # Gemini CLI settings
│   ├── oauth_creds.json # Mirrored auth credentials
│   └── system.md        # System prompt
├── data/
│   ├── tasks.json       # Scheduled tasks
│   ├── session.json     # Active session state
│   ├── knowledge.db     # SQLite FTS5 knowledge store
│   ├── uploads/         # Discord attachment downloads
│   └── tmp/             # Temporary response files
├── logs/                # PM2 log output
├── config.json          # Tars configuration
└── .env                 # Encrypted secrets
```

### Auto-Bootstrapping on Start

When `tars start` runs, the supervisor automatically executes these bootstrapping functions before starting the heartbeat:

- **installSystemPrompt** — Copies the latest `system.md` from the package
- **installSkills** — Syncs built-in skills while preserving user-created ones
- **installExtensions** — Validates and re-links extension symlinks
- **installDefaultSettings** — Ensures `settings.json` exists with compression config

This means Tars self-heals on every startup — broken symlinks are repaired, missing files are restored.

### Gemini CLI Settings

The wizard configures `settings.json` with:

```json
{
    "model": {
        "compressionThreshold": 0.2,
        "summarizeToolOutput": {
            "run_shell_command": { "tokenBudget": 2000 }
        }
    },
    "security": {
        "auth": {
            "selectedType": "oauth-personal"
        }
    }
}
```

The `compressionThreshold: 0.2` triggers context compaction at 20% capacity, keeping sessions lean.
