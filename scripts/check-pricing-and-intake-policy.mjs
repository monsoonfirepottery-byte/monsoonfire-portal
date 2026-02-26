#!/usr/bin/env node

/* eslint-disable no-console */

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const repoRoot = resolve(__filename, "..", "..");

function runRg(pattern, targets) {
  const result = spawnSync(
    "rg",
    ["-n", pattern, ...targets, "--glob", "!**/node_modules/**"],
    {
      cwd: repoRoot,
      encoding: "utf8",
    }
  );
  return {
    code: result.status ?? 1,
    stdout: String(result.stdout || "").trim(),
    stderr: String(result.stderr || "").trim(),
  };
}

function assertNoMatches(label, pattern, targets) {
  const result = runRg(pattern, targets);
  if (result.code === 1) return;
  if (result.code !== 0) {
    throw new Error(`${label}: rg failed (${result.stderr || "unknown error"})`);
  }
  throw new Error(`${label}: found disallowed matches\n${result.stdout}`);
}

function assertHasMatches(label, pattern, targets) {
  const result = runRg(pattern, targets);
  if (result.code === 0 && result.stdout.length > 0) return;
  if (result.code !== 0 && result.code !== 1) {
    throw new Error(`${label}: rg failed (${result.stderr || "unknown error"})`);
  }
  throw new Error(`${label}: expected at least one match for pattern ${pattern}`);
}

function main() {
  const sourceTargets = ["web/src", "functions/src", "ios"];
  const websiteTargets = ["website/kiln-firing/index.html", "website/ncsitebuilder/kiln-firing/index.html", "website/data/faq.json", "website/ncsitebuilder/data/faq.json"];

  assertNoMatches("volume field usage", "useVolumePricing|volumeIn3", sourceTargets);
  assertNoMatches("website by-volume pricing copy", "By volume|by volume|per cubic inch", websiteTargets);

  assertHasMatches(
    "website no-volume billing statement",
    "do not measure kiln volume for billing|do not bill by kiln volume",
    websiteTargets
  );
  assertHasMatches(
    "website community shelf statement",
    "Community shelf",
    websiteTargets
  );
  assertHasMatches(
    "website community shelf firing exclusion statement",
    "excluded from firing triggers|do not trigger firing schedules",
    websiteTargets
  );

  console.log(JSON.stringify({ ok: true, check: "pricing_and_intake_policy" }, null, 2));
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
}
