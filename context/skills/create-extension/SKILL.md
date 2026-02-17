---
name: extension-builder
description: Guide for creating new Gemini CLI extensions with MCP tools.
---

# create-extension Guide Skill

This skill allows Tars to create new Gemini CLI extensions with MCP servers.

## Instructions

When you need to build a new tool or integration:

1.  **Plan the Extension**: Define the name and the MCP tools it will expose.
2.  **Create the Directory**: Move to `~/.gemini/extensions/<name>`.
3.  **Initialize npm**: Run `npm init -y`.
4.  **Install Dependencies**: Install `@modelcontextprotocol/sdk` and any other required libraries.
5.  **Write the Server (JavaScript)**: Create a `server.js` file.
    - **CRITICAL**: Use plain JavaScript for runtime-created extensions to avoid a build step.
    - Use the `@modelcontextprotocol/sdk` to define tools and handle stdio.
6.  **Create Manifest**: Create `gemini-extension.json`.
7.  **Register**: Run `gemini extensions install .` from the directory.

## Manifest Template (gemini-extension.json)

```json
{
    "name": "my-extension",
    "version": "1.0.0",
    "mcpServers": {
        "main": {
            "command": "node",
            "args": ["${extensionPath}/server.js"],
            "env": {
                "NODE_ENV": "production"
            }
        }
    }
}
```

## Server Template (server.js)

```javascript
#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const server = new McpServer({
    name: 'my-extension',
    version: '1.0.0'
});

server.registerTool(
    'my_tool',
    {
        description: 'Describe tool here',
        inputSchema: z.object({}).shape
    },
    async (args) => {
        return {
            content: [{ type: 'text', text: 'Hello from Tars extension!' }]
        };
    }
);

const transport = new StdioServerTransport();
await server.connect(transport);
```

##  Handling Secrets & Authentication

Do **NOT** pass API keys or credentials as tool arguments. This exposes them in the conversation history and logs.

**Standard Workflow:**

1. **Access**: Use `process.env.MY_SECRET_KEY` in your extension.
2. **Missing Key Handling**: If missing, return an error message:
   `" API Key missing. Please run 'tars secret set MY_SECRET_KEY YOUR_KEY' and restart Tars."`
3. **Storage**: Tars manages these via `~/.tars/.env` with private permissions.
