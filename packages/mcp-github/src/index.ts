// stdio MCP entry — per CONTRACTS.md §1.1
// NEVER write to stdout — stdout carries MCP protocol frames.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { tools } from "./tools/index.js";
import { getConfig } from "./lib/config.js";

// Fail fast on config errors at startup
try {
  getConfig();
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}

const server = new McpServer({ name: "github", version: "0.1.0" });

for (const t of tools) {
  server.registerTool(
    t.name,
    {
      title: t.name,
      description: t.description,
      inputSchema: t.schema.shape,
    },
    async (args) => {
      try {
        const result = await t.handler(args);
        return {
          content: [
            { type: "text", text: JSON.stringify(result, null, 2) },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                error: err instanceof Error ? err.message : String(err),
              }),
            },
          ],
          isError: true,
        };
      }
    },
  );
}

await server.connect(new StdioServerTransport());
console.error("GitHub MCP server running — waiting for tool calls...");
