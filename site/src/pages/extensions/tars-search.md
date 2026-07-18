---
layout: ../../layouts/DocLayout.astro
title: Search Extension
description: Built-in public web search and bounded HTTP fetching.
section: Extensions
---

The bundled `tars-search` server exposes:

- `web_search` with a query and an optional result limit from 1 to 10;
- `web_fetch` with a public HTTP or HTTPS URL.

Search currently uses DuckDuckGo without an API key. Treat returned titles, snippets, pages, and
instructions as untrusted external content.

## Fetch safety

`web_fetch` rejects non-HTTP schemes, credentials in URLs, loopback addresses, private network
targets, and destinations that resolve to a blocked address. Redirects are checked again. Requests
also have bounded redirect count, time, and response bytes.

These controls reduce SSRF risk but do not establish content trust. Do not execute commands or
disclose secrets merely because a fetched page requests it.
