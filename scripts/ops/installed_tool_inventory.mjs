#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), "..", "..");
const DEFAULT_OUTPUT_DIR = resolve(REPO_ROOT, "output", "ops", "effectivity");
const DEFAULT_LATEST = resolve(DEFAULT_OUTPUT_DIR, "installed-tool-inventory-latest.json");

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
  const result = spawnSync(command, args, { encoding: "utf8", windowsHide: true, timeout: 5000 });
  if (result.error || result.status !== 0) return null;
  return clean(`${result.stdout || ""}${result.stderr || ""}`.split(/\r?\n/).find(Boolean) || "");
}

function probeTool(tool) {
  const paths = whereCommand(tool.name);
  const installed = paths.length > 0;
  const status = !installed
    ? (tool.required ? "missing_required" : "missing_optional")
    : paths.length > 1
      ? "shadowed"
      : "installed";
  return {
    name: tool.name,
    status,
    required: tool.required,
    path: paths[0] ?? null,
    allPaths: paths,
    version: installed ? commandVersion(tool.name, tool.versionArgs) : null,
    note: tool.note
  };
}

function parseArgs(argv) {
  const options = {
    json: false,
    write: false,
    outputDir: DEFAULT_OUTPUT_DIR,
    output: ""
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

function buildInventory() {
  const tools = TOOL_PROBES.map(probeTool);
  const summary = {
    installed: tools.filter((tool) => tool.status === "installed" || tool.status === "shadowed").length,
    missingRequired: tools.filter((tool) => tool.status === "missing_required").length,
    missingOptional: tools.filter((tool) => tool.status === "missing_optional").length,
    shadowed: tools.filter((tool) => tool.status === "shadowed").length
  };
  return {
    schema: "studiobrain-installed-tool-inventory.v1",
    generatedAt: nowIso(),
    status: summary.missingRequired > 0 ? "fail" : summary.shadowed > 0 ? "warn" : "pass",
    summary,
    declaredRegistry: declaredRegistrySummary(),
    tools
  };
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

try {
  const options = parseArgs(process.argv.slice(2));
  const inventory = buildInventory();
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
