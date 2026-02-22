---
layout: ../../layouts/DocLayout.astro
title: Server & Host Manager
description: Give Tars the keys to a server and let it handle the sysadmin work.
section: Use Cases
---

Because Tars is a lightweight Node.js wrapper with full shell access, it makes an excellent automated systems administrator when deployed directly on a Linux host (bare-metal, VPS, or homelab).

## Setup
Install Tars globally on your server:
```bash
npm install -g @saccolabs/tars
```

During `tars setup`, provide a dedicated Discord Bot Token (e.g., "Web-Server-Bot"). 

## Capabilities

### Autonomous Updates
Instruct Tars to keep your server up to date via its background heartbeat.
```text
User: "Every Sunday at 3am, run apt-get update and apt-get upgrade. Send me a summary of what packages were updated."
```
Tars will autonomously spin up on Sunday, run the bash commands, analyze the massive wall of update text, and send you a neat 3-bullet-point summary in Discord on Monday morning.

### Incident Remediation
If an application crashes, Tars is already on the machine. You can message your bot directly from Discord:
```text
User: "Why is the Nginx site down? Look at the error logs and restart the service."
```
Tars will execute `systemctl status nginx`, read the logs in `/var/log/nginx/`, recognize a syntax error in the config file, fix the syntax error via a patch, and restart the service—all while you're sitting in a coffee shop using your phone.

### Host Monitoring
Write a custom **Skill (SKILL.md)** that teaches Tars how to parse your specific Docker logs or `htop` output. When Tars wakes up on its heartbeat, it will review these metrics and alert you proactively if memory usage spikes past 90%.
