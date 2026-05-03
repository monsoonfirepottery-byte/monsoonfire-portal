import test from "node:test";
import assert from "node:assert/strict";

import {
  collectRepoCodexConfigErrors,
  parseCodexConfigToml,
  readCanonicalSetFromDocs,
} from "./audit-codex-mcp.mjs";

test("parseCodexConfigToml ignores nested MCP tool tables while keeping quoted server ids", () => {
  const toml = `
[mcp_servers.open_memory]
command = "pwsh"
enabled = true

[mcp_servers."studio-brain-memory"]
command = "pwsh"
enabled = true

[mcp_servers."studio-brain-memory".tools.studio_brain_memory_context]
approval_mode = "approve"

[mcp_servers."studio-brain-memory".tools.studio_brain_memory_search]
approval_mode = "approve"

[profiles.open_memory.mcp_servers.open_memory]
enabled = true
`;

  const { topServers, profileServers } = parseCodexConfigToml(toml);

  assert.deepEqual([...topServers.keys()].sort(), ["open_memory", "studio-brain-memory"]);
  assert.equal(topServers.get("studio-brain-memory")?.command, "pwsh");
  assert.equal(topServers.has('"studio-brain-memory".tools.studio_brain_memory_context'), false);
  assert.equal(profileServers.get("open_memory")?.get("open_memory")?.enabled, true);
});

test("readCanonicalSetFromDocs accepts hyphenated MCP ids and ignores wildcard aliases", () => {
  const markdown = `
## 3) MCP & External Sources

| Domain | Authoritative Source | Derived/Validated By | Trust |
|---|---|---|---|
| Open Memory bridge | \`~/.codex/config.toml\` (\`mcp_servers.open_memory\`) | audit | advisory |
| Studio Brain bridge | \`~/.codex/config.toml\` (\`mcp_servers.studio-brain-memory\`) | audit | advisory |
| Legacy aliases | \`~/.codex/config.toml\` (\`mcp_servers.agentOrchestration*\`) | audit | advisory |
`;

  const keys = readCanonicalSetFromDocs(markdown);

  assert.equal(keys.has("open_memory"), true);
  assert.equal(keys.has("studio-brain-memory"), true);
  assert.equal(keys.has("agentOrchestration"), false);
});

test("collectRepoCodexConfigErrors rejects non-canonical and machine-specific MCP entries", () => {
  const canonical = new Set(["open_memory", "studio-brain-memory"]);
  const toml = `
[mcp_servers.context7]
url = "https://mcp.context7.com/mcp"

[mcp_servers.open_memory]
command = "/bin/bash"
args = ["/home/wuff/monsoonfire-portal/scripts/open-memory-mcp-launch.sh"]
enabled = true
`;

  const errors = collectRepoCodexConfigErrors(toml, canonical);

  assert.equal(errors.some((entry) => entry.includes("mcp_servers.context7")), true);
  assert.equal(errors.some((entry) => entry.includes("/home/wuff/monsoonfire-portal")), true);
});

test("collectRepoCodexConfigErrors allows repo config without MCP server blocks", () => {
  const canonical = new Set(["open_memory", "studio-brain-memory"]);
  const toml = `
[features]
multi_agent = true
`;

  assert.deepEqual(collectRepoCodexConfigErrors(toml, canonical), []);
});
