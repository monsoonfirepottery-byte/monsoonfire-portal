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
    repoPath: resolve(REPO_ROOT, "secrets", "portal", "portal-agent-staff.json"),
    fallbackRepoSource: resolveSourcePath("secrets", "portal", "portal-agent-staff.json"),
    homePath: resolve(HOME_ROOT, "secrets", "portal", "portal-agent-staff.json"),
  },
  {
    repoPath: resolve(REPO_ROOT, "secrets", "portal", "portal-automation.env"),
    fallbackRepoSource: resolveSourcePath("secrets", "portal", "portal-automation.env"),
    homePath: resolve(HOME_ROOT, "secrets", "portal", "portal-automation.env"),
  },
  {
    repoPath: resolve(REPO_ROOT, "secrets", "studio-brain", "studio-brain-mcp.env"),
    fallbackRepoSource: resolveSourcePath("secrets", "studio-brain", "studio-brain-mcp.env"),
    homePath: resolve(HOME_ROOT, "secrets", "studio-brain", "studio-brain-mcp.env"),
  },
  {
    repoPath: resolve(REPO_ROOT, "secrets", "studio-brain", "studio-brain-automation.env"),
    fallbackRepoSource: resolveSourcePath("secrets", "studio-brain", "studio-brain-mcp.env"),
    homePath: resolve(HOME_ROOT, "secrets", "studio-brain", "studio-brain-automation.env"),
  },
];

const results = [];

for (const pair of syncPairs) {
  if (existsSync(pair.homePath)) {
    mkdirSync(dirname(pair.repoPath), { recursive: true });
    copyFileSync(pair.homePath, pair.repoPath);
    results.push({
      ok: true,
      source: pair.homePath,
      destination: pair.repoPath,
      direction: "home-to-repo",
      status: "copied",
    });
    continue;
  }

  if (!existsSync(pair.fallbackRepoSource)) {
    results.push({
      ok: false,
      source: pair.fallbackRepoSource,
      destination: pair.homePath,
      direction: "repo-to-home",
      status: "missing-source",
    });
    continue;
  }
  mkdirSync(dirname(pair.homePath), { recursive: true });
  copyFileSync(pair.fallbackRepoSource, pair.homePath);
  results.push({
    ok: true,
    source: pair.fallbackRepoSource,
    destination: pair.homePath,
    direction: "repo-to-home",
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
