#!/usr/bin/env node

/* eslint-disable no-console */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const repoRoot = resolve(dirname(__filename), "..");

function compilePattern(pattern) {
  return new RegExp(pattern, "i");
}

function readTarget(relativePath) {
  const absolutePath = resolve(repoRoot, relativePath);
  try {
    return readFileSync(absolutePath, "utf8");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not read ${relativePath}: ${message}`);
  }
}

function listTargetFiles(relativePath) {
  const absolutePath = resolve(repoRoot, relativePath);
  let stats;
  try {
    stats = statSync(absolutePath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not stat ${relativePath}: ${message}`);
  }
  if (stats.isFile()) {
    return [relativePath];
  }
  if (!stats.isDirectory()) {
    return [];
  }

  const entries = readdirSync(absolutePath, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.name === "node_modules") continue;
    const childPath = `${relativePath}/${entry.name}`;
    if (entry.isDirectory()) {
      files.push(...listTargetFiles(childPath));
      continue;
    }
    if (entry.isFile()) {
      files.push(childPath);
    }
  }
  return files;
}

function findMatches(pattern, targets) {
  const matcher = compilePattern(pattern);
  const matches = [];
  for (const target of targets) {
    const files = listTargetFiles(target);
    for (const file of files) {
      if (matcher.test(readTarget(file))) {
        matches.push(file);
      }
    }
  }
  return matches;
}

function assertNoMatches(label, pattern, targets) {
  const matches = findMatches(pattern, targets);
  if (matches.length === 0) {
    return;
  }
  throw new Error(`${label}: found disallowed matches in ${matches.join(", ")}`);
}

function assertHasMatches(label, pattern, targets) {
  const matches = findMatches(pattern, targets);
  if (matches.length > 0) {
    return;
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
    "portal community shelf tiny-load cap statement",
    "under one half shelf per check-in|tiny-load lane",
    ["web/src/views/ReservationsView.tsx"]
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
