---
layout: ../../layouts/DocLayout.astro
title: Personal Assistant
description: The default setup for Tars, acting as your daily helper.
section: Use Cases
---

By default, Tars is designed to be your **Personal Assistant**. Because you communicate with Tars via Discord, it is always available whether you are at your laptop, or on the go using your phone.

## Capabilities

### Episodic Memory
Tars remembers the facts you tell it forever. If you mention that you prefer `TypeScript` over `Python`, or that you use `yarn` instead of `npm`, Tars stores these as **Core Facts**. Every subsequent conversation will take these preferences into account, saving you from having to repeat yourself.

### Background Reminders & Tasks
Because Tars runs continuously (via a 5-minute heartbeat), it doesn't just respond to prompts—it can initiate them.

```text
User: "Remind me in 2 hours to check on the deployment."
Tars: "✅ Scheduled task. I will message you in 2 hours."
```

Tars will set a cron job for itself, and 2 hours later, you will receive an unprompted Discord message from Tars.

### Coding & File Management
Tars runs with the same permissions as your user account. Since it operates in a full bash shell, it can:
- Clone repositories
- Draft new `.ts` or `.json` files
- Run scripts (like `npm run dev`)
- Read crash logs and provide a summary of what went wrong

### Seamless Handoff
Start debugging an issue on your smartphone while on the train via the Discord app. By the time you get home and sit at your computer, Tars has already pulled the repository, written the patch, and is waiting for your approval to push the code.
