---
layout: ../../layouts/DocLayout.astro
title: DevOps Engineer
description: Connecting Tars to your Git and deployment pipelines.
section: Use Cases
---

You can deploy Tars on your build server or inside a development environment to act as an autonomous **DevOps Engineer**.

## Capabilities

### Pipeline Debugging
When a CI/CD pipeline fails, developers usually have to hunt through hundreds of lines of obscure build output. By connecting a Tars instance to the same machine running your runners (e.g., GitHub Actions self-hosted runner, GitLab Runner):

```text
User: "The latest build on 'main' failed. Find the workspace, read the test logs, figure out what broke, and write a patch to fix it."
```

Tars will locate the workspace, parse the raw test output, identify the failing unit test, and generate the TypeScript patch to resolve the issue before you even open your IDE.

### Release Management
Tars can be instructed to manage releases autonomously:
```text
User: "Check our Git history since the last release tag. Write a concise, professional changelog based on the commit messages, and then run the deploy script."
```
Tars will synthesize the raw `git log` output into a human-readable release note, and then execute the shell script required to push the code to production.

### Database Operations
With Model Context Protocol (MCP) extensions, Tars can connect to PostgreSQL, Redis, or MongoDB without having raw credentials in its prompt. You can ask Tars to:
- Run complex SQL migrations.
- Verify schema integrity after an update.
- Scrub sensitive data from a production dump and move it to staging.
