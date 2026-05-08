#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), "..", "..");
const DEFAULT_OUTPUT_DIR = resolve(REPO_ROOT, "output", "ops", "dependency-security-scout");
const DEFAULT_REPO = "monsoonfirepottery-byte/monsoonfire-portal";
const DEFAULT_WORKSPACES = [".", "web", "functions", "studio-brain", "studio-brain-mcp", "codex-agents"];

function usage() {
  return `Studio Brain dependency security scout

Usage:
  node scripts/ops/dependency_security_scout.mjs [--json] [--write]

Options:
  --json                  Print JSON.
  --write                 Write latest JSON and Markdown artifacts.
  --output-dir <path>     Artifact directory. Default: output/ops/dependency-security-scout.
  --repo <owner/repo>     GitHub repo for Dependabot alert/PR lookup.
  --skip-npm-audit        Skip local npm audit probes.
  --skip-github           Skip GitHub alert and PR lookup.
`;
}

function parseArgs(argv) {
  const options = {
    json: false,
    write: false,
    outputDir: DEFAULT_OUTPUT_DIR,
    repo: DEFAULT_REPO,
    npmAudit: true,
    github: true
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      process.stdout.write(usage());
      process.exit(0);
    }
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    if (arg === "--write") {
      options.write = true;
      continue;
    }
    if (arg === "--skip-npm-audit") {
      options.npmAudit = false;
      continue;
    }
    if (arg === "--skip-github") {
      options.github = false;
      continue;
    }
    if (arg === "--output-dir" || arg === "--repo") {
      if (!argv[index + 1]) throw new Error(`${arg} requires a value.`);
      options[arg === "--output-dir" ? "outputDir" : "repo"] = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg.startsWith("--output-dir=")) {
      options.outputDir = arg.slice("--output-dir=".length);
      continue;
    }
    if (arg.startsWith("--repo=")) {
      options.repo = arg.slice("--repo=".length);
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  options.outputDir = resolve(REPO_ROOT, options.outputDir);
  return options;
}

function repoRelative(path) {
  return relative(REPO_ROOT, path).replace(/\\/g, "/");
}

function commandExists(command) {
  const result = spawnSync(process.platform === "win32" ? "where.exe" : "sh", process.platform === "win32" ? [windowsCommand(command)] : ["-lc", `command -v ${command}`], {
    encoding: "utf8",
    windowsHide: true
  });
  return result.status === 0;
}

function windowsCommand(command) {
  if (process.platform !== "win32") return command;
  if (command === "npm") return "npm.cmd";
  if (command === "npx") return "npx.cmd";
  if (command === "gh") return "gh.exe";
  return command;
}

function run(command, args, options = {}) {
  const resolved = windowsCommand(command);
  const useCmdShim = process.platform === "win32" && /\.cmd$/i.test(resolved);
  const actualCommand = useCmdShim ? "cmd.exe" : resolved;
  const actualArgs = useCmdShim ? ["/d", "/s", "/c", [resolved, ...args].map(windowsShellQuote).join(" ")] : args;
  const result = spawnSync(actualCommand, actualArgs, {
    cwd: options.cwd || REPO_ROOT,
    encoding: "utf8",
    windowsHide: true,
    timeout: options.timeoutMs || 120_000,
    env: { ...process.env, ...options.env }
  });
  return {
    status: result.status ?? null,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    error: result.error?.message || ""
  };
}

function windowsShellQuote(value) {
  const text = String(value);
  if (/^[A-Za-z0-9_./:=@-]+$/.test(text)) return text;
  return `"${text.replace(/"/g, '\\"')}"`;
}

function safeJsonParse(raw, fallback) {
  try {
    return JSON.parse(raw || "");
  } catch {
    return fallback;
  }
}

function packageNameFromLockPath(path) {
  const parts = String(path || "").split("node_modules/");
  const last = parts.at(-1) || "";
  if (!last) return "";
  const segments = last.split("/");
  return last.startsWith("@") ? `${segments[0]}/${segments[1] || ""}` : segments[0];
}

function loadLockGraph(packageLockPath) {
  if (!existsSync(packageLockPath)) return { packages: {}, reverseByName: new Map() };
  const lock = safeJsonParse(readFileSync(packageLockPath, "utf8"), {});
  const packages = lock.packages && typeof lock.packages === "object" ? lock.packages : {};
  const reverseByName = new Map();
  for (const [path, metadata] of Object.entries(packages)) {
    const dependencyGroups = [
      metadata?.dependencies,
      metadata?.devDependencies,
      metadata?.optionalDependencies,
      metadata?.peerDependencies
    ].filter((group) => group && typeof group === "object");
    const dependencies = Object.assign({}, ...dependencyGroups);
    for (const dependencyName of Object.keys(dependencies)) {
      const parents = reverseByName.get(dependencyName) || [];
      parents.push(path || "(root)");
      reverseByName.set(dependencyName, parents);
    }
  }
  return { packages, reverseByName };
}

function shortestDependencyChain(targetPath, graph) {
  const normalizedTarget = targetPath || "";
  const targetName = packageNameFromLockPath(normalizedTarget);
  if (!targetName) return [];
  const queue = [{ path: normalizedTarget, chain: [normalizedTarget] }];
  const seen = new Set([normalizedTarget]);
  while (queue.length) {
    const current = queue.shift();
    const currentName = packageNameFromLockPath(current.path);
    const parents = graph.reverseByName.get(currentName) || [];
    for (const parent of parents) {
      const parentPath = parent === "(root)" ? "" : parent;
      if (seen.has(parentPath)) continue;
      const nextChain = [parentPath || "(root)", ...current.chain];
      if (!parentPath) return nextChain;
      seen.add(parentPath);
      queue.push({ path: parentPath, chain: nextChain });
    }
  }
  return [normalizedTarget];
}

function advisoryIds(vulnerability) {
  const via = Array.isArray(vulnerability?.via) ? vulnerability.via : [];
  return via
    .filter((entry) => entry && typeof entry === "object")
    .map((entry) => entry.url || entry.source || entry.title || entry.name)
    .filter(Boolean);
}

function githubAlerts(repo) {
  if (!commandExists("gh")) {
    return { status: "skipped_gh_unavailable", alerts: [], error: "" };
  }
  const result = run("gh", [
    "api",
    `repos/${repo}/dependabot/alerts?state=open`
  ], { timeoutMs: 120_000 });
  if (result.status !== 0) {
    return { status: "unavailable", alerts: [], error: firstLines(result.stderr || result.error) };
  }
  const parsed = safeJsonParse(result.stdout, []);
  const alerts = (Array.isArray(parsed) ? parsed : []).map((alert) => ({
    number: alert.number,
    state: alert.state,
    dependency: alert.dependency?.package?.name || "",
    ecosystem: alert.dependency?.package?.ecosystem || "",
    manifestPath: alert.dependency?.manifest_path || "",
    scope: alert.dependency?.scope || "",
    severity: alert.security_advisory?.severity || "",
    ghsaId: alert.security_advisory?.ghsa_id || "",
    cveId: alert.security_advisory?.cve_id || "",
    summary: alert.security_advisory?.summary || "",
    vulnerableRange: alert.security_vulnerability?.vulnerable_version_range || "",
    patchedVersions: alert.security_vulnerability?.patched_versions || "",
    htmlUrl: alert.html_url || ""
  }));
  return { status: "ok", alerts, error: "" };
}

function dependabotPrs(repo) {
  if (!commandExists("gh")) {
    return { status: "skipped_gh_unavailable", prs: [], error: "" };
  }
  const result = run("gh", [
    "pr",
    "list",
    "--repo",
    repo,
    "--author",
    "app/dependabot",
    "--state",
    "open",
    "--json",
    "number,title,headRefName,baseRefName,isDraft,mergeStateStatus,statusCheckRollup,url,updatedAt",
    "--limit",
    "50"
  ], { timeoutMs: 120_000 });
  if (result.status !== 0) {
    return { status: "unavailable", prs: [], error: firstLines(result.stderr || result.error) };
  }
  const parsed = safeJsonParse(result.stdout, []);
  const prs = (Array.isArray(parsed) ? parsed : []).map((pr) => {
    const checks = Array.isArray(pr.statusCheckRollup) ? pr.statusCheckRollup : [];
    const failing = checks.filter((check) => check.conclusion && check.conclusion !== "SUCCESS" && check.conclusion !== "SKIPPED");
    const pending = checks.filter((check) => check.status && check.status !== "COMPLETED");
    return {
      number: pr.number,
      title: pr.title,
      url: pr.url,
      headRefName: pr.headRefName,
      baseRefName: pr.baseRefName,
      isDraft: Boolean(pr.isDraft),
      mergeStateStatus: pr.mergeStateStatus || "",
      updatedAt: pr.updatedAt || "",
      checks: {
        total: checks.length,
        failing: failing.length,
        pending: pending.length,
        passing: checks.filter((check) => check.conclusion === "SUCCESS").length
      }
    };
  });
  return { status: "ok", prs, error: "" };
}

function workspaceSummary(dir) {
  const absolute = resolve(REPO_ROOT, dir);
  const packageJson = resolve(absolute, "package.json");
  const packageLock = resolve(absolute, "package-lock.json");
  const summary = {
    path: dir,
    packageJson: repoRelative(packageJson),
    packageLock: existsSync(packageLock) ? repoRelative(packageLock) : "",
    packageName: "",
    dependencies: 0,
    devDependencies: 0,
    status: existsSync(packageJson) ? "present" : "missing_package_json",
    audit: { status: "not_run" }
  };
  if (!existsSync(packageJson)) return summary;
  const pkg = safeJsonParse(readFileSync(packageJson, "utf8"), {});
  summary.packageName = pkg.name || "(unnamed)";
  summary.dependencies = pkg.dependencies && typeof pkg.dependencies === "object" ? Object.keys(pkg.dependencies).length : 0;
  summary.devDependencies = pkg.devDependencies && typeof pkg.devDependencies === "object" ? Object.keys(pkg.devDependencies).length : 0;
  if (!existsSync(packageLock)) {
    summary.audit = { status: "skipped_missing_lockfile" };
  }
  return summary;
}

function npmAuditWorkspace(summary, enabled) {
  if (!enabled) {
    summary.audit = { status: "skipped_by_flag" };
    return summary;
  }
  if (!summary.packageLock) return summary;
  if (!commandExists("npm")) {
    summary.audit = { status: "skipped_npm_unavailable" };
    return summary;
  }
  const result = run("npm", ["audit", "--package-lock-only", "--json"], {
    cwd: resolve(REPO_ROOT, summary.path),
    timeoutMs: 120_000
  });
  const audit = safeJsonParse(result.stdout, {});
  const counts = audit.metadata?.vulnerabilities || {};
  const vulnerabilityMap = audit.vulnerabilities && typeof audit.vulnerabilities === "object" ? audit.vulnerabilities : {};
  const vulnerabilities = Object.keys(vulnerabilityMap).sort();
  const graph = loadLockGraph(resolve(REPO_ROOT, summary.packageLock));
  const vulnerableChains = vulnerabilities.map((name) => {
    const vulnerability = vulnerabilityMap[name] || {};
    const nodes = Array.isArray(vulnerability.nodes) ? vulnerability.nodes : [];
    return {
      name,
      severity: vulnerability.severity || "",
      range: vulnerability.range || "",
      fixAvailable: Boolean(vulnerability.fixAvailable),
      advisories: advisoryIds(vulnerability).slice(0, 5),
      chains: nodes.slice(0, 5).map((node) => shortestDependencyChain(node, graph)).filter((chain) => chain.length > 0)
    };
  });
  summary.audit = {
    status: result.status === 0 ? "clean" : vulnerabilities.length > 0 ? "vulnerabilities_found" : "audit_error",
    exitStatus: result.status,
    counts: {
      info: counts.info || 0,
      low: counts.low || 0,
      moderate: counts.moderate || 0,
      high: counts.high || 0,
      critical: counts.critical || 0,
      total: counts.total || 0
    },
    affectedPackages: vulnerabilities.slice(0, 30),
    vulnerableChains,
    stderrSummary: firstLines(result.stderr || result.error)
  };
  return summary;
}

function firstLines(value) {
  return String(value || "")
    .split(/\r?\n/)
    .filter(Boolean)
    .filter((line) => !/npm notice/i.test(line))
    .slice(0, 3)
    .join(" | ");
}

function issueReadyTasks(report) {
  const tasks = [];
  const alertGroups = new Map();
  for (const alert of report.github.alerts.alerts || []) {
    const key = `${alert.dependency}|${alert.manifestPath}`;
    const existing = alertGroups.get(key) || [];
    existing.push(alert);
    alertGroups.set(key, existing);
  }
  for (const [key, alerts] of alertGroups.entries()) {
    const [dependency, manifestPath] = key.split("|");
    tasks.push({
      title: `[deps] Review ${dependency} alert in ${manifestPath}`,
      body: [
        "## Problem",
        `${alerts.length} open Dependabot alert(s) affect \`${dependency}\` in \`${manifestPath}\`.`,
        "",
        "## Evidence",
        ...alerts.map((alert) => `- #${alert.number}: ${alert.ghsaId || alert.cveId} ${alert.severity} patched in ${alert.patchedVersions || "unknown"}`),
        "",
        "## Risk",
        "The dependency surface remains exposed until the lockfile update is merged and verified.",
        "",
        "## Proposed Fix",
        "Review the matching Dependabot PR if present, run package-specific checks, and merge only after CI passes.",
        "",
        "## Acceptance Criteria",
        "- Matching alert closes or is explicitly dismissed with rationale.",
        "- CI and package-specific tests pass.",
        "- No manual `npm audit fix` or broad dependency update is used without review.",
        "",
        "## Safety Notes",
        "- This scout is read-only.",
        "- Dependency upgrades remain PR-gated and rollback is the previous lockfile commit."
      ].join("\n"),
      labels: ["ops", "security", "dependencies"]
    });
  }
  for (const workspace of report.workspaces) {
    const counts = workspace.audit?.counts || {};
    if ((counts.high || 0) + (counts.critical || 0) === 0) continue;
    tasks.push({
      title: `[deps] Triage high npm audit findings in ${workspace.path}`,
      body: [
        "## Problem",
        `\`${workspace.path}\` reports high or critical npm audit findings.`,
        "",
        "## Evidence",
        `- Counts: high=${counts.high || 0}, critical=${counts.critical || 0}, total=${counts.total || 0}`,
        `- Affected package sample: ${(workspace.audit.affectedPackages || []).join(", ") || "none"}`,
        ...((workspace.audit.vulnerableChains || [])
          .filter((item) => item.severity === "high" || item.severity === "critical")
          .slice(0, 5)
          .map((item) => `- Chain for ${item.name}: ${(item.chains?.[0] || []).join(" -> ") || "unresolved"}`)),
        "",
        "## Risk",
        "Local npm audit may reveal dependency risk that is not represented by currently open GitHub alerts.",
        "",
        "## Proposed Fix",
        "Open a targeted dependency PR or confirm an existing Dependabot PR covers the chain.",
        "",
        "## Acceptance Criteria",
        "- High/critical count is zero or tracked by an explicit accepted-risk ticket.",
        "- Relevant package tests pass.",
        "- Lockfile-only changes are reviewed.",
        "",
        "## Safety Notes",
        "- Do not run `npm audit fix` automatically.",
        "- Rollback is reverting the dependency PR."
      ].join("\n"),
      labels: ["ops", "security", "dependencies"]
    });
  }
  return tasks;
}

function buildReport(options) {
  const alerts = options.github ? githubAlerts(options.repo) : { status: "skipped_by_flag", alerts: [], error: "" };
  const prs = options.github ? dependabotPrs(options.repo) : { status: "skipped_by_flag", prs: [], error: "" };
  const workspaces = DEFAULT_WORKSPACES
    .map(workspaceSummary)
    .map((summary) => npmAuditWorkspace(summary, options.npmAudit));
  const highCritical = workspaces.reduce((acc, workspace) => acc + (workspace.audit?.counts?.high || 0) + (workspace.audit?.counts?.critical || 0), 0);
  const report = {
    schema: "studio-brain.ops.dependency-security-scout.v1",
    generatedAt: new Date().toISOString(),
    readOnly: true,
    status: highCritical > 0 ? "warning" : (alerts.alerts || []).length > 0 ? "degraded" : "ok",
    github: { alerts, dependabotPrs: prs },
    summary: {
      openAlerts: (alerts.alerts || []).length,
      openDependabotPrs: (prs.prs || []).length,
      workspaces: workspaces.length,
      auditHighCritical: highCritical,
      auditTotal: workspaces.reduce((acc, workspace) => acc + (workspace.audit?.counts?.total || 0), 0)
    },
    workspaces,
    approvalBoundary: "This report does not approve dependency upgrades, npm audit fix, package installs, deploys, or lockfile changes."
  };
  report.issueReadyTasks = issueReadyTasks(report);
  return report;
}

function renderMarkdown(report) {
  const lines = [
    "# Dependency Security Scout",
    "",
    `- Generated at: ${report.generatedAt}`,
    `- Status: ${report.status}`,
    `- Read-only: ${report.readOnly ? "yes" : "no"}`,
    `- Approval boundary: ${report.approvalBoundary}`,
    "",
    "## Summary",
    "",
    `- Open Dependabot alerts: ${report.summary.openAlerts}`,
    `- Open Dependabot PRs: ${report.summary.openDependabotPrs}`,
    `- Workspaces checked: ${report.summary.workspaces}`,
    `- npm audit high/critical: ${report.summary.auditHighCritical}`,
    `- npm audit total: ${report.summary.auditTotal}`,
    "",
    "## Dependabot Alerts",
    "",
    "| Alert | Severity | Dependency | Manifest | Patched versions | Advisory |",
    "| --- | --- | --- | --- | --- | --- |"
  ];
  for (const alert of report.github.alerts.alerts || []) {
    lines.push(`| #${alert.number} | ${alert.severity} | \`${alert.dependency}\` | \`${alert.manifestPath}\` | ${alert.patchedVersions || "unknown"} | ${alert.ghsaId || alert.cveId || ""} |`);
  }
  if (!(report.github.alerts.alerts || []).length) lines.push("| n/a | n/a | n/a | n/a | n/a | n/a |");
  lines.push("");
  lines.push("## Dependabot PRs");
  lines.push("");
  lines.push("| PR | State | Checks | Branch | Title |");
  lines.push("| --- | --- | --- | --- | --- |");
  for (const pr of report.github.dependabotPrs.prs || []) {
    lines.push(`| #${pr.number} | ${pr.mergeStateStatus}${pr.isDraft ? " draft" : ""} | pass=${pr.checks.passing} pending=${pr.checks.pending} fail=${pr.checks.failing} | \`${pr.headRefName}\` | ${pr.title} |`);
  }
  if (!(report.github.dependabotPrs.prs || []).length) lines.push("| n/a | n/a | n/a | n/a | n/a |");
  lines.push("");
  lines.push("## npm Audit Workspaces");
  lines.push("");
  lines.push("| Workspace | Audit status | Moderate | High | Critical | Total | Affected sample |");
  lines.push("| --- | --- | ---: | ---: | ---: | ---: | --- |");
  for (const workspace of report.workspaces) {
    const counts = workspace.audit?.counts || {};
    lines.push(`| \`${workspace.path}\` | ${workspace.audit?.status || "unknown"} | ${counts.moderate || 0} | ${counts.high || 0} | ${counts.critical || 0} | ${counts.total || 0} | ${(workspace.audit?.affectedPackages || []).slice(0, 8).join(", ") || ""} |`);
  }
  lines.push("");
  lines.push("## Vulnerable Dependency Chains");
  lines.push("");
  lines.push("| Workspace | Package | Severity | Range | Chain | Advisories |");
  lines.push("| --- | --- | --- | --- | --- | --- |");
  let chainRows = 0;
  for (const workspace of report.workspaces) {
    for (const item of workspace.audit?.vulnerableChains || []) {
      const chain = (item.chains?.[0] || []).join(" -> ");
      lines.push(`| \`${workspace.path}\` | \`${item.name}\` | ${item.severity || ""} | \`${item.range || ""}\` | ${chain || "unresolved"} | ${(item.advisories || []).join(", ")} |`);
      chainRows += 1;
    }
  }
  if (!chainRows) lines.push("| n/a | n/a | n/a | n/a | n/a | n/a |");
  lines.push("");
  lines.push("## Issue-Ready Tasks");
  lines.push("");
  if (!report.issueReadyTasks.length) lines.push("- No dependency/security follow-up tasks.");
  for (const task of report.issueReadyTasks) {
    lines.push(`### ${task.title}`);
    lines.push("");
    lines.push(task.body);
    lines.push("");
    lines.push(`Labels: ${task.labels.join(", ")}`);
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

function writeArtifacts(report, options) {
  mkdirSync(options.outputDir, { recursive: true });
  const jsonPath = resolve(options.outputDir, "latest.json");
  const markdownPath = resolve(options.outputDir, "latest.md");
  writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  writeFileSync(markdownPath, renderMarkdown(report), "utf8");
  report.paths = {
    json: repoRelative(jsonPath),
    markdown: repoRelative(markdownPath)
  };
}

function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    const report = buildReport(options);
    if (options.write) writeArtifacts(report, options);
    process.stdout.write(options.json ? `${JSON.stringify(report, null, 2)}\n` : renderMarkdown(report));
  } catch (error) {
    process.stderr.write(`dependency_security_scout: ${error.message}\n`);
    process.exit(1);
  }
}

main();
