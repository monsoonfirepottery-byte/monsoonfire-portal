#!/usr/bin/env node

/* eslint-disable no-console */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildAutomationFamilyBody, getAutomationFamily } from "../lib/automation-issue-families.mjs";
import {
  commentIssue,
  ensureGhLabels,
  ensureIssueWithMarker,
  fetchLatestIssueCommentBody,
  listRepoIssues,
  markerComment,
  parseRepoSlug,
} from "../lib/github-issues.mjs";

const __filename = fileURLToPath(import.meta.url);
const repoRoot = resolve(dirname(__filename), "..", "..");

const DEFAULT_REPORT_PATH = resolve(repoRoot, "output", "governance", "weekly-tune-report.json");
const DEFAULT_OUTPUT_PATH = resolve(repoRoot, "output", "governance", "weekly-tune-issue.json");
const GOVERNANCE_FAMILY = getAutomationFamily("governance-tuning");

function parseArgs(argv) {
  const options = {
    reportPath: DEFAULT_REPORT_PATH,
    outputPath: DEFAULT_OUTPUT_PATH,
    apply: true,
    asJson: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg || !arg.startsWith("--")) continue;

    if (arg === "--json") {
      options.asJson = true;
      continue;
    }
    if (arg === "--apply") {
      options.apply = true;
      continue;
    }
    if (arg === "--no-apply") {
      options.apply = false;
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
    if (arg === "--output") {
      options.outputPath = resolve(process.cwd(), String(next).trim());
      index += 1;
      continue;
    }
  }

  return options;
}

function formatRate(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "n/a";
  return numeric.toFixed(4);
}

function buildComment(report, marker) {
  const lines = [];
  lines.push(`## ${String(report.generated_at || "").slice(0, 10) || new Date().toISOString().slice(0, 10)} — weekly tuning summary`);
  lines.push("");
  lines.push("Weekly governance tuning summary (proposal-only).");
  lines.push("");
  lines.push(`- verification_hold_rate: ${formatRate(report.metrics?.verification_hold_rate)}`);
  lines.push(`- false_positive_rate: ${formatRate(report.metrics?.false_positive_rate)}`);
  lines.push(`- ci_failure_loop_rate: ${formatRate(report.metrics?.ci_failure_loop_rate)}`);
  lines.push(`- audit_workload_per_week: ${String(report.metrics?.audit_workload_per_week ?? "n/a")}`);
  lines.push("");
  lines.push("Proposed threshold updates:");
  lines.push("```json");
  lines.push(JSON.stringify(report.proposed_thresholds || {}, null, 2));
  lines.push("```");
  lines.push("");
  lines.push("Notes:");
  const notes = Array.isArray(report.tuning_notes) ? report.tuning_notes : [];
  if (notes.length === 0) {
    lines.push("- No tuning notes recorded.");
  } else {
    for (const note of notes) {
      lines.push(`- ${String(note || "").trim()}`);
    }
  }
  lines.push("");
  lines.push(markerComment(marker));
  lines.push("");
  return lines.join("\n");
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const raw = await readFile(options.reportPath, "utf8");
  const report = JSON.parse(raw);
  const repoSlug = parseRepoSlug({ cwd: repoRoot });
  if (!repoSlug) {
    throw new Error("Could not resolve repository slug from environment or git remote.");
  }

  const summary = {
    status: "ok",
    generatedAtIso: new Date().toISOString(),
    reportPath: options.reportPath,
    outputPath: options.outputPath,
    issueNumber: 0,
    issueUrl: "",
    result: options.apply ? "pending" : "dry-run",
    marker: `governance-weekly-tuning:${String(report.generated_at || "").slice(0, 10) || "manual"}`,
    notes: [],
  };

  if (!options.apply) {
    summary.result = "dry-run";
  } else {
    const openIssuesResp = listRepoIssues(repoSlug, { state: "open", maxPages: 2, cwd: repoRoot });
    if (!openIssuesResp.ok) {
      throw new Error(`Could not read open issues: ${openIssuesResp.error}`);
    }

    ensureGhLabels(repoSlug, GOVERNANCE_FAMILY.labels, { cwd: repoRoot });
    const ensured = ensureIssueWithMarker(
      repoSlug,
      {
        title: GOVERNANCE_FAMILY.title,
        body: buildAutomationFamilyBody(GOVERNANCE_FAMILY),
        labels: GOVERNANCE_FAMILY.labels.map((label) => label.name),
        marker: GOVERNANCE_FAMILY.marker,
        preferredNumber: GOVERNANCE_FAMILY.preferredNumber,
        openIssues: openIssuesResp.data,
      },
      { cwd: repoRoot }
    );
    if (!ensured.ok || !ensured.issue) {
      throw new Error(`Could not resolve governance family issue: ${ensured.error || "unknown error"}`);
    }

    summary.issueNumber = ensured.issue.number;
    summary.issueUrl = ensured.issue.url;
    const latestComment = fetchLatestIssueCommentBody(repoSlug, ensured.issue.number, { cwd: repoRoot });
    if (latestComment.includes(markerComment(summary.marker))) {
      summary.result = "unchanged-skip";
    } else {
      const comment = commentIssue(repoSlug, ensured.issue.number, buildComment(report, summary.marker), {
        cwd: repoRoot,
      });
      if (!comment.ok) {
        throw new Error("Could not post governance weekly tuning comment.");
      }
      summary.result = "commented";
    }
  }

  await mkdir(dirname(options.outputPath), { recursive: true });
  await writeFile(options.outputPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");

  if (options.asJson) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  } else {
    process.stdout.write(`status: ${summary.status}\n`);
    process.stdout.write(`result: ${summary.result}\n`);
    process.stdout.write(`issue: ${summary.issueUrl || "n/a"}\n`);
    process.stdout.write(`output: ${summary.outputPath}\n`);
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`publish-weekly-tuning-issue failed: ${message}`);
  process.exit(1);
});
