#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..");
const DEFAULT_POLICY = "config/codex-plugin-policy.json";
const DEFAULT_ARTIFACT = "output/codex-plugin-policy/latest.json";

const VALID_WRITE_POLICIES = new Set([
  "read_only",
  "artifact_only",
  "explicit_confirmation",
  "explicit_approval_for_mutation",
  "memory_write_guarded",
]);
const VALID_MEMORY_INGRESS = new Set(["forbidden", "redacted_only", "artifact_summary_only", "allowed"]);
const VALID_APPROVAL_POLICIES = new Set([
  "no_approval",
  "auto_review_ok",
  "human_required",
  "human_required_for_mutation",
]);
const SENSITIVE_CATEGORIES = new Set(["mailbox", "calendar"]);

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}

function parseArgs(argv) {
  const parsed = {
    json: false,
    strict: false,
    policyPath: DEFAULT_POLICY,
    artifact: DEFAULT_ARTIFACT,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = clean(argv[index]);
    if (!arg) continue;
    if (arg === "--json") {
      parsed.json = true;
      continue;
    }
    if (arg === "--strict") {
      parsed.strict = true;
      continue;
    }
    if (arg === "--policy" && argv[index + 1]) {
      parsed.policyPath = clean(argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg.startsWith("--policy=")) {
      parsed.policyPath = clean(arg.slice("--policy=".length));
      continue;
    }
    if (arg === "--artifact" && argv[index + 1]) {
      parsed.artifact = clean(argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg.startsWith("--artifact=")) {
      parsed.artifact = clean(arg.slice("--artifact=".length));
    }
  }
  return parsed;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function pushFinding(findings, severity, pluginId, message, details = {}) {
  findings.push({
    severity,
    pluginId: clean(pluginId) || null,
    message,
    details,
  });
}

export function auditCodexPluginPolicy({
  repoRoot = REPO_ROOT,
  policyPath = DEFAULT_POLICY,
  artifact = DEFAULT_ARTIFACT,
  strict = false,
} = {}) {
  const absolutePolicyPath = resolve(repoRoot, policyPath);
  const artifactPath = resolve(repoRoot, artifact);
  const findings = [];
  let policy = null;

  if (!existsSync(absolutePolicyPath)) {
    pushFinding(findings, "error", null, `Plugin policy is missing: ${policyPath}`);
  } else {
    policy = readJson(absolutePolicyPath);
  }

  if (policy && policy.schema !== "codex-plugin-boundary-policy.v1") {
    pushFinding(findings, "error", null, `Unexpected plugin policy schema: ${policy.schema || "missing"}`);
  }

  const plugins = Array.isArray(policy?.plugins) ? policy.plugins : [];
  if (policy && plugins.length === 0) {
    pushFinding(findings, "error", null, "Plugin policy must include at least one plugin boundary.");
  }

  const seen = new Set();
  for (const plugin of plugins) {
    const pluginId = clean(plugin?.pluginId);
    const connectorId = clean(plugin?.connectorId);
    const category = clean(plugin?.category);
    const allowedTasks = Array.isArray(plugin?.allowedTasks) ? plugin.allowedTasks.map(clean).filter(Boolean) : [];
    const forbiddenData = Array.isArray(plugin?.forbiddenData) ? plugin.forbiddenData.map(clean).filter(Boolean) : [];
    const writePolicy = clean(plugin?.writePolicy || policy?.defaults?.writePolicy);
    const memoryIngress = clean(plugin?.memoryIngress || policy?.defaults?.memoryIngress);
    const approvalPolicy = clean(plugin?.approvalPolicy);

    if (!pluginId) {
      pushFinding(findings, "error", null, "Plugin boundary is missing pluginId.");
      continue;
    }
    if (seen.has(pluginId)) pushFinding(findings, "error", pluginId, `Duplicate pluginId: ${pluginId}`);
    seen.add(pluginId);
    if (!connectorId) pushFinding(findings, "error", pluginId, "Plugin boundary is missing connectorId.");
    if (!category) pushFinding(findings, "error", pluginId, "Plugin boundary is missing category.");
    if (allowedTasks.length === 0) pushFinding(findings, "error", pluginId, "Plugin boundary is missing allowedTasks.");
    if (forbiddenData.length === 0) pushFinding(findings, "warning", pluginId, "Plugin boundary does not declare forbiddenData.");
    if (!VALID_WRITE_POLICIES.has(writePolicy)) {
      pushFinding(findings, "error", pluginId, `Invalid writePolicy: ${writePolicy || "missing"}`);
    }
    if (!VALID_MEMORY_INGRESS.has(memoryIngress)) {
      pushFinding(findings, "error", pluginId, `Invalid memoryIngress: ${memoryIngress || "missing"}`);
    }
    if (!VALID_APPROVAL_POLICIES.has(approvalPolicy)) {
      pushFinding(findings, "error", pluginId, `Invalid approvalPolicy: ${approvalPolicy || "missing"}`);
    }
    if (SENSITIVE_CATEGORIES.has(category) && memoryIngress === "allowed") {
      pushFinding(findings, "warning", pluginId, "Sensitive connector should use redacted_only or forbidden memory ingress.");
    }
    if (/mutation|confirmation|memory_write/.test(writePolicy) && approvalPolicy === "no_approval") {
      pushFinding(findings, "warning", pluginId, "Mutating plugin boundary should not use no_approval.");
    }
  }

  const errors = findings.filter((finding) => finding.severity === "error").length;
  const warnings = findings.filter((finding) => finding.severity === "warning").length;
  const status = errors > 0 || (strict && warnings > 0) ? "fail" : warnings > 0 ? "warn" : "pass";
  const report = {
    schema: "codex-plugin-policy-audit.v1",
    generatedAt: new Date().toISOString(),
    strict,
    status,
    policyPath: absolutePolicyPath,
    artifactPath,
    summary: {
      plugins: plugins.length,
      errors,
      warnings,
    },
    findings,
    plugins: plugins.map((plugin) => ({
      pluginId: clean(plugin.pluginId),
      connectorId: clean(plugin.connectorId),
      category: clean(plugin.category),
      writePolicy: clean(plugin.writePolicy || policy?.defaults?.writePolicy),
      memoryIngress: clean(plugin.memoryIngress || policy?.defaults?.memoryIngress),
      approvalPolicy: clean(plugin.approvalPolicy),
    })),
  };

  mkdirSync(dirname(artifactPath), { recursive: true });
  writeFileSync(artifactPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return report;
}

function printHumanSummary(report) {
  process.stdout.write("Codex plugin policy audit\n");
  process.stdout.write(`  status: ${report.status}\n`);
  process.stdout.write(`  plugins: ${report.summary.plugins}\n`);
  process.stdout.write(`  errors: ${report.summary.errors}\n`);
  process.stdout.write(`  warnings: ${report.summary.warnings}\n`);
  process.stdout.write(`  artifact: ${report.artifactPath}\n`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const report = auditCodexPluginPolicy({
    policyPath: args.policyPath,
    artifact: args.artifact,
    strict: args.strict,
  });
  if (args.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    printHumanSummary(report);
  }
  if (report.status === "fail") process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === __filename) {
  main();
}
