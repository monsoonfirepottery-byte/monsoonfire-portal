#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), "..", "..");
const DEFAULT_OUTPUT_DIR = resolve(REPO_ROOT, "output", "ops", "tooling-quality");
const DEFAULT_TOOLING_REPORT = resolve(DEFAULT_OUTPUT_DIR, "tooling-quality-latest.json");

function usage() {
  return `Studio Brain ops tooling findings export

Usage:
  node scripts/ops/tooling_findings_export.mjs [--json] [--write]

Options:
  --json                Print JSON.
  --write               Write timestamped/latest JSON and Markdown artifacts.
  --tooling-report <p>  Tooling-quality report. Default: output/ops/tooling-quality/tooling-quality-latest.json.
  --output-dir <path>   Artifact directory. Default: output/ops/tooling-quality.
`;
}

function clean(value) {
  return String(value ?? "").replace(/\r/g, "").trim();
}

function nowIso() {
  return new Date().toISOString();
}

function resolveRepoPath(path) {
  return resolve(REPO_ROOT, clean(path));
}

function repoRelative(path) {
  return relative(REPO_ROOT, resolve(path)).replace(/\\/g, "/");
}

function readJson(path) {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function parseArgs(argv) {
  const options = {
    json: false,
    write: false,
    toolingReport: DEFAULT_TOOLING_REPORT,
    outputDir: DEFAULT_OUTPUT_DIR,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = clean(argv[index]);
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
    if (arg === "--tooling-report") {
      options.toolingReport = resolveRepoPath(argv[++index]);
      continue;
    }
    if (arg.startsWith("--tooling-report=")) {
      options.toolingReport = resolveRepoPath(arg.slice("--tooling-report=".length));
      continue;
    }
    if (arg === "--output-dir") {
      options.outputDir = resolveRepoPath(argv[++index]);
      continue;
    }
    if (arg.startsWith("--output-dir=")) {
      options.outputDir = resolveRepoPath(arg.slice("--output-dir=".length));
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function sectionsFrom(report) {
  if (Array.isArray(report?.sections)) return report.sections;
  if (Array.isArray(report?.checks)) return report.checks;
  return [];
}

function isCoverageGap(finding) {
  const code = clean(finding?.code).toLowerCase();
  const message = clean(finding?.message).toLowerCase();
  return code === "tool_missing" || message.includes("not installed");
}

function normalizeFinding(section, finding) {
  const location = {
    file: clean(finding?.file),
    line: Number.isInteger(finding?.line) ? finding.line : null,
    column: Number.isInteger(finding?.column) ? finding.column : null,
  };
  return {
    toolId: clean(section?.id),
    tool: clean(section?.tool) || clean(section?.id),
    file: location.file,
    line: location.line,
    column: location.column,
    code: clean(finding?.code) || clean(section?.id) || "tooling",
    severity: clean(finding?.severity) || "warning",
    message: clean(finding?.message),
    coverageGap: isCoverageGap(finding),
  };
}

function findingEvidence(finding) {
  const loc = finding.file
    ? `${finding.file}${finding.line ? `:${finding.line}` : ""}${finding.column ? `:${finding.column}` : ""}`
    : finding.tool;
  return `${loc} ${finding.code}: ${finding.message}`.trim();
}

function taskFor(section, findings) {
  const toolId = clean(section.id);
  const files = Array.from(new Set(findings.map((finding) => finding.file).filter(Boolean)));
  return {
    title: `[ops-tooling] Review ${toolId} findings`,
    labels: ["ops", "reliability", "cleanup"],
    priority: findings.some((finding) => finding.code === "SC2115") ? "P1" : "P2",
    owner: "Codex",
    approvalRequired: false,
    problem: `${toolId} produced ${findings.length} actionable finding(s) in the latest tooling-quality report.`,
    evidence: findings.map(findingEvidence),
    proposedFix: "Review the finding(s), make the smallest safe code/doc change, and rerun the targeted validator.",
    acceptanceCriteria: [
      "The targeted validator no longer reports the finding, or the finding is documented as an intentional false positive.",
      "The fix is covered by existing focused tests or a small new regression test when behavior changes.",
      "No generated ops artifact prints secrets, tokens, or raw environment values.",
    ],
    safetyNotes: [
      "Report-only task; no host, Docker, database, package, or firewall mutation is implied.",
      "Rollback is a normal git revert of the small fixing PR.",
    ],
    suggestedBranchName: `codex/ops-tooling-${toolId}-findings`,
    suggestedPrTitle: `[ops] Address ${toolId} tooling findings`,
    files,
  };
}

function buildReport(options = {}) {
  const generatedAt = nowIso();
  const reportPath = options.toolingReport || DEFAULT_TOOLING_REPORT;
  const sourceReport = options.reportObject || readJson(reportPath);
  const sections = sectionsFrom(sourceReport);
  const findings = sections.flatMap((section) =>
    (Array.isArray(section.findings) ? section.findings : []).map((finding) => normalizeFinding(section, finding)));
  const actionable = findings.filter((finding) => !finding.coverageGap);
  const coverageGaps = findings.filter((finding) => finding.coverageGap);
  const tasks = sections
    .map((section) => {
      const sectionFindings = actionable.filter((finding) => finding.toolId === clean(section.id));
      return sectionFindings.length ? taskFor(section, sectionFindings) : null;
    })
    .filter(Boolean);
  const status = sourceReport ? (actionable.length || coverageGaps.length ? "warn" : "pass") : "warn";
  return {
    schema: "studiobrain-ops-tooling-findings-export.v1",
    generatedAt,
    status,
    readOnly: true,
    source: {
      toolingReportPath: repoRelative(reportPath),
      toolingReportGeneratedAt: sourceReport?.generatedAt || null,
      toolingReportStatus: sourceReport?.status || "unavailable",
    },
    summary: {
      sections: sections.length,
      findings: findings.length,
      actionableFindings: actionable.length,
      coverageGaps: coverageGaps.length,
      issueReadyTasks: tasks.length,
    },
    findings,
    tasks,
  };
}

function renderMarkdown(report) {
  const lines = [
    "# Studio Brain Tooling Findings Export",
    "",
    `Generated: ${report.generatedAt}`,
    `Status: ${report.status}`,
    `Source: ${report.source.toolingReportPath}`,
    "",
    "## Summary",
    "",
    `- Findings: ${report.summary.findings}`,
    `- Actionable findings: ${report.summary.actionableFindings}`,
    `- Coverage gaps: ${report.summary.coverageGaps}`,
    `- Issue-ready tasks: ${report.summary.issueReadyTasks}`,
    "",
  ];
  if (report.tasks.length === 0) {
    lines.push("No issue-ready tooling findings were found.", "");
    return `${lines.join("\n")}\n`;
  }
  lines.push("## Issue-Ready Tasks", "");
  for (const task of report.tasks) {
    lines.push(`### ${task.title}`, "");
    lines.push("Labels: " + task.labels.join(", "));
    lines.push(`Priority: ${task.priority}`);
    lines.push(`Owner: ${task.owner}`);
    lines.push(`Approval required: ${task.approvalRequired ? "yes" : "no"}`, "");
    lines.push("## Problem", task.problem, "");
    lines.push("## Evidence");
    for (const item of task.evidence) lines.push(`- ${item}`);
    lines.push("", "## Proposed Fix", task.proposedFix, "");
    lines.push("## Acceptance Criteria");
    for (const item of task.acceptanceCriteria) lines.push(`- ${item}`);
    lines.push("", "## Safety Notes");
    for (const item of task.safetyNotes) lines.push(`- ${item}`);
    lines.push("", `Suggested branch: \`${task.suggestedBranchName}\``);
    lines.push(`Suggested PR: \`${task.suggestedPrTitle}\``, "");
  }
  return `${lines.join("\n")}\n`;
}

function writeArtifact(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf8");
}

function run(rawArgs = process.argv.slice(2)) {
  const options = parseArgs(rawArgs);
  const report = buildReport(options);
  const stamp = report.generatedAt.replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const jsonPath = resolve(options.outputDir, `tooling-findings-${stamp}.json`);
  const markdownPath = resolve(options.outputDir, `tooling-findings-${stamp}.md`);
  const latestJson = resolve(options.outputDir, "tooling-findings-latest.json");
  const latestMarkdown = resolve(options.outputDir, "tooling-findings-latest.md");
  if (options.write) {
    writeArtifact(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
    writeArtifact(markdownPath, renderMarkdown(report));
    writeArtifact(latestJson, `${JSON.stringify({ ...report, artifactPath: repoRelative(jsonPath), markdownPath: repoRelative(markdownPath) }, null, 2)}\n`);
    writeArtifact(latestMarkdown, renderMarkdown(report));
  }
  const output = options.write
    ? { ...report, artifacts: { jsonPath: repoRelative(jsonPath), latestPath: repoRelative(latestJson), markdownPath: repoRelative(markdownPath), latestMarkdownPath: repoRelative(latestMarkdown) } }
    : report;
  if (options.json) process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  else {
    process.stdout.write(`tooling findings export: ${report.status}\n`);
    process.stdout.write(`tasks: ${report.summary.issueReadyTasks}\n`);
    if (options.write) process.stdout.write(`artifact: ${repoRelative(jsonPath)}\n`);
  }
  return output;
}

export { buildReport, normalizeFinding, renderMarkdown };

if (process.argv[1] && resolve(process.argv[1]) === __filename) {
  try {
    run();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
