#!/usr/bin/env node

import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..");
const HOME_ROOT = homedir();

const syncPairs = [
  {
    source: resolve(REPO_ROOT, "secrets", "portal", "portal-agent-staff.json"),
    destination: resolve(HOME_ROOT, "secrets", "portal", "portal-agent-staff.json"),
  },
  {
    source: resolve(REPO_ROOT, "secrets", "portal", "portal-automation.env"),
    destination: resolve(HOME_ROOT, "secrets", "portal", "portal-automation.env"),
  },
  {
    source: resolve(REPO_ROOT, "secrets", "studio-brain", "studio-brain-mcp.env"),
    destination: resolve(HOME_ROOT, "secrets", "studio-brain", "studio-brain-mcp.env"),
  },
  {
    source: resolve(REPO_ROOT, "secrets", "studio-brain", "studio-brain-mcp.env"),
    destination: resolve(HOME_ROOT, "secrets", "studio-brain", "studio-brain-automation.env"),
  },
];

const results = [];

for (const pair of syncPairs) {
  if (!existsSync(pair.source)) {
    results.push({
      ok: false,
      source: pair.source,
      destination: pair.destination,
      status: "missing-source",
    });
    continue;
  }
  mkdirSync(dirname(pair.destination), { recursive: true });
  copyFileSync(pair.source, pair.destination);
  results.push({
    ok: true,
    source: pair.source,
    destination: pair.destination,
    status: "copied",
  });
}

process.stdout.write(
  `${JSON.stringify(
    {
      schema: "codex-home-runtime-sync-report.v1",
      homeRoot: HOME_ROOT,
      repoRoot: REPO_ROOT,
      results,
    },
    null,
    2
  )}\n`
);
