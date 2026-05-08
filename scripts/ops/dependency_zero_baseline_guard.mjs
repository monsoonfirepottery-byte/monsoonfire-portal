#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), "..", "..");
const DEFAULT_BASELINE = resolve(REPO_ROOT, "docs", "ops", "dependency-zero-baseline.json");
const DEFAULT_OUTPUT_DIR = resolve(REPO_ROOT, "output", "ops", "dependency-zero-baseline");

function usage() {
  return `Dependency zero-baseline guard

Usage:
  node scripts/ops/dependency_zero_baseline_guard.mjs [--json] [--write] [--strict]

Options:
  --json                  Print JSON.
  --write                 Write latest JSON and Markdown artifacts.
  --strict                Exit non-zero when the baseline regresses or evidence is unavailable.
  --baseline <path>       Baseline JSON. Default: docs/ops/dependency-zero-baseline.json.
  --output-dir <path>     Artifact directory. Default: output/ops/dependency-zero-baseline.
  --skip-github           Pass through to dependency scout when GitHub evidence is intentionally unavailable.

This guard is read-only. It does not run npm audit fix, install, update, override, or remove dependencies.
`;
}

function parseArgs(argv) {
  const options = {
    json: false,
    write: false,
    strict: false,
    baseline: DEFAULT_BASELINE,
    outputDir: DEFAULT_OUTPUT_DIR,
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
    if (arg === "--strict") {
      options.strict = true;
      continue;
    }
    if (arg === "--skip-github") {
      options.github = false;
      continue;
    }
    if (arg === "--baseline" || arg === "--output-dir") {
      if (!argv[index + 1]) throw new Error(`${arg} requires a value.`);
      options[arg === "--baseline" ? "baseline" : "outputDir"] = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg.startsWith("--baseline=")) {
      options.baseline = arg.slice("--baseline=".length);
      continue;
    }
    if (arg.startsWith("--output-dir=")) {
      options.outputDir = arg.slice("--output-dir=".length);
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  options.baseline = resolve(REPO_ROOT, options.baseline);
  options.outputDir = resolve(REPO_ROOT, options.outputDir);
  return options;
}

function repoRelative(path) {
  return relative(REPO_ROOT, path).replace(/\\/g, "/") || ".";
}

function safeJsonParse(raw, fallback) {
  try {
    return JSON.parse(raw || "");
  } catch {
    return fallback;
  }
}

function readJson(path) {
  if (!existsSync(path)) throw new Error(`Missing baseline file: ${repoRelative(path)}`);
  const parsed = safeJsonParse(readFileSync(path, "utf8"), null);
  if (!parsed || typeof parsed !== "object") throw new Error(`Could not parse JSON: ${repoRelative(path)}`);
  return parsed;
}

function runNodeScript(scriptPath, args) {
  const result = spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    windowsHide: true,
    timeout: 180_000
  });
  return {
    status: result.status ?? null,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    error: result.error?.message || ""
  };
}

function firstLines(text, maxLines = 4) {
  return String(text || "").split(/\r?\n/).filter(Boolean).slice(0, maxLines).join("\n");
}

function collectEvidence(options) {
  const scoutArgs = ["scripts/ops/dependency_security_scout.mjs", "--json"];
  if (!options.github) scoutArgs.push("--skip-github");
  const scoutResult = runNodeScript(scoutArgs[0], scoutArgs.slice(1));
  const upstreamResult = runNodeScript("scripts/ops/dependency_upstream_watch.mjs", ["--json"]);
  return {
    githubEvidenceRequired: options.github,
    scout: {
      command: `node ${scoutArgs.join(" ")}`,
      exitStatus: scoutResult.status,
      error: firstLines(scoutResult.stderr || scoutResult.error),
      report: safeJsonParse(scoutResult.stdout, null)
    },
    upstreamWatch: {
      command: "node scripts/ops/dependency_upstream_watch.mjs --json",
      exitStatus: upstreamResult.status,
      error: firstLines(upstreamResult.stderr || upstreamResult.error),
      report: safeJsonParse(upstreamResult.stdout, null)
    }
  };
}

function addFinding(findings, severity, title, evidence, action) {
  findings.push({
    severity,
    title,
    evidence,
    likelyImpact: severity === "high"
      ? "A dependency security regression can ship unnoticed or operators can chase the wrong remediation path."
      : "Dependency evidence is incomplete, so the zero baseline cannot be trusted.",
    recommendedAction: action,
    safeNextStep: "Run the dependency scout and upstream watch directly, then address any high/critical item in a small dependency PR.",
    rollback: "Revert the dependency PR or this guard PR; do not run npm audit fix as rollback.",
    prSuitable: true
  });
}

function compareBaseline(baseline, evidence) {
  const expectations = baseline.expectations || {};
  const scout = evidence.scout.report;
  const upstream = evidence.upstreamWatch.report;
  const findings = [];

  if (evidence.scout.exitStatus !== 0 || !scout) {
    addFinding(findings, "medium", "Dependency scout evidence unavailable", evidence.scout.error || `exit=${evidence.scout.exitStatus}`, "Restore GitHub/npm access or rerun without --skip-github only when GitHub evidence is intentionally unavailable.");
  } else {
    if (evidence.githubEvidenceRequired) {
      const alertStatus = scout.github?.alerts?.status || "unknown";
      const prStatus = scout.github?.dependabotPrs?.status || "unknown";
      if (alertStatus !== "ok" || prStatus !== "ok") {
        addFinding(findings, "medium", "GitHub dependency evidence unavailable", `alerts=${alertStatus}; dependabotPrs=${prStatus}`, "Restore GitHub CLI authentication or rerun with --skip-github only for an explicitly local-only audit.");
      }
    }
    if (scout.status !== expectations.dependencyScoutStatus) {
      addFinding(findings, "high", "Dependency scout status regressed", `expected=${expectations.dependencyScoutStatus}; actual=${scout.status}`, "Open the scout packet and classify active versus stale alerts.");
    }
    const checks = [
      ["Open Dependabot alerts exceeded baseline", scout.summary?.openAlerts, expectations.maxOpenDependabotAlerts],
      ["Active Dependabot alerts exceeded baseline", scout.summary?.activeAlerts, expectations.maxActiveDependabotAlerts],
      ["Stale Dependabot alerts exceeded baseline", scout.summary?.staleAlerts, expectations.maxStaleDependabotAlerts],
      ["npm audit high/critical exceeded baseline", scout.summary?.auditHighCritical, expectations.maxAuditHighCritical],
      ["npm audit total exceeded baseline", scout.summary?.auditTotal, expectations.maxAuditTotal]
    ];
    for (const [title, actual, expected] of checks) {
      if (Number(actual || 0) > Number(expected || 0)) {
        addFinding(findings, "high", title, `expected<=${expected}; actual=${actual}`, "Use the remediation packet and upstream watch before choosing a lockfile refresh, normal update, or override experiment.");
      }
    }
  }

  if (evidence.upstreamWatch.exitStatus !== 0 || !upstream) {
    addFinding(findings, "medium", "Dependency upstream-watch evidence unavailable", evidence.upstreamWatch.error || `exit=${evidence.upstreamWatch.exitStatus}`, "Restore npm registry access and rerun upstream-watch.");
  } else {
    if (upstream.status !== expectations.upstreamWatchStatus) {
      addFinding(findings, "high", "Dependency upstream-watch status regressed", `expected=${expectations.upstreamWatchStatus}; actual=${upstream.status}`, "Review whether vulnerable chains now have a safe normal update or lockfile refresh candidate.");
    }
    if ((upstream.items || []).length > Number(expectations.maxUpstreamWatchItems || 0)) {
      addFinding(findings, "high", "Dependency upstream-watch items exceeded baseline", `expected<=${expectations.maxUpstreamWatchItems}; actual=${upstream.items.length}`, "Generate a remediation packet for each high/critical chain.");
    }
  }

  return findings;
}

function renderMarkdown(report) {
  const lines = [
    "# Dependency Zero-Baseline Guard",
    "",
    `Generated: ${report.generatedAt}`,
    `Status: \`${report.status}\``,
    `Read-only: ${report.readOnly ? "yes" : "no"}`,
    "",
    "## Baseline",
    "",
    `- File: \`${report.baseline.path}\``,
    `- Source commit: \`${report.baseline.sourceCommit || "unknown"}\``,
    `- Approval boundary: ${report.approvalBoundary}`,
    "",
    "## Evidence",
    "",
    `- Dependency scout: exit=${report.evidence.scout.exitStatus}; status=\`${report.evidence.scout.report?.status || "unavailable"}\`; audit high/critical=${report.evidence.scout.report?.summary?.auditHighCritical ?? "unknown"}; audit total=${report.evidence.scout.report?.summary?.auditTotal ?? "unknown"}; open alerts=${report.evidence.scout.report?.summary?.openAlerts ?? "unknown"}`,
    `- Upstream watch: exit=${report.evidence.upstreamWatch.exitStatus}; status=\`${report.evidence.upstreamWatch.report?.status || "unavailable"}\`; items=${(report.evidence.upstreamWatch.report?.items || []).length}`,
    "",
    "## Findings",
    ""
  ];
  if (!report.findings.length) {
    lines.push("- None. Dependency posture still matches the zero baseline.");
  } else {
    for (const finding of report.findings) {
      lines.push(`### ${finding.severity.toUpperCase()}: ${finding.title}`);
      lines.push("");
      lines.push(`- Evidence: ${finding.evidence}`);
      lines.push(`- Likely impact: ${finding.likelyImpact}`);
      lines.push(`- Recommended action: ${finding.recommendedAction}`);
      lines.push(`- Safe next step: ${finding.safeNextStep}`);
      lines.push(`- Rollback: ${finding.rollback}`);
      lines.push("");
    }
  }
  lines.push("");
  lines.push("## Safety Notes");
  lines.push("");
  lines.push("- This guard does not install, update, override, remove, prune, or fix dependencies.");
  lines.push("- Treat regressions as evidence for a small reviewed PR, not approval for `npm audit fix`.");
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
  const options = parseArgs(process.argv.slice(2));
  const baseline = readJson(options.baseline);
  const evidence = collectEvidence(options);
  const findings = compareBaseline(baseline, evidence);
  const report = {
    schema: "studio-brain.ops.dependency-zero-baseline-guard.v1",
    generatedAt: new Date().toISOString(),
    readOnly: true,
    status: findings.some((finding) => finding.severity === "high") ? "regressed" : findings.length ? "unknown" : "ok",
    baseline: {
      path: repoRelative(options.baseline),
      sourceCommit: baseline.sourceCommit || "",
      expectations: baseline.expectations || {}
    },
    approvalBoundary: baseline.approvalBoundary || "Dependency mutations require a reviewed PR.",
    evidence,
    findings
  };
  if (options.write) writeArtifacts(report, options);
  process.stdout.write(options.json ? `${JSON.stringify(report, null, 2)}\n` : renderMarkdown(report));
  if (options.strict && report.status !== "ok") process.exit(2);
}

try {
  main();
} catch (error) {
  process.stderr.write(`dependency zero-baseline guard failed: ${error.message}\n`);
  process.exit(1);
}
