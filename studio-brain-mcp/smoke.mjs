import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({
  command: process.execPath,
  args: ["./server.mjs"],
  cwd: new URL(".", import.meta.url),
  stderr: "pipe",
  env: {
    ...process.env,
  },
});

if (transport.stderr) {
  transport.stderr.on("data", (chunk) => {
    process.stderr.write(chunk.toString());
  });
}

const client = new Client({
  name: "studio-brain-mcp-smoke",
  version: "0.1.0",
});

try {
  await client.connect(transport);
  const listed = await client.listTools();
  const names = listed.tools.map((tool) => tool.name);
  if (!names.includes("studio_brain_memory_search")) {
    throw new Error(`Expected tool not found. Advertised tools: ${names.join(", ")}`);
  }
  process.stdout.write("Studio Brain MCP smoke test passed.\n");
} finally {
  await transport.close();
}
