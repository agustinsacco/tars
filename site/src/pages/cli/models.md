---
layout: ../../layouts/DocLayout.astro
title: Models and Sign-in
description: Sign in to any pi registry provider and pick a discovered model and thinking level.
section: CLI
---

Tars runs on the pi model registry, so every provider pi knows about is available: OpenAI Codex
(ChatGPT subscriptions), Anthropic, OpenAI, Google, GitHub Copilot, OpenRouter, and many more, plus
local and custom OpenAI-compatible endpoints.

## Pick a provider and model

```bash
tars model
```

The command walks through four steps and writes the result to `~/.tars/config.json`:

1. **Provider** — the list shows each provider's sign-in methods (`OAuth`, `API key`, or
   `environment credentials`) and whether you are already signed in.
2. **Credentials** — keep the current credentials, sign in with OAuth in your browser, enter an API
   key, or import an existing login from the standalone `pi` CLI (`~/.pi/agent/auth.json`).
3. **Model** — models are discovered from the signed-in account (the live catalog is refreshed when
   the network allows). You can always enter a model id manually.
4. **Thinking level** — reasoning-capable models ask for `off`, `minimal`, `low`, `medium`, `high`,
   `xhigh`, or `max`; only levels the model supports are offered and `medium` is suggested. The
   context window is taken from the catalog.

Apply the change with `tars restart`.

### Non-interactive use

Flags pre-answer prompts, which is handy over SSH or in scripts. With `--provider`, stored
credentials for that provider are kept as they are (re-authenticate with `tars auth login`), so the
command finishes without prompting once you are signed in.

```bash
tars model --provider openai-codex --model gpt-5.6-luna --thinking medium
tars restart
```

`--model` requires `--provider`. An unsupported `--thinking` level for the chosen model fails
before anything is written.

## Sign in separately

```bash
tars auth login openai-codex        # OAuth (ChatGPT Plus/Pro)
tars auth login anthropic --api-key # API key instead of OAuth for providers that offer both
tars auth status
tars auth logout openai-codex
```

Credentials live in `~/.tars/auth.json` with owner-only permissions. OAuth tokens refresh
automatically; the supervisor picks up new credentials on the next message without a restart.
Providers without an interactive login (for example cloud SDK profiles) read ambient credentials
from the environment.

## Configuration keys

| JSON              | Environment         | Purpose                                           |
| ----------------- | ------------------- | ------------------------------------------------- |
| `piProvider`      | `PI_PROVIDER`       | Provider id, for example `openai-codex`           |
| `piModel`         | `PI_MODEL`          | Model id, for example `gpt-5.6-luna`              |
| `piThinkingLevel` | `PI_THINKING_LEVEL` | Reasoning effort; ignored by non-reasoning models |
| `piBaseUrl`       | `PI_BASE_URL`       | Local or custom OpenAI-compatible endpoint        |

Local and custom endpoints keep their optional key in `~/.tars/.env` (`LOCAL_API_KEY` or
`CUSTOM_API_KEY`). When a thinking level other than `off` is set, Tars advertises reasoning for
the endpoint model so pi forwards the effort parameter.
