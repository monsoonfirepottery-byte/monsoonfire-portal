#!/usr/bin/env node

/* eslint-disable no-console */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runResolved } from "./lib/command-runner.mjs";
import { loadPortalAutomationEnv } from "./lib/runtime-secrets.mjs";

const __filename = fileURLToPath(import.meta.url);
const repoRoot = resolve(dirname(__filename), "..");
const DEFAULT_REPORT_JSON = resolve(repoRoot, "output", "qa", "portal-firebase-ops.json");
const DEFAULT_REPORT_MARKDOWN = resolve(repoRoot, "output", "qa", "portal-firebase-ops.md");

loadPortalAutomationEnv();

function clean(value) {
  return String(value ?? "").trim();
}

function parseJsonObjectFromMixedOutput(text) {
  const raw = clean(text);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    const firstBrace = raw.indexOf("{");
    const lastBrace = raw.lastIndexOf("}");
    if (firstBrace < 0 || lastBrace <= firstBrace) return null;
    try {
      return JSON.parse(raw.slice(firstBrace, lastBrace + 1));
    } catch {
      return null;
    }
  }
}

export function inspectPortalFirebaseErrorText(text) {
  const raw = clean(text);
  const normalized = raw.toLowerCase();
  if (!normalized) return [];

  const findings = [];
  if (/failed-precondition|requires an index|create it here/i.test(raw)) {
    findings.push({
      code: "firestore-index-required",
      severity: "warning",
      summary: "Composite Firestore index likely missing for the failing query shape.",
      nextAction: "Run `npm run portal:index:guard` and inspect `firestore.indexes.json` plus the index troubleshooting runbook.",
    });
  }
  if (/missing or insufficient permissions|permission-denied|insufficient permissions/i.test(raw)) {
    findings.push({
      code: "firestore-rules-or-auth",
      severity: "warning",
      summary: "Firestore auth or rules enforcement is likely blocking the request.",
      nextAction: "Run `npm run rules:index:drift:blocker` and `npm run secrets:health:check` to separate token issues from rules drift.",
    });
  }
  if (/undefined/i.test(raw) && /firestore|batch|document|write/i.test(raw)) {
    findings.push({
      code: "firestore-undefined-write",
      severity: "warning",
      summary: "A Firestore write appears to include `undefined` where the repo contract expects omit-or-null semantics.",
      nextAction: "Strip `undefined` fields before write and use `null` only where schema allows it.",
    });
  }
  return findings;
}

function parseArgs(argv) {
  const options = {
    asJson: false,
    strict: false,
    includeDeployPreflight: true,
    reportJsonPath: DEFAULT_REPORT_JSON,
    reportMarkdownPath: DEFAULT_REPORT_MARKDOWN,
    errorText: "",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = clean(argv[index]);
    if (!arg) continue;

    if (arg === "--json") {
      options.asJson = true;
      continue;
    }
    if (arg === "--strict") {
      options.strict = true;
      continue;
    }
    if (arg === "--skip-deploy-preflight") {
      options.includeDeployPreflight = false;
      continue;
    }

    const next = clean(argv[index + 1]);
    if (!next || next.startsWith("--")) {
      throw new Error(`Missing value for ${arg}`);
    }

    if (arg === "--report-json") {
      options.reportJsonPath = resolve(process.cwd(), next);
      index += 1;
      continue;
    }
    if (arg === "--report-markdown") {
      options.reportMarkdownPath = resolve(process.cwd(), next);
      index += 1;
      continue;
    }
    if (arg === "--error-text") {
      options.errorText = next;
      index += 1;
      continue;
    }
  }

  return options;
}

function runJsonScript(label, relativeScriptPath, args = []) {
  const scriptPath = resolve(repoRoot, relativeScriptPath);
  const result = runResolved(process.execPath, [scriptPath, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    env: process.env,
  });
  return {
    label,
    ok: result.status === 0,
    exitCode: result.status ?? 1,
    stdout: clean(result.stdout),
    stderr: clean(result.stderr),
    payload: parseJsonObjectFromMixedOutput(result.stdout),
    command: `node ${relativeScriptPath} ${args.join(" ")}`.trim(),
  };
}

function summarizeCheck(run, { required = true, detail = "" } = {}) {
  const payloadStatus = clean(run.payload?.status || run.payload?.summary?.status);
  const status = run.ok || payloadStatus === "passed" || payloadStatus === "pass" ? "passed" : "failed";
  return {
    label: run.label,
    required,
    status,
    detail: detail || clean(run.payload?.message || run.payload?.summary || run.stderr || run.stdout),
    command: run.command,
  };
}

function buildMarkdown(summary) {
  const lines = [
    "# Portal Firebase Ops Toolbox",
    "",
    `- generatedAt: ${summary.generatedAt}`,
    `- status: ${summary.status}`,
    "",
    "## Checks",
    ...summary.checks.map(
      (check) =>
        `- ${check.label}: ${check.status}${check.required ? "" : " (optional)"}${check.detail ? ` - ${check.detail}` : ""}`
    ),
  ];

  if (summary.errorFindings.length > 0) {
    lines.push("", "## Error Text Findings");
    for (const finding of summary.errorFindings) {
      lines.push(`- ${finding.code}: ${finding.summary} Next: ${finding.nextAction}`);
    }
  }

  if (summary.nextActions.length > 0) {
    lines.push("", "## Next Actions", ...summary.nextActions.map((action) => `- ${action}`));
  }

  return `${lines.join("\n")}\n`;
}

export async function runPortalFirebaseOpsToolbox(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);

  const runs = [
    runJsonScript("credential health", "scripts/credentials-health-check.mjs", [
      "--json",
      "--no-github",
      "--no-apply",
      "--rules-probe-optional",
    ]),
    runJsonScript("firestore index guard", "scripts/firestore-index-contract-guard.mjs", [
      "--strict",
      "--json",
      "--no-github",
      "--report",
      resolve(repoRoot, "output", "qa", "portal-firebase-ops-index-guard.json"),
    ]),
    runJsonScript("firestore rules drift check", "scripts/sync-firestore-rules-releases.mjs", ["--check", "--json"]),
  ];

  if (options.includeDeployPreflight) {
    runs.push(
      runJsonScript("deploy preflight", "scripts/deploy-preflight.mjs", [
        "--target",
        "namecheap-portal",
        "--json",
        "--skip-promotion-gate",
      ])
    );
  }

  const checks = [
    summarizeCheck(runs[0], {
      required: true,
      detail: clean(runs[0].payload?.status ? `status=${runs[0].payload.status}` : runs[0].stderr),
    }),
    summarizeCheck(runs[1], {
      required: true,
      detail: clean(runs[1].payload?.summary || runs[1].stderr),
    }),
    summarizeCheck(runs[2], {
      required: true,
      detail: clean(runs[2].payload?.message || runs[2].stderr),
    }),
    ...runs.slice(3).map((run) =>
      summarizeCheck(run, {
        required: false,
        detail: clean(run.payload?.status ? `status=${run.payload.status}` : run.stderr),
      })
    ),
  ];

  const errorFindings = inspectPortalFirebaseErrorText(options.errorText);
  const nextActions = [];
  for (const check of checks) {
    if (check.status !== "failed") continue;
    nextActions.push(`${check.label}: rerun ${check.command}`);
  }
  for (const finding of errorFindings) {
    nextActions.push(`${finding.code}: ${finding.nextAction}`);
  }

  const requiredFailure = checks.some((check) => check.required && check.status === "failed");
  const summary = {
    generatedAt: new Date().toISOString(),
    status: requiredFailure ? "failed" : "passed",
    checks,
    errorFindings,
    nextActions,
    reportJsonPath: options.reportJsonPath,
    reportMarkdownPath: options.reportMarkdownPath,
  };

  await mkdir(dirname(options.reportJsonPath), { recursive: true });
  await mkdir(dirname(options.reportMarkdownPath), { recursive: true });
  await writeFile(options.reportJsonPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  await writeFile(options.reportMarkdownPath, buildMarkdown(summary), "utf8");

  if (options.asJson) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  } else {
    process.stdout.write(`status: ${summary.status}\n`);
    for (const check of checks) {
      process.stdout.write(`- ${check.label}: ${check.status}${check.required ? "" : " (optional)"}\n`);
    }
    for (const finding of errorFindings) {
      process.stdout.write(`- error finding ${finding.code}: ${finding.summary}\n`);
    }
    process.stdout.write(`report json: ${options.reportJsonPath}\n`);
    process.stdout.write(`report markdown: ${options.reportMarkdownPath}\n`);
  }

  if (options.strict && summary.status === "failed") {
    process.exitCode = 1;
  }

  return summary;
}

if (process.argv[1] && resolve(process.argv[1]) === __filename) {
  runPortalFirebaseOpsToolbox().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`portal-firebase-ops-toolbox failed: ${message}`);
    process.exit(1);
  });
}
