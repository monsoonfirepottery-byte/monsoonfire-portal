#!/usr/bin/env node

/* eslint-disable no-console */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildAutomationFamilyBody, getAutomationFamily } from "./lib/automation-issue-families.mjs";
import {
  closeIssue,
  commentIssue,
  ensureGhLabels,
  ensureIssueWithMarker,
  fetchLatestIssueCommentBody,
  listRepoIssues,
  markerComment,
  parseRepoSlug,
} from "./lib/github-issues.mjs";

const __filename = fileURLToPath(import.meta.url);
const repoRoot = resolve(dirname(__filename), "..");
const DEFAULT_REPORT_PATH = resolve(repoRoot, "output", "qa", "github-automation-issue-cleanup.json");

const FAMILY_KEYS = ["portal-qa", "portal-infra", "codex-automation", "governance-tuning"];

const SUPERSeded_ISSUES = [
  {
    issueNumber: 116,
    familyKey: "portal-qa",
    stateReason: "not_planned",
    note: "Legacy rolling tracker replaced by the portal QA reliability coordination thread.",
  },
  {
    issueNumber: 103,
    familyKey: "portal-infra",
    stateReason: "not_planned",
    note: "Legacy rolling tracker replaced by the portal infra and security coordination thread.",
  },
  {
    issueNumber: 84,
    familyKey: "codex-automation",
    stateReason: "not_planned",
    note: "Legacy rolling tracker replaced by the Codex automation coordination thread.",
  },
  {
    issueNumber: 309,
    familyKey: "governance-tuning",
    stateReason: "not_planned",
    note: "Legacy rolling tracker replaced by the governance tuning coordination thread.",
  },
  { issueNumber: 315, familyKey: "portal-qa", stateReason: "not_planned", note: "Load-test rolling failures now aggregate into the portal QA family thread." },
  { issueNumber: 264, familyKey: "portal-qa", stateReason: "not_planned", note: "Older duplicate load-test rolling thread superseded by the portal QA family thread." },
  { issueNumber: 310, familyKey: "portal-qa", stateReason: "not_planned", note: "Smoke-test workflow failures now aggregate into the portal QA family thread." },
  { issueNumber: 115, familyKey: "portal-qa", stateReason: "not_planned", note: "Threshold tuning snapshots now live in the portal QA family thread." },
  { issueNumber: 140, familyKey: "codex-automation", stateReason: "not_planned", note: "Backlog autopilot reporting now rolls into the shared Codex automation thread." },
  { issueNumber: 45, familyKey: "codex-automation", stateReason: "not_planned", note: "Continuous improvement reporting now rolls into the shared Codex automation thread." },
  { issueNumber: 46, familyKey: "codex-automation", stateReason: "not_planned", note: "Interaction interrogation reporting now rolls into the shared Codex automation thread." },
  { issueNumber: 30, familyKey: "codex-automation", stateReason: "not_planned", note: "PR-green reporting now rolls into the shared Codex automation thread." },
  { issueNumber: 294, familyKey: "governance-tuning", stateReason: "not_planned", note: "Weekly governance tuning now comments into one rolling thread instead of date-stamped issues." },
];

const RECOVERED_ISSUES = [
  {
    issueNumber: 85,
    familyKey: "portal-qa",
    stateReason: "completed",
    evidencePath: "output/qa/portal-authenticated-canary.json",
    expectedStatus: "passed",
    note: "Authenticated canary is green again and future state changes now flow through the portal QA family thread.",
  },
  {
    issueNumber: 87,
    familyKey: "portal-infra",
    stateReason: "completed",
    evidencePath: "output/qa/credential-health-check.json",
    expectedStatus: "passed",
    note: "Credential health is currently passing and future updates now flow through the portal infra family thread.",
  },
  {
    issueNumber: 88,
    familyKey: "portal-infra",
    stateReason: "completed",
    evidencePath: "output/qa/branch-divergence-guard.json",
    expectedStatus: "passed",
    note: "Branch divergence guard is currently passing and future updates now flow through the portal infra family thread.",
  },
];

const FAMILY_SUMMARY_NOTES = {
  "portal-qa":
    "Automation cleanup on 2026-03-09 consolidated workflow-failure, canary, tuning, and weekly digest reporting here. Persistent deterministic failures stay open as dedicated child issues.",
  "portal-infra":
    "Automation cleanup on 2026-03-09 consolidated credential, index, and branch-integrity reporting here.",
  "codex-automation":
    "Automation cleanup on 2026-03-09 consolidated Codex improvement, interaction, PR-green, and backlog rollups here.",
  "governance-tuning":
    "Automation cleanup on 2026-03-09 switched governance tuning from date-stamped issues to this rolling thread.",
};

function parseArgs(argv) {
  const options = {
    apply: false,
    asJson: false,
    reportPath: DEFAULT_REPORT_PATH,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg || !arg.startsWith("--")) continue;

    if (arg === "--apply") {
      options.apply = true;
      continue;
    }
    if (arg === "--dry-run") {
      options.apply = false;
      continue;
    }
    if (arg === "--json") {
      options.asJson = true;
      continue;
    }

    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      throw new Error(`Missing value for ${arg}`);
    }

    if (arg === "--report") {
      options.reportPath = resolve(process.cwd(), String(next).trim());
      index += 1;
      continue;
    }
  }

  return options;
}

async function readStatus(pathValue) {
  try {
    const raw = await readFile(resolve(repoRoot, pathValue), "utf8");
    const parsed = JSON.parse(raw);
    return String(parsed?.status || "").trim().toLowerCase();
  } catch {
    return "";
  }
}

function buildMigrationComment({ familyIssueNumber, familyTitle, note, evidencePath = "", evidenceStatus = "" }) {
  const lines = [];
  lines.push(note);
  lines.push("");
  lines.push(`Follow-up lives in #${familyIssueNumber} (${familyTitle}).`);
  if (evidencePath && evidenceStatus) {
    lines.push(`Latest local evidence: \`${evidencePath}\` reports status=\`${evidenceStatus}\`.`);
  }
  return lines.join("\n");
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const repoSlug = parseRepoSlug({ cwd: repoRoot });
  if (!repoSlug) {
    throw new Error("Could not resolve repository slug from environment or git remote.");
  }

  const openIssuesResp = listRepoIssues(repoSlug, { state: "open", maxPages: 2, cwd: repoRoot });
  if (!openIssuesResp.ok) {
    throw new Error(`Could not read open issues: ${openIssuesResp.error}`);
  }
  const openIssueMap = new Map(openIssuesResp.data.map((issue) => [issue.number, issue]));

  const report = {
    status: "ok",
    generatedAtIso: new Date().toISOString(),
    mode: options.apply ? "apply" : "dry-run",
    canonicalIssues: [],
    closures: [],
    notes: [],
  };

  const familyResults = new Map();
  for (const familyKey of FAMILY_KEYS) {
    const family = getAutomationFamily(familyKey);
    if (!family) continue;
    ensureGhLabels(repoSlug, family.labels, { cwd: repoRoot });
    const ensured = ensureIssueWithMarker(
      repoSlug,
      {
        title: family.title,
        body: buildAutomationFamilyBody(family),
        labels: family.labels.map((label) => label.name),
        marker: family.marker,
        preferredNumber: family.preferredNumber,
        openIssues: openIssuesResp.data,
      },
      { cwd: repoRoot }
    );
    if (!ensured.ok || !ensured.issue) {
      throw new Error(`Could not resolve ${familyKey} family issue: ${ensured.error || "unknown error"}`);
    }
    familyResults.set(familyKey, ensured.issue);

    const cleanupMarker = `automation-cleanup:family:${family.key}:2026-03-09`;
    if (options.apply) {
      const latestComment = fetchLatestIssueCommentBody(repoSlug, ensured.issue.number, { cwd: repoRoot });
      if (!latestComment.includes(markerComment(cleanupMarker))) {
        commentIssue(
          repoSlug,
          ensured.issue.number,
          `${FAMILY_SUMMARY_NOTES[family.key]}\n\n${markerComment(cleanupMarker)}\n`,
          { cwd: repoRoot }
        );
      }
    }

    report.canonicalIssues.push({
      familyKey,
      issueNumber: ensured.issue.number,
      issueUrl: ensured.issue.url,
      title: ensured.issue.title,
      created: ensured.created,
      updated: ensured.updated,
    });
  }

  const closePlans = [...SUPERSeded_ISSUES];
  for (const recovered of RECOVERED_ISSUES) {
    const evidenceStatus = await readStatus(recovered.evidencePath);
    closePlans.push({ ...recovered, evidenceStatus });
  }

  for (const plan of closePlans) {
    const issue = openIssueMap.get(plan.issueNumber);
    const familyIssue = familyResults.get(plan.familyKey);
    if (!issue || !familyIssue) {
      report.closures.push({
        issueNumber: plan.issueNumber,
        result: "skip-missing",
        familyKey: plan.familyKey,
      });
      continue;
    }

    if ("expectedStatus" in plan && plan.expectedStatus && plan.evidenceStatus !== plan.expectedStatus) {
      report.closures.push({
        issueNumber: plan.issueNumber,
        result: "skip-evidence-mismatch",
        familyKey: plan.familyKey,
        evidenceStatus: plan.evidenceStatus,
      });
      continue;
    }

    const commentBody = buildMigrationComment({
      familyIssueNumber: familyIssue.number,
      familyTitle: familyIssue.title,
      note: plan.note,
      evidencePath: plan.evidencePath || "",
      evidenceStatus: plan.evidenceStatus || "",
    });

    if (options.apply) {
      const closed = closeIssue(
        repoSlug,
        plan.issueNumber,
        {
          commentBody,
          stateReason: plan.stateReason,
        },
        { cwd: repoRoot }
      );
      if (!closed.ok) {
        throw new Error(`Could not close issue #${plan.issueNumber}.`);
      }
    }

    report.closures.push({
      issueNumber: plan.issueNumber,
      result: options.apply ? "closed" : "planned-close",
      familyKey: plan.familyKey,
      stateReason: plan.stateReason,
      evidenceStatus: plan.evidenceStatus || "",
    });
  }

  await mkdir(dirname(options.reportPath), { recursive: true });
  await writeFile(options.reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  if (options.asJson) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(`status: ${report.status}\n`);
    process.stdout.write(`mode: ${report.mode}\n`);
    process.stdout.write(`canonicalIssues: ${String(report.canonicalIssues.length)}\n`);
    process.stdout.write(`closures: ${String(report.closures.length)}\n`);
    process.stdout.write(`report: ${options.reportPath}\n`);
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`github-automation-issue-cleanup failed: ${message}`);
  process.exit(1);
});
