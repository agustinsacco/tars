---
layout: ../../layouts/DocLayout.astro
title: Security Analyzer
description: Deploying Tars as a 24/7 security analyst.
section: Use Cases
---

Tars's ability to run recurring background tasks makes it a cost-effective, hyper-vigilant **Security Analyst** for your infrastructure.

## Setup
Create a dedicated system prompt (`~/.tars/.gemini/system.md`) for this specific agent:
> "You are an expert cybersecurity analyst. Your job is to monitor logs for anomalies, bruteforce attacks, and unauthorized access. You are paranoid, diligent, and concise."

## Capabilities

### Log Ingestion & Analysis
Typical SIEM tools are expensive and require complex query languages. By writing a simple Tars scheduled task, you get the same result powered by LLM reasoning:

```text
User: "Every hour, scan /var/log/auth.log. If you detect any SSH login attempts from an IP address not inside our standard VPN range, alert me immediately with the IP and the username they tried to guess."
```

Tars will silently read the auth logs in the background. If nothing is found, it goes back to sleep. If an anomaly is located, you will receive a Discord ping instantly.

### Automated Incident Response
Because Tars has terminal access, it can go a step further than just alerting.
```text
User: "If you detect a repetitive brute force attack on WordPress, automatically block the IP using UFW and log the incident to our internal tracker."
```

### Exploit Verification
If a new CVE drops, you can paste the CVE number into Discord. First, Tars uses the Gemini web search tools to understand the CVE. Then, because it is running locally on your infrastructure, Tars can immediately run vulnerability scanners or inspect your package versions to see if you are exposed without needing manual intervention.
