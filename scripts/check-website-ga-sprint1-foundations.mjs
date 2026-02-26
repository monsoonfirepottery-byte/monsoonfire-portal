#!/usr/bin/env node
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
  "docs/runbooks/WEBSITE_GA_SPRINT1_FOUNDATIONS.md",
  ["website:ga:sprint1:check", "artifacts/website-ga-sprint1-foundations.json", "Current blocker"],
  "runbook",
  "Sprint 1 GA runbook exists with command and blocker context",
);

checkFile(
  "docs/analytics/WEBSITE_GA_DATA_PACKAGE_TEMPLATE.md",
  ["Top Acquisition Channels", "Landing pages", "Event audit", "Goal table"],
  "data-package-template",
  "Data package template includes required export families",
);

checkFile(
  "docs/analytics/WEBSITE_GA_EVENT_GOAL_MAP_TEMPLATE.md",
  ["event_name", "goal_name", "funnel_step", "required_params"],
  "event-goal-template",
  "Event-goal mapping template defines canonical columns",
);

checkFile(
  "docs/analytics/WEBSITE_GA_UTM_TAXONOMY.md",
  ["utm_source", "utm_medium", "utm_campaign", "Canonical mediums"],
  "utm-taxonomy",
  "UTM taxonomy includes required parameters and medium policy",
);

checkFile(
  "tickets/P1-website-ga-data-package-template-and-access.md",
  ["Status: In Progress", "Unblock update (2026-02-25)"],
  "ticket-data-package",
  "Data package ticket reflects Sprint 1 foundation progress",
);

checkFile(
  "tickets/P1-website-ga-event-and-goal-instrumentation-completeness.md",
  ["Status: In Progress", "Unblock update (2026-02-25)"],
  "ticket-event-goal",
  "Event/goal instrumentation ticket reflects Sprint 1 foundation progress",
);

checkFile(
  "tickets/P1-website-ga-campaign-and-source-quality.md",
  ["Status: In Progress", "Unblock update (2026-02-25)"],
  "ticket-campaign-quality",
  "Campaign/source quality ticket reflects Sprint 1 foundation progress",
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
