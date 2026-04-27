import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { resolveMcpDefaultCredentialsPath } from "./open-memory-mcp.mjs";

test("resolveMcpDefaultCredentialsPath prefers repo-local portal staff credentials", () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "open-memory-mcp-"));
  const expected = join(repoRoot, "secrets", "portal", "portal-agent-staff.json");

  try {
    mkdirSync(join(repoRoot, "secrets", "portal"), { recursive: true });
    writeFileSync(expected, "{}\n", "utf8");

    const actual = resolveMcpDefaultCredentialsPath({ repoRoot, env: {} });
    assert.equal(actual, expected);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("resolveMcpDefaultCredentialsPath resolves explicit relative credentials against repo root", () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "open-memory-mcp-"));
  const expected = join(repoRoot, "custom", "portal-agent-staff.json");

  try {
    mkdirSync(join(repoRoot, "custom"), { recursive: true });
    writeFileSync(expected, "{}\n", "utf8");

    const actual = resolveMcpDefaultCredentialsPath({
      repoRoot,
      env: {
        PORTAL_AGENT_STAFF_CREDENTIALS: "custom/portal-agent-staff.json",
      },
    });
    assert.equal(actual, expected);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});
