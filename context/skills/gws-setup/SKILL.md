---
name: gws-setup
description: Guides an operator through a reviewed Google Workspace CLI installation and OAuth setup.
---

# Google Workspace CLI setup

Use this skill only when the user asks to connect Google Workspace through the external `gws` CLI.
This is not a built-in Tars integration.

## Install safely

1. Open the official Google Workspace CLI release documentation and identify a pinned release for
   the user's platform.
2. Download the release artifact without piping a remote script into a shell.
3. Verify the publisher-provided checksum or signature before installation.
4. Run `gws --version` and `gws --help` to confirm the installed command and current syntax.

Do not guess current download URLs or authentication commands; the external project may change.

## Authenticate

Follow the CLI's current official OAuth setup flow using a dedicated Google Cloud project and a
Desktop OAuth client. Enable only the Workspace APIs required by the user's workflow and choose the
smallest OAuth scopes that work.

Never paste a client secret, access token, or refresh token into chat, Tars memory, a skill file, or
the repository. Store and revoke credentials using the external CLI's documented credential store.

## Generate skills

If the installed version supports skill generation, direct output to `~/.tars/skills/` and review
every generated `SKILL.md` before use. Remove recipes that request broader scopes or actions than the
user needs, then run:

```bash
tars memory sync
```

Generated skills are instructions; they do not create a sandbox or independently authorize Google
Workspace changes.
