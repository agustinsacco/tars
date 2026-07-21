---
layout: ../../layouts/DocLayout.astro
title: Extension Policy Audit
description: Audit and migrate custom MCP extension environment policies safely.
section: CLI
---

Custom MCP servers are trusted local subprocesses. Tars requires each enabled custom server to
explicitly declare which host environment variables it may inherit and keeps its working directory
inside the extension.

## Audit

```bash
tars extensions audit
```

The audit is read-only. It reports each blocking extension and server, its manifest path, the policy
problem, and likely environment-variable names found through a bounded source scan. It never prints
environment values or secret values. It exits nonzero when blockers are present, so automation can
use it as a readiness check.

Source scanning recognizes static references such as `process.env.SHOPIFY_TOKEN`. It cannot prove
that every required variable was found, especially when an extension computes names dynamically or
loads an external package. Treat suggestions as a review aid, not an authorization decision.

## Guided migration

```bash
tars extensions migrate
```

For each legacy extension, choose one of these outcomes:

1. allow the names detected by the source scan after reviewing them;
2. enter the required names manually;
3. explicitly grant no inherited variables with `envAllowlist: []`;
4. disable the extension; or
5. cancel without writing changes.

Tars groups servers by extension because an allowlist in `extension-enablement.json` applies to the
whole extension. It preserves existing settings, creates an owner-readable backup, and atomically
replaces the enablement file. The file contains variable names only; credential values remain in
`~/.tars/.env`.

Working directories outside an extension cannot be rewritten automatically. The migration lets you
disable that extension, or you can cancel, move the required files inside it, and rerun the audit.

## Restart behavior

```bash
tars restart
```

When unresolved policies exist, an interactive restart launches the same guided migration and
continues restarting active processes only after the audit passes. A non-interactive restart pauses
and tells the operator to run `tars extensions migrate`; it never chooses an empty allowlist or
grants detected credentials automatically.

After a standalone migration, run `tars restart` to load the reviewed policies.

## Updates

`tars update` stages the target release and runs that release's preflight before installing it.
Custom-policy findings do not block a core update: affected extensions remain fail-closed, the
update completes, and the CLI reports `tars extensions migrate` as a post-update action. This avoids
an upgrade deadlock while preserving least privilege. You do not need to stop Tars first; a
successful update restarts the processes that were active when it began.
