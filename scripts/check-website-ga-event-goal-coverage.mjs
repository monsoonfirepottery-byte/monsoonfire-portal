#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const repoRoot = process.cwd();
const args = new Set(process.argv.slice(2));
const asJson = args.has("--json");
const strict = args.has("--strict");

const checks = [];
const outputDir = resolve(repoRoot, "artifacts", "ga", "reports");
const requiredEvents = [
  "cta_primary_click",
  "quote_form_open",
  "quote_form_submit",
  "contact_phone_click",
  "contact_email_click",
  "whatsapp_click",
];

function readUtf8(path) {
  return readFileSync(resolve(repoRoot, path), "utf8");
}

function addCheck(ok, key, message, details = null) {
  checks.push({ ok, key, message, details });
}

function checkFileHas(path, requiredPatterns, key, message) {
  if (!existsSync(resolve(repoRoot, path))) {
    addCheck(false, key, `${message} (missing file)`, { path });
    return;
  }
  const source = readUtf8(path);
  const missing = requiredPatterns.filter((pattern) => !source.includes(pattern));
  addCheck(missing.length === 0, key, message, {
    path,
    missing,
  });
}

function checkCanonicalDoc() {
  const path = "docs/analytics/WEBSITE_GA_EVENT_GOAL_MAP.md";
  if (!existsSync(resolve(repoRoot, path))) {
    addCheck(false, "canonical-map", "Canonical GA event-goal map exists", { path });
    return;
  }

  const source = readUtf8(path);
  const eventsInDoc = source
    .split(/\r?\n/)
    .map((line) => {
      const match = line.match(/^\|\s*`([^`]+)`\s*\|/);
      return match ? match[1] : null;
    })
    .filter(Boolean);
  const missingEvents = requiredEvents.filter((eventName) => !eventsInDoc.includes(eventName));
  const duplicateEvents = eventsInDoc.filter((eventName, index) => eventsInDoc.indexOf(eventName) !== index);

  addCheck(missingEvents.length === 0, "canonical-map-events", "Canonical map includes all required website conversion events", {
    path,
    missingEvents,
  });
  addCheck(duplicateEvents.length === 0, "canonical-map-duplicates", "Canonical map avoids duplicate event names", {
    path,
    duplicateEvents: [...new Set(duplicateEvents)],
  });
  addCheck(source.includes("Weekly validation checklist"), "canonical-map-weekly-checklist", "Canonical map includes weekly validation checklist", {
    path,
  });
}

checkCanonicalDoc();

checkFileHas(
  "website/assets/js/main.js",
  ["cta_primary_click", "contact_phone_click", "contact_email_click", "whatsapp_click", "utm_source", "utm_campaign"],
  "website-main-instrumentation",
  "Primary website runtime emits canonical CTA/contact events with campaign metadata"
);

checkFileHas(
  "website/ncsitebuilder/assets/js/main.js",
  ["cta_primary_click", "contact_phone_click", "contact_email_click", "whatsapp_click", "utm_source", "utm_campaign"],
  "ncsitebuilder-main-instrumentation",
  "NC Site Builder runtime emits canonical CTA/contact events with campaign metadata"
);

checkFileHas(
  "website/contact/index.html",
  ["quote_form_open", "quote_form_submit", "goal_name", "funnel_step", "contact_intake_2026q1"],
  "website-contact-form",
  "Primary contact form emits open and submit conversion events"
);

checkFileHas(
  "website/ncsitebuilder/contact/index.html",
  ["quote_form_open", "quote_form_submit", "goal_name", "funnel_step", "contact_intake_2026q1"],
  "ncsitebuilder-contact-form",
  "NC Site Builder contact form emits open and submit conversion events"
);

const failed = checks.filter((check) => !check.ok);
const runId = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
const jsonPath = join(outputDir, `website-ga-event-goal-check-${runId}.json`);
const latestJsonPath = join(outputDir, "website-ga-event-goal-check-latest.json");
mkdirSync(outputDir, { recursive: true });

const result = {
  ok: failed.length === 0,
  strict,
  failed: failed.length,
  checks,
  outputs: {
    jsonPath,
    latestJsonPath,
  },
};

writeFileSync(jsonPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
writeFileSync(latestJsonPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");

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
