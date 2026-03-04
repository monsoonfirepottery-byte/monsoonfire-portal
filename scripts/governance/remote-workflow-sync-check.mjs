#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
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
    output: "output/governance/remote-workflow-sync-check.json",
    openIssue: false
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
    if ((arg === "--output" || arg === "--report") && argv[i + 1]) {
      parsed.output = String(argv[i + 1]);
      i += 1;
      continue;
    }
    if (arg === "--open-issue" && argv[i + 1]) {
      parsed.openIssue = String(argv[i + 1]).toLowerCase() === "true";
      i += 1;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      process.stdout.write(
        [
          "Remote governance workflow sync checker",
          "",
          "Usage:",
          "  node ./scripts/governance/remote-workflow-sync-check.mjs [options]",
          "",
          "Options:",
          "  --owner <org>         GitHub org/user",
          "  --repo <name>         GitHub repo name",
          "  --output <path>       Output report path",
          "  --open-issue <bool>   Open a sync-required issue when missing workflows are detected"
        ].join("\n")
      );
      process.exit(0);
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return parsed;
}

async function ghFetchJson(endpoint, token, method = "GET", body = null) {
  const apiBase = process.env.GITHUB_API_URL || "https://api.github.com";
  const response = await fetch(`${apiBase}${endpoint}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "monsoonfire-governance-workflow-sync",
      ...(body ? { "Content-Type": "application/json" } : {})
    },
    ...(body ? { body: JSON.stringify(body) } : {})
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

function listLocalGovernanceWorkflows() {
  const workflowsDir = resolve(REPO_ROOT, ".github", "workflows");
  const names = readdirSync(workflowsDir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => /^governance-.*\.ya?ml$/i.test(name));
  return names.map((name) => `.github/workflows/${name}`).sort((a, b) => a.localeCompare(b));
}

function writeJson(pathValue, data) {
  const target = resolve(REPO_ROOT, pathValue);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

async function maybeOpenSyncIssue({ owner, repo, token, missingPaths }) {
  const label = "governance-sync-required";
  const list = await ghFetchJson(`/repos/${owner}/${repo}/issues?state=open&labels=${encodeURIComponent(label)}&per_page=100`, token);
  const existing = Array.isArray(list)
    ? list.find((row) => String(row.title || "").startsWith("Governance Workflow Sync Required"))
    : null;
  const buildBody = (paths) =>
    [
      "Remote repository is missing one or more governance workflow files present locally.",
      "",
      "Missing workflow paths:",
      ...paths.map((p) => `- ${p}`),
      "",
      "Recommended action:",
      "1. Push the local workflow files to default branch or active governance branch.",
      "2. Re-run governance execute-until-blocked after workflows appear in GitHub Actions registry."
    ].join("\n");
  if (existing && existing.html_url) {
    await ghFetchJson(`/repos/${owner}/${repo}/issues/${existing.number}`, token, "PATCH", {
      body: buildBody(missingPaths)
    });
    return { created: false, updated: true, url: String(existing.html_url), issue_number: Number(existing.number || 0) };
  }
  const today = new Date().toISOString().slice(0, 10);
  const title = `Governance Workflow Sync Required ${today}`;
  const body = buildBody(missingPaths);
  const issue = await ghFetchJson(`/repos/${owner}/${repo}/issues`, token, "POST", {
    title,
    body,
    labels: [label]
  });
  return {
    created: true,
    updated: false,
    url: String(issue?.html_url || ""),
    issue_number: Number(issue?.number || 0)
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const token = resolveToken();
  if (!args.owner || !args.repo) {
    throw new Error("Missing repository owner/repo. Provide --owner/--repo or configure origin remote.");
  }
  if (!token) {
    throw new Error("Missing GitHub token. Set GITHUB_TOKEN/GH_TOKEN or run gh auth login.");
  }

  const localPaths = listLocalGovernanceWorkflows();
  const remote = await ghFetchJson(`/repos/${args.owner}/${args.repo}/actions/workflows?per_page=100`, token);
  const remotePaths = (Array.isArray(remote?.workflows) ? remote.workflows : [])
    .map((row) => String(row?.path || ""))
    .filter((pathValue) => pathValue.length > 0)
    .sort((a, b) => a.localeCompare(b));

  const remoteSet = new Set(remotePaths);
  const missingOnRemote = localPaths.filter((pathValue) => !remoteSet.has(pathValue));

  let issue = null;
  if (args.openIssue && missingOnRemote.length > 0) {
    issue = await maybeOpenSyncIssue({
      owner: args.owner,
      repo: args.repo,
      token,
      missingPaths: missingOnRemote
    });
  }

  const report = {
    generated_at: new Date().toISOString(),
    repository: `${args.owner}/${args.repo}`,
    local_governance_workflow_paths: localPaths,
    remote_workflow_paths: remotePaths,
    missing_on_remote: missingOnRemote,
    missing_count: missingOnRemote.length,
    synced: missingOnRemote.length === 0,
    recommended_actions:
      missingOnRemote.length > 0
        ? [
            "Push local governance workflow files to GitHub.",
            "Confirm workflows appear in GitHub Actions workflow registry.",
            "Re-run: npm run governance:execute:until-blocked"
          ]
        : [],
    issue
  };

  writeJson(args.output, report);

  if (missingOnRemote.length > 0) {
    process.stdout.write(`workflow-sync: missing ${missingOnRemote.length} governance workflow(s) on remote\n`);
    process.stdout.write(`report: ${args.output}\n`);
    process.exitCode = 2;
    return;
  }

  process.stdout.write("workflow-sync: remote governance workflows are in sync\n");
  process.stdout.write(`report: ${args.output}\n`);
}

main().catch((error) => {
  process.stderr.write(`workflow-sync failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
