#!/usr/bin/env node

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

function parseArgs(argv) {
  const parsed = {
    governanceRoot: ".governance",
    reportPath: "output/governance/validate-governance-artifacts.json"
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = String(argv[i] || "");
    if (!arg) continue;
    if ((arg === "--governance-root" || arg === "--root") && argv[i + 1]) {
      parsed.governanceRoot = String(argv[i + 1]);
      i += 1;
      continue;
    }
    if ((arg === "--report" || arg === "--artifact") && argv[i + 1]) {
      parsed.reportPath = String(argv[i + 1]);
      i += 1;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      process.stdout.write(
        [
          "Governance artifact validator",
          "",
          "Usage:",
          "  node ./scripts/governance/validate-governance-artifacts.mjs [options]",
          "",
          "Options:",
          "  --governance-root <path>  Governance root directory (default: .governance)",
          "  --report <path>           Validation report output path"
        ].join("\n")
      );
      process.exit(0);
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return parsed;
}

function readJson(filePath) {
  const raw = readFileSync(filePath, "utf8");
  return JSON.parse(raw);
}

function normalizePath(pathValue) {
  return String(pathValue || "").replaceAll("\\", "/");
}

function pushFinding(findings, severity, type, file, message, details = null) {
  findings.push({
    severity,
    type,
    file: normalizePath(file),
    message,
    details
  });
}

function validateIntentInvariants(intentFile, intent, findings) {
  if (!Array.isArray(intent.success_criteria) || intent.success_criteria.length === 0) {
    pushFinding(findings, "error", "shape", intentFile, "success_criteria must be a non-empty array.");
    return;
  }

  const criterionIds = new Set();
  for (const [idx, criterion] of intent.success_criteria.entries()) {
    const prefix = `success_criteria[${idx}]`;
    if (!criterion || typeof criterion !== "object") {
      pushFinding(findings, "error", "shape", intentFile, `${prefix} must be an object.`);
      continue;
    }
    const id = String(criterion.id || "").trim();
    if (!id) {
      pushFinding(findings, "error", "required-field", intentFile, `${prefix}.id is required.`);
    } else {
      criterionIds.add(id);
    }
    if (!String(criterion.metric || "").trim()) {
      pushFinding(findings, "error", "measurable-criterion", intentFile, `${prefix}.metric is required.`);
    }
    if (!Object.hasOwn(criterion, "target")) {
      pushFinding(findings, "error", "measurable-criterion", intentFile, `${prefix}.target is required.`);
    }
    if (!String(criterion.measurement_method || "").trim()) {
      pushFinding(
        findings,
        "error",
        "measurable-criterion",
        intentFile,
        `${prefix}.measurement_method is required.`
      );
    }
  }

  const budgets = intent.budgets || {};
  const budgetKeys = ["tokens", "runtime_minutes", "retries"];
  for (const key of budgetKeys) {
    const value = Number(budgets[key]);
    if (!Number.isFinite(value)) {
      pushFinding(findings, "error", "missing-budget", intentFile, `budgets.${key} must be set.`);
      continue;
    }
    if ((key === "retries" && value < 0) || (key !== "retries" && value <= 0)) {
      pushFinding(findings, "error", "invalid-budget", intentFile, `budgets.${key} has invalid value ${value}.`);
    }
  }

  if (!Array.isArray(intent.allowed_tools) || intent.allowed_tools.length === 0) {
    pushFinding(findings, "error", "missing-allowed-tools", intentFile, "allowed_tools must be non-empty.");
  }

  if (!Array.isArray(intent.required_evidence) || intent.required_evidence.length === 0) {
    pushFinding(findings, "error", "missing-required-evidence", intentFile, "required_evidence must be non-empty.");
  } else {
    const mappedCriteria = new Set();
    for (const [idx, row] of intent.required_evidence.entries()) {
      const criterionId = String(row?.criterion_id || "").trim();
      if (!criterionId) {
        pushFinding(findings, "error", "required-field", intentFile, `required_evidence[${idx}].criterion_id is required.`);
        continue;
      }
      mappedCriteria.add(criterionId);
    }
    for (const criterionId of criterionIds) {
      if (!mappedCriteria.has(criterionId)) {
        pushFinding(
          findings,
          "error",
          "evidence-mapping-gap",
          intentFile,
          `No required_evidence mapping found for success criterion "${criterionId}".`
        );
      }
    }
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const governanceRoot = resolve(REPO_ROOT, args.governanceRoot);
  const reportPath = resolve(REPO_ROOT, args.reportPath);
  const findings = [];

  const requiredPaths = [
    "schemas/intent-contract.v1.schema.json",
    "schemas/plan-step.v1.schema.json",
    "schemas/evidence-record.v1.schema.json",
    "schemas/audit-event.v1.schema.json",
    "schemas/run-ledger.v1.schema.json",
    "schemas/agent-capability-manifest.v1.schema.json",
    "config/supervisor-thresholds.json",
    "config/authority-map.json",
    "customer-service-policies/policy-program.json",
    "customer-service-policies/policy-inventory.json",
    "customer-service-policies/policy-resolution-contract.json"
  ];

  for (const relativePath of requiredPaths) {
    const absolutePath = resolve(governanceRoot, relativePath);
    if (!existsSync(absolutePath)) {
      pushFinding(findings, "error", "missing-file", relativePath, "Required governance artifact is missing.");
      continue;
    }
    try {
      readJson(absolutePath);
    } catch (error) {
      pushFinding(
        findings,
        "error",
        "invalid-json",
        relativePath,
        "Artifact must be valid JSON.",
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  const intentDir = resolve(governanceRoot, "intents");
  const intentFiles = existsSync(intentDir)
    ? readdirSync(intentDir)
        .filter((file) => file.endsWith(".intent.json"))
        .sort()
    : [];

  if (intentFiles.length === 0) {
    pushFinding(findings, "error", "missing-intents", "intents/", "At least one governance intent is required.");
  }

  const customerServiceProgramPath = resolve(
    governanceRoot,
    "customer-service-policies",
    "policy-program.json"
  );
  if (existsSync(customerServiceProgramPath)) {
    const program = readJson(customerServiceProgramPath);
    if (!Array.isArray(program?.policies) || program.policies.length === 0) {
      pushFinding(
        findings,
        "error",
        "shape",
        "customer-service-policies/policy-program.json",
        "policies must be a non-empty array."
      );
    }
  }

  const customerServiceResolutionPath = resolve(
    governanceRoot,
    "customer-service-policies",
    "policy-resolution-contract.json"
  );
  if (existsSync(customerServiceResolutionPath)) {
    const resolution = readJson(customerServiceResolutionPath);
    if (!Array.isArray(resolution?.intents) || resolution.intents.length === 0) {
      pushFinding(
        findings,
        "error",
        "shape",
        "customer-service-policies/policy-resolution-contract.json",
        "intents must be a non-empty array."
      );
    }
  }

  for (const fileName of intentFiles) {
    const relativePath = `intents/${fileName}`;
    const absolutePath = resolve(intentDir, fileName);
    let intent;
    try {
      intent = readJson(absolutePath);
    } catch (error) {
      pushFinding(
        findings,
        "error",
        "invalid-json",
        relativePath,
        "Intent must be valid JSON.",
        error instanceof Error ? error.message : String(error)
      );
      continue;
    }
    validateIntentInvariants(relativePath, intent, findings);
  }

  const errors = findings.filter((row) => row.severity === "error").length;
  const warnings = findings.filter((row) => row.severity === "warning").length;
  const report = {
    status: errors > 0 ? "fail" : "pass",
    generatedAt: new Date().toISOString(),
    governanceRoot: normalizePath(args.governanceRoot),
    summary: {
      intentFiles: intentFiles.length,
      findings: findings.length,
      errors,
      warnings
    },
    findings
  };

  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  process.stdout.write(`governance-validate status: ${report.status}\n`);
  process.stdout.write(`intent files: ${intentFiles.length}\n`);
  process.stdout.write(`errors: ${errors} | warnings: ${warnings}\n`);
  process.stdout.write(`report: ${normalizePath(args.reportPath)}\n`);

  if (errors > 0) {
    process.exitCode = 1;
  }
}

try {
  main();
} catch (error) {
  process.stderr.write(`governance-validate failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}

