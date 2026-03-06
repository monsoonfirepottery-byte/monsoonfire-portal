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
    intentsDir: DEFAULT_INTENTS_DIR,
    schemaPath: DEFAULT_SCHEMA_PATH,
    artifact: DEFAULT_PLAN_ARTIFACT,
    report: "output/intent/intent-drift-report.json",
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
          "Intent drift check",
          "",
          "Usage:",
          "  node ./scripts/intent-drift-check.mjs [--json] [--strict]",
          "",
          "Checks:",
          "  1. Intent files are valid.",
          "  2. Compiled artifact exists.",
          "  3. Artifact plan digest matches current source state.",
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
  const schemaAbsolutePath = resolve(REPO_ROOT, args.schemaPath);
  const artifactAbsolutePath = resolve(REPO_ROOT, args.artifact);
  const reportAbsolutePath = resolve(REPO_ROOT, args.report);

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

  if (entries.length === 0) {
    findings.push({
      severity: "error",
      type: "no-intents",
      file: args.intentsDir,
      message: "No intent files found.",
      details: null,
    });
  }

  let currentPlan = null;
  if (findings.every((finding) => finding.severity !== "error")) {
    currentPlan = buildCompiledPlan(REPO_ROOT, validation.validEntries);
  }

  const artifactExists = existsSync(artifactAbsolutePath);
  let artifact = null;
  if (!artifactExists) {
    findings.push({
      severity: "error",
      type: "missing-artifact",
      file: relative(REPO_ROOT, artifactAbsolutePath).replaceAll("\\", "/"),
      message: "Compiled intent artifact is missing. Run npm run intent:compile.",
      details: null,
    });
  } else {
    try {
      artifact = JSON.parse(readFileSync(artifactAbsolutePath, "utf8"));
    } catch (error) {
      findings.push({
        severity: "error",
        type: "artifact-parse",
        file: relative(REPO_ROOT, artifactAbsolutePath).replaceAll("\\", "/"),
        message: `Failed to parse compiled artifact: ${error instanceof Error ? error.message : String(error)}`,
        details: null,
      });
    }
  }

  let driftDetected = false;
  if (currentPlan && artifact) {
    const existingDigest = typeof artifact.planDigestSha256 === "string" ? artifact.planDigestSha256 : null;
    const currentDigest = currentPlan.planDigestSha256;
    if (!existingDigest || existingDigest !== currentDigest) {
      driftDetected = true;
      findings.push({
        severity: "error",
        type: "intent-drift",
        file: relative(REPO_ROOT, artifactAbsolutePath).replaceAll("\\", "/"),
        message: "Intent artifact drift detected. Re-run npm run intent:compile and commit updated artifact.",
        details: {
          existingDigest,
          currentDigest,
        },
      });
    }
  }

  const errors = findings.filter((finding) => finding.severity === "error").length;
  const warnings = findings.filter((finding) => finding.severity === "warning").length;
  const status = errors > 0 || (args.strict && warnings > 0) ? "fail" : "pass";

  const report = {
    schema: "intent-drift-report.v1",
    generatedAt: new Date().toISOString(),
    strict: args.strict,
    status,
    inputs: {
      intentsDir: args.intentsDir,
      schemaPath: relative(REPO_ROOT, schemaAbsolutePath).replaceAll("\\", "/"),
      artifactPath: relative(REPO_ROOT, artifactAbsolutePath).replaceAll("\\", "/"),
    },
    summary: {
      filesScanned: validation.summary.filesScanned,
      validIntents: validation.summary.validIntents,
      errors,
      warnings,
      driftDetected,
      artifactExists,
      currentDigest: currentPlan?.planDigestSha256 ?? null,
      artifactDigest: typeof artifact?.planDigestSha256 === "string" ? artifact.planDigestSha256 : null,
    },
    findings,
  };

  mkdirSync(dirname(reportAbsolutePath), { recursive: true });
  writeFileSync(reportAbsolutePath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  if (args.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(`intent-drift status: ${report.status}\n`);
    process.stdout.write(`drift detected: ${report.summary.driftDetected}\n`);
    process.stdout.write(`errors: ${report.summary.errors} | warnings: ${report.summary.warnings}\n`);
    process.stdout.write(`report: ${reportAbsolutePath}\n`);
  }

  if (report.status !== "pass") {
    process.exitCode = 1;
  }
}

try {
  main();
} catch (error) {
  process.stderr.write(`intent-drift-check failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
