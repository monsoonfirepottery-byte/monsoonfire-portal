#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const REPO_ROOT = resolve(dirname(new URL(import.meta.url).pathname), "..", "..");

function parseRepoSlug(input) {
  const raw = String(input || "").trim();
  if (!raw) return { owner: "", repo: "" };
  const normalized = raw
    .replace(/^https?:\/\/github\.com\//i, "")
    .replace(/^git@github\.com:/i, "")
    .replace(/\.git$/i, "")
    .replace(/^\/+/, "")
    .trim();
  if (!normalized) return { owner: "", repo: "" };
  const parts = normalized.split("/").filter(Boolean);
  if (parts.length >= 2) return { owner: parts[0], repo: parts[1] };
  return { owner: "", repo: parts[0] || "" };
}

function inferFromGitConfig() {
  try {
    const configPath = resolve(REPO_ROOT, ".git", "config");
    const config = readFileSync(configPath, "utf8");
    const remoteOriginBlock = config.match(/\[remote "origin"\]([\s\S]*?)(\n\[|$)/);
    const remoteBlock = remoteOriginBlock ? remoteOriginBlock[1] : "";
    const urlMatch = remoteBlock.match(/^\s*url\s*=\s*(.+)\s*$/m);
    if (!urlMatch) return { owner: "", repo: "" };
    return parseRepoSlug(urlMatch[1]);
  } catch {
    return { owner: "", repo: "" };
  }
}

function resolveToken() {
  const envToken = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "";
  if (envToken) return envToken;
  try {
    return execFileSync("gh", ["auth", "token"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
  } catch {
    return "";
  }
}

function parseArgs(argv) {
  const repoEnvParts = parseRepoSlug(process.env.GITHUB_REPOSITORY || "");
  const defaults = inferFromGitConfig();
  const parsed = {
    owner: process.env.GITHUB_REPOSITORY_OWNER || repoEnvParts.owner || defaults.owner || "",
    repo: repoEnvParts.repo || defaults.repo || "",
    workflowFile: "governance-weekly-tuning.yml",
    maxAgeSeconds: 180
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = String(argv[i] || "");
    if (arg === "--owner" && argv[i + 1]) {
      parsed.owner = String(argv[i + 1]);
      i += 1;
      continue;
    }
    if (arg === "--repo" && argv[i + 1]) {
      parsed.repo = String(argv[i + 1]);
      i += 1;
      continue;
    }
    if (arg === "--workflow-file" && argv[i + 1]) {
      parsed.workflowFile = String(argv[i + 1]);
      i += 1;
      continue;
    }
    if (arg === "--max-age-seconds" && argv[i + 1]) {
      const n = Number(argv[i + 1]);
      parsed.maxAgeSeconds = Number.isFinite(n) && n > 0 ? n : 180;
      i += 1;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      process.stdout.write(
        [
          "Verify a recent workflow_dispatch run exists for a workflow file.",
          "",
          "Usage:",
          "  node ./scripts/governance/weekly-dispatch-verify.mjs [options]",
          "",
          "Options:",
          "  --owner <org>             GitHub org/user",
          "  --repo <name>             GitHub repo name",
          "  --workflow-file <file>    Workflow filename (default: governance-weekly-tuning.yml)",
          "  --max-age-seconds <n>     Maximum run age in seconds (default: 180)"
        ].join("\n")
      );
      process.exit(0);
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return parsed;
}

async function ghFetchJson(endpoint, token) {
  const apiBase = process.env.GITHUB_API_URL || "https://api.github.com";
  const response = await fetch(`${apiBase}${endpoint}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "monsoonfire-governance-weekly-dispatch-verify"
    }
  });
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }
  if (!response.ok) {
    throw new Error(`GitHub API ${endpoint} failed: ${response.status} ${typeof payload === "string" ? payload : JSON.stringify(payload)}`);
  }
  return payload;
}

function parseTs(value) {
  const ms = Date.parse(String(value || ""));
  return Number.isFinite(ms) ? ms : 0;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const token = resolveToken();
  if (!token) throw new Error("Missing GitHub token. Set GITHUB_TOKEN/GH_TOKEN or run gh auth login.");
  if (!args.owner || !args.repo) throw new Error("Missing repository owner/repo.");
  if (!args.workflowFile) throw new Error("Missing workflow file.");

  const endpoint = `/repos/${args.owner}/${args.repo}/actions/workflows/${encodeURIComponent(args.workflowFile)}/runs?event=workflow_dispatch&per_page=20`;
  const payload = await ghFetchJson(endpoint, token);
  const runs = Array.isArray(payload?.workflow_runs) ? payload.workflow_runs : [];
  if (runs.length === 0) {
    throw new Error(`No workflow_dispatch runs found for ${args.workflowFile}.`);
  }
  const latest = runs[0];
  const ageMs = Date.now() - parseTs(latest.created_at);
  const ageSeconds = Math.floor(ageMs / 1000);
  if (!Number.isFinite(ageSeconds) || ageSeconds > args.maxAgeSeconds) {
    throw new Error(
      `Latest workflow_dispatch run is too old (${ageSeconds}s > ${args.maxAgeSeconds}s): ${String(latest.html_url || "unknown-url")}`
    );
  }

  process.stdout.write(`weekly-dispatch-verify ok: run #${latest.id} age=${ageSeconds}s\n`);
}

main().catch((error) => {
  process.stderr.write(`weekly-dispatch-verify failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
