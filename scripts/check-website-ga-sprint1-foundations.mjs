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
  [
    "website:ga:sprint1:check",
    "artifacts/website-ga-sprint1-foundations.json",
    "website:ga:baseline:report",
    "artifacts/ga/reports/website-ga-acquisition-quality-latest.json",
    "website:ga:event-goal:check",
    "artifacts/ga/reports/website-ga-event-goal-check-latest.json",
    "website:ga:campaign:audit",
    "artifacts/ga/reports/website-ga-campaign-link-audit-latest.json",
    "website:ga:data-package:check",
    "artifacts/ga/reports/website-ga-data-package-check-latest.json",
    "website:ga:funnel:report",
    "artifacts/ga/reports/website-ga-funnel-friction-latest.json",
    "website:ga:experiments:backlog",
    "artifacts/ga/reports/website-ga-experiment-backlog-latest.json",
    "website:ga:content:opportunities",
    "artifacts/ga/reports/website-ga-content-opportunities-latest.json",
    "website:ga:dashboard:weekly",
    "artifacts/ga/reports/website-ga-weekly-dashboard-latest.json",
    "Current blocker",
  ],
  "runbook",
  "GA runbook exists with command matrix and blocker context",
);

checkFile(
  "package.json",
  [
    '"website:ga:sprint1:check"',
    '"website:ga:baseline:report"',
    '"website:ga:event-goal:check"',
    '"website:ga:campaign:audit"',
    '"website:ga:data-package:check"',
    '"website:ga:funnel:report"',
    '"website:ga:experiments:backlog"',
    '"website:ga:content:opportunities"',
    '"website:ga:dashboard:weekly"',
  ],
  "package-scripts",
  "Package scripts include GA instrumentation, funnel, content, and dashboard automation commands",
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
  "docs/analytics/WEBSITE_GA_EVENT_GOAL_MAP.md",
  ["Version:", "cta_primary_click", "quote_form_submit", "Weekly validation checklist"],
  "event-goal-canonical-map",
  "Canonical event-goal map captures implemented conversion contract and weekly validation",
);

checkFile(
  "docs/analytics/WEBSITE_GA_UTM_TAXONOMY.md",
  ["utm_source", "utm_medium", "utm_campaign", "Canonical mediums"],
  "utm-taxonomy",
  "UTM taxonomy includes required parameters and medium policy",
);

checkFile(
  "docs/analytics/WEBSITE_GA_WEEKLY_REPORT_TEMPLATE.md",
  ["Week ending (UTC)", "KPI summary", "Alerts and escalations"],
  "weekly-report-template",
  "Weekly report template includes cadence fields and escalation section",
);

checkFile(
  "docs/analytics/WEBSITE_GA_ALERT_THRESHOLDS.md",
  ["sessionsTotalTop10Sources", "averageTopFunnelConversionPct", "assistedRevenueTotal", "simulate-breach"],
  "alert-thresholds",
  "Alert threshold doc defines metric gates and dry-run validation",
);

checkFile(
  "tickets/P1-website-ga-data-package-template-and-access.md",
  ["Status:", "Unblock update (2026-02-25)", "Progress update (2026-02-28)"],
  "ticket-data-package",
  "Data package ticket reflects Sprint 1 foundation progress",
);

checkFile(
  "tickets/P1-website-ga-event-and-goal-instrumentation-completeness.md",
  ["Status:", "Unblock update (2026-02-25)", "Progress update (2026-02-28)"],
  "ticket-event-goal",
  "Event/goal instrumentation ticket reflects Sprint 1 foundation progress",
);

checkFile(
  "tickets/P1-website-ga-campaign-and-source-quality.md",
  ["Status:", "Unblock update (2026-02-25)", "Progress update (2026-02-28)"],
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
