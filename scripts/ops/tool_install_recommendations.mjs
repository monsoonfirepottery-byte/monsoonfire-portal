#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), "..", "..");
const DEFAULT_OUTPUT_DIR = resolve(REPO_ROOT, "output", "ops", "effectivity");
const DEFAULT_INVENTORY = resolve(DEFAULT_OUTPUT_DIR, "installed-tool-inventory-latest.json");

const TOOL_PLANS = {
  shellcheck: {
    priority: "P1",
    acquisitionClass: "ephemeral-runner",
    validationCommand: "node scripts/ops/tooling_quality_report.mjs --mode shellcheck --allow-install --json --write",
    installCommand: null,
    approvalRequired: false,
    expectedBenefit: "Catches shell syntax and portability defects in Ubuntu-targeted ops scripts before they reach the host.",
    safetyNotes: "Uses the existing report-only gate; no shell files are modified."
  },
  sqlfluff: {
    priority: "P1",
    acquisitionClass: "ephemeral-runner",
    validationCommand: "node scripts/ops/tooling_quality_report.mjs --mode sqlfluff --allow-install --json --write",
    installCommand: null,
    approvalRequired: false,
    expectedBenefit: "Parses PostgreSQL inspection SQL before DBA packets are shipped.",
    safetyNotes: "Uses uv tool execution when available; no database connection or schema mutation occurs."
  },
  actionlint: {
    priority: "P2",
    acquisitionClass: "persistent-install",
    validationCommand: "node scripts/ops/tooling_quality_report.mjs --mode actionlint --allow-install --json --write",
    installCommand: "Install Go or actionlint on the local tooling lane, then rerun the validation command.",
    approvalRequired: false,
    expectedBenefit: "Finds invalid GitHub Actions workflow syntax and expressions before PR checks fail.",
    safetyNotes: "Keep report-only until it catches real workflow defects with tolerable noise."
  },
  docker: {
    priority: "P2",
    acquisitionClass: "remote-lane",
    validationCommand: "node scripts/ops/tooling_quality_report.mjs --mode compose-config --json --write",
    installCommand: "Run on a Docker-capable lane or install Docker Desktop only if compose validation becomes a repeated coverage gap.",
    approvalRequired: true,
    expectedBenefit: "Validates rendered Docker Compose config without starting services.",
    safetyNotes: "Do not start, restart, pull, prune, or mutate Docker resources as part of validation."
  },
  gitleaks: {
    priority: "P2",
    acquisitionClass: "not-yet-justified",
    validationCommand: "Add a report-only gitleaks mode before installing or requiring this tool.",
    installCommand: null,
    approvalRequired: false,
    expectedBenefit: "Would provide secret-exposure scanning for generated ops bundles and docs.",
    safetyNotes: "A report mode and redaction policy should exist before promotion."
  },
  shfmt: {
    priority: "P3",
    acquisitionClass: "not-yet-justified",
    validationCommand: "Add a report-only shfmt check before installing or requiring this tool.",
    installCommand: null,
    approvalRequired: false,
    expectedBenefit: "Would normalize shell script formatting after syntax and safety gates are stable.",
    safetyNotes: "Formatting should remain reviewable and should not mask behavioral changes."
  },
  make: {
    priority: "P3",
    acquisitionClass: "not-yet-justified",
    validationCommand: "Use npm/bash wrappers unless Make becomes a repeated operator friction point on Windows.",
    installCommand: null,
    approvalRequired: false,
    expectedBenefit: "Would make documented make ops-* commands directly runnable on this laptop.",
    safetyNotes: "Do not require Make on Windows until the command wrappers prove repeated value."
  }
};

function usage() {
  return `Studio Brain ops tool install recommendations

Usage:
  node scripts/ops/tool_install_recommendations.mjs [--json] [--write]

Options:
  --json                Print JSON.
  --write               Write timestamped/latest JSON and Markdown artifacts.
  --inventory <path>    Installed-tool inventory. Default: output/ops/effectivity/installed-tool-inventory-latest.json.
  --output-dir <path>   Artifact directory. Default: output/ops/effectivity.
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
    inventory: DEFAULT_INVENTORY,
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
    if (arg === "--inventory") {
      options.inventory = resolveRepoPath(argv[++index]);
      continue;
    }
    if (arg.startsWith("--inventory=")) {
      options.inventory = resolveRepoPath(arg.slice("--inventory=".length));
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

function toolPlan(tool) {
  return TOOL_PLANS[tool.name] || {
    priority: "P3",
    acquisitionClass: "not-yet-justified",
    validationCommand: "Add a report-only validator before installing or requiring this tool.",
    installCommand: null,
    approvalRequired: false,
    expectedBenefit: "No concrete repeated benefit has been measured yet.",
    safetyNotes: "Keep as observation until a coverage gap or actionable finding proves value."
  };
}

function reasonFor(tool, plan) {
  const effectivity = tool.effectivity || {};
  if ((effectivity.coverageGaps || 0) > 0) {
    return `${tool.name} has ${effectivity.coverageGaps} coverage gap(s) in the latest tooling report.`;
  }
  if (tool.status === "missing_optional") {
    return `${tool.name} is missing optional tooling, but has not yet produced a measured coverage gap.`;
  }
  return `${tool.name} is available; keep it report-only until usefulness is measured.`;
}

function recommendationFor(tool) {
  const effectivity = tool.effectivity || {};
  const plan = toolPlan(tool);
  const hasCoverageGap = (effectivity.coverageGaps || 0) > 0;
  const missingOptional = tool.status === "missing_optional";
  if (!hasCoverageGap && !missingOptional) return null;
  return {
    tool: tool.name,
    priority: hasCoverageGap ? plan.priority : "P3",
    acquisitionClass: plan.acquisitionClass,
    currentStatus: tool.status,
    coverageGaps: effectivity.coverageGaps || 0,
    actionableFindings: effectivity.actionableFindings || 0,
    reason: reasonFor(tool, plan),
    expectedBenefit: plan.expectedBenefit,
    validationCommand: plan.validationCommand,
    installCommand: plan.installCommand,
    approvalRequired: Boolean(plan.approvalRequired),
    destructive: false,
    safetyNotes: plan.safetyNotes
  };
}

function sortRecommendations(left, right) {
  const priority = { P0: 0, P1: 1, P2: 2, P3: 3 };
  const classRank = { "ephemeral-runner": 0, "persistent-install": 1, "remote-lane": 2, "not-yet-justified": 3 };
  return (priority[left.priority] - priority[right.priority])
    || (classRank[left.acquisitionClass] - classRank[right.acquisitionClass])
    || left.tool.localeCompare(right.tool);
}

function buildReport(options = {}) {
  const generatedAt = nowIso();
  const inventoryPath = options.inventory || DEFAULT_INVENTORY;
  const inventory = options.inventoryObject || readJson(inventoryPath);
  const tools = Array.isArray(inventory?.tools) ? inventory.tools : [];
  const recommendations = tools
    .map(recommendationFor)
    .filter(Boolean)
    .sort(sortRecommendations);
  const coverageGapCount = recommendations.reduce((sum, item) => sum + item.coverageGaps, 0);
  const approvalRequired = recommendations.filter((item) => item.approvalRequired).length;
  const installNowCandidates = recommendations.filter((item) => item.acquisitionClass === "ephemeral-runner" && !item.approvalRequired && item.coverageGaps > 0).length;
  return {
    schema: "studiobrain-ops-tool-install-recommendations.v1",
    generatedAt,
    status: inventory?.schema ? (recommendations.length ? "warn" : "pass") : "warn",
    readOnly: true,
    source: {
      inventoryPath: repoRelative(inventoryPath),
      inventoryGeneratedAt: inventory?.generatedAt || null,
      inventoryStatus: inventory?.status || "unavailable"
    },
    summary: {
      recommendations: recommendations.length,
      coverageGaps: coverageGapCount,
      approvalRequired,
      installNowCandidates
    },
    recommendations
  };
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function renderMarkdown(report) {
  const lines = [
    "# Studio Brain Ops Tool Install Recommendations",
    "",
    `Generated: ${report.generatedAt}`,
    `Status: ${report.status}`,
    `Inventory: ${report.source.inventoryPath}`,
    "",
    "## Summary",
    "",
    `- Recommendations: ${report.summary.recommendations}`,
    `- Coverage gaps: ${report.summary.coverageGaps}`,
    `- Approval required: ${report.summary.approvalRequired}`,
    `- Install-now candidates: ${report.summary.installNowCandidates}`,
    "",
    "## Recommendations",
    ""
  ];
  if (report.recommendations.length === 0) {
    lines.push("No missing-tool recommendations from the latest inventory.");
  }
  for (const item of report.recommendations) {
    lines.push(`### ${item.priority} ${item.tool}`);
    lines.push("");
    lines.push(`- Class: ${item.acquisitionClass}`);
    lines.push(`- Current status: ${item.currentStatus}`);
    lines.push(`- Coverage gaps: ${item.coverageGaps}`);
    lines.push(`- Actionable findings: ${item.actionableFindings}`);
    lines.push(`- Approval required: ${item.approvalRequired ? "yes" : "no"}`);
    lines.push(`- Reason: ${item.reason}`);
    lines.push(`- Expected benefit: ${item.expectedBenefit}`);
    lines.push(`- Validation command: \`${item.validationCommand}\``);
    if (item.installCommand) lines.push(`- Install path: ${item.installCommand}`);
    lines.push(`- Safety notes: ${item.safetyNotes}`);
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

function writeArtifacts(report, outputDir) {
  const timestamp = report.generatedAt.replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const jsonPath = resolve(outputDir, `tool-install-recommendations-${timestamp}.json`);
  const markdownPath = resolve(outputDir, `tool-install-recommendations-${timestamp}.md`);
  writeJson(jsonPath, report);
  writeJson(resolve(outputDir, "tool-install-recommendations-latest.json"), { ...report, artifactPath: repoRelative(jsonPath) });
  mkdirSync(dirname(markdownPath), { recursive: true });
  writeFileSync(markdownPath, renderMarkdown(report), "utf8");
  writeFileSync(resolve(outputDir, "tool-install-recommendations-latest.md"), renderMarkdown(report), "utf8");
  return { jsonPath, markdownPath };
}

function main(argv = process.argv.slice(2)) {
  try {
    const options = parseArgs(argv);
    const report = buildReport(options);
    if (options.write) {
      report.artifacts = Object.fromEntries(Object.entries(writeArtifacts(report, options.outputDir)).map(([key, value]) => [key, value]));
    }
    if (options.json || !options.write) {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    } else {
      process.stdout.write(`tool install recommendations: ${report.status}, recommendations=${report.summary.recommendations}\n`);
    }
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
}

export {
  buildReport,
  main,
  parseArgs,
  recommendationFor
};

if (process.argv[1] && resolve(process.argv[1]) === __filename) {
  main();
}
