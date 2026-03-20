#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { homedir, tmpdir } from "node:os";

const cwd = process.cwd();
const args = process.argv.slice(2);

function readFlag(name, fallback = undefined) {
  const key = `--${name}`;
  const index = args.indexOf(key);
  if (index === -1) return fallback;
  const next = args[index + 1];
  if (!next || next.startsWith("--")) return "true";
  return next;
}

function shortHash(value, size = 24) {
  return createHash("sha256").update(value).digest("hex").slice(0, size);
}

function safeRead(path) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

function normalizeText(text) {
  return String(text ?? "")
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function oneLine(text, max = 320) {
  const normalized = normalizeText(text).replace(/\s+/g, " ");
  if (!normalized) return "";
  return normalized.length > max ? `${normalized.slice(0, max - 13).trimEnd()} [truncated]` : normalized;
}

function firstSection(markdown, heading) {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`(?:^|\\n)##\\s+${escaped}\\s*\\n([\\s\\S]*?)(?=\\n##\\s+|$)`);
  const match = markdown.match(pattern);
  if (!match) return "";
  return normalizeText(match[1] ?? "");
}

function summarizeSection(markdown, heading, max = 380) {
  const section = firstSection(markdown, heading);
  if (!section) return "";
  const codeBlockMatches = Array.from(section.matchAll(/```[\s\S]*?```/g));
  const prose = section.replace(/```[\s\S]*?```/g, " ");
  const lines = prose
    .split(/\n+/)
    .map((line) => line.replace(/^[-*]\s+/, "").replace(/^\d+\.\s+/, "").trim())
    .filter(Boolean)
    .slice(0, 4);
  if (lines.length > 0) {
    return oneLine(lines.join(" | "), max);
  }
  const codeLines = codeBlockMatches
    .flatMap((match) =>
      String(match[0] ?? "")
        .split(/\n+/)
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith("```"))
    )
    .slice(0, 4);
  return oneLine(codeLines.join(" | "), max);
}

function listFiles(dir, predicate = () => true) {
  let entries = [];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => join(dir, entry.name))
    .filter((path) => predicate(path))
    .sort((a, b) => a.localeCompare(b));
}

function readJson(path, fallback = null) {
  const raw = safeRead(path);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

const workspaceRoot = resolve(readFlag("repo-root", cwd));
const codexHome = resolve(readFlag("codex-home", process.env.CODEX_HOME || join(homedir(), ".codex")));
const repoMetadataCachePath = join(tmpdir(), "__ctx_repo.json");

function safeExec(cmd, options = {}) {
  try {
    return execSync(cmd, {
      cwd: options.cwd ?? workspaceRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch {
    return "";
  }
}

const outputPath = resolve(
  readFlag("output", `./imports/memory-context-slice-${new Date().toISOString().replace(/[:.]/g, "-")}.jsonl`)
);
const source = String(readFlag("source", `context-slice:${new Date().toISOString().slice(0, 10)}`));
const runScope = String(readFlag("run-scope", new Date().toISOString().replace(/[:.]/g, "-"))).trim();
const maxItems = Number(readFlag("max-items", "320"));
const maxChars = Number(readFlag("max-chars", "900"));
const categoryLimits = {
  intent: Number(readFlag("limit-intent", "40")),
  ticket: Number(readFlag("limit-ticket", "80")),
  doc: Number(readFlag("limit-doc", "20")),
  "intent-output": Number(readFlag("limit-intent-output", "30")),
  "memory-ledger": Number(readFlag("limit-memory-ledger", "4")),
  git: Number(readFlag("limit-git", "8")),
  github: Number(readFlag("limit-github", "50")),
  mcp: Number(readFlag("limit-mcp", "20")),
  artifact: Number(readFlag("limit-artifact", "10")),
};

const items = [];
const dedupe = new Set();
const categoryCounts = {};

function applyRunScope(baseRunId) {
  const base = String(baseRunId || "").trim() || "ctx";
  const scope = runScope.replace(/[^a-zA-Z0-9:_-]+/g, "-").replace(/-+/g, "-").replace(/^-+/, "").replace(/-+$/, "");
  if (!scope) return base.slice(0, 128);
  return `${base}:${scope}`.slice(0, 128);
}

function addItem({ category, content, tags = [], metadata = {}, runId = null }) {
  let normalized = normalizeText(content);
  if (!normalized) return;
  const limit = categoryLimits[category];
  const existing = categoryCounts[category] ?? 0;
  if (Number.isFinite(limit) && limit >= 0 && existing >= limit) return;
  if (normalized.length > maxChars) {
    normalized = `${normalized.slice(0, maxChars - 13).trimEnd()} [truncated]`;
  }
  const key = `${category}|${normalized.toLowerCase()}`;
  if (dedupe.has(key)) return;
  dedupe.add(key);
  const safeCategory = category.toLowerCase().replace(/[^a-z0-9:_-]+/g, "-");
  const resolvedRunId = runId || `ctx-${safeCategory}`;
  items.push({
    content: normalized,
    source,
    tags: ["context-slice", category, ...tags].map((tag) => String(tag).toLowerCase()),
    metadata: {
      category,
      ...metadata,
    },
    agentId: "agent:context-slice",
    runId: applyRunScope(resolvedRunId),
    clientRequestId: `ctx-${shortHash(`${safeCategory}|${normalized}`)}`,
  });
  categoryCounts[category] = existing + 1;
}

function ingestIntents() {
  const intentsDir = join(cwd, "intents");
  const files = listFiles(intentsDir, (path) => path.endsWith(".intent.json"));
  for (const path of files) {
    const parsed = readJson(path, {});
    if (!parsed || typeof parsed !== "object") continue;
    const title = oneLine(parsed.title ?? basename(path), 180);
    const intentId = oneLine(parsed.intentId ?? "", 120);
    const objective = oneLine(parsed.objective ?? "", 380);
    const riskTier = oneLine(parsed?.constraints?.riskTier ?? "unknown", 80);
    const writePolicy = oneLine(parsed?.constraints?.writePolicy ?? "unknown", 120);
    addItem({
      category: "intent",
      tags: ["intent", "epic"],
      metadata: { path: path.replace(`${cwd}/`, ""), intentId },
      runId: "ctx-intents",
      content: `Intent "${title}" (${intentId}) objective: ${objective}. Constraints: risk tier ${riskTier}, write policy ${writePolicy}.`,
    });
    const checks = Array.isArray(parsed?.doneCriteria?.requiredChecks)
      ? parsed.doneCriteria.requiredChecks.slice(0, 5).map((value) => oneLine(value, 180)).filter(Boolean)
      : [];
    if (checks.length > 0) {
      addItem({
        category: "intent",
        tags: ["intent", "checks"],
        metadata: { path: path.replace(`${cwd}/`, ""), intentId },
        runId: "ctx-intents",
        content: `Intent "${title}" required checks: ${checks.join(" | ")}.`,
      });
    }
    const slices = Array.isArray(parsed.executionSlices) ? parsed.executionSlices.slice(0, 5) : [];
    for (const slice of slices) {
      const sliceId = oneLine(slice?.id ?? "slice", 80);
      const sliceTitle = oneLine(slice?.title ?? "", 180);
      const writeScope = oneLine(slice?.writeScope ?? "unknown", 120);
      addItem({
        category: "intent",
        tags: ["intent", "slice"],
        metadata: { path: path.replace(`${cwd}/`, ""), intentId, sliceId },
        runId: "ctx-intents",
        content: `Intent "${title}" slice "${sliceId}" (${sliceTitle}) write scope: ${writeScope}.`,
      });
    }
  }
}

function ingestTickets() {
  const ticketsDir = join(cwd, "tickets");
  const files = listFiles(ticketsDir, (path) => path.endsWith(".md"));
  for (const path of files) {
    const text = safeRead(path);
    if (!text) continue;
    const title = oneLine((text.match(/^#\s+(.+)$/m) || [])[1] ?? basename(path, ".md"), 220);
    const status = oneLine((text.match(/^Status:\s*(.+)$/m) || [])[1] ?? "Unknown", 80);
    const priority = oneLine((text.match(/^Priority:\s*(.+)$/m) || [])[1] ?? "Unknown", 80);
    const owner = oneLine((text.match(/^Owner:\s*(.+)$/m) || [])[1] ?? "Unknown", 120);
    const objective = oneLine(firstSection(text, "Objective"), 360);
    const acceptance = firstSection(text, "Acceptance Criteria")
      .split(/\n+/)
      .map((line) => oneLine(line, 140))
      .filter((line) => /^\d+\.\s+/.test(line))
      .slice(0, 3);
    addItem({
      category: "ticket",
      tags: ["ticket"],
      metadata: { path: path.replace(`${cwd}/`, ""), status, priority },
      runId: "ctx-tickets",
      content: `Ticket "${title}" status ${status}, priority ${priority}, owner ${owner}. Objective: ${objective || "not specified"}.`,
    });
    if (acceptance.length > 0) {
      addItem({
        category: "ticket",
        tags: ["ticket", "acceptance"],
        metadata: { path: path.replace(`${cwd}/`, ""), status, priority },
        runId: "ctx-tickets",
        content: `Ticket "${title}" acceptance highlights: ${acceptance.join(" | ")}.`,
      });
    }
  }
}

function ingestRunbooks() {
  const docsDir = join(cwd, "docs", "runbooks");
  const files = listFiles(docsDir, (path) => path.endsWith(".md"));
  const focusNames = new Set([
    "OPEN_MEMORY_SYSTEM.md",
    "MCP_OPERATIONS.md",
    "INTENT_CONTROL_PLANE.md",
    "PORTAL_AUTOMATION_MATRIX.md",
    "CODEX_AGENTIC_RUBRIC_AND_AUTOPILOT.md",
    "LOCAL_SECRETS_LAYOUT.md",
    "SECURITY_HISTORY_REWRITE_PLAYBOOK.md",
    "INDUSTRY_EVENTS_CURATION_RUNBOOK.md",
  ]);
  for (const path of files.filter((candidate) => focusNames.has(basename(candidate)))) {
    const text = safeRead(path);
    if (!text) continue;
    const title = oneLine((text.match(/^#\s+(.+)$/m) || [])[1] ?? basename(path, ".md"), 220);
    const purpose = oneLine(firstSection(text, "Purpose"), 420);
    const fileName = basename(path);
    addItem({
      category: "doc",
      tags: ["runbook", "docs"],
      metadata: { path: path.replace(`${cwd}/`, "") },
      runId: "ctx-docs",
      content: `Runbook "${title}" purpose: ${purpose || "purpose section not explicitly present"}.`,
    });

    if (fileName === "MCP_OPERATIONS.md") {
      const defaultModel = summarizeSection(text, "Default Disabled Model", 360);
      const wrapperUsage = summarizeSection(text, "Wrapper Usage", 360);
      const audit = summarizeSection(text, "Config Regression Audit", 360);
      const cloudflare = summarizeSection(text, "Cloudflare Notes", 360);
      if (defaultModel) {
        addItem({
          category: "doc",
          tags: ["runbook", "docs", "mcp", "guardrail"],
          metadata: { path: path.replace(`${cwd}/`, ""), topic: "default-disabled-model" },
          runId: "ctx-docs-mcp",
          content: `MCP operations default-disabled model: ${defaultModel}.`,
        });
      }
      if (wrapperUsage) {
        addItem({
          category: "doc",
          tags: ["runbook", "docs", "mcp", "wrapper"],
          metadata: { path: path.replace(`${cwd}/`, ""), topic: "wrapper-usage" },
          runId: "ctx-docs-mcp",
          content: `MCP wrapper usage guidance: ${wrapperUsage}.`,
        });
      }
      if (audit) {
        addItem({
          category: "doc",
          tags: ["runbook", "docs", "mcp", "audit"],
          metadata: { path: path.replace(`${cwd}/`, ""), topic: "config-regression-audit" },
          runId: "ctx-docs-mcp",
          content: `MCP config regression audit checks: ${audit}.`,
        });
      }
      if (cloudflare) {
        addItem({
          category: "doc",
          tags: ["runbook", "docs", "mcp", "cloudflare"],
          metadata: { path: path.replace(`${cwd}/`, ""), topic: "cloudflare-notes" },
          runId: "ctx-docs-mcp",
          content: `MCP Cloudflare notes: ${cloudflare}.`,
        });
      }
    }

    if (fileName === "OPEN_MEMORY_SYSTEM.md") {
      const nanny = summarizeSection(text, "Memory nanny hardening", 360);
      const security = summarizeSection(text, "Security notes", 360);
      if (nanny) {
        addItem({
          category: "doc",
          tags: ["runbook", "docs", "memory", "nanny"],
          metadata: { path: path.replace(`${cwd}/`, ""), topic: "memory-nanny-hardening" },
          runId: "ctx-docs-memory",
          content: `Open Memory nanny hardening summary: ${nanny}.`,
        });
      }
      if (security) {
        addItem({
          category: "doc",
          tags: ["runbook", "docs", "memory", "security"],
          metadata: { path: path.replace(`${cwd}/`, ""), topic: "security-notes" },
          runId: "ctx-docs-memory",
          content: `Open Memory security notes: ${security}.`,
        });
      }
    }

    if (fileName === "INTENT_CONTROL_PLANE.md") {
      const components = summarizeSection(text, "Components", 360);
      const workflow = summarizeSection(text, "Typical workflow", 360);
      if (components) {
        addItem({
          category: "doc",
          tags: ["runbook", "docs", "intent", "components"],
          metadata: { path: path.replace(`${cwd}/`, ""), topic: "components" },
          runId: "ctx-docs-intent",
          content: `Intent control plane components: ${components}.`,
        });
      }
      if (workflow) {
        addItem({
          category: "doc",
          tags: ["runbook", "docs", "intent", "workflow"],
          metadata: { path: path.replace(`${cwd}/`, ""), topic: "workflow" },
          runId: "ctx-docs-intent",
          content: `Intent control plane workflow: ${workflow}.`,
        });
      }
    }
  }
}

function ingestIntentOutput() {
  const intentDir = join(cwd, "output", "intent");
  const reportFiles = listFiles(intentDir, (path) => path.endsWith(".json"));
  for (const path of reportFiles) {
    const parsed = readJson(path, {});
    if (!parsed || typeof parsed !== "object") continue;
    const topKeys = Object.keys(parsed).slice(0, 8);
    addItem({
      category: "intent-output",
      tags: ["intent", "output"],
      metadata: { path: path.replace(`${cwd}/`, ""), keys: topKeys },
      runId: "ctx-intent-output",
      content: `Intent output artifact ${path.replace(`${cwd}/`, "")} includes keys: ${topKeys.join(", ") || "none"}.`,
    });
  }
  const ledgerFiles = listFiles(intentDir, (path) => path.endsWith(".jsonl"));
  for (const path of ledgerFiles) {
    const raw = safeRead(path);
    const lines = raw ? raw.split(/\r?\n/).filter(Boolean) : [];
    addItem({
      category: "intent-output",
      tags: ["intent", "ledger"],
      metadata: { path: path.replace(`${cwd}/`, ""), rows: lines.length },
      runId: "ctx-intent-output",
      content: `Intent ledger ${path.replace(`${cwd}/`, "")} has ${lines.length} rows.`,
    });
  }
}

function ingestMemoryLedgerSummary() {
  const acceptedPath = join(cwd, "memory", "accepted", "accepted.jsonl");
  const proposedPath = join(cwd, "memory", "proposed", "proposed.jsonl");
  const acceptedRows = safeRead(acceptedPath).split(/\r?\n/).filter(Boolean).length;
  const proposedRows = safeRead(proposedPath).split(/\r?\n/).filter(Boolean).length;
  addItem({
    category: "memory-ledger",
    tags: ["memory", "ledger"],
    metadata: { acceptedPath: "memory/accepted/accepted.jsonl", proposedPath: "memory/proposed/proposed.jsonl" },
    runId: "ctx-memory-ledger",
    content: `Local memory pipeline state: accepted ledger has ${acceptedRows} rows and proposed ledger has ${proposedRows} rows.`,
  });
}

function ingestLocalGit() {
  const logRaw = safeExec("git log --oneline -n 20");
  if (!logRaw) return;
  const commits = logRaw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 20);
  if (commits.length === 0) return;
  addItem({
    category: "git",
    tags: ["git", "commit"],
    metadata: { count: commits.length },
    runId: "ctx-git",
    content: `Recent local git activity (${commits.length} commits): ${commits.slice(0, 8).join(" | ")}.`,
  });
}

function ingestGithub() {
  const auth = safeExec("gh auth status 2>&1");
  if (!auth.includes("Logged in")) {
    addItem({
      category: "github",
      tags: ["github", "auth"],
      runId: "ctx-github",
      content: "GitHub CLI authentication is not available for context ingestion in this environment.",
    });
    return;
  }

  const repo = readJson(
    repoMetadataCachePath,
    null
  );
  const repoRaw = safeExec(
    "gh repo view --json nameWithOwner,description,defaultBranchRef,viewerPermission,createdAt,updatedAt,repositoryTopics"
  );
  let repoParsed = null;
  try {
    repoParsed = repoRaw ? JSON.parse(repoRaw) : repo;
  } catch {
    repoParsed = repo;
  }
  if (repoParsed) {
    const nameWithOwner = oneLine(repoParsed.nameWithOwner ?? "unknown", 120);
    const description = oneLine(repoParsed.description ?? "", 220);
    const defaultBranch = oneLine(repoParsed?.defaultBranchRef?.name ?? "main", 80);
    const permission = oneLine(repoParsed.viewerPermission ?? "unknown", 80);
    addItem({
      category: "github",
      tags: ["github", "repo"],
      metadata: { nameWithOwner, defaultBranch, permission },
      runId: "ctx-github",
      content: `GitHub repo ${nameWithOwner} (default branch ${defaultBranch}) description: ${description}. Viewer permission: ${permission}.`,
    });
  }

  const prsRaw = safeExec(
    "gh pr list --limit 20 --json number,title,state,isDraft,headRefName,baseRefName,updatedAt,author"
  );
  if (prsRaw) {
    try {
      const prs = JSON.parse(prsRaw);
      const openPrs = Array.isArray(prs) ? prs : [];
      addItem({
        category: "github",
        tags: ["github", "pr"],
        metadata: { openCount: openPrs.length },
        runId: "ctx-github",
        content: `Open GitHub PRs (${openPrs.length}): ${openPrs
          .slice(0, 10)
          .map((pr) => `#${pr.number} ${oneLine(pr.title, 120)}`)
          .join(" | ")}.`,
      });
    } catch {
      // ignore parsing failure
    }
  }

  const issuesRaw = safeExec(
    "gh issue list --limit 20 --state open --json number,title,labels,updatedAt,author"
  );
  if (issuesRaw) {
    try {
      const issues = JSON.parse(issuesRaw);
      const openIssues = Array.isArray(issues) ? issues : [];
      addItem({
        category: "github",
        tags: ["github", "issue"],
        metadata: { openCount: openIssues.length },
        runId: "ctx-github",
        content: `Open GitHub issues (${openIssues.length}) include: ${openIssues
          .slice(0, 10)
          .map((issue) => `#${issue.number} ${oneLine(issue.title, 120)}`)
          .join(" | ")}.`,
      });
    } catch {
      // ignore parsing failure
    }
  }

  const runsRaw = safeExec(
    "gh run list --limit 30 --json workflowName,status,conclusion,headBranch,event,createdAt,updatedAt,url"
  );
  if (runsRaw) {
    try {
      const runs = JSON.parse(runsRaw);
      const rows = Array.isArray(runs) ? runs : [];
      const completed = rows.filter((row) => row.status === "completed");
      const success = completed.filter((row) => row.conclusion === "success").length;
      const totalCompleted = completed.length;
      const successRate = totalCompleted > 0 ? Math.round((success / totalCompleted) * 100) : 0;
      addItem({
        category: "github",
        tags: ["github", "actions"],
        metadata: { completedRuns: totalCompleted, successRuns: success, successRate },
        runId: "ctx-github",
        content: `Recent GitHub Actions health: ${success}/${totalCompleted} completed runs successful (${successRate}% success). Recent workflows: ${rows
          .slice(0, 12)
          .map((row) => `${oneLine(row.workflowName || "workflow", 64)}=${row.conclusion || row.status}`)
          .join(" | ")}.`,
      });
    } catch {
      // ignore parsing failure
    }
  }
}

function ingestMcpConfig() {
  const configPath = join(codexHome, "config.toml");
  const text = safeRead(configPath);
  if (!text) return;

  const lines = text.split(/\r?\n/);
  const topServers = [];
  let currentTop = null;
  for (const line of lines) {
    const topMatch = line.match(/^\[mcp_servers\.([^\]]+)\]\s*$/);
    if (topMatch) {
      if (currentTop) topServers.push(currentTop);
      currentTop = {
        key: String(topMatch[1] ?? "").trim(),
        enabled: false,
        url: null,
        command: null,
      };
      continue;
    }
    if (/^\[/.test(line)) {
      if (currentTop) {
        topServers.push(currentTop);
        currentTop = null;
      }
      continue;
    }
    if (!currentTop) continue;
    const enabledMatch = line.match(/^\s*enabled\s*=\s*(true|false)\s*$/);
    if (enabledMatch) {
      currentTop.enabled = enabledMatch[1] === "true";
      continue;
    }
    const urlMatch = line.match(/^\s*url\s*=\s*"([^"]+)"/);
    if (urlMatch) {
      currentTop.url = urlMatch[1];
      continue;
    }
    const cmdMatch = line.match(/^\s*command\s*=\s*"([^"]+)"/);
    if (cmdMatch) {
      currentTop.command = cmdMatch[1];
      continue;
    }
  }
  if (currentTop) topServers.push(currentTop);

  const enabledTop = topServers.filter((server) => server.enabled).map((server) => server.key);
  const disabledTop = topServers.filter((server) => !server.enabled).map((server) => server.key);
  addItem({
    category: "mcp",
    tags: ["mcp", "config"],
    metadata: { configPath, topServers: topServers.length, enabledTop: enabledTop.length },
    runId: "ctx-mcp",
    content: `MCP top-level servers: ${topServers.length} configured, ${enabledTop.length} enabled by default (${enabledTop.join(", ") || "none"}), ${disabledTop.length} disabled by default.`,
  });

  const profileMap = new Map();
  let currentProfile = null;
  for (const line of lines) {
    const profileMatch = line.match(/^\[profiles\.([^.]+)\.mcp_servers\.([^\]]+)\]\s*$/);
    if (profileMatch) {
      currentProfile = {
        profile: String(profileMatch[1] ?? "").trim(),
        server: String(profileMatch[2] ?? "").trim(),
      };
      continue;
    }
    if (/^\[/.test(line)) {
      currentProfile = null;
      continue;
    }
    if (!currentProfile) continue;
    const enabledMatch = line.match(/^\s*enabled\s*=\s*(true|false)\s*$/);
    if (!enabledMatch || enabledMatch[1] !== "true") continue;
    const list = profileMap.get(currentProfile.profile) ?? [];
    list.push(currentProfile.server);
    profileMap.set(currentProfile.profile, list);
    currentProfile = null;
  }

  const enabledTopServers = topServers.filter((server) => server.enabled);
  for (const server of enabledTopServers) {
    addItem({
      category: "mcp",
      tags: ["mcp", "top-level", "enabled"],
      metadata: { key: server.key, url: server.url, command: server.command },
      runId: "ctx-mcp",
      content: `MCP top-level server "${server.key}" is enabled by default${server.url ? ` (url ${server.url})` : ""}${
        server.command ? ` (command ${server.command})` : ""
      }.`,
    });
  }
  for (const [profile, servers] of profileMap.entries()) {
    addItem({
      category: "mcp",
      tags: ["mcp", "profile"],
      metadata: { profile, enabledServers: servers.length },
      runId: "ctx-mcp",
      content: `MCP profile "${profile}" enables servers: ${servers.slice(0, 20).join(", ")}.`,
    });
  }
}

function ingestArtifactHints() {
  const qaDir = join(cwd, "output", "qa");
  const qaFiles = listFiles(qaDir, (path) => path.endsWith(".json") || path.endsWith(".md"));
  if (qaFiles.length > 0) {
    const recent = qaFiles
      .map((path) => {
        let mtime = 0;
        try {
          mtime = statSync(path).mtimeMs;
        } catch {
          // ignore
        }
        return { path, mtime };
      })
      .sort((a, b) => b.mtime - a.mtime)
      .slice(0, 12)
      .map((entry) => entry.path.replace(`${cwd}/`, ""));
    addItem({
      category: "artifact",
      tags: ["artifact", "qa"],
      metadata: { count: qaFiles.length },
      runId: "ctx-artifacts",
      content: `QA/output artifacts available (${qaFiles.length} files). Recent artifacts: ${recent.join(" | ")}.`,
    });
  }
}

ingestIntents();
ingestTickets();
ingestRunbooks();
ingestIntentOutput();
ingestMemoryLedgerSummary();
ingestLocalGit();
ingestGithub();
ingestMcpConfig();
ingestArtifactHints();

const sliced = items.slice(0, Number.isFinite(maxItems) && maxItems > 0 ? maxItems : 320);
mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${sliced.map((row) => JSON.stringify(row)).join("\n")}\n`, "utf8");

const byCategory = {};
for (const item of sliced) {
  const key = String(item?.metadata?.category ?? "unknown");
  byCategory[key] = (byCategory[key] ?? 0) + 1;
}

process.stdout.write(
  `${JSON.stringify(
    {
      outputPath,
      source,
      runScope,
      generatedAt: new Date().toISOString(),
      total: sliced.length,
      byCategory,
      droppedDueToCap: Math.max(0, items.length - sliced.length),
    },
    null,
    2
  )}\n`
);
