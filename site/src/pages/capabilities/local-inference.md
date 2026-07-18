---
layout: ../../layouts/DocLayout.astro
title: Local and Custom Models
description: Configure a supported cloud provider or OpenAI-compatible endpoint.
section: Capabilities
---

Run `tars setup` to choose Google, OpenAI, Anthropic, a local endpoint, or another
OpenAI-compatible service.

For a local or custom endpoint, configure the base URL and the exact model ID exposed by that
server. A typical local base URL is:

```text
http://127.0.0.1:8080/v1
```

Use the endpoint's actual context limit in setup. Oversized context settings do not increase model
capacity and can cause failed requests or poor compression timing.

## Privacy considerations

A loopback endpoint can keep inference traffic on the host, but local inference alone does not make
the full system private:

- enabled extensions may access the network;
- web tools contact public services;
- Discord messages pass through Discord;
- dashboard exposure and OS-level access remain operator responsibilities.

Bind local inference servers to loopback unless remote access is intentionally protected. If the
server requires an API key, store it with `tars secret set` rather than in `config.json`.
