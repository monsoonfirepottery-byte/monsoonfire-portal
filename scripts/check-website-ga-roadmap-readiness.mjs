#!/usr/bin/env node

/* eslint-disable no-console */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const repoRoot = process.cwd();
const args = new Set(process.argv.slice(2));
const asJson = args.has("--json");
const strict = args.has("--strict");

const checks = [];

function readUtf8(path) {
  return readFileSync(resolve(repoRoot, path), "utf8");
}

function addCheck(ok, key, message, details = null) {
  checks.push({ ok, key, message, details });
}

function checkFile(path, patterns, key, message) {
  if (!existsSync(resolve(repoRoot, path))) {
    addCheck(false, key, `${message} (missing file)`, { path });
    return;
  }
  const source = readUtf8(path);
  const ok = patterns.every((pattern) => source.includes(pattern));
  addCheck(ok, key, message, { path, requiredPatterns: patterns });
}

checkFile(
  "package.json",
  ['"website:ga:roadmap:readiness"', "check-website-ga-roadmap-readiness.mjs"],
  "package-script",
  "Package command exists for roadmap readiness validation"
);

checkFile(
  "tickets/P1-website-ga-30-day-priority-roadmap.md",
  [
    "Roadmap unblock pack update (2026-03-04)",
    "docs/runbooks/WEBSITE_GA_30_DAY_EXECUTION_HANDOFF.md",
    "docs/analytics/WEBSITE_GA_LIVE_EXECUTION_HANDOFF_TEMPLATE.md",
    "website:ga:roadmap:readiness",
    "Remaining external blockers",
  ],
  "roadmap-ticket",
  "Roadmap ticket captures unblock pack + explicit remaining external blockers"
);

checkFile(
  "docs/runbooks/WEBSITE_GA_30_DAY_EXECUTION_HANDOFF.md",
  [
    "Purpose",
    "Pre-flight (owner environment)",
    "Required owner-provided inputs",
    "Execution sequence",
    "Close conditions for roadmap ticket",
  ],
  "handoff-runbook",
  "30-day execution handoff runbook exists with operator sequence"
);

checkFile(
  "docs/analytics/WEBSITE_GA_LIVE_EXECUTION_HANDOFF_TEMPLATE.md",
  [
    "Snapshot metadata",
    "Experiment 1",
    "Experiment 2",
    "Day-30 readout",
    "Command checklist",
  ],
  "handoff-template",
  "Live execution handoff template captures owner-provided inputs and experiment outcomes"
);

const failed = checks.filter((check) => !check.ok);
const result = {
  ok: failed.length === 0,
  strict,
  failed: failed.length,
  checks,
};

if (asJson) {
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} else {
  for (const check of checks) {
    process.stdout.write(`${check.ok ? "PASS" : "FAIL"} ${check.key}: ${check.message}\n`);
  }
}

if (failed.length > 0) {
  process.exit(1);
}
