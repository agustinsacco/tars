---
layout: ../../layouts/DocLayout.astro
title: Security Model
description: Implemented controls, trust boundaries, and known limitations.
section: Capabilities
---

Tars keeps its workspace local and adds defensive checks around common ingress, process, web, log,
dashboard, and archive paths. These controls reduce risk; they do not make an AI agent a security
boundary.

## Implemented controls

- **Discord ownership:** every accepted message must match the preconfigured owner ID. With no owner
  ID, all Discord messages are ignored; inbound messages never establish or replace trust.
- **Attachments:** the Discord CDN source, filename, declared and streamed size, download time, and
  local destination are constrained.
- **Configuration:** external data is schema-validated; numeric values are bounded; exported
  environment variables are not overwritten by `.env`.
- **MCP:** missing or invalid enablement denies all extensions. Subprocess environment variables are
  minimized and explicitly allowlisted; working directories and timeouts are bounded.
- **Web fetch:** only public HTTP(S) destinations are allowed. Private, loopback, and non-HTTP targets
  are rejected across redirects, with time and response-size limits.
- **Logs and events:** common sensitive tool arguments and output are redacted.
- **Dashboard:** disabled by default, loopback-bound, requires a non-default password of at least 16
  characters, is rate-limited, and uses constant-time Basic authentication. File APIs enforce
  real-path containment and deny credential files.
- **Backups and maintenance:** exports exclude known credential files and redact recognized JSON
  keys on a best-effort basis. Import and refresh validate staged content and use atomic replacement
  with rollback. Update validates the package before installation and attempts to reinstall the prior
  version if a later step fails. Uninstall rejects broad or unmarked targets.
- **State writes:** session compression and task writes preserve valid prior data on failure; task
  storage coordinates across processes.

## Explicit limitations

- Tars and its extensions run with the OS user's authority. There is no filesystem, shell, network,
  or process sandbox.
- Model output and prompt instructions are not trusted authorization decisions.
- Redaction is not comprehensive DLP and cannot retract data already sent to a provider or external
  tool.
- Tars does not provide prompt-injection immunity, model rollback detection, signed extensions, or
  human confirmation for every destructive operation.
- A local workspace does not imply local inference. Cloud providers and Discord receive data sent to
  them.
- Basic authentication is not a substitute for TLS or a trusted network boundary.

## Deployment guidance

Run Tars as a dedicated least-privilege user. Keep `~/.tars/.env` owner-readable only. Review each
skill and extension, maintain strict enablement, and avoid granting administrator credentials.
Keep the dashboard and local inference on loopback and use authenticated tunnels for remote access.
Treat backup archives as sensitive, test restoration, and monitor logs for denied access and
repeated failures.

For high-risk commands, enforce authorization and confirmation outside the model—for example with
OS permissions, `sudoers` rules, a constrained wrapper, or a separate approval service.
