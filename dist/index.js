#!/usr/bin/env node
/**
 * USCIS MCP Server — stdio entry point.
 *
 * For Claude Desktop and any local MCP client that spawns a subprocess.
 * Single shared Server instance — stdio is inherently one-connection.
 *
 * Run:
 *   $ npm run build && npm start
 *
 * Claude Desktop config (claude_desktop_config.json):
 *   {
 *     "mcpServers": {
 *       "uscis": {
 *         "command": "node",
 *         "args": ["/absolute/path/to/dist/index.js"]
 *       }
 *     }
 *   }
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./lib/server-factory.js";
async function main() {
    const server = createServer();
    const transport = new StdioServerTransport();
    await server.connect(transport);
    // stdout is reserved for MCP — log to stderr only.
    process.stderr.write("[uscis-mcp] ready on stdio\n");
}
main().catch((err) => {
    process.stderr.write(`[uscis-mcp] fatal: ${String(err)}\n`);
    process.exit(1);
});
//# sourceMappingURL=index.js.map