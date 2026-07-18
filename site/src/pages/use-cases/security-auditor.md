---
layout: ../../layouts/DocLayout.astro
title: Security Reviews
description: Use Tars as a supervised analysis aid, not a 24/7 security control.
section: Operational Guides
---

Tars can summarize a supplied log sample, compare a configuration with a documented baseline, or
draft remediation steps. It does not continuously collect events, detect incidents, or replace a
SIEM, EDR, vulnerability scanner, or human responder.

## Safe pattern

- provide a bounded, redacted input set;
- request evidence and uncertainty, not only a verdict;
- validate findings with authoritative tools;
- keep remediation read-only until an operator approves an exact change;
- record the source, time range, and limitations in the result.

Adversarial log or document content can influence a model. Treat it as untrusted data, keep secrets
out of the prompt, and enforce permissions outside Tars.
