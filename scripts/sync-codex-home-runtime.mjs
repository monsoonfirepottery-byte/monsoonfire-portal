#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..");
const HOME_ROOT = homedir();

function listWorktreeRoots() {
  const result = spawnSync("git", ["worktree", "list", "--porcelain"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (result.status !== 0) {
    return [REPO_ROOT];
  }

  const roots = [];
  for (const rawLine of String(result.stdout || "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line.startsWith("worktree ")) continue;
    roots.push(resolve(line.slice("worktree ".length)));
  }

  return roots.length > 0 ? Array.from(new Set([REPO_ROOT, ...roots])) : [REPO_ROOT];
}

const sourceRoots = listWorktreeRoots();

function resolveSourcePath(...parts) {
  for (const root of sourceRoots) {
    const candidate = resolve(root, ...parts);
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return resolve(REPO_ROOT, ...parts);
}

const syncPairs = [
  {
    source: resolveSourcePath("secrets", "portal", "portal-agent-staff.json"),
    destination: resolve(HOME_ROOT, "secrets", "portal", "portal-agent-staff.json"),
  },
  {
    source: resolveSourcePath("secrets", "portal", "portal-automation.env"),
    destination: resolve(HOME_ROOT, "secrets", "portal", "portal-automation.env"),
  },
  {
    source: resolveSourcePath("secrets", "studio-brain", "studio-brain-mcp.env"),
    destination: resolve(HOME_ROOT, "secrets", "studio-brain", "studio-brain-mcp.env"),
  },
  {
    source: resolveSourcePath("secrets", "studio-brain", "studio-brain-mcp.env"),
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
      sourceRoots,
      results,
    },
    null,
    2
  )}\n`
);
