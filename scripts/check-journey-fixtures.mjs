#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const strict = args.includes("--strict");
const json = args.includes("--json");
const artifactArg = readArgValue(args, "--artifact");
const artifactPath = artifactArg ? resolve(ROOT, artifactArg) : resolve(ROOT, "output", "journey-tests", "fixtures-check.json");

const checks = [];

const fixtureRelPath = "functions/scripts/fixtures/agent-commerce-smoke.base.json";
const fixtureAbsPath = resolve(ROOT, fixtureRelPath);
if (!existsSync(fixtureAbsPath)) {
  checks.push({
    severity: "error",
    file: fixtureRelPath,
    message: "Required fixture file is missing.",
  });
} else {
  const raw = readFileSync(fixtureAbsPath, "utf8");
  let parsed = null;
  try {
    parsed = JSON.parse(raw);
    checks.push({ severity: "pass", file: fixtureRelPath, message: "Fixture parses as JSON." });
  } catch (error) {
    checks.push({
      severity: "error",
      file: fixtureRelPath,
      message: `Fixture is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    });
  }

  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    const fixture = parsed;
    assertObjectField(fixture, "catalogPayload");
    assertObjectField(fixture, "quotePayload");
    assertObjectField(fixture, "reservePayload");
    assertObjectField(fixture, "payPayload");
    assertObjectField(fixture, "orderGetPayload");
    assertObjectField(fixture, "statusPayload");
    assertObjectField(fixture, "staffTransitionPayload");
    assertArrayField(fixture, "staffTransitions");

    const transitions = Array.isArray(fixture.staffTransitions) ? fixture.staffTransitions : [];
    const invalidTransitions = transitions.filter((entry) => typeof entry !== "string" || !entry.trim().length);
    checks.push({
      severity: invalidTransitions.length > 0 ? "error" : "pass",
      file: fixtureRelPath,
      message: invalidTransitions.length > 0
        ? `staffTransitions contains invalid values (${invalidTransitions.length}).`
        : "staffTransitions contains non-empty string values.",
    });

    const lowered = raw.toLowerCase();
    const leakMarkers = ["bearer ", "sk_live_", "pk_live_", "whsec_live_", "token=", "authorization:"];
    const matchedMarkers = leakMarkers.filter((marker) => lowered.includes(marker));
    checks.push({
      severity: matchedMarkers.length > 0 ? "error" : "pass",
      file: fixtureRelPath,
      message: matchedMarkers.length > 0
        ? `Fixture appears to contain sensitive token markers: ${matchedMarkers.join(", ")}`
        : "Fixture has no obvious sensitive token markers.",
    });
  }
}

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
  process.stdout.write(`journey fixtures check: ${summary.status.toUpperCase()} (${checks.length} checks)\n`);
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

function assertObjectField(source, key) {
  const value = source[key];
  checks.push({
    severity: value && typeof value === "object" && !Array.isArray(value) ? "pass" : "error",
    file: "functions/scripts/fixtures/agent-commerce-smoke.base.json",
    message: `Fixture field "${key}" must be an object.`,
  });
}

function assertArrayField(source, key) {
  const value = source[key];
  checks.push({
    severity: Array.isArray(value) ? "pass" : "error",
    file: "functions/scripts/fixtures/agent-commerce-smoke.base.json",
    message: `Fixture field "${key}" must be an array.`,
  });
}
