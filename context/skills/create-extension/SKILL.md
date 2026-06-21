---
name: extension-builder
description: Guide for creating new MCP extensions at runtime.
---

# extension-builder Guide Skill

This skill allows Tars to create new MCP extensions to expand its own toolset.

## Instructions

When you need to build a new tool or integration:

1.  **Plan & Consolidate Tools**: Define the name and the MCP tools.
    - **CRITICAL**: Do NOT expose many small, granular tools. Consolidate related operations into a single tool using an `action` parameter (`z.enum`) to keep the total tool count low. This prevents attention dilution in local/smaller models.
2.  **Create the Directory**: Move to `~/.tars/.gemini/extensions/<name>`.
3.  **Initialize npm**: Run `npm init -y`. Set `"type": "module"` in `package.json`.
4.  **Install Dependencies**: Install `@modelcontextprotocol/sdk` and any required libraries.
5.  **Write the Server (JavaScript)**: Create a `server.js` file.
    - **CRITICAL**: Use **plain JavaScript** for runtime-created extensions to avoid a build step.
    - Use `@modelcontextprotocol/sdk` to define tools and handle stdio.
6.  **Create Manifest**: Create `tars-extension.json`.
7.  **Enable Extension**: Edit `~/.tars/.gemini/extensions/extension-enablement.json`.
    - Authorize the extension by adding its entry with safety overrides:
    ```json
    "my-extension": {
        "overrides": ["/path/to/my/workspace/*"]
    }
    ```
8.  **Finalize**: Restart Tars using `tars stop && tars start`.

## Manifest Template (tars-extension.json)

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

// Consolidated, action-based tool example
server.registerTool(
    'manage_data',
    {
        description: 'Perform actions (store, delete, or list) on the data store.',
        inputSchema: z.object({
            action: z.enum(['store', 'delete', 'list']).description('The action to perform'),
            key: z.string().optional().description('Required for store/delete actions'),
            value: z.string().optional().description('Required for store action')
        })
    },
    async (args) => {
        const { action, key, value } = args;

        if (action === 'store') {
            if (!key || !value)
                return {
                    content: [{ type: 'text', text: 'Error: Key and value required' }],
                    isError: true
                };
            // Store implementation...
            return { content: [{ type: 'text', text: `Successfully stored key: ${key}` }] };
        } else if (action === 'delete') {
            if (!key)
                return { content: [{ type: 'text', text: 'Error: Key required' }], isError: true };
            // Delete implementation...
            return { content: [{ type: 'text', text: `Successfully deleted key: ${key}` }] };
        } else if (action === 'list') {
            // List implementation...
            return { content: [{ type: 'text', text: 'Listing stored keys...' }] };
        }

        return { content: [{ type: 'text', text: 'Invalid action' }], isError: true };
    }
);

const transport = new StdioServerTransport();
await server.connect(transport);
```

## Handling Secrets & Authentication

Do **NOT** hardcode API keys.

1. **Access**: Use `process.env.MY_SECRET_KEY` in your extension code.
2. **Missing Key Handling**: If missing, return a clear error:
   `"API Key missing. Please run 'tars secret set MY_SECRET_KEY <YOUR_KEY>' and restart Tars."`
3. **Storage**: Tars manages these via `~/.tars/.env`. Use `tars secret set KEY VALUE` to store them.
