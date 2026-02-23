---
layout: ../../layouts/DocLayout.astro
title: Host Manager
description: Automate systems administration on Linux hosts and homelabs.
section: Use Cases
---

Tars is an ideal automated systems administrator when deployed directly on a Linux host, VPS, or homelab. Its native shell access allows it to manage system resources as if you were logged in via SSH.

### Deployment
Install Tars on your target host to begin:

```bash
npm install -g @saccolabs/tars
tars setup
```

We recommend using a specific Discord Bot name (e.g., `Prod-Server-Bot`) to distinguish it from your personal instances.

### Capabilities

#### Scheduled Maintenance
Automate routine updates and system checks. Tars can oversee complex upgrade paths and provide high-level summaries of the changes:

```text
User: "Every Sunday at 3 AM, update system packages and report any service restarts."
```

Tars will execute the maintenance, analyze the output, and send a concise status report to your Discord channel.

#### Remediation & Recovery
When a service fails, Tars is already on-site. You can diagnose and fix issues without opening a terminal:

```text
User: "The web server is returning 502s. Check the logs and restore service."
```

Tars can inspect `systemctl` statuses, read log files, identify configuration errors, and apply patches autonomously.

#### Proactive Monitoring
By combining the **Heartbeat** with custom **MCP Extensions**, Tars can monitor specific metrics (CPU, Memory, Disk) and alert you before a threshold is breached. It doesn't just send an alert—it can include a proposed fix based on the current system state.

