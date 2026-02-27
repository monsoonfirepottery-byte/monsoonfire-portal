#!/usr/bin/env node

/* eslint-disable no-console */

import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { access } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const repoRoot = resolve(dirname(__filename), "..");
const indexesPath = resolve(repoRoot, "firestore.indexes.json");
const codexDir = resolve(repoRoot, ".codex");
const logPath = resolve(codexDir, "index-guard-log.md");
const rollingIssueTitle = "Portal Firestore Index Guard (Rolling)";

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
];

function parseArgs(argv) {
  const options = {
    apply: false,
    strict: true,
    asJson: false,
    includeGithub: true,
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

function ensureGhLabel(repoSlug, name, color, description) {
  runCommand(
    "gh",
    ["label", "create", name, "--repo", repoSlug, "--color", color, "--description", description, "--force"],
    { allowFailure: true }
  );
}

function ensureRollingIssue(repoSlug) {
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
      `in:title \"${rollingIssueTitle}\"`,
      "--json",
      "number,title,url",
    ],
    { allowFailure: true }
  );

  if (existing.ok) {
    try {
      const parsed = JSON.parse(existing.stdout || "[]");
      const match = parsed.find((item) => String(item?.title || "") === rollingIssueTitle);
      if (match) {
        return { number: match.number, url: match.url };
      }
    } catch {
      // fall through to create
    }
  }

  const created = runCommand(
    "gh",
    [
      "issue",
      "create",
      "--repo",
      repoSlug,
      "--title",
      rollingIssueTitle,
      "--body",
      "Rolling index guard findings for portal query stability.",
      "--label",
      "automation",
      "--label",
      "infra",
    ],
    { allowFailure: true }
  );

  if (!created.ok || !created.stdout) {
    return { number: 0, url: "" };
  }

  const issueUrl = created.stdout.split(/\s+/).find((token) => /^https:\/\/github\.com\//.test(token)) || "";
  const issueNumberMatch = issueUrl.match(/\/issues\/(\d+)/);
  return {
    number: issueNumberMatch ? Number(issueNumberMatch[1]) : 0,
    url: issueUrl,
  };
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

function buildRollingComment(summary) {
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
    rollingIssueUrl: "",
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
      ensureGhLabel(repoSlug, "automation", "5319e7", "Automation generated task/update.");
      ensureGhLabel(repoSlug, "infra", "1f6feb", "Infrastructure or platform guardrails.");
      ensureGhLabel(repoSlug, "firestore", "0e8a16", "Firestore indexes/rules/contracts.");

      const rolling = ensureRollingIssue(repoSlug);
      if (rolling.number > 0) {
        summary.rollingIssueUrl = rolling.url;
        runCommand(
          "gh",
          ["issue", "comment", String(rolling.number), "--repo", repoSlug, "--body", buildRollingComment(summary)],
          { allowFailure: true }
        );
      }

      if (summary.missing.length > 0) {
        summary.ticketUrl = createAlertIssue(repoSlug, summary);
      }
    }
  }

  await mkdir(dirname(options.reportPath), { recursive: true });
  await writeFile(options.reportPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  await appendLog(summary);

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
