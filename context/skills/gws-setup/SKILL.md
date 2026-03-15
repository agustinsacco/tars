---
name: gws-setup
description: Guide for setting up and managing the Google Workspace CLI (gws) and its skill recipes.
---

# Google Workspace CLI (gws) Setup Guide

Use this skill when you need to enable Tars to interact with Google Workspace (Gmail, Drive, Calendar, etc.) using the professional-grade `gws` CLI.

## 🚀 1. Installation

The `gws` CLI is the engine behind all Google Workspace automation.

```bash
# Install via the official shell script (macOS/Linux)
curl -sSL https://github.com/googleworkspace/cli/releases/latest/download/gws-installer.sh | bash
```

## 🔑 2. Authentication Setup

Tars needs an OAuth client to act on your behalf. You should help the user set this up using the built-in wizard.

```bash
# Run the interactive setup wizard
gws auth setup
```

**Setup instructions to give the user:**

1.  **Google Cloud Project**: You'll need a project. If you don't have one, `gws` will help you create it or provide a link.
2.  **Enable APIs**: The wizard will prompt you to enable the APIs you want to use (e.g., Gmail, Drive).
3.  **OAuth Client**: The wizard will ask you to create a **Desktop App** OAuth client in the Google Cloud Console and download the `client_secret.json` file.
4.  **Login**: Once setup is complete, run:
    ```bash
    gws auth login
    ```

## 📚 3. Skill Generation

The `gws` CLI can auto-generate documentation (specialized "skills") for every Google Workspace API. This is how Tars learns exactly what commands to run.

```bash
# Generate all skills and recipes into Tars' skill directory
gws generate-skills --output-dir ~/.tars/.gemini/skills
```

**Why do this?**

- It creates `SKILL.md` files for Services (Gmail, Drive, etc.).
- It creates **Recipes** (e.g., `recipe-label-and-archive-emails`).
- It creates **Personas** (e.g., `persona-exec-assistant`).
- Once generated, Tars will automatically index these and know how to perform complex tasks.

## 🛠️ Common Admin Commands

```bash
# Check if you are logged in
gws auth status

# List all available services and helpers
gws --help

# Example: Read your first 5 emails
gws gmail +triage --limit 5
```

## ⚠️ Security

- **Never** share the `client_secret.json`.
- Tars will store its tokens in `~/.tars/.gemini/token_cache.json`.
- If you need to revoke access, run `gws auth logout`.
