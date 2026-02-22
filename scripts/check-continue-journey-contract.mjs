#!/usr/bin/env node

import { existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const strict = args.includes("--strict");
const json = args.includes("--json");
const artifactArg = readArgValue(args, "--artifact");
const artifactPath = artifactArg ? resolve(ROOT, artifactArg) : resolve(ROOT, "output", "journey-tests", "continue-journey-contract.json");

const checks = [];

checkFileContains("functions/src/index.ts", /continueJourneySchema\s*=\s*z\.object\(\{[\s\S]*uid:\s*z\.string\(\)\.min\(1\),[\s\S]*fromBatchId:\s*z\.string\(\)\.min\(1\)/m, "continueJourney schema requires uid + fromBatchId");
checkFileContains("docs/API_CONTRACTS.md", /###\s*continueJourney[\s\S]*"uid":\s*"string"[\s\S]*"fromBatchId":\s*"string"/m, "API contracts doc includes continueJourney uid/fromBatchId request");
checkFileContains("docs/CONTINUE_JOURNEY_AGENT_QUICKSTART.md", /"uid":\s*"<firebase uid>"[\s\S]*"fromBatchId":\s*"<existing batch id>"/m, "Continue Journey quickstart includes canonical uid/fromBatchId body");
checkFileContains("web/src/api/portalContracts.ts", /export type ContinueJourneyRequest = \{[\s\S]*uid:\s*string;[\s\S]*fromBatchId:\s*string;/m, "Portal contracts declare ContinueJourneyRequest uid + fromBatchId");
checkFileContains("web/src/api/functionsClient.test.ts", /continueJourney[\s\S]*fromBatchId:\s*"batch_1"/m, "Functions client tests include continueJourney payload with fromBatchId");

const errors = checks.filter((row) => row.severity === "error").length;
const summary = {
  generatedAt: new Date().toISOString(),
  strict,
  status: errors > 0 ? "fail" : "pass",
  checks,
  summary: {
    errors,
    total: checks.length,
  },
};

mkdirSync(dirname(artifactPath), { recursive: true });
writeFileSync(artifactPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");

if (json) {
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
} else {
  process.stdout.write(`continueJourney contract checks: ${summary.status.toUpperCase()} (${checks.length} checks)\n`);
  for (const row of checks) {
    process.stdout.write(`- [${row.severity}] ${row.message}\n`);
  }
}

if (strict && errors > 0) {
  process.exitCode = 1;
}

function readArgValue(argv, name) {
  const index = argv.indexOf(name);
  if (index < 0) return null;
  return argv[index + 1] ?? null;
}

function checkFileContains(relPath, pattern, message) {
  const abs = resolve(ROOT, relPath);
  if (!existsSync(abs)) {
    checks.push({
      severity: "error",
      file: relPath,
      message: `${message} (missing file)`,
    });
    return;
  }
  const content = readFileSync(abs, "utf8");
  const ok = pattern.test(content);
  checks.push({
    severity: ok ? "pass" : "error",
    file: relPath,
    message,
  });
}
