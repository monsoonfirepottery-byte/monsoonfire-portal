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
    output: "output/governance/remote-workflow-sync-apply.json",
    closeIssue: true,
    fallbackPr: true
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
    if (arg === "--close-issue" && argv[i + 1]) {
      parsed.closeIssue = String(argv[i + 1]).toLowerCase() !== "false";
      i += 1;
      continue;
    }
    if (arg === "--fallback-pr" && argv[i + 1]) {
      parsed.fallbackPr = String(argv[i + 1]).toLowerCase() !== "false";
      i += 1;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      process.stdout.write(
        [
          "Remote governance workflow sync apply",
          "",
          "Usage:",
          "  node ./scripts/governance/remote-workflow-sync-apply.mjs [options]",
          "",
          "Options:",
          "  --owner <org>         GitHub org/user",
          "  --repo <name>         GitHub repo name",
          "  --output <path>       Output report path",
          "  --close-issue <bool>  Close governance-sync-required issue when fully synced (default: true)",
          "  --fallback-pr <bool>  Create sync branch + PR when default branch is protected (default: true)"
        ].join("\n")
      );
      process.exit(0);
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return parsed;
}

function isProtectedBranchError(message) {
  const text = String(message || "");
  return /required status check/i.test(text) || /protected branch/i.test(text);
}

async function ghFetchJson(endpoint, token, method = "GET", body = null) {
  const apiBase = process.env.GITHUB_API_URL || "https://api.github.com";
  const response = await fetch(`${apiBase}${endpoint}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "monsoonfire-governance-workflow-sync-apply",
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

function listRelativeFilesUnder(rootRelative) {
  const absolute = resolve(REPO_ROOT, rootRelative);
  const out = [];
  const walk = (currentAbsolute, currentRelative) => {
    const entries = readdirSync(currentAbsolute, { withFileTypes: true });
    for (const entry of entries) {
      const nextAbsolute = resolve(currentAbsolute, entry.name);
      const nextRelative = `${currentRelative}/${entry.name}`.replace(/\\/g, "/");
      if (entry.isDirectory()) {
        walk(nextAbsolute, nextRelative);
      } else if (entry.isFile()) {
        out.push(nextRelative);
      }
    }
  };
  try {
    walk(absolute, rootRelative.replace(/\\/g, "/"));
  } catch {
    return [];
  }
  return out.sort((a, b) => a.localeCompare(b));
}

function listGovernanceBundlePaths() {
  const set = new Set();
  for (const pathValue of listLocalGovernanceWorkflows()) set.add(pathValue);
  for (const pathValue of listRelativeFilesUnder("scripts/governance")) set.add(pathValue);
  for (const pathValue of listRelativeFilesUnder(".governance")) set.add(pathValue);
  const optional = [
    "docs/runbooks/AGENT_GOVERNANCE_TRIANGLE.md",
    ".github/ISSUE_TEMPLATE/decision-request.yml",
    ".github/ISSUE_TEMPLATE/audit-escalation.yml"
  ];
  for (const pathValue of optional) {
    try {
      readFileSync(resolve(REPO_ROOT, pathValue), "utf8");
      set.add(pathValue);
    } catch {
      // optional file missing locally
    }
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}

function encodeRepoPath(pathValue) {
  return String(pathValue)
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function writeJson(pathValue, data) {
  const target = resolve(REPO_ROOT, pathValue);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

async function closeSyncIssueIfOpen({ owner, repo, token }) {
  const label = "governance-sync-required";
  const list = await ghFetchJson(`/repos/${owner}/${repo}/issues?state=open&labels=${encodeURIComponent(label)}&per_page=100`, token);
  const issue = Array.isArray(list)
    ? list.find((row) => String(row.title || "").startsWith("Governance Workflow Sync Required"))
    : null;
  if (!issue) return null;
  await ghFetchJson(`/repos/${owner}/${repo}/issues/${issue.number}/comments`, token, "POST", {
    body: "Remote governance workflow sync is complete. Closing this issue automatically."
  });
  await ghFetchJson(`/repos/${owner}/${repo}/issues/${issue.number}`, token, "PATCH", {
    state: "closed"
  });
  return {
    issue_number: Number(issue.number || 0),
    url: String(issue.html_url || "")
  };
}

async function createSyncBranch({ owner, repo, defaultBranch, token }) {
  const baseRef = await ghFetchJson(`/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(defaultBranch)}`, token);
  const baseSha = String(baseRef?.object?.sha || "");
  if (!baseSha) throw new Error("Could not resolve base SHA for fallback PR branch.");
  const stamp = new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const suffix = attempt === 0 ? "" : `-${attempt + 1}`;
    const branchName = `codex/governance-workflow-sync-${stamp}${suffix}`;
    try {
      await ghFetchJson(`/repos/${owner}/${repo}/git/refs`, token, "POST", {
        ref: `refs/heads/${branchName}`,
        sha: baseSha
      });
      return branchName;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!/Reference already exists/i.test(message)) throw error;
    }
  }
  throw new Error("Could not create fallback sync branch after retries.");
}

async function getContentSha({ owner, repo, branch, pathValue, token }) {
  const endpointPath = encodeRepoPath(pathValue.replace(/^\.\//, ""));
  try {
    const payload = await ghFetchJson(
      `/repos/${owner}/${repo}/contents/${endpointPath}?ref=${encodeURIComponent(branch)}`,
      token
    );
    return String(payload?.sha || "");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/ 404 /.test(message) || /"status":404/.test(message)) return "";
    throw error;
  }
}

async function findOpenSyncPr({ owner, repo, defaultBranch, token }) {
  const pulls = await ghFetchJson(`/repos/${owner}/${repo}/pulls?state=open&base=${encodeURIComponent(defaultBranch)}&per_page=100`, token);
  if (!Array.isArray(pulls)) return null;
  const match = pulls.find((row) => String(row?.title || "").trim() === "chore(governance): sync missing governance workflow files");
  if (!match) return null;
  return {
    number: Number(match.number || 0),
    url: String(match.html_url || ""),
    branch: String(match.head?.ref || "")
  };
}

async function upsertSyncPullRequest({ owner, repo, branchName, defaultBranch, token, missingPaths }) {
  const existing = await ghFetchJson(
    `/repos/${owner}/${repo}/pulls?state=open&head=${encodeURIComponent(`${owner}:${branchName}`)}&base=${encodeURIComponent(defaultBranch)}&per_page=20`,
    token
  );
  if (Array.isArray(existing) && existing.length > 0) {
    return {
      created: false,
      number: Number(existing[0]?.number || 0),
      url: String(existing[0]?.html_url || "")
    };
  }
  const title = "chore(governance): sync missing governance workflow files";
  const body = [
    "Automated fallback PR because direct writes to default branch are protected by required status checks.",
    "",
    "Included workflow files:",
    ...missingPaths.map((p) => `- ${p}`),
    "",
    "After merge:",
    "1. Re-run `npm run governance:execute:until-blocked`.",
    "2. Confirm governance weekly workflow can be dispatched."
  ].join("\n");
  const pr = await ghFetchJson(`/repos/${owner}/${repo}/pulls`, token, "POST", {
    title,
    head: branchName,
    base: defaultBranch,
    body
  });
  return {
    created: true,
    number: Number(pr?.number || 0),
    url: String(pr?.html_url || "")
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const token = resolveToken();
  if (!token) {
    throw new Error("Missing GitHub token. Set GITHUB_TOKEN/GH_TOKEN or run gh auth login.");
  }
  if (!args.owner || !args.repo) {
    throw new Error("Missing repository owner/repo. Provide --owner/--repo or configure origin remote.");
  }

  const localPaths = listLocalGovernanceWorkflows();
  const workflowsBefore = await ghFetchJson(`/repos/${args.owner}/${args.repo}/actions/workflows?per_page=100`, token);
  const remoteBefore = (Array.isArray(workflowsBefore?.workflows) ? workflowsBefore.workflows : [])
    .map((row) => String(row?.path || ""))
    .filter((p) => p.length > 0);
  const remoteBeforeSet = new Set(remoteBefore);
  const missingBefore = localPaths.filter((pathValue) => !remoteBeforeSet.has(pathValue));

  const repoInfo = await ghFetchJson(`/repos/${args.owner}/${args.repo}`, token);
  const defaultBranch = String(repoInfo?.default_branch || "main");

  const applied = [];
  const failed = [];
  let fallbackPr = null;
  for (const pathValue of missingBefore) {
    try {
      const localAbsolute = resolve(REPO_ROOT, pathValue);
      const content = readFileSync(localAbsolute, "utf8");
      const contentBase64 = Buffer.from(content, "utf8").toString("base64");
      const endpointPath = encodeRepoPath(pathValue.replace(/^\.\//, ""));
      await ghFetchJson(`/repos/${args.owner}/${args.repo}/contents/${endpointPath}`, token, "PUT", {
        message: `chore(governance): sync ${pathValue}`,
        content: contentBase64,
        branch: defaultBranch
      });
      applied.push(pathValue);
    } catch (error) {
      failed.push({
        path: pathValue,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  const allProtectedFailures =
    failed.length > 0 &&
    failed.length === missingBefore.length &&
    failed.every((entry) => isProtectedBranchError(entry.error));

  if (allProtectedFailures && args.fallbackPr) {
    const existingSyncPr = await findOpenSyncPr({
      owner: args.owner,
      repo: args.repo,
      defaultBranch,
      token
    });
    const branchName =
      existingSyncPr?.branch ||
      (await createSyncBranch({
        owner: args.owner,
        repo: args.repo,
        defaultBranch,
        token
      }));
    const bundlePaths = listGovernanceBundlePaths();
    const branchApplied = [];
    const branchFailed = [];
    for (const pathValue of bundlePaths) {
      try {
        const localAbsolute = resolve(REPO_ROOT, pathValue);
        const content = readFileSync(localAbsolute, "utf8");
        const contentBase64 = Buffer.from(content, "utf8").toString("base64");
        const endpointPath = encodeRepoPath(pathValue.replace(/^\.\//, ""));
        const maybeSha = await getContentSha({
          owner: args.owner,
          repo: args.repo,
          branch: branchName,
          pathValue,
          token
        });
        await ghFetchJson(`/repos/${args.owner}/${args.repo}/contents/${endpointPath}`, token, "PUT", {
          message: `chore(governance): sync ${pathValue}`,
          content: contentBase64,
          branch: branchName,
          ...(maybeSha ? { sha: maybeSha } : {})
        });
        branchApplied.push(pathValue);
      } catch (error) {
        branchFailed.push({
          path: pathValue,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
    if (branchFailed.length === 0) {
      fallbackPr = {
        branch: branchName,
        ...(existingSyncPr
          ? {
              created: false,
              number: existingSyncPr.number,
              url: existingSyncPr.url
            }
          : await upsertSyncPullRequest({
              owner: args.owner,
              repo: args.repo,
              branchName,
              defaultBranch,
              token,
              missingPaths: bundlePaths
            }))
      };
      applied.splice(0, applied.length, ...branchApplied);
      failed.splice(0, failed.length);
    } else {
      failed.splice(0, failed.length, ...branchFailed);
    }
  }

  const workflowsAfter = await ghFetchJson(`/repos/${args.owner}/${args.repo}/actions/workflows?per_page=100`, token);
  const remoteAfter = (Array.isArray(workflowsAfter?.workflows) ? workflowsAfter.workflows : [])
    .map((row) => String(row?.path || ""))
    .filter((p) => p.length > 0);
  const remoteAfterSet = new Set(remoteAfter);
  const missingAfter = localPaths.filter((pathValue) => !remoteAfterSet.has(pathValue));

  let closedIssue = null;
  if (args.closeIssue && missingAfter.length === 0) {
    closedIssue = await closeSyncIssueIfOpen({
      owner: args.owner,
      repo: args.repo,
      token
    });
  }

  const report = {
    generated_at: new Date().toISOString(),
    repository: `${args.owner}/${args.repo}`,
    default_branch: defaultBranch,
    local_governance_workflow_paths: localPaths,
    missing_before_apply: missingBefore,
    applied_paths: applied,
    failed_paths: failed,
    missing_after_apply: missingAfter,
    synced_after_apply: missingAfter.length === 0,
    fallback_pr: fallbackPr,
    requires_merge: missingAfter.length > 0 && Boolean(fallbackPr?.url),
    closed_issue: closedIssue
  };

  writeJson(args.output, report);

  if (failed.length > 0) {
    process.stdout.write(`workflow-sync-apply: ${failed.length} path(s) failed\n`);
    process.stdout.write(`report: ${args.output}\n`);
    process.exitCode = 1;
    return;
  }
  if (fallbackPr?.url && missingAfter.length > 0) {
    process.stdout.write("workflow-sync-apply: fallback PR opened, awaiting merge\n");
    process.stdout.write(`pr: ${fallbackPr.url}\n`);
    process.stdout.write(`report: ${args.output}\n`);
    process.exitCode = 3;
    return;
  }
  if (missingAfter.length > 0) {
    process.stdout.write(`workflow-sync-apply: ${missingAfter.length} path(s) still missing after apply\n`);
    process.stdout.write(`report: ${args.output}\n`);
    process.exitCode = 2;
    return;
  }

  process.stdout.write("workflow-sync-apply: governance workflows synced to remote\n");
  process.stdout.write(`report: ${args.output}\n`);
}

main().catch((error) => {
  process.stderr.write(`workflow-sync-apply failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
