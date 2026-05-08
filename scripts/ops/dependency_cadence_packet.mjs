#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), "..", "..");
const DEFAULT_OUTPUT_DIR = resolve(REPO_ROOT, "output", "ops", "dependency-cadence");

const PRODUCERS = [
  {
    id: "dependency-security-scout",
    label: "Dependency security scout",
    command: ["node", "scripts/ops/dependency_security_scout.mjs", "--write", "--json"],
    latest: resolve(REPO_ROOT, "output", "ops", "dependency-security-scout", "latest.json")
  },
  {
    id: "dependency-upstream-watch",
    label: "Dependency upstream watch",
    command: ["node", "scripts/ops/dependency_upstream_watch.mjs", "--write", "--json"],
    latest: resolve(REPO_ROOT, "output", "ops", "dependency-upstream-watch", "latest.json")
  },
  {
    id: "dependency-zero-baseline",
    label: "Dependency zero-baseline guard",
    command: ["node", "scripts/ops/dependency_zero_baseline_guard.mjs", "--write", "--json"],
    latest: resolve(REPO_ROOT, "output", "ops", "dependency-zero-baseline", "latest.json")
  }
];

function usage() {
  return `Dependency cadence packet

Usage:
  node scripts/ops/dependency_cadence_packet.mjs [--json] [--write] [--refresh]

Options:
  --json                 Print JSON.
  --write                Write latest JSON and Markdown artifacts.
  --refresh              Refresh dependency producers before summarizing.
  --output-dir <path>    Artifact directory. Default: output/ops/dependency-cadence.

This command is read-only. It does not install, update, audit-fix, override,
remove, or rewrite dependencies.
`;
}

function parseArgs(argv) {
  const options = {
    json: false,
    write: false,
    refresh: false,
    outputDir: DEFAULT_OUTPUT_DIR
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
    if (arg === "--refresh") {
      options.refresh = true;
      continue;
    }
    if (arg === "--output-dir") {
      if (!argv[index + 1]) throw new Error(`${arg} requires a value.`);
      options.outputDir = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg.startsWith("--output-dir=")) {
      options.outputDir = arg.slice("--output-dir=".length);
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  options.outputDir = resolve(REPO_ROOT, options.outputDir);
  return options;
}

function repoRelative(path) {
  return relative(REPO_ROOT, path).replace(/\\/g, "/") || ".";
}

function windowsCommand(command) {
  if (process.platform !== "win32") return command;
  if (command === "node") return process.execPath;
  if (command === "npm") return "npm.cmd";
  return command;
}

function windowsShellQuote(value) {
  const text = String(value);
  if (/^[A-Za-z0-9_./:=@-]+$/.test(text)) return text;
  return `"${text.replace(/"/g, '\\"')}"`;
}

function run(command) {
  const [rawCommand, ...rawArgs] = command;
  const resolved = windowsCommand(rawCommand);
  const useCmdShim = process.platform === "win32" && /\.cmd$/i.test(resolved);
  const actualCommand = useCmdShim ? "cmd.exe" : resolved;
  const actualArgs = useCmdShim
    ? ["/d", "/s", "/c", [resolved, ...rawArgs].map(windowsShellQuote).join(" ")]
    : rawArgs;
  const result = spawnSync(actualCommand, actualArgs, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    windowsHide: true,
    timeout: 300_000
  });
  return {
    exitStatus: result.status ?? null,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    error: result.error?.message || ""
  };
}

function safeJsonParse(raw, fallback = null) {
  try {
    return JSON.parse(raw || "");
  } catch {
    return fallback;
  }
}

function readJson(path) {
  if (!existsSync(path)) return null;
  return safeJsonParse(readFileSync(path, "utf8"), null);
}

function firstLines(text, maxLines = 4) {
  return String(text || "").split(/\r?\n/).filter(Boolean).slice(0, maxLines).join("\n");
}

function loadProducer(producer, options) {
  const commandText = producer.command.join(" ");
  let refresh = null;
  if (options.refresh) {
    const result = run(producer.command);
    refresh = {
      command: commandText,
      exitStatus: result.exitStatus,
      error: firstLines(result.stderr || result.error),
      parsed: safeJsonParse(result.stdout, null)
    };
  }
  const report = refresh?.parsed || readJson(producer.latest);
  return {
    id: producer.id,
    label: producer.label,
    command: commandText,
    latestPath: repoRelative(producer.latest),
    refreshed: Boolean(options.refresh),
    refreshExitStatus: refresh?.exitStatus ?? null,
    refreshError: refresh?.error || "",
    evidenceAvailable: Boolean(report),
    status: report?.status || "unavailable",
    generatedAt: report?.generatedAt || null,
    summary: summarizeProducer(producer.id, report),
    findingCount: Array.isArray(report?.findings) ? report.findings.length : null,
    safeNextStep: nextStepForProducer(producer.id, report, refresh)
  };
}

function summarizeProducer(id, report) {
  if (!report) return {};
  if (id === "dependency-security-scout") {
    return {
      openAlerts: report.summary?.openAlerts ?? null,
      activeAlerts: report.summary?.activeAlerts ?? null,
      staleAlerts: report.summary?.staleAlerts ?? null,
      auditHighCritical: report.summary?.auditHighCritical ?? null,
      auditTotal: report.summary?.auditTotal ?? null,
      dependabotPrs: report.summary?.dependabotPrs ?? null
    };
  }
  if (id === "dependency-upstream-watch") {
    return {
      itemCount: Array.isArray(report.items) ? report.items.length : null,
      normalUpdateCandidates: countItems(report.items, "normal_update_candidate"),
      lockfileRefreshCandidates: countItems(report.items, "lockfile_refresh_candidate"),
      upstreamMovementNeeded: countItems(report.items, "upstream_movement_needed")
    };
  }
  if (id === "dependency-zero-baseline") {
    return {
      findingCount: Array.isArray(report.findings) ? report.findings.length : null,
      baselinePath: report.baseline?.path || null,
      sourceCommit: report.baseline?.sourceCommit || null
    };
  }
  return {};
}

function countItems(items, classification) {
  return (Array.isArray(items) ? items : []).filter((item) => item.classification === classification).length;
}

function nextStepForProducer(id, report, refresh) {
  if (refresh && refresh.exitStatus !== 0) {
    return "Inspect the producer error, restore read-only GitHub/npm access if needed, and rerun the cadence packet.";
  }
  if (!report) {
    return "Run this packet with --refresh to create missing dependency evidence artifacts.";
  }
  if (report.status === "ok") {
    return "No dependency remediation action is needed; keep the cadence artifact fresh.";
  }
  if (id === "dependency-zero-baseline") {
    return "Open the zero-baseline findings and decide whether the regression needs a dependency PR or an evidence-access fix.";
  }
  return "Open the producer's latest Markdown packet and classify active risk versus stale or unavailable evidence.";
}

function statusFromProducers(producers) {
  if (producers.some((producer) => !producer.evidenceAvailable || producer.refreshExitStatus !== null && producer.refreshExitStatus !== 0)) {
    return "unknown";
  }
  if (producers.some((producer) => producer.status !== "ok")) {
    return "action_needed";
  }
  return "ok";
}

function buildFindings(producers) {
  const findings = [];
  for (const producer of producers) {
    if (!producer.evidenceAvailable) {
      findings.push({
        severity: "medium",
        title: `${producer.label} evidence is unavailable`,
        affectedComponent: producer.id,
        evidence: `${producer.latestPath} is missing or unreadable.`,
        likelyImpact: "Operators cannot trust the dependency security baseline without this evidence.",
        recommendedAction: "Run the cadence packet with --refresh and inspect producer access errors.",
        safeNextStep: producer.safeNextStep,
        rollback: "Revert this reporting PR or delete the ignored output artifact; no dependency state is changed.",
        prSuitable: true
      });
      continue;
    }
    if (producer.status !== "ok") {
      findings.push({
        severity: producer.id === "dependency-zero-baseline" ? "high" : "medium",
        title: `${producer.label} reports ${producer.status}`,
        affectedComponent: producer.id,
        evidence: `${producer.latestPath}; summary=${JSON.stringify(producer.summary)}`,
        likelyImpact: "A dependency security regression or evidence gap can remain hidden between manual checks.",
        recommendedAction: "Open the producer packet and create a focused remediation or evidence-access task.",
        safeNextStep: producer.safeNextStep,
        rollback: "Revert the eventual remediation PR; this cadence packet does not mutate dependencies.",
        prSuitable: true
      });
    }
  }
  return findings;
}

function renderMarkdown(report) {
  const lines = [
    "# Dependency Cadence Packet",
    "",
    `Generated: ${report.generatedAt}`,
    `Status: \`${report.status}\``,
    `Read-only: ${report.readOnly ? "yes" : "no"}`,
    `Refreshed producers: ${report.refreshed ? "yes" : "no"}`,
    "",
    "## Summary",
    "",
    `- Producers: ${report.summary.producerCount}`,
    `- Evidence available: ${report.summary.availableCount}/${report.summary.producerCount}`,
    `- Action-needed producers: ${report.summary.actionNeededCount}`,
    `- Findings: ${report.findings.length}`,
    "",
    "## Producer Status",
    ""
  ];
  for (const producer of report.producers) {
    lines.push(`### ${producer.label}`);
    lines.push("");
    lines.push(`- Status: \`${producer.status}\``);
    lines.push(`- Latest: \`${producer.latestPath}\``);
    lines.push(`- Generated: ${producer.generatedAt || "unknown"}`);
    lines.push(`- Summary: \`${JSON.stringify(producer.summary)}\``);
    lines.push(`- Safe next step: ${producer.safeNextStep}`);
    if (producer.refreshError) lines.push(`- Refresh error: \`${producer.refreshError}\``);
    lines.push("");
  }
  lines.push("## Findings");
  lines.push("");
  if (report.findings.length === 0) {
    lines.push("- No dependency cadence findings.");
  } else {
    for (const finding of report.findings) {
      lines.push(`### ${finding.title}`);
      lines.push("");
      lines.push(`- Severity: ${finding.severity}`);
      lines.push(`- Affected component: ${finding.affectedComponent}`);
      lines.push(`- Evidence: ${finding.evidence}`);
      lines.push(`- Likely impact: ${finding.likelyImpact}`);
      lines.push(`- Recommended action: ${finding.recommendedAction}`);
      lines.push(`- Safe next step: ${finding.safeNextStep}`);
      lines.push(`- Rollback: ${finding.rollback}`);
      lines.push(`- PR suitable: ${finding.prSuitable ? "yes" : "no"}`);
      lines.push("");
    }
  }
  lines.push("");
  lines.push("## Safety Notes");
  lines.push("");
  lines.push("- This packet is read-only.");
  lines.push("- It does not run `npm audit fix`, `npm install`, `npm update`, overrides, removals, or lockfile edits.");
  lines.push("- Dependency fixes still require a separate reviewable PR with tests and rollback notes.");
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function writeArtifacts(report, options) {
  mkdirSync(options.outputDir, { recursive: true });
  writeFileSync(resolve(options.outputDir, "latest.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  writeFileSync(resolve(options.outputDir, "latest.md"), renderMarkdown(report), "utf8");
}

function buildReport(options) {
  const producers = PRODUCERS.map((producer) => loadProducer(producer, options));
  const findings = buildFindings(producers);
  const status = statusFromProducers(producers);
  return {
    schema: "studio-brain.ops.dependency-cadence.v1",
    generatedAt: new Date().toISOString(),
    status,
    readOnly: true,
    refreshed: options.refresh,
    approvalBoundary: "No dependency mutation, install, update, audit-fix, override, removal, or lockfile edit is performed.",
    summary: {
      producerCount: producers.length,
      availableCount: producers.filter((producer) => producer.evidenceAvailable).length,
      actionNeededCount: producers.filter((producer) => producer.status !== "ok").length,
      highOrCriticalAuditCount: producers.find((producer) => producer.id === "dependency-security-scout")?.summary?.auditHighCritical ?? null,
      upstreamWatchItemCount: producers.find((producer) => producer.id === "dependency-upstream-watch")?.summary?.itemCount ?? null,
      zeroBaselineFindingCount: producers.find((producer) => producer.id === "dependency-zero-baseline")?.summary?.findingCount ?? null
    },
    producers,
    findings,
    safeNextStep: findings.length === 0
      ? "Keep dependency evidence fresh on the documented daily/weekly cadence."
      : "Create issue-ready remediation tasks for the findings before changing dependencies."
  };
}

try {
  const options = parseArgs(process.argv.slice(2));
  const report = buildReport(options);
  if (options.write) writeArtifacts(report, options);
  process.stdout.write(options.json ? `${JSON.stringify(report, null, 2)}\n` : renderMarkdown(report));
  process.exit(0);
} catch (error) {
  process.stderr.write(`dependency cadence packet failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
