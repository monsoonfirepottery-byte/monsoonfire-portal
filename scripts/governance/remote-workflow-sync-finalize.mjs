#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
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
    output: "output/governance/remote-workflow-sync-finalize.json",
    pollSeconds: 0
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
    if (arg === "--poll-seconds" && argv[i + 1]) {
      const n = Number(argv[i + 1]);
      parsed.pollSeconds = Number.isFinite(n) && n >= 0 ? n : 0;
      i += 1;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      process.stdout.write(
        [
          "Finalize fallback governance workflow sync PR",
          "",
          "Usage:",
          "  node ./scripts/governance/remote-workflow-sync-finalize.mjs [options]",
          "",
          "Options:",
          "  --owner <org>         GitHub org/user",
          "  --repo <name>         GitHub repo name",
          "  --output <path>       Output report path",
          "  --poll-seconds <n>    Optional wait before evaluating checks"
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
      "User-Agent": "monsoonfire-governance-workflow-sync-finalize",
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

function writeJson(pathValue, data) {
  const target = resolve(REPO_ROOT, pathValue);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

async function findFallbackSyncPr({ owner, repo, token }) {
  const pulls = await ghFetchJson(`/repos/${owner}/${repo}/pulls?state=open&base=main&per_page=100`, token);
  if (!Array.isArray(pulls)) return null;
  const match = pulls.find((row) => {
    const title = String(row?.title || "");
    const head = String(row?.head?.ref || "");
    return (
      title.trim() === "chore(governance): sync missing governance workflow files" ||
      head.startsWith("codex/governance-workflow-sync-")
    );
  });
  if (!match) return null;
  return {
    number: Number(match.number || 0),
    url: String(match.html_url || ""),
    head_sha: String(match.head?.sha || ""),
    head_ref: String(match.head?.ref || "")
  };
}

function classifyCheckRuns(checkRuns) {
  const failed = [];
  const pending = [];
  const passed = [];
  for (const row of checkRuns) {
    const name = String(row?.name || "unknown");
    const status = String(row?.status || "");
    const conclusion = String(row?.conclusion || "");
    if (status !== "completed") {
      pending.push({ name, status, conclusion });
      continue;
    }
    if (["success", "neutral", "skipped"].includes(conclusion)) {
      passed.push({ name, status, conclusion });
      continue;
    }
    failed.push({ name, status, conclusion });
  }
  return { failed, pending, passed };
}

function sleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const token = resolveToken();
  if (!token) throw new Error("Missing GitHub token. Set GITHUB_TOKEN/GH_TOKEN or run gh auth login.");
  if (!args.owner || !args.repo) throw new Error("Missing repository owner/repo. Provide --owner/--repo or configure origin remote.");

  if (args.pollSeconds > 0) {
    await sleep(args.pollSeconds * 1000);
  }

  const pr = await findFallbackSyncPr({
    owner: args.owner,
    repo: args.repo,
    token
  });
  if (!pr) {
    const report = {
      generated_at: new Date().toISOString(),
      repository: `${args.owner}/${args.repo}`,
      status: "no_open_fallback_pr",
      merged: false
    };
    writeJson(args.output, report);
    process.stdout.write("workflow-sync-finalize: no open fallback sync PR found\n");
    process.stdout.write(`report: ${args.output}\n`);
    return;
  }

  const checksPayload = await ghFetchJson(
    `/repos/${args.owner}/${args.repo}/commits/${encodeURIComponent(pr.head_sha)}/check-runs?per_page=100`,
    token
  );
  const checks = Array.isArray(checksPayload?.check_runs) ? checksPayload.check_runs : [];
  const classified = classifyCheckRuns(checks);

  const reportBase = {
    generated_at: new Date().toISOString(),
    repository: `${args.owner}/${args.repo}`,
    pr,
    checks: {
      total: checks.length,
      pending: classified.pending,
      failed: classified.failed,
      passed: classified.passed
    }
  };

  if (classified.failed.length > 0) {
    const report = { ...reportBase, status: "checks_failed", merged: false };
    writeJson(args.output, report);
    process.stdout.write("workflow-sync-finalize: checks failed on fallback PR\n");
    process.stdout.write(`report: ${args.output}\n`);
    process.exitCode = 1;
    return;
  }

  if (classified.pending.length > 0) {
    const report = { ...reportBase, status: "checks_pending", merged: false };
    writeJson(args.output, report);
    process.stdout.write("workflow-sync-finalize: checks still pending on fallback PR\n");
    process.stdout.write(`report: ${args.output}\n`);
    process.exitCode = 2;
    return;
  }

  const mergeAttempt = spawnSync(
    "gh",
    ["pr", "merge", String(pr.number), "--repo", `${args.owner}/${args.repo}`, "--squash", "--delete-branch", "--admin"],
    {
      cwd: REPO_ROOT,
      encoding: "utf8",
      env: { ...process.env, GITHUB_TOKEN: token }
    }
  );
  const mergeOk = Number(mergeAttempt.status) === 0;

  const report = {
    ...reportBase,
    status: mergeOk ? "merged" : "merge_failed",
    merged: mergeOk,
    merge: {
      exit_code: Number.isInteger(mergeAttempt.status) ? mergeAttempt.status : 1,
      stdout: String(mergeAttempt.stdout || "").trim() || null,
      stderr: String(mergeAttempt.stderr || "").trim() || null
    }
  };
  writeJson(args.output, report);

  if (!mergeOk) {
    process.stdout.write("workflow-sync-finalize: merge attempt failed\n");
    process.stdout.write(`report: ${args.output}\n`);
    process.exitCode = 1;
    return;
  }

  process.stdout.write("workflow-sync-finalize: fallback PR merged\n");
  process.stdout.write(`report: ${args.output}\n`);
}

main().catch((error) => {
  process.stderr.write(`workflow-sync-finalize failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
