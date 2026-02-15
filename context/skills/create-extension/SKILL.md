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
    - Set `command` to `node`.
    - Set `args` to `["${extensionPath}/server.js"]`.
7.  **Register**: Run `gemini extensions install .` from the directory.

## Template (server.js)
```javascript
#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const server = new Server({ name: 'my-extension', version: '1.0.0' }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [{ name: 'my_tool', description: 'Describe tool here', inputSchema: { type: 'object', properties: {} } }]
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name === 'my_tool') {
    return { content: [{ type: 'text', text: 'Hello from Tars extension!' }] };
  }
  throw new Error('Tool not found');
});

const transport = new StdioServerTransport();
await server.connect(transport);
```
