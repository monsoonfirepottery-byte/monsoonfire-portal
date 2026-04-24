#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..");
const DEFAULT_MANIFEST = "config/codex-app-automations.json";
const DEFAULT_ARTIFACT = "output/codex-app-automations/latest.json";
const VALID_RISK_LANES = new Set(["interactive", "background", "high_risk"]);
const VALID_APPROVAL_POLICIES = new Set([
  "no_approval",
  "auto_review_ok",
  "human_required",
  "human_required_for_mutation",
]);

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}

function parseArgs(argv) {
  const parsed = {
    json: false,
    strict: false,
    manifest: DEFAULT_MANIFEST,
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
    if (arg === "--manifest" && argv[index + 1]) {
      parsed.manifest = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg.startsWith("--manifest=")) {
      parsed.manifest = arg.slice("--manifest=".length);
      continue;
    }
    if (arg === "--artifact" && argv[index + 1]) {
      parsed.artifact = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg.startsWith("--artifact=")) {
      parsed.artifact = arg.slice("--artifact=".length);
    }
  }
  return parsed;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function readPackageScripts(repoRoot) {
  try {
    const pkg = readJson(resolve(repoRoot, "package.json"));
    return pkg && typeof pkg.scripts === "object" && pkg.scripts ? pkg.scripts : {};
  } catch {
    return {};
  }
}

function extractNpmRunScripts(command) {
  const scripts = [];
  const pattern = /\bnpm\s+run(?:\s+--silent)?\s+([^\s&|]+)/g;
  for (const match of command.matchAll(pattern)) {
    const scriptName = clean(match[1]);
    if (scriptName) scripts.push(scriptName);
  }
  return scripts;
}

function pushFinding(findings, severity, automationId, message, details = {}) {
  findings.push({
    severity,
    automationId: clean(automationId) || null,
    message,
    details,
  });
}

export function auditCodexAppAutomations({
  repoRoot = REPO_ROOT,
  manifestPath = DEFAULT_MANIFEST,
  artifact = DEFAULT_ARTIFACT,
  strict = false,
} = {}) {
  const absoluteManifestPath = resolve(repoRoot, manifestPath);
  const artifactPath = resolve(repoRoot, artifact);
  const findings = [];
  let manifest = null;

  if (!existsSync(absoluteManifestPath)) {
    pushFinding(findings, "error", null, `Automation manifest is missing: ${manifestPath}`);
  } else {
    manifest = readJson(absoluteManifestPath);
  }

  if (manifest && manifest.schema !== "codex-app-automation-manifest.v1") {
    pushFinding(findings, "error", null, `Unexpected automation manifest schema: ${manifest.schema || "missing"}`);
  }

  const automations = Array.isArray(manifest?.automations) ? manifest.automations : [];
  const packageScripts = readPackageScripts(repoRoot);
  if (manifest && automations.length === 0) {
    pushFinding(findings, "error", null, "Automation manifest must include at least one automation.");
  }

  const seenIds = new Set();
  const seenDedupeKeys = new Set();
  for (const automation of automations) {
    const automationId = clean(automation?.automationId);
    const title = clean(automation?.title);
    const schedule = clean(automation?.schedule);
    const command = clean(automation?.command);
    const riskLane = clean(automation?.riskLane);
    const approvalPolicy = clean(automation?.approvalPolicy);
    const dedupeKey = clean(automation?.dedupeKey);
    const requiredArtifacts = Array.isArray(automation?.requiredArtifacts) ? automation.requiredArtifacts : [];
    const successCriteria = Array.isArray(automation?.successCriteria) ? automation.successCriteria : [];

    if (!automationId) {
      pushFinding(findings, "error", null, "Automation is missing automationId.");
      continue;
    }
    if (seenIds.has(automationId)) pushFinding(findings, "error", automationId, `Duplicate automationId: ${automationId}`);
    seenIds.add(automationId);
    if (!title) pushFinding(findings, "error", automationId, "Automation is missing title.");
    if (!schedule) pushFinding(findings, "error", automationId, "Automation is missing schedule.");
    if (!command) pushFinding(findings, "error", automationId, "Automation is missing command.");
    for (const scriptName of extractNpmRunScripts(command)) {
      if (!packageScripts[scriptName]) {
        pushFinding(findings, "error", automationId, `Automation command references missing npm script: ${scriptName}`);
      }
    }
    if (!VALID_RISK_LANES.has(riskLane)) {
      pushFinding(findings, "error", automationId, `Automation has invalid riskLane: ${riskLane || "missing"}`);
    }
    if (!VALID_APPROVAL_POLICIES.has(approvalPolicy)) {
      pushFinding(findings, "error", automationId, `Automation has invalid approvalPolicy: ${approvalPolicy || "missing"}`);
    }
    if (!dedupeKey) {
      pushFinding(findings, "error", automationId, "Automation is missing dedupeKey.");
    } else if (seenDedupeKeys.has(dedupeKey)) {
      pushFinding(findings, "error", automationId, `Duplicate dedupeKey: ${dedupeKey}`);
    }
    seenDedupeKeys.add(dedupeKey);
    if (requiredArtifacts.length === 0) {
      pushFinding(findings, "warning", automationId, "Automation does not declare required artifacts.");
    }
    if (successCriteria.length === 0) {
      pushFinding(findings, "warning", automationId, "Automation does not declare success criteria.");
    }
    if (/deploy|apply|send|cleanup/i.test(command) && !/human_required/i.test(approvalPolicy)) {
      pushFinding(
        findings,
        "warning",
        automationId,
        "Command appears mutating but approval policy is not human_required.",
        { command, approvalPolicy },
      );
    }
  }

  const errors = findings.filter((finding) => finding.severity === "error").length;
  const warnings = findings.filter((finding) => finding.severity === "warning").length;
  const status = errors > 0 || (strict && warnings > 0) ? "fail" : warnings > 0 ? "warn" : "pass";
  const report = {
    schema: "codex-app-automation-audit.v1",
    generatedAt: new Date().toISOString(),
    strict,
    status,
    manifestPath: absoluteManifestPath,
    artifactPath,
    summary: {
      automations: automations.length,
      errors,
      warnings,
    },
    findings,
    automations: automations.map((automation) => ({
      automationId: clean(automation.automationId),
      title: clean(automation.title),
      schedule: clean(automation.schedule),
      command: clean(automation.command),
      riskLane: clean(automation.riskLane),
      approvalPolicy: clean(automation.approvalPolicy),
      dedupeKey: clean(automation.dedupeKey),
    })),
  };

  mkdirSync(dirname(artifactPath), { recursive: true });
  writeFileSync(artifactPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return report;
}

function printHumanSummary(report) {
  process.stdout.write("Codex app automation audit\n");
  process.stdout.write(`  status: ${report.status}\n`);
  process.stdout.write(`  automations: ${report.summary.automations}\n`);
  process.stdout.write(`  errors: ${report.summary.errors}\n`);
  process.stdout.write(`  warnings: ${report.summary.warnings}\n`);
  process.stdout.write(`  artifact: ${report.artifactPath}\n`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const report = auditCodexAppAutomations({
    manifestPath: args.manifest,
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
