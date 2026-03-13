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
    planPath: "artifacts/intent-plan.generated.json",
    policyPath: "config/intent-policy.json",
    artifact: "output/intent/policy-gate-report.json",
    intentIds: [],
    environment: String(process.env.INTENT_ENVIRONMENT || "local").toLowerCase(),
    infraPhase: String(process.env.INTENT_INFRA_PHASE || "normal").toLowerCase(),
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

    if ((arg === "--plan" || arg === "--plan-path") && argv[index + 1]) {
      parsed.planPath = String(argv[index + 1]).trim();
      index += 1;
      continue;
    }
    if (arg.startsWith("--plan=")) {
      parsed.planPath = arg.slice("--plan=".length).trim();
      continue;
    }

    if ((arg === "--policy" || arg === "--policy-path") && argv[index + 1]) {
      parsed.policyPath = String(argv[index + 1]).trim();
      index += 1;
      continue;
    }
    if (arg.startsWith("--policy=")) {
      parsed.policyPath = arg.slice("--policy=".length).trim();
      continue;
    }

    if ((arg === "--artifact" || arg === "--report") && argv[index + 1]) {
      parsed.artifact = String(argv[index + 1]).trim();
      index += 1;
      continue;
    }
    if (arg.startsWith("--artifact=")) {
      parsed.artifact = arg.slice("--artifact=".length).trim();
      continue;
    }

    if (arg === "--intent-id" && argv[index + 1]) {
      parsed.intentIds.push(String(argv[index + 1]).trim());
      index += 1;
      continue;
    }
    if (arg.startsWith("--intent-id=")) {
      parsed.intentIds.push(arg.slice("--intent-id=".length).trim());
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

    if (arg === "--infra-phase" && argv[index + 1]) {
      parsed.infraPhase = String(argv[index + 1]).trim().toLowerCase();
      index += 1;
      continue;
    }
    if (arg.startsWith("--infra-phase=")) {
      parsed.infraPhase = arg.slice("--infra-phase=".length).trim().toLowerCase();
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      process.stdout.write(
        [
          "Intent policy gate",
          "",
          "Usage:",
          "  node ./scripts/intent-policy-gate.mjs [--plan artifacts/intent-plan.generated.json] [--json]",
          "",
          "Options:",
          "  --intent-id <id>    Restrict gate to one or more intent IDs",
          "  --policy <path>     Policy config path",
          "  --artifact <path>   Report output path",
          "  --environment <id>  Runtime environment (local|staging|production)",
          "  --infra-phase <id>  Infra phase (normal|ingestion)",
        ].join("\n")
      );
      process.exit(0);
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  parsed.intentIds = parsed.intentIds.filter(Boolean);
  if (!["normal", "ingestion"].includes(parsed.infraPhase)) {
    throw new Error("--infra-phase must be one of: normal, ingestion.");
  }
  return parsed;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeWriteScope(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-");
}

function isMutableWriteScope(value) {
  const scope = normalizeWriteScope(value);
  return !["", "none", "artifact-only", "artifact_only", "read-only", "readonly", "unspecified"].includes(scope);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const planAbsolutePath = resolve(REPO_ROOT, args.planPath);
  const policyAbsolutePath = resolve(REPO_ROOT, args.policyPath);
  const artifactAbsolutePath = resolve(REPO_ROOT, args.artifact);

  if (!existsSync(planAbsolutePath)) throw new Error(`Plan file not found: ${planAbsolutePath}`);
  if (!existsSync(policyAbsolutePath)) throw new Error(`Policy file not found: ${policyAbsolutePath}`);

  const plan = readJson(planAbsolutePath);
  const policy = readJson(policyAbsolutePath);
  const forbiddenPatterns = Array.isArray(policy.forbiddenCommandPatterns)
    ? policy.forbiddenCommandPatterns
        .filter((row) => typeof row === "string" && row.trim().length > 0)
        .map((row) => new RegExp(row, "i"))
    : [];
  const destructivePatterns = Array.isArray(policy.destructiveCommandPatterns)
    ? policy.destructiveCommandPatterns
        .filter((row) => typeof row === "string" && row.trim().length > 0)
        .map((row) => new RegExp(row, "i"))
    : [];
  const deployPatterns = Array.isArray(policy.deployCommandPatterns)
    ? policy.deployCommandPatterns
        .filter((row) => typeof row === "string" && row.trim().length > 0)
        .map((row) => new RegExp(row, "i"))
    : [];
  const allowedWriteScopes = new Set(
    Array.isArray(policy.allowedWriteScopes)
      ? policy.allowedWriteScopes.map((row) => normalizeWriteScope(row)).filter(Boolean)
      : []
  );
  const skipProviders = new Set(
    Array.isArray(policy.allowedProviderChecks?.skipProviders)
      ? policy.allowedProviderChecks.skipProviders.filter((row) => typeof row === "string" && row.trim().length > 0)
      : []
  );
  const runtimeControls = isPlainObject(policy.runtimeControls) ? policy.runtimeControls : {};
  const failOpenMatrix = isPlainObject(runtimeControls.failOpenMatrix) ? runtimeControls.failOpenMatrix : {};
  const killSwitch = runtimeControls.killSwitch === true;
  const brownoutMode = String(runtimeControls.brownoutMode || "off").toLowerCase();
  const environmentIsolation = isPlainObject(runtimeControls.environmentIsolation) ? runtimeControls.environmentIsolation : {};
  const enforceEnvIsolation = environmentIsolation.enforce !== false;
  const disallowProdCommandsIn = new Set(
    Array.isArray(environmentIsolation.disallowProdCommandsIn)
      ? environmentIsolation.disallowProdCommandsIn.map((row) => String(row || "").trim().toLowerCase()).filter(Boolean)
      : ["local", "staging"]
  );
  const envProdPatterns = Array.isArray(environmentIsolation.prodCommandPatterns)
    ? environmentIsolation.prodCommandPatterns
        .filter((row) => typeof row === "string" && row.trim().length > 0)
        .map((row) => new RegExp(row, "i"))
    : deployPatterns;
  const capabilityControls = isPlainObject(runtimeControls.capabilityTokens) ? runtimeControls.capabilityTokens : {};
  const requireCapabilityTokenForDestructive = capabilityControls.requireForDestructive === true;
  const capabilityPrefixes = Array.isArray(capabilityControls.acceptedPrefixes)
    ? capabilityControls.acceptedPrefixes
        .map((row) => String(row || "").trim())
        .filter((row) => row.length > 0)
    : ["cap_"];
  const twoPhaseCommit = isPlainObject(runtimeControls.twoPhaseCommit) ? runtimeControls.twoPhaseCommit : {};
  const enforceTwoPhaseCommit = twoPhaseCommit.enforceForDestructive === true;
  const dryRunPattern = String(twoPhaseCommit.dryRunPattern || "--dry-run");

  const selectedIntentIds = args.intentIds.length > 0 ? new Set(args.intentIds) : null;
  const intents = (Array.isArray(plan.intents) ? plan.intents : []).filter((intent) =>
    selectedIntentIds ? selectedIntentIds.has(intent.intentId) : true
  );
  const intentById = new Map(intents.map((intent) => [intent.intentId, intent]));
  const tasks = (Array.isArray(plan.tasks) ? plan.tasks : []).filter((task) =>
    selectedIntentIds ? selectedIntentIds.has(task.intentId) : true
  );

  const findings = [];
  const warnings = [];

  for (const intent of intents) {
    const allowUntrustedMcp = intent?.policy?.allowUntrustedMcp === true;
    const allowedTools = Array.isArray(intent.allowedTools) ? intent.allowedTools : [];
    if (!allowUntrustedMcp) {
      for (const toolName of allowedTools) {
        if (typeof toolName !== "string") continue;
        if (!toolName.startsWith("functions.")) {
          findings.push({
            severity: "error",
            code: "untrusted_tool_namespace",
            intentId: intent.intentId,
            toolName,
            message: `Tool ${toolName} is outside trusted functions.* namespace.`,
          });
        }
      }
    }
  }

  for (const task of tasks) {
    const intent = intentById.get(task.intentId) || null;
    const riskTier = String(intent?.riskTier || task?.riskTier || "").toLowerCase();
    const writeScope = normalizeWriteScope(task?.writeScope || "unspecified");
    const isMutableTask = isMutableWriteScope(writeScope);

    if (allowedWriteScopes.size > 0 && !allowedWriteScopes.has(writeScope)) {
      findings.push({
        severity: "error",
        code: "scope_violation",
        intentId: task.intentId,
        taskId: task.taskId,
        writeScope,
        message: `Task writeScope "${writeScope}" is outside allowedWriteScopes.`,
      });
    }

    if (killSwitch && isMutableTask) {
      findings.push({
        severity: "error",
        code: "kill_switch_write_blocked",
        intentId: task.intentId,
        taskId: task.taskId,
        writeScope,
        message: "Runtime kill switch is enabled; mutable tasks are blocked.",
      });
    }

    if (brownoutMode === "read_only_noncritical" && isMutableTask && !["high", "critical"].includes(riskTier)) {
      findings.push({
        severity: "error",
        code: "brownout_noncritical_write_blocked",
        intentId: task.intentId,
        taskId: task.taskId,
        riskTier,
        message: "Brownout read_only_noncritical blocks mutable work for low/medium risk intents.",
      });
    }

    const allCommands = Array.isArray(task.checks) ? task.checks : [];
    const hasDryRunCompanion =
      dryRunPattern.length > 0 &&
      allCommands.some((row) => {
        const commandText = String(row || "");
        return commandText.includes(dryRunPattern) || /\b--dry-run\b/.test(commandText);
      });

    const capabilityToken = String(task?.capabilityToken || intent?.capabilityToken || "").trim();
    const hasCapabilityToken = capabilityPrefixes.some((prefix) => capabilityToken.startsWith(prefix));

    for (const command of Array.isArray(task.checks) ? task.checks : []) {
      const commandText = String(command || "").trim();
      if (!commandText) continue;

      for (const pattern of forbiddenPatterns) {
        if (pattern.test(commandText)) {
          findings.push({
            severity: "error",
            code: "forbidden_command_pattern",
            intentId: task.intentId,
            taskId: task.taskId,
            command: commandText,
            message: `Command matched forbidden pattern ${pattern}.`,
          });
        }
      }

      if (skipProviders.size > 0 && /portal:auth:providers:check:full/.test(commandText)) {
        warnings.push({
          severity: "warning",
          code: "provider_check_full",
          intentId: task.intentId,
          taskId: task.taskId,
          message: `Full provider check invoked; expected skip provider(s): ${Array.from(skipProviders).join(", ")}.`,
        });
      }

      if (enforceEnvIsolation && disallowProdCommandsIn.has(args.environment)) {
        for (const pattern of envProdPatterns) {
          if (pattern.test(commandText)) {
            findings.push({
              severity: "error",
              code: "environment_isolation_violation",
              intentId: task.intentId,
              taskId: task.taskId,
              command: commandText,
              environment: args.environment,
              message: `Environment ${args.environment} cannot execute production-impact command ${pattern}.`,
            });
          }
        }
      }

      let destructive = false;
      for (const pattern of destructivePatterns) {
        if (pattern.test(commandText)) {
          destructive = true;
          break;
        }
      }

      if (destructive && enforceTwoPhaseCommit && !hasDryRunCompanion) {
        findings.push({
          severity: "error",
          code: "two_phase_commit_missing_dry_run",
          intentId: task.intentId,
          taskId: task.taskId,
          command: commandText,
          message: "Destructive command requires at least one dry-run companion command in the task.",
        });
      }

      if (destructive && requireCapabilityTokenForDestructive && !hasCapabilityToken) {
        findings.push({
          severity: "error",
          code: "missing_capability_token",
          intentId: task.intentId,
          taskId: task.taskId,
          command: commandText,
          message: "Destructive command requires a valid capability token.",
        });
      }
    }
  }

  const status = findings.length === 0 ? "pass" : "fail";
  const report = {
    schema: "intent-policy-gate-report.v1",
    generatedAt: new Date().toISOString(),
    status,
    planPath: args.planPath,
    policyPath: args.policyPath,
    selectedIntentCount: intents.length,
    selectedTaskCount: tasks.length,
    summary: {
      errors: findings.length,
      warnings: warnings.length,
    },
    runtimeControls: {
      environment: args.environment,
      infraPhase: args.infraPhase,
      killSwitch,
      brownoutMode,
      failOpenMatrix,
    },
    findings,
    warnings,
  };

  mkdirSync(dirname(artifactAbsolutePath), { recursive: true });
  writeFileSync(artifactAbsolutePath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  if (args.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(`intent-policy-gate status: ${status}\n`);
    process.stdout.write(`report: ${artifactAbsolutePath}\n`);
  }

  if (status !== "pass" && args.strict) {
    process.exitCode = 1;
  } else if (status !== "pass") {
    process.exitCode = 1;
  }
}

try {
  main();
} catch (error) {
  process.stderr.write(`intent-policy-gate failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
