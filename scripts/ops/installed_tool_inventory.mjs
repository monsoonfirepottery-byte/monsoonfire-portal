#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), "..", "..");
const DEFAULT_OUTPUT_DIR = resolve(REPO_ROOT, "output", "ops", "effectivity");
const DEFAULT_LATEST = resolve(DEFAULT_OUTPUT_DIR, "installed-tool-inventory-latest.json");
const DEFAULT_TOOLING_QUALITY_REPORT = resolve(REPO_ROOT, "output", "ops", "tooling-quality", "tooling-quality-latest.json");

const TOOL_PROBES = [
  { name: "node", required: true, versionArgs: ["--version"], note: "Node scripts power the admin harness." },
  { name: "npm", required: true, versionArgs: ["--version"], note: "Package scripts and npx-based validators." },
  { name: "git", required: true, versionArgs: ["--version"], note: "Review surface and branch/PR workflow." },
  { name: "bash", required: true, versionArgs: ["--version"], note: "Ubuntu-targeted ops scripts." },
  { name: "ssh", required: true, versionArgs: ["-V"], note: "Read-only host probes and artifact capture." },
  { name: "gh", required: false, versionArgs: ["--version"], note: "PR and issue automation." },
  { name: "curl", required: false, versionArgs: ["--version"], note: "HTTP health probes." },
  { name: "psql", required: false, versionArgs: ["--version"], note: "Direct PostgreSQL read-only packets." },
  { name: "docker", required: false, versionArgs: ["--version"], note: "Docker inventory and compose validation." },
  { name: "make", required: false, versionArgs: ["--version"], note: "Operator command router." },
  { name: "pwsh", required: false, versionArgs: ["--version"], note: "PowerShell script analysis and Windows bridge checks." },
  { name: "powershell", required: false, versionArgs: ["-NoProfile", "-Command", "$PSVersionTable.PSVersion.ToString()"], note: "Windows fallback for watcher checks." },
  { name: "npx", required: false, versionArgs: ["--version"], note: "Portable one-off validators." },
  { name: "python", required: false, versionArgs: ["--version"], note: "Existing host automation scripts." },
  { name: "uv", required: false, versionArgs: ["--version"], note: "Portable Python tooling runner." },
  { name: "shellcheck", required: false, versionArgs: ["--version"], note: "Shell script linting; recommended next install." },
  { name: "gitleaks", required: false, versionArgs: ["version"], note: "Secret scanning." },
  { name: "sqlfluff", required: false, versionArgs: ["--version"], note: "PostgreSQL SQL parser/linter." },
  { name: "actionlint", required: false, versionArgs: ["--version"], note: "GitHub Actions workflow validation." },
  { name: "shfmt", required: false, versionArgs: ["--version"], note: "Shell formatter." }
];

function usage() {
  return `Studio Brain installed tool inventory

Usage:
  node scripts/ops/installed_tool_inventory.mjs [--json] [--write] [--output-dir <path>] [--output <path>]

Options:
  --json              Print JSON to stdout.
  --write             Write timestamped and latest JSON artifacts. Default: no write.
  --output-dir <path> Artifact directory. Default: output/ops/effectivity.
  --output <path>     Exact JSON output path.
  --tooling-report <path>
                      Optional tooling-quality report for effectivity scoring.
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

function readJson(path) {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function whereCommand(command) {
  const executable = process.platform === "win32" ? "where" : "sh";
  const args = process.platform === "win32" ? [command] : ["-lc", `command -v ${shellQuote(command)}`];
  const result = spawnSync(executable, args, { encoding: "utf8", windowsHide: true });
  if (result.status !== 0) return [];
  return `${result.stdout || ""}${result.stderr || ""}`
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function commandVersion(command, args) {
  const invocation = commandInvocation(command, args);
  const result = spawnSync(invocation.command, invocation.args, { encoding: "utf8", windowsHide: true, timeout: 5000 });
  if (result.error || result.status !== 0) return null;
  return clean(`${result.stdout || ""}${result.stderr || ""}`.split(/\r?\n/).find(Boolean) || "");
}

function commandInvocation(command, args) {
  if (process.platform === "win32" && /\.(cmd|bat)$/i.test(command)) {
    return {
      command: process.env.ComSpec || "cmd.exe",
      args: ["/d", "/s", "/c", ["call", cmdQuote(command), ...args.map(cmdQuote)].join(" ")]
    };
  }
  return { command, args };
}

function cmdQuote(value) {
  const raw = String(value);
  if (/^[A-Za-z0-9_./:\\=+-]+$/.test(raw)) return raw;
  return `"${raw.replace(/"/g, '""')}"`;
}

function preferredExecutable(paths) {
  if (process.platform === "win32") {
    return paths.find((path) => /\.(exe|cmd|bat)$/i.test(path)) || paths[0] || null;
  }
  return paths[0] || null;
}

function probeTool(tool, effectivityByTool) {
  const paths = whereCommand(tool.name);
  const installed = paths.length > 0;
  const executable = installed ? preferredExecutable(paths) : null;
  const status = !installed
    ? (tool.required ? "missing_required" : "missing_optional")
    : paths.length > 1
      ? "shadowed"
      : "installed";
  return {
    name: tool.name,
    status,
    required: tool.required,
    path: executable,
    allPaths: paths,
    version: installed && executable ? commandVersion(executable, tool.versionArgs) : null,
    note: tool.note,
    effectivity: effectivityByTool[tool.name] || defaultToolEffectivity(status, tool.required)
  };
}

function parseArgs(argv) {
  const options = {
    json: false,
    write: false,
    outputDir: DEFAULT_OUTPUT_DIR,
    output: "",
    toolingReport: DEFAULT_TOOLING_QUALITY_REPORT
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
    if (arg === "--output-dir") {
      options.outputDir = resolveRepoPath(argv[++index]);
      continue;
    }
    if (arg.startsWith("--output-dir=")) {
      options.outputDir = resolveRepoPath(arg.slice("--output-dir=".length));
      continue;
    }
    if (arg === "--output") {
      options.output = resolveRepoPath(argv[++index]);
      continue;
    }
    if (arg.startsWith("--output=")) {
      options.output = resolveRepoPath(arg.slice("--output=".length));
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
    throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function declaredRegistrySummary() {
  const contracts = readJson(resolve(REPO_ROOT, "config", "agent-tool-contracts.json"));
  const primitives = readJson(resolve(REPO_ROOT, "config", "agent-tool-primitives.json"));
  return {
    contractToolCount: Array.isArray(contracts?.tools) ? contracts.tools.length : 0,
    primitiveFamilyCount: Array.isArray(primitives?.families) ? primitives.families.length : 0
  };
}

function defaultToolEffectivity(status, required) {
  return {
    observed: false,
    actionableFindings: 0,
    coverageGaps: 0,
    falsePositiveCount: 0,
    minutesSaved: 0,
    promotionState: required ? "required" : status === "missing_optional" ? "optional_missing" : "not_observed",
    evidence: []
  };
}

function effectivityFromToolingReport(report) {
  const sections = Array.isArray(report?.sections) ? report.sections : [];
  const byTool = {};
  const assign = (toolName, section) => {
    if (!section) return;
    const findings = Array.isArray(section.findings) ? section.findings : [];
    const coverageGaps = findings.filter((finding) => finding?.code === "tool_missing").length;
    const actionableFindings = findings.length - coverageGaps;
    byTool[toolName] = {
      observed: true,
      actionableFindings,
      coverageGaps,
      falsePositiveCount: 0,
      minutesSaved: actionableFindings > 0 ? Math.min(30, actionableFindings) : 0,
      promotionState: coverageGaps > 0 && actionableFindings === 0
        ? "coverage_gap"
        : section.status === "skipped"
          ? "optional_missing"
        : actionableFindings > 0
          ? "candidate"
          : "report_only",
      evidence: [`tooling-quality:${section.id}:${section.status}`]
    };
  };

  assign("node", sections.find((section) => section.id === "shell-lf"));
  assign("shellcheck", sections.find((section) => section.id === "shellcheck"));
  assign("pwsh", sections.find((section) => section.id === "powershell"));
  assign("powershell", sections.find((section) => section.id === "powershell"));
  assign("sqlfluff", sections.find((section) => section.id === "sqlfluff"));
  assign("actionlint", sections.find((section) => section.id === "actionlint"));
  assign("docker", sections.find((section) => section.id === "compose-config"));
  byTool.uv = runnerEffectivity("uv", sections.find((section) => section.id === "sqlfluff"));
  byTool.npx = runnerEffectivity("npx", sections.find((section) => section.id === "shellcheck"));
  return byTool;
}

function runnerEffectivity(toolName, section) {
  if (!section) return undefined;
  return {
    observed: true,
    actionableFindings: 0,
    coverageGaps: 0,
    falsePositiveCount: 0,
    minutesSaved: 0,
    promotionState: section.status === "skipped" ? "optional_missing" : "report_only",
    evidence: [`tooling-quality:${section.id}:${section.status}:runner:${toolName}`]
  };
}

function buildInventory(options = {}) {
  const toolingReport = readJson(options.toolingReport || DEFAULT_TOOLING_QUALITY_REPORT);
  const effectivityByTool = effectivityFromToolingReport(toolingReport);
  const tools = TOOL_PROBES.map((tool) => probeTool(tool, effectivityByTool));
  const summary = {
    installed: tools.filter((tool) => tool.status === "installed" || tool.status === "shadowed").length,
    missingRequired: tools.filter((tool) => tool.status === "missing_required").length,
    missingOptional: tools.filter((tool) => tool.status === "missing_optional").length,
    shadowed: tools.filter((tool) => tool.status === "shadowed").length,
    actionableFindings: tools.reduce((sum, tool) => sum + (tool.effectivity?.actionableFindings || 0), 0),
    coverageGaps: tools.reduce((sum, tool) => sum + (tool.effectivity?.coverageGaps || 0), 0),
    falsePositiveCount: tools.reduce((sum, tool) => sum + (tool.effectivity?.falsePositiveCount || 0), 0),
    minutesSaved: tools.reduce((sum, tool) => sum + (tool.effectivity?.minutesSaved || 0), 0),
    promotionCandidates: tools.filter((tool) => tool.effectivity?.promotionState === "candidate").length
  };
  return {
    schema: "studiobrain-installed-tool-inventory.v1",
    generatedAt: nowIso(),
    status: summary.missingRequired > 0 ? "fail" : summary.shadowed > 0 ? "warn" : "pass",
    summary,
    declaredRegistry: declaredRegistrySummary(),
    effectivitySource: toolingReport?.schema === "studiobrain-ops-tooling-quality-report.v1"
      ? {
          path: relative(REPO_ROOT, options.toolingReport || DEFAULT_TOOLING_QUALITY_REPORT).replace(/\\/g, "/"),
          generatedAt: toolingReport.generatedAt || null,
          status: toolingReport.status || "unknown"
        }
      : {
          path: relative(REPO_ROOT, options.toolingReport || DEFAULT_TOOLING_QUALITY_REPORT).replace(/\\/g, "/"),
          generatedAt: null,
          status: "unavailable"
        },
    tools
  };
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function main(argv = process.argv.slice(2)) {
  try {
    const options = parseArgs(argv);
    const inventory = buildInventory(options);
    if (options.write || options.output) {
      const timestamp = inventory.generatedAt.replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
      const outputPath = options.output || resolve(options.outputDir, `installed-tool-inventory-${timestamp}.json`);
      writeJson(outputPath, inventory);
      writeJson(resolve(dirname(outputPath), "installed-tool-inventory-latest.json"), { ...inventory, artifactPath: relative(REPO_ROOT, outputPath).replace(/\\/g, "/") });
    }
    if (options.json || !options.write) {
      process.stdout.write(`${JSON.stringify(inventory, null, 2)}\n`);
    } else {
      process.stdout.write(`installed tool inventory: ${inventory.status}, installed=${inventory.summary.installed}, missingRequired=${inventory.summary.missingRequired}\n`);
    }
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
}

export {
  buildInventory,
  effectivityFromToolingReport,
  main,
  parseArgs,
  probeTool
};

if (process.argv[1] && resolve(process.argv[1]) === __filename) {
  main();
}
