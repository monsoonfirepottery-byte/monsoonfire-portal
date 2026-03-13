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
    intentId: "",
    planPath: "artifacts/intent-plan.generated.json",
    profile: "safe",
    profilePath: "",
    artifact: "output/intent/sim-result.json",
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

    if (arg === "--intent-id" && argv[index + 1]) {
      parsed.intentId = String(argv[index + 1]).trim();
      index += 1;
      continue;
    }
    if (arg.startsWith("--intent-id=")) {
      parsed.intentId = arg.slice("--intent-id=".length).trim();
      continue;
    }

    if (arg === "--plan" && argv[index + 1]) {
      parsed.planPath = String(argv[index + 1]).trim();
      index += 1;
      continue;
    }
    if (arg.startsWith("--plan=")) {
      parsed.planPath = arg.slice("--plan=".length).trim();
      continue;
    }

    if (arg === "--profile" && argv[index + 1]) {
      parsed.profile = String(argv[index + 1]).trim();
      index += 1;
      continue;
    }
    if (arg.startsWith("--profile=")) {
      parsed.profile = arg.slice("--profile=".length).trim();
      continue;
    }

    if (arg === "--profile-path" && argv[index + 1]) {
      parsed.profilePath = String(argv[index + 1]).trim();
      index += 1;
      continue;
    }
    if (arg.startsWith("--profile-path=")) {
      parsed.profilePath = arg.slice("--profile-path=".length).trim();
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

    if (arg === "--help" || arg === "-h") {
      process.stdout.write(
        [
          "Simulation runner",
          "",
          "Usage:",
          "  node ./scripts/sim-runner.mjs --intent-id <intentId> [--profile safe] [--json]",
          "",
          "Options:",
          "  --plan <path>          Compiled intent plan path",
          "  --profile <id>         Simulation profile id (safe|normal|chaos by default)",
          "  --profile-path <path>  Explicit profile path override",
          "  --artifact <path>      Output report path",
          "  --strict               Exit non-zero on failed simulation",
        ].join("\n")
      );
      process.exit(0);
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!parsed.intentId) {
    throw new Error("--intent-id is required.");
  }

  return parsed;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function loadProfile(args) {
  const candidatePath = args.profilePath
    ? resolve(REPO_ROOT, args.profilePath)
    : resolve(REPO_ROOT, "evals", "profiles", `${args.profile}.json`);
  if (!existsSync(candidatePath)) {
    return {
      ok: false,
      path: candidatePath,
      errorCode: "missing_profile",
      error: `Simulation profile not found at ${candidatePath}`,
      profile: null,
    };
  }

  try {
    const parsed = readJson(candidatePath);
    return {
      ok: true,
      path: candidatePath,
      errorCode: null,
      error: "",
      profile: parsed,
    };
  } catch (error) {
    return {
      ok: false,
      path: candidatePath,
      errorCode: "invalid_profile_json",
      error: error instanceof Error ? error.message : String(error),
      profile: null,
    };
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const artifactAbsolutePath = resolve(REPO_ROOT, args.artifact);
  const planAbsolutePath = resolve(REPO_ROOT, args.planPath);

  const findings = [];
  const warnings = [];

  if (!existsSync(planAbsolutePath)) {
    throw new Error(`Compiled plan not found at ${args.planPath}`);
  }
  const plan = readJson(planAbsolutePath);
  const intent = (Array.isArray(plan.intents) ? plan.intents : []).find((row) => row.intentId === args.intentId) || null;
  const tasks = (Array.isArray(plan.tasks) ? plan.tasks : []).filter((row) => row.intentId === args.intentId);

  if (!intent) {
    throw new Error(`Intent ${args.intentId} not found in compiled plan.`);
  }

  const profileResult = loadProfile(args);
  if (!profileResult.ok) {
    findings.push({
      severity: "critical",
      code: profileResult.errorCode,
      message: profileResult.error,
    });
  }

  const profile = profileResult.profile || {};
  const maxChecksPerTask = Number(profile.maxChecksPerTask || 0);
  const maxTotalChecks = Number(profile.maxTotalChecks || 0);
  const denyPatterns = Array.isArray(profile.denyCommandPatterns)
    ? profile.denyCommandPatterns
        .filter((value) => typeof value === "string" && value.trim().length > 0)
        .map((value) => new RegExp(value, "i"))
    : [];
  const requiredEnv = Array.isArray(profile.requiredEnv)
    ? profile.requiredEnv.filter((value) => typeof value === "string" && value.trim().length > 0)
    : [];

  const totalChecks = tasks.reduce((sum, task) => sum + (Array.isArray(task.checks) ? task.checks.length : 0), 0);
  if (Number.isFinite(maxTotalChecks) && maxTotalChecks > 0 && totalChecks > maxTotalChecks) {
    findings.push({
      severity: "critical",
      code: "max_total_checks_exceeded",
      message: `Intent has ${totalChecks} checks, above simulation maxTotalChecks=${maxTotalChecks}.`,
    });
  }

  for (const task of tasks) {
    const checks = Array.isArray(task.checks) ? task.checks : [];
    if (Number.isFinite(maxChecksPerTask) && maxChecksPerTask > 0 && checks.length > maxChecksPerTask) {
      findings.push({
        severity: "critical",
        code: "max_checks_per_task_exceeded",
        taskId: task.taskId,
        message: `${task.taskId} has ${checks.length} checks, above maxChecksPerTask=${maxChecksPerTask}.`,
      });
    }

    for (const command of checks) {
      const commandText = String(command || "");
      for (const pattern of denyPatterns) {
        if (pattern.test(commandText)) {
          findings.push({
            severity: "critical",
            code: "denied_command_pattern",
            taskId: task.taskId,
            command: commandText,
            message: `Command matched denied simulation pattern ${pattern}.`,
          });
        }
      }
      if (profile.allowNetworkWrites === false && /(\bcurl\b.*-X\s+(POST|PUT|PATCH|DELETE)|\bfirebase-tools deploy\b|\bnpm run deploy\b)/i.test(commandText)) {
        warnings.push({
          severity: "warning",
          code: "network_write_candidate",
          taskId: task.taskId,
          command: commandText,
          message: "Command appears to perform a network write while profile disallows network writes.",
        });
      }
    }
  }

  for (const envName of requiredEnv) {
    if (!process.env[envName]) {
      findings.push({
        severity: "critical",
        code: "missing_required_env",
        env: envName,
        message: `Required env var ${envName} is missing.`,
      });
    }
  }

  const criticalCount = findings.filter((row) => row.severity === "critical").length;
  const status = criticalCount === 0 ? "pass" : "fail";
  const report = {
    schema: "intent-sim-result.v1",
    generatedAt: new Date().toISOString(),
    status,
    intentId: args.intentId,
    profileId: String(profile.profileId || args.profile || "unknown"),
    profilePath: profileResult.path,
    planPath: args.planPath,
    summary: {
      taskCount: tasks.length,
      totalChecks,
      criticalCount,
      warningCount: warnings.length,
    },
    findings,
    warnings,
  };

  mkdirSync(dirname(artifactAbsolutePath), { recursive: true });
  writeFileSync(artifactAbsolutePath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  if (args.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(`sim-runner status: ${report.status}\n`);
    process.stdout.write(`intent: ${report.intentId}\n`);
    process.stdout.write(`profile: ${report.profileId}\n`);
    process.stdout.write(`report: ${artifactAbsolutePath}\n`);
  }

  if (report.status !== "pass" && args.strict) {
    process.exitCode = 1;
  } else if (report.status !== "pass") {
    process.exitCode = 1;
  }
}

try {
  main();
} catch (error) {
  process.stderr.write(`sim-runner failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
