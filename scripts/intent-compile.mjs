#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_INTENTS_DIR,
  DEFAULT_SCHEMA_PATH,
  DEFAULT_PLAN_ARTIFACT,
  loadIntentEntries,
  validateIntentEntries,
  buildCompiledPlan,
} from "./lib/intent-control-plane.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..");

function parseArgs(argv) {
  const parsed = {
    json: false,
    strict: false,
    write: false,
    check: false,
    intentsDir: DEFAULT_INTENTS_DIR,
    schemaPath: DEFAULT_SCHEMA_PATH,
    artifact: DEFAULT_PLAN_ARTIFACT,
    report: "output/intent/intent-compile-report.json",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = String(argv[index] ?? "");
    if (!arg) continue;

    if (arg === "--json") {
      parsed.json = true;
      continue;
    }
    if (arg === "--strict") {
      parsed.strict = true;
      continue;
    }
    if (arg === "--write") {
      parsed.write = true;
      continue;
    }
    if (arg === "--check") {
      parsed.check = true;
      continue;
    }

    if ((arg === "--intents-dir" || arg === "--intents") && argv[index + 1]) {
      parsed.intentsDir = String(argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg.startsWith("--intents-dir=")) {
      parsed.intentsDir = arg.slice("--intents-dir=".length);
      continue;
    }

    if (arg === "--schema" && argv[index + 1]) {
      parsed.schemaPath = String(argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg.startsWith("--schema=")) {
      parsed.schemaPath = arg.slice("--schema=".length);
      continue;
    }

    if (arg === "--artifact" && argv[index + 1]) {
      parsed.artifact = String(argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg.startsWith("--artifact=")) {
      parsed.artifact = arg.slice("--artifact=".length);
      continue;
    }

    if ((arg === "--report" || arg === "--out") && argv[index + 1]) {
      parsed.report = String(argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg.startsWith("--report=")) {
      parsed.report = arg.slice("--report=".length);
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      process.stdout.write(
        [
          "Intent compiler",
          "",
          "Usage:",
          "  node ./scripts/intent-compile.mjs [--json] [--write] [--check]",
          "",
          "Options:",
          "  --write             Persist compiled artifact to --artifact path",
          "  --check             Compare current compile output to existing artifact",
          "  --artifact <path>   Compiled artifact path (default: artifacts/intent-plan.generated.json)",
          "  --report <path>     Compile report output path",
        ].join("\n")
      );
      process.exit(0);
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return parsed;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const artifactAbsolutePath = resolve(REPO_ROOT, args.artifact);
  const reportAbsolutePath = resolve(REPO_ROOT, args.report);
  const schemaAbsolutePath = resolve(REPO_ROOT, args.schemaPath);

  const entries = loadIntentEntries(REPO_ROOT, args.intentsDir);
  const validation = validateIntentEntries(REPO_ROOT, entries);

  const findings = [...validation.findings];
  if (!existsSync(schemaAbsolutePath)) {
    findings.push({
      severity: "error",
      type: "missing-schema",
      file: relative(REPO_ROOT, schemaAbsolutePath).replaceAll("\\", "/"),
      message: "Intent schema file not found.",
      details: null,
    });
  }

  const errors = findings.filter((finding) => finding.severity === "error").length;
  const warnings = findings.filter((finding) => finding.severity === "warning").length;
  let status = errors > 0 || (args.strict && warnings > 0) ? "fail" : "pass";

  let plan = null;
  let check = {
    performed: args.check,
    artifactExists: existsSync(artifactAbsolutePath),
    driftDetected: false,
  };

  if (status === "pass") {
    plan = buildCompiledPlan(REPO_ROOT, validation.validEntries);

    if (args.check) {
      if (!check.artifactExists) {
        findings.push({
          severity: "error",
          type: "missing-artifact",
          file: relative(REPO_ROOT, artifactAbsolutePath).replaceAll("\\", "/"),
          message: "Compiled intent artifact is missing. Run intent compile with --write.",
          details: null,
        });
        check.driftDetected = true;
        status = "fail";
      } else {
        let existing = null;
        try {
          existing = JSON.parse(readFileSync(artifactAbsolutePath, "utf8"));
        } catch (error) {
          findings.push({
            severity: "error",
            type: "artifact-parse",
            file: relative(REPO_ROOT, artifactAbsolutePath).replaceAll("\\", "/"),
            message: `Failed to parse compiled artifact: ${error instanceof Error ? error.message : String(error)}`,
            details: null,
          });
          check.driftDetected = true;
          status = "fail";
        }

        if (existing) {
          const existingDigest = typeof existing.planDigestSha256 === "string" ? existing.planDigestSha256 : null;
          if (!existingDigest || existingDigest !== plan.planDigestSha256) {
            findings.push({
              severity: "error",
              type: "artifact-drift",
              file: relative(REPO_ROOT, artifactAbsolutePath).replaceAll("\\", "/"),
              message: "Compiled intent artifact drift detected. Re-run intent compile with --write.",
              details: {
                existingDigest,
                currentDigest: plan.planDigestSha256,
              },
            });
            check.driftDetected = true;
            status = "fail";
          }
        }
      }
    }

    if (args.write) {
      mkdirSync(dirname(artifactAbsolutePath), { recursive: true });
      writeFileSync(artifactAbsolutePath, `${JSON.stringify(plan, null, 2)}\n`, "utf8");
    }
  }

  const report = {
    schema: "intent-compile-report.v1",
    generatedAt: new Date().toISOString(),
    strict: args.strict,
    status,
    intentsDir: args.intentsDir,
    schemaPath: relative(REPO_ROOT, schemaAbsolutePath).replaceAll("\\", "/"),
    artifactPath: relative(REPO_ROOT, artifactAbsolutePath).replaceAll("\\", "/"),
    reportPath: relative(REPO_ROOT, reportAbsolutePath).replaceAll("\\", "/"),
    summary: {
      filesScanned: validation.summary.filesScanned,
      validIntents: validation.summary.validIntents,
      errors: findings.filter((finding) => finding.severity === "error").length,
      warnings: findings.filter((finding) => finding.severity === "warning").length,
      intentCount: plan?.intentCount ?? 0,
      taskCount: plan?.taskCount ?? 0,
      planDigestSha256: plan?.planDigestSha256 ?? null,
    },
    check,
    findings,
  };

  mkdirSync(dirname(reportAbsolutePath), { recursive: true });
  writeFileSync(reportAbsolutePath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  if (args.json) {
    const payload = {
      ...report,
      planPreview: plan
        ? {
            schema: plan.schema,
            planDigestSha256: plan.planDigestSha256,
            intentCount: plan.intentCount,
            taskCount: plan.taskCount,
            intents: plan.intents.map((intent) => ({
              intentId: intent.intentId,
              epicPath: intent.epicPath,
              riskTier: intent.riskTier,
            })),
          }
        : null,
    };
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  } else {
    process.stdout.write(`intent-compile status: ${report.status}\n`);
    process.stdout.write(`intent count: ${report.summary.intentCount} | task count: ${report.summary.taskCount}\n`);
    process.stdout.write(`plan digest: ${report.summary.planDigestSha256 ?? "none"}\n`);
    process.stdout.write(`report: ${reportAbsolutePath}\n`);
    if (args.write) {
      process.stdout.write(`artifact written: ${artifactAbsolutePath}\n`);
    }
  }

  if (report.status !== "pass") {
    process.exitCode = 1;
  }
}

try {
  main();
} catch (error) {
  process.stderr.write(`intent-compile failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
