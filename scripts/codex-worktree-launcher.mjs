#!/usr/bin/env node

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { prepareCodexWorktree } from "./lib/codex-worktree-utils.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..");

function parseArgs(argv) {
  const options = {
    json: false,
    currentWorktree: false,
    worktreePath: "",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = String(argv[index] || "").trim();
    if (!arg) continue;
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    if (arg === "--current-worktree") {
      options.currentWorktree = true;
      continue;
    }
    if (arg === "--worktree-path" && argv[index + 1]) {
      options.worktreePath = String(argv[index + 1]).trim();
      index += 1;
      continue;
    }
    if (arg.startsWith("--worktree-path=")) {
      options.worktreePath = arg.slice("--worktree-path=".length).trim();
    }
  }
  return options;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const workspace = prepareCodexWorktree({
    repoRoot: REPO_ROOT,
    env: process.env,
    useCurrentWorktree: options.currentWorktree,
    requestedPath: options.worktreePath,
  });

  const report = {
    schema: "codex-worktree-launcher.v1",
    generatedAt: new Date().toISOString(),
    repoRoot: workspace.repoRoot,
    workspacePath: workspace.workspacePath,
    usingCleanWorktree: workspace.usingCleanWorktree,
    created: workspace.created,
    launcherState: workspace.launcherState,
    branch: workspace.branch,
    branchPrefixValid: workspace.branchPrefixValid,
    repoStatus: workspace.repoStatus,
    workspaceStatus: workspace.workspaceStatus,
  };

  if (options.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return;
  }

  process.stdout.write(`repo root: ${report.repoRoot}\n`);
  process.stdout.write(`workspace: ${report.workspacePath}\n`);
  process.stdout.write(`clean worktree: ${report.usingCleanWorktree ? `yes (${report.launcherState})` : "no (current worktree)" }\n`);
  process.stdout.write(`branch: ${report.branch || "HEAD"}\n`);
  process.stdout.write(`branch prefix valid: ${report.branchPrefixValid ? "yes" : "no"}\n`);
}

main();
