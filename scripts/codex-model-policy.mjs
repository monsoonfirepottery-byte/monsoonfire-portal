#!/usr/bin/env node

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_CODEX_MODEL_POLICY_PATH,
  loadCodexModelPolicy,
  resolveCodexModelPolicy,
  validateCodexModelPolicy,
} from "./lib/agent-harness-control-plane.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..");
const DEFAULT_ARTIFACT = "output/codex-model-policy/latest.json";

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}

function parseArgs(argv) {
  const parsed = {
    json: false,
    strict: false,
    policyPath: DEFAULT_CODEX_MODEL_POLICY_PATH,
    artifact: DEFAULT_ARTIFACT,
    role: "",
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
    if (arg === "--role" && argv[index + 1]) {
      parsed.role = clean(argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg.startsWith("--role=")) {
      parsed.role = clean(arg.slice("--role=".length));
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

export function buildCodexModelPolicyReport({
  repoRoot = REPO_ROOT,
  policyPath = DEFAULT_CODEX_MODEL_POLICY_PATH,
  artifact = DEFAULT_ARTIFACT,
  role = "",
  generatedAt = new Date().toISOString(),
  env = process.env,
} = {}) {
  const policyBundle = loadCodexModelPolicy(repoRoot, policyPath);
  const validation = validateCodexModelPolicy(policyBundle.policy);
  const resolved = resolveCodexModelPolicy(
    repoRoot,
    { policyPath, generatedAt },
    {
      policyBundle,
      env,
    },
  );
  const selectedRole = clean(role);
  const selection = selectedRole ? resolved.roles[selectedRole] || null : null;
  const findings = [...validation.findings];
  if (selectedRole && !selection) {
    findings.push({ severity: "error", message: `Unknown model policy role: ${selectedRole}.` });
  }
  const errors = findings.filter((finding) => finding.severity === "error").length;
  const artifactPath = resolve(repoRoot, artifact);
  const report = {
    schema: "codex-model-policy-report.v1",
    generatedAt,
    status: errors > 0 ? "fail" : "pass",
    policyPath: policyBundle.relativePath,
    artifactPath,
    summary: {
      roles: Object.keys(resolved.roles).length,
      errors,
    },
    findings,
    resolved,
    selection,
  };
  mkdirSync(dirname(artifactPath), { recursive: true });
  writeFileSync(artifactPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return report;
}

function printHumanSummary(report) {
  process.stdout.write("Codex model policy\n");
  process.stdout.write(`  status: ${report.status}\n`);
  process.stdout.write(`  standard: ${report.resolved.standard}\n`);
  process.stdout.write(`  planning: ${report.resolved.planning}\n`);
  process.stdout.write(`  hygiene: ${report.resolved.hygiene}\n`);
  if (report.selection) {
    process.stdout.write(`  selection: ${report.selection.model} (${report.selection.reasoningEffort})\n`);
  }
  process.stdout.write(`  artifact: ${report.artifactPath}\n`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const report = buildCodexModelPolicyReport({
    policyPath: args.policyPath,
    artifact: args.artifact,
    role: args.role,
  });
  if (args.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    printHumanSummary(report);
  }
  if (report.status === "fail" || (args.strict && report.findings.length > 0)) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === __filename) {
  main();
}
