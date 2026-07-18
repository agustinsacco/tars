---
layout: ../../layouts/DocLayout.astro
title: Host Operations
description: Assist with explicit diagnostics and maintenance under least privilege.
section: Operational Guides
---

Tars can analyze logs, inspect service state, or run a documented maintenance workflow when an
enabled tool grants those operations.

## Recommended deployment

1. Create a dedicated non-root OS user.
2. Grant read-only access first and add narrow command wrappers only as required.
3. Keep the dashboard and local model endpoints on loopback.
4. Store credentials outside prompts and allowlist only required extension variables.
5. Require deterministic approval for restarts, package changes, firewall edits, user management,
   and deletion.

The heartbeat is not a host monitor. For continuous health checks, use a dedicated monitoring system
and have it send bounded, explicit events or reports for Tars to analyze.
