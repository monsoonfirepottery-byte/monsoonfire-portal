#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { spawnSync } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..");
const DEFAULT_CONTEXT_CANDIDATES = ["output/wiki/context-refresh.json", "output/wiki/context-check.json"];
const DEFAULT_REFRESH_ARTIFACT = "output/wiki/context-refresh.json";

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function parseContextArg(argv) {
  for (let index = 0; index < argv.length; index += 1) {
    const arg = clean(argv[index]);
    if (arg === "--context" && argv[index + 1]) return clean(argv[index + 1]);
    if (arg.startsWith("--context=")) return clean(arg.slice("--context=".length));
  }
  return "";
}

export function hasJsonArg(argv) {
  return argv.some((arg) => clean(arg) === "--json");
}

export function refreshArtifactForContext(context = "") {
  return clean(context) || DEFAULT_REFRESH_ARTIFACT;
}

export function buildRefreshArgs(context = "") {
  return [
    "./scripts/wiki-postgres.mjs",
    "context",
    "--fresh-extract",
    "--write-markdown",
    "--json",
    "--artifact",
    refreshArtifactForContext(context),
  ];
}

export function contextNeedsRefresh({ repoRoot = REPO_ROOT, context = "" } = {}) {
  const candidates = context ? [context] : DEFAULT_CONTEXT_CANDIDATES;
  for (const candidate of candidates) {
    const path = resolve(repoRoot, candidate);
    if (!existsSync(path)) continue;
    try {
      const artifact = JSON.parse(readFileSync(path, "utf8"));
      const pack = artifact?.contextPack && typeof artifact.contextPack === "object" ? artifact.contextPack : artifact;
      if (pack && typeof pack === "object" && Array.isArray(pack.items)) return false;
    } catch {
      continue;
    }
  }
  return true;
}

function forwardCapturedFailure(result) {
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.stdout) process.stderr.write(result.stdout);
}

function runNode(args, { quietStdout = false } = {}) {
  const result = spawnSync(process.execPath, args, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    stdio: quietStdout ? ["ignore", "pipe", "pipe"] : "inherit",
    shell: false,
  });
  if (result.error) throw result.error;
  if (quietStdout && result.status !== 0) forwardCapturedFailure(result);
  if (quietStdout && result.stderr) process.stderr.write(result.stderr);
  return result.status ?? 1;
}

function main() {
  const argv = process.argv.slice(2);
  const context = parseContextArg(argv);
  const wantsJson = hasJsonArg(argv);
  if (contextNeedsRefresh({ context })) {
    const refreshArtifact = refreshArtifactForContext(context);
    process.stderr.write(`Wiki startup preflight: refreshing context pack at ${refreshArtifact}\n`);
    const refreshStatus = runNode(buildRefreshArgs(context), { quietStdout: wantsJson });
    if (refreshStatus !== 0) process.exit(refreshStatus);
  }
  process.exit(runNode(["./scripts/wiki-startup-pack-audit.mjs", ...argv]));
}

if (process.argv[1] && resolve(process.argv[1]) === __filename) main();
