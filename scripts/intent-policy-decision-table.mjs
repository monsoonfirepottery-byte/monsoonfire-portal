#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..");

function parseArgs(argv) {
  const parsed = {
    json: false,
    strict: false,
    policyPath: "config/intent-policy.json",
    artifact: "output/intent/policy-decision-table-report.json",
    environment: String(process.env.INTENT_ENVIRONMENT || "local").toLowerCase(),
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = String(argv[index] || "");
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
      parsed.policyPath = String(argv[index + 1]).trim();
      index += 1;
      continue;
    }
    if (arg.startsWith("--policy=")) {
      parsed.policyPath = arg.slice("--policy=".length).trim();
      continue;
    }
    if (arg === "--artifact" && argv[index + 1]) {
      parsed.artifact = String(argv[index + 1]).trim();
      index += 1;
      continue;
    }
    if (arg.startsWith("--artifact=")) {
      parsed.artifact = arg.slice("--artifact=".length).trim();
      continue;
    }
    if (arg === "--environment" && argv[index + 1]) {
      parsed.environment = String(argv[index + 1]).trim().toLowerCase();
      index += 1;
      continue;
    }
    if (arg.startsWith("--environment=")) {
      parsed.environment = arg.slice("--environment=".length).trim().toLowerCase();
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      process.stdout.write(
        [
          "Intent policy decision table check",
          "",
          "Usage:",
          "  node ./scripts/intent-policy-decision-table.mjs --json",
        ].join("\n")
      );
      process.exit(0);
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return parsed;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function normalizeWriteScope(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-");
}

function isMutableWriteScope(value) {
  const scope = normalizeWriteScope(value);
  return !["none", "artifact-only", "artifact_only", "read-only", "readonly", "unspecified", ""].includes(scope);
}

function matchesAny(text, patterns) {
  for (const pattern of patterns) {
    if (pattern.test(text)) return true;
  }
  return false;
}

function compilePatternList(rows) {
  if (!Array.isArray(rows)) return [];
  const compiled = [];
  for (const row of rows) {
    const pattern = String(row || "").trim();
    if (!pattern) continue;
    try {
      compiled.push(new RegExp(pattern, "i"));
    } catch {
      // Ignore invalid patterns.
    }
  }
  return compiled;
}

function evaluateScenario({ policy, environment, scenario }) {
  const runtimeControls = policy?.runtimeControls || {};
  const envIsolation = runtimeControls?.environmentIsolation || {};
  const disallowProdCommandsIn = new Set(
    Array.isArray(envIsolation.disallowProdCommandsIn) ? envIsolation.disallowProdCommandsIn : ["local", "staging"]
  );
  const prodPatterns = compilePatternList(envIsolation.prodCommandPatterns || policy.deployCommandPatterns || []);
  const forbiddenPatterns = compilePatternList(policy.forbiddenCommandPatterns || []);
  const destructivePatterns = compilePatternList(policy.destructiveCommandPatterns || []);
  const twoPhaseCommit = runtimeControls.twoPhaseCommit || {};
  const dryRunPattern = String(twoPhaseCommit.dryRunPattern || "--dry-run");

  if (runtimeControls.killSwitch === true && isMutableWriteScope(scenario.writeScope)) {
    return "block";
  }
  if (
    String(runtimeControls.brownoutMode || "off").toLowerCase() === "read_only_noncritical" &&
    isMutableWriteScope(scenario.writeScope) &&
    !["high", "critical"].includes(String(scenario.riskTier || "").toLowerCase())
  ) {
    return "block";
  }
  if (matchesAny(scenario.command, forbiddenPatterns)) {
    return "block";
  }
  if (disallowProdCommandsIn.has(environment) && matchesAny(scenario.command, prodPatterns)) {
    return "block";
  }
  if (
    twoPhaseCommit.enforceForDestructive === true &&
    matchesAny(scenario.command, destructivePatterns) &&
    !scenario.companionCommands.some((command) => command.includes(dryRunPattern) || /\b--dry-run\b/.test(command))
  ) {
    return "block";
  }
  return "allow";
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const policyAbsolutePath = resolve(REPO_ROOT, args.policyPath);
  const artifactAbsolutePath = resolve(REPO_ROOT, args.artifact);
  if (!existsSync(policyAbsolutePath)) {
    throw new Error(`Policy file not found: ${policyAbsolutePath}`);
  }

  const policy = readJson(policyAbsolutePath);
  const scenarios = [
    {
      id: "kill-switch-blocks-mutation",
      expected: "block",
      command: "npm run deploy:namecheap:portal",
      writeScope: "staff-portal-ui",
      riskTier: "medium",
      forcePolicy: { runtimeControls: { ...policy.runtimeControls, killSwitch: true } },
      companionCommands: [],
    },
    {
      id: "forbidden-command-blocked",
      expected: "block",
      command: "git reset --hard",
      writeScope: "none",
      riskTier: "low",
      forcePolicy: null,
      companionCommands: [],
    },
    {
      id: "env-isolation-blocks-prod-command",
      expected: "block",
      command: "npm run deploy:namecheap:portal",
      writeScope: "artifact-only",
      riskTier: "low",
      environment: "local",
      forcePolicy: null,
      companionCommands: [],
    },
    {
      id: "safe-read-command-allowed",
      expected: "allow",
      command: "npm run intent:validate:strict",
      writeScope: "none",
      riskTier: "low",
      forcePolicy: null,
      companionCommands: [],
    },
    {
      id: "destructive-command-requires-dry-run",
      expected: "block",
      command: "npx firebase-tools deploy --project monsoonfire-portal",
      writeScope: "external-api-readwrite-bounded",
      riskTier: "high",
      forcePolicy: null,
      companionCommands: ["npm run portal:pr:functional:gate"],
    },
  ];

  const findings = [];
  for (const scenario of scenarios) {
    const scenarioPolicy = scenario.forcePolicy
      ? { ...policy, ...scenario.forcePolicy, runtimeControls: scenario.forcePolicy.runtimeControls }
      : policy;
    const observed = evaluateScenario({
      policy: scenarioPolicy,
      environment: String(scenario.environment || args.environment || "local").toLowerCase(),
      scenario,
    });
    if (observed !== scenario.expected) {
      findings.push({
        severity: "error",
        code: "decision_table_mismatch",
        scenarioId: scenario.id,
        expected: scenario.expected,
        observed,
      });
    }
  }

  const status = findings.length === 0 ? "pass" : "fail";
  const report = {
    schema: "intent-policy-decision-table-report.v1",
    generatedAt: new Date().toISOString(),
    status,
    environment: args.environment,
    policyPath: args.policyPath,
    summary: {
      totalScenarios: scenarios.length,
      failures: findings.length,
    },
    findings,
  };

  mkdirSync(dirname(artifactAbsolutePath), { recursive: true });
  writeFileSync(artifactAbsolutePath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  if (args.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(`intent-policy-decision-table status: ${report.status}\n`);
    process.stdout.write(`report: ${artifactAbsolutePath}\n`);
  }

  if (status !== "pass") {
    process.exitCode = 1;
  }
}

try {
  main();
} catch (error) {
  process.stderr.write(`intent-policy-decision-table failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
