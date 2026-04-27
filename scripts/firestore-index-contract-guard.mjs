#!/usr/bin/env node

/* eslint-disable no-console */

import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { access } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildAutomationFamilyBody, getAutomationFamily } from "./lib/automation-issue-families.mjs";
import {
  ensureGhLabels,
  ensureIssueWithMarker,
  fetchLatestIssueCommentBody,
  listRepoIssues,
} from "./lib/github-issues.mjs";

const __filename = fileURLToPath(import.meta.url);
const repoRoot = resolve(dirname(__filename), "..");
const indexesPath = resolve(repoRoot, "firestore.indexes.json");
const codexDir = resolve(repoRoot, ".codex");
const logPath = resolve(codexDir, "index-guard-log.md");
const PORTAL_INFRA_FAMILY = getAutomationFamily("portal-infra");

const requiredIndexes = [
  {
    id: "directMessages-participantUids-lastMessageAt",
    collectionGroup: "directMessages",
    queryScope: "COLLECTION",
    fields: [
      { fieldPath: "participantUids", arrayConfig: "CONTAINS" },
      { fieldPath: "lastMessageAt", order: "DESCENDING" },
    ],
    reason: "Messages page thread list query (participantUids array-contains + orderBy lastMessageAt desc)",
  },
  {
    id: "reservations-ownerUid-createdAt",
    collectionGroup: "reservations",
    queryScope: "COLLECTION",
    fields: [
      { fieldPath: "ownerUid", order: "ASCENDING" },
      { fieldPath: "createdAt", order: "DESCENDING" },
    ],
    reason: "Ware Check-in list query (ownerUid equality + orderBy createdAt desc)",
  },
  {
    id: "batches-ownerUid-isClosed-updatedAt",
    collectionGroup: "batches",
    queryScope: "COLLECTION",
    fields: [
      { fieldPath: "ownerUid", order: "ASCENDING" },
      { fieldPath: "isClosed", order: "ASCENDING" },
      { fieldPath: "updatedAt", order: "DESCENDING" },
    ],
    reason: "My pieces active batch list",
  },
  {
    id: "deviceTokens-active-updatedAt",
    collectionGroup: "deviceTokens",
    queryScope: "COLLECTION_GROUP",
    fields: [
      { fieldPath: "active", order: "ASCENDING" },
      { fieldPath: "updatedAt", order: "ASCENDING" },
    ],
    reason: "Stale device token cleanup scheduler (collectionGroup active + updatedAt cutoff)",
  },
  {
    id: "notificationJobs-status-runAfter",
    collectionGroup: "notificationJobs",
    queryScope: "COLLECTION",
    fields: [
      { fieldPath: "status", order: "ASCENDING" },
      { fieldPath: "runAfter", order: "ASCENDING" },
    ],
    reason: "Queued notification processor scheduler (status equality + runAfter cutoff)",
  },
];

function parseArgs(argv) {
  const options = {
    apply: false,
    strict: true,
    asJson: false,
    includeGithub: true,
    writeLog: false,
    projectId: process.env.PORTAL_PROJECT_ID || "monsoonfire-portal",
    reportPath: resolve(repoRoot, "output", "qa", "firestore-index-contract-guard.json"),
    feedbackPath: String(process.env.FIRESTORE_INDEX_GUARD_FEEDBACK || "").trim(),
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg) continue;

    if (arg === "--apply") {
      options.apply = true;
      continue;
    }
    if (arg === "--no-strict") {
      options.strict = false;
      continue;
    }
    if (arg === "--strict") {
      options.strict = true;
      continue;
    }
    if (arg === "--json") {
      options.asJson = true;
      continue;
    }
    if (arg === "--no-github") {
      options.includeGithub = false;
      continue;
    }
    if (arg === "--write-log") {
      options.writeLog = true;
      continue;
    }
    if (arg === "--no-write-log") {
      options.writeLog = false;
      continue;
    }

    const next = argv[index + 1];
    if (!arg.startsWith("--")) continue;
    if (!next || next.startsWith("--")) {
      throw new Error(`Missing value for ${arg}`);
    }

    if (arg === "--project") {
      options.projectId = String(next).trim();
      index += 1;
      continue;
    }
    if (arg === "--report") {
      options.reportPath = resolve(process.cwd(), String(next).trim());
      index += 1;
      continue;
    }
    if (arg === "--feedback") {
      options.feedbackPath = resolve(process.cwd(), String(next).trim());
      index += 1;
      continue;
    }
  }

  return options;
}

async function pathExists(path) {
  try {
    await access(path, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function readJsonSafe(path) {
  if (!(await pathExists(path))) return null;
  try {
    const raw = await readFile(path, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function runCommand(command, args, { allowFailure = false } = {}) {
  const startedAt = Date.now();
  const result = spawnSync(command, args, { cwd: repoRoot, encoding: "utf8" });
  const durationMs = Date.now() - startedAt;
  const code = typeof result.status === "number" ? result.status : 1;
  const ok = code === 0;
  const stdout = String(result.stdout || "").trim();
  const stderr = String(result.stderr || "").trim();
  if (!ok && !allowFailure) {
    throw new Error(`Command failed (${code}): ${command} ${args.join(" ")}\n${stderr || stdout}`);
  }
  return { ok, code, stdout, stderr, durationMs };
}

function indexSignature(indexDef) {
  const group = String(indexDef.collectionGroup || "").trim();
  const scope = String(indexDef.queryScope || "COLLECTION").trim();
  const fields = Array.isArray(indexDef.fields)
    ? indexDef.fields.map((field) => {
        if (field.arrayConfig) {
          return `${field.fieldPath}:array:${field.arrayConfig}`;
        }
        return `${field.fieldPath}:order:${field.order || "ASCENDING"}`;
      })
    : [];

  return `${group}|${scope}|${fields.join(",")}`;
}

function parseRepoSlug() {
  const envSlug = String(process.env.GITHUB_REPOSITORY || "").trim();
  if (envSlug) return envSlug;

  const remote = runCommand("git", ["config", "--get", "remote.origin.url"], { allowFailure: true });
  if (!remote.ok || !remote.stdout) return "";

  const value = remote.stdout.trim();
  const sshMatch = value.match(/^git@github\.com:([^/]+\/[^/.]+)(?:\.git)?$/i);
  if (sshMatch) return sshMatch[1];
  const httpsMatch = value.match(/^https:\/\/github\.com\/([^/]+\/[^/.]+)(?:\.git)?$/i);
  if (httpsMatch) return httpsMatch[1];
  return "";
}

function formatMissing(missing) {
  if (missing.length === 0) return ["- None"];
  return missing.map((item) => `- ${item.id}: ${item.reason}`);
}

async function appendLog(summary) {
  await mkdir(codexDir, { recursive: true });
  if (!(await pathExists(logPath))) {
    await writeFile(logPath, "# Firestore Index Guard Log\n\n", "utf8");
  }

  const lines = [];
  lines.push(`## ${summary.runAtIso}`);
  lines.push("");
  lines.push(`- Status: ${summary.status}`);
  lines.push(`- Project: ${summary.projectId}`);
  lines.push(`- Required index count: ${summary.requiredCount}`);
  lines.push(`- Missing index count: ${summary.missing.length}`);
  lines.push("- Missing indexes:");
  lines.push(...formatMissing(summary.missing));
  if (summary.rollingIssueUrl) {
    lines.push(`- Rolling issue: ${summary.rollingIssueUrl}`);
  }
  if (summary.ticketUrl) {
    lines.push(`- Alert ticket: ${summary.ticketUrl}`);
  }
  lines.push("");

  await appendFile(logPath, `${lines.join("\n")}\n`, "utf8");
}

function createAlertIssue(repoSlug, summary) {
  const title = "[Index Guard] Missing required Firestore indexes";
  const existing = runCommand(
    "gh",
    [
      "issue",
      "list",
      "--repo",
      repoSlug,
      "--state",
      "open",
      "--search",
      `in:title \"${title}\"`,
      "--json",
      "url,title",
    ],
    { allowFailure: true }
  );

  if (existing.ok) {
    try {
      const parsed = JSON.parse(existing.stdout || "[]");
      const match = parsed.find((item) => String(item?.title || "") === title);
      if (match) {
        return match.url || "";
      }
    } catch {
      // ignore
    }
  }

  const body = [
    "Portal index guard detected missing required Firestore composite indexes.",
    "",
    `Run: ${summary.runAtIso}`,
    "",
    "Missing indexes:",
    ...formatMissing(summary.missing),
    "",
    "Follow-up:",
    "1. Add missing index specs to firestore.indexes.json.",
    "2. Deploy with `firebase deploy --only firestore:indexes --project monsoonfire-portal`.",
    "3. Re-run index guard + portal canary.",
  ].join("\n");

  const created = runCommand(
    "gh",
    [
      "issue",
      "create",
      "--repo",
      repoSlug,
      "--title",
      title,
      "--body",
      body,
      "--label",
      "automation",
      "--label",
      "bug",
      "--label",
      "firestore",
    ],
    { allowFailure: true }
  );

  if (!created.ok || !created.stdout) return "";
  return created.stdout.split(/\s+/).find((token) => /^https:\/\/github\.com\//.test(token)) || "";
}

function buildRollingCommentSignature(summary) {
  const payload = {
    status: summary.status,
    projectId: summary.projectId,
    requiredCount: summary.requiredCount,
    missing: (Array.isArray(summary.missing) ? summary.missing : []).map((item) => ({
      id: String(item?.id || ""),
      reason: String(item?.reason || ""),
    })),
  };
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex").slice(0, 20);
}

function buildRollingComment(summary, marker) {
  const lines = [];
  lines.push(`## ${summary.runAtIso} (Index Guard)`);
  lines.push("");
  lines.push(`- Status: ${summary.status}`);
  lines.push(`- Project: ${summary.projectId}`);
  lines.push(`- Required index count: ${summary.requiredCount}`);
  lines.push(`- Missing index count: ${summary.missing.length}`);
  lines.push("- Missing indexes:");
  lines.push(...formatMissing(summary.missing));
  lines.push("");
  lines.push("Next actions:");
  if (summary.missing.length === 0) {
    lines.push("- None. Keep daily checks running.");
  } else {
    lines.push("- Update firestore.indexes.json and deploy firestore:indexes.");
    lines.push("- Re-run authenticated canary to verify messages/check-ins stability.");
  }
  lines.push("");
  lines.push(`<!-- ${marker} -->`);
  return lines.join("\n");
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const startedAt = Date.now();
  const feedbackProfile = options.feedbackPath ? await readJsonSafe(options.feedbackPath) : null;

  const raw = await readFile(indexesPath, "utf8");
  const parsed = JSON.parse(raw);
  const indexes = Array.isArray(parsed.indexes) ? parsed.indexes : [];

  const available = new Set(indexes.map((indexDef) => indexSignature(indexDef)));
  const missing = requiredIndexes.filter((required) => !available.has(indexSignature(required)));

  const summary = {
    status: missing.length > 0 ? "failed" : "passed",
    projectId: options.projectId,
    runAtIso: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
    requiredCount: requiredIndexes.length,
    missing,
    strict: options.strict,
    apply: options.apply,
    writeLog: options.writeLog,
    logPath,
    logWritten: false,
    rollingIssueUrl: "",
    rollingCommentSignature: "",
    rollingCommentSkipped: false,
    ticketUrl: "",
    feedback: {
      enabled: Boolean(options.feedbackPath),
      loaded: Boolean(feedbackProfile),
      path: options.feedbackPath || "",
      suggestedApplyMode: Boolean(feedbackProfile?.feedback?.shouldEnableApplyMode),
      suggestedKeepStrictMode:
        typeof feedbackProfile?.feedback?.shouldKeepStrictMode === "boolean"
          ? feedbackProfile.feedback.shouldKeepStrictMode
          : true,
      candidateMissingIds: Array.isArray(feedbackProfile?.feedback?.candidateMissingIds)
        ? feedbackProfile.feedback.candidateMissingIds
        : [],
    },
    notes: [],
  };

  if (summary.feedback.enabled && !summary.feedback.loaded) {
    summary.notes.push(`Feedback profile missing or invalid at ${summary.feedback.path}.`);
  }

  if (options.apply && options.includeGithub) {
    const repoSlug = parseRepoSlug();
    if (repoSlug) {
      const openIssuesResp = listRepoIssues(repoSlug, { state: "open", maxPages: 2, cwd: repoRoot });
      if (openIssuesResp.ok) {
        ensureGhLabels(repoSlug, PORTAL_INFRA_FAMILY.labels, { cwd: repoRoot });
        const ensured = ensureIssueWithMarker(
          repoSlug,
          {
            title: PORTAL_INFRA_FAMILY.title,
            body: buildAutomationFamilyBody(PORTAL_INFRA_FAMILY),
            labels: PORTAL_INFRA_FAMILY.labels.map((label) => label.name),
            marker: PORTAL_INFRA_FAMILY.marker,
            preferredNumber: PORTAL_INFRA_FAMILY.preferredNumber,
            openIssues: openIssuesResp.data,
          },
          { cwd: repoRoot }
        );
        if (ensured.ok && ensured.issue) {
          summary.rollingIssueUrl = ensured.issue.url;
          const rollingNumber = ensured.issue.number;
          const signature = buildRollingCommentSignature(summary);
          summary.rollingCommentSignature = signature;
          const marker = `index-guard-signature:${signature}`;
          const latestBody = fetchLatestIssueCommentBody(repoSlug, rollingNumber, { cwd: repoRoot });
          const unchanged = latestBody.includes(`<!-- ${marker} -->`);
          summary.rollingCommentSkipped = unchanged;
          if (!unchanged) {
            runCommand(
              "gh",
              ["issue", "comment", String(rollingNumber), "--repo", repoSlug, "--body", buildRollingComment(summary, marker)],
              { allowFailure: true }
            );
          }
        }
      }

      if (summary.missing.length > 0) {
        summary.ticketUrl = createAlertIssue(repoSlug, summary);
      }
    }
  }

  await mkdir(dirname(options.reportPath), { recursive: true });
  await writeFile(options.reportPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  if (options.apply || options.writeLog) {
    await appendLog(summary);
    summary.logWritten = true;
    await writeFile(options.reportPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  }

  if (options.asJson) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  } else {
    process.stdout.write(`status: ${summary.status}\n`);
    process.stdout.write(`required indexes: ${summary.requiredCount}\n`);
    process.stdout.write(`missing indexes: ${summary.missing.length}\n`);
    summary.missing.forEach((item) => {
      process.stdout.write(`- ${item.id}: ${item.reason}\n`);
    });
    process.stdout.write(`report: ${options.reportPath}\n`);
  }

  if (summary.missing.length > 0 && options.strict) {
    process.exit(1);
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`firestore-index-contract-guard failed: ${message}`);
  process.exit(1);
});
