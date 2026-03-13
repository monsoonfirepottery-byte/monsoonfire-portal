#!/usr/bin/env node

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_INTENTS_DIR,
  DEFAULT_SCHEMA_PATH,
  loadIntentEntries,
  validateIntentEntries,
  buildValidationReport,
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
    artifact: "output/intent/intent-validate-report.json",
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

    if ((arg === "--artifact" || arg === "--report") && argv[index + 1]) {
      parsed.artifact = String(argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg.startsWith("--artifact=")) {
      parsed.artifact = arg.slice("--artifact=".length);
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      process.stdout.write(
        [
          "Intent validator",
          "",
          "Usage:",
          "  node ./scripts/intent-validate.mjs [--json] [--strict]",
          "",
          "Options:",
          "  --intents-dir <path>  Intents root directory (default: intents)",
          "  --schema <path>       Intent schema contract path (default: contracts/intent.schema.json)",
          "  --artifact <path>     Validation report output path",
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

  const entries = loadIntentEntries(REPO_ROOT, args.intentsDir);
  const validation = validateIntentEntries(REPO_ROOT, entries);

  if (!existsSync(schemaAbsolutePath)) {
    validation.findings.push({
      severity: "error",
      type: "missing-schema",
      file: relative(REPO_ROOT, schemaAbsolutePath).replaceAll("\\", "/"),
      message: "Intent schema file not found.",
      details: null,
    });
    validation.summary.errors += 1;
  }

  if (entries.length === 0) {
    validation.findings.push({
      severity: "warning",
      type: "no-intents",
      file: args.intentsDir,
      message: "No intent files found. Add at least one *.intent.json file.",
      details: null,
    });
    validation.summary.warnings += 1;
  }

  const report = buildValidationReport({
    strict: args.strict,
    artifactPath: relative(REPO_ROOT, artifactAbsolutePath).replaceAll("\\", "/"),
    schemaPath: relative(REPO_ROOT, schemaAbsolutePath).replaceAll("\\", "/"),
    validation,
  });

  mkdirSync(dirname(artifactAbsolutePath), { recursive: true });
  writeFileSync(artifactAbsolutePath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  if (args.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(`intent-validate status: ${report.status}\n`);
    process.stdout.write(`files scanned: ${report.summary.filesScanned}\n`);
    process.stdout.write(`valid intents: ${report.summary.validIntents}\n`);
    process.stdout.write(`errors: ${report.summary.errors} | warnings: ${report.summary.warnings}\n`);
    process.stdout.write(`report: ${artifactAbsolutePath}\n`);
  }

  if (report.status !== "pass") {
    process.exitCode = 1;
  }
}

try {
  main();
} catch (error) {
  process.stderr.write(`intent-validate failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
