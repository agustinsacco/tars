---
layout: ../../layouts/DocLayout.astro
title: Customization
description: Rename your assistant and customize its identity.
section: Get Started
---

You can customize the identity of your assistant by renaming it. This affects the persona in the system prompt, the Discord command prefix, and internal logs.

## Renaming the Assistant

To rename your assistant, you can set the `ASSISTANT_NAME` environment variable before starting or add it to your `config.json`.

### Using Environment Variables

```bash
export ASSISTANT_NAME="Case"
tars start
```

Now, the assistant will refer to itself as **Case**, and you can interact with it using the `!case` prefix in Discord.

### Using config.json

Alternatively, you can edit your `config.json` (located in your Tars home directory, usually `~/.tars/config.json`):

```json
{
    "assistantName": "Case",
    "discordToken": "...",
    "piProvider": "google",
    "piModel": "gemini-2.5-flash"
}
```

## How it Works

1. **System Prompt**: The `system.md` file is automatically templated. On every startup, the supervisor replaces all occurrences of the assistant name in the prompt with your configured value.
2. **Discord Prefix**: The bot dynamically listens for `!${name}`. For example, if you name it "Interstellar", it will respond to `!interstellar`.
3. **Legacy Fallback**: The bot will always respond to `!tars` as a fallback to ensure you never lose control of the agent.

---

## Changing the CLI Binary Name

While you can rename the assistant's _identity_, the command-line tool itself remains `tars` to maintain backward compatibility and ensure standard installation paths work as expected.
