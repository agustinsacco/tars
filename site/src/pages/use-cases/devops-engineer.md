---
layout: ../../layouts/DocLayout.astro
title: DevOps Workflows
description: Assist with explicit diagnostics, build analysis, and runbook-driven operations.
section: Operational Guides
---

Useful Tars workflows include summarizing CI logs, comparing manifests, drafting a rollout plan, or
following a reviewed runbook through narrow tools.

Keep deployment credentials out of model context. Prefer short-lived identities, read-only
diagnostics, protected environments, and external approval gates. Let CI/CD systems perform builds
and deployments; use Tars to inspect their state and prepare an exact requested change.

For scheduled reports, create an explicit task with a bounded prompt and `notify` mode. The cron
poller runs once per minute and can defer work while the supervisor is busy, so it should not gate a
deployment or incident response deadline.
