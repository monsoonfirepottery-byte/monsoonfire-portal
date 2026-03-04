#!/usr/bin/env node

/* eslint-disable no-console */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const __filename = fileURLToPath(import.meta.url);
const scriptsDir = dirname(__filename);
const functionsRoot = resolve(scriptsDir, "..");

const DEFAULT_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || "monsoonfire-portal";
const DEFAULT_FIXTURE_PATH = resolve(scriptsDir, "fixtures", "industry-events-source-fixture.json");
const DEFAULT_ARTIFACT_PATH = resolve(functionsRoot, "output", "industry-events", "freshness-audit.json");
const DEFAULT_STALE_REVIEW_DAYS = 21;
const DEFAULT_RETIRE_PAST_HOURS = 48;

function parseArgs(argv) {
  const options = {
    projectId: DEFAULT_PROJECT_ID,
    source: "fixture",
    fixturePath: DEFAULT_FIXTURE_PATH,
    artifactPath: DEFAULT_ARTIFACT_PATH,
    staleReviewDays: DEFAULT_STALE_REVIEW_DAYS,
    retirePastHours: DEFAULT_RETIRE_PAST_HOURS,
    limit: 500,
    strict: false,
    asJson: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg) continue;

    if (arg === "--strict") {
      options.strict = true;
      continue;
    }
    if (arg === "--json") {
      options.asJson = true;
      continue;
    }

    if (arg.startsWith("--source=")) {
      options.source = String(arg.slice("--source=".length)).trim() || options.source;
      continue;
    }
    if (arg.startsWith("--fixture=")) {
      options.fixturePath = resolve(process.cwd(), String(arg.slice("--fixture=".length)).trim());
      continue;
    }
    if (arg.startsWith("--artifact=")) {
      options.artifactPath = resolve(process.cwd(), String(arg.slice("--artifact=".length)).trim());
      continue;
    }
    if (arg.startsWith("--project=")) {
      options.projectId = String(arg.slice("--project=".length)).trim() || options.projectId;
      continue;
    }
    if (arg.startsWith("--stale-review-days=")) {
      const parsed = Number.parseInt(String(arg.slice("--stale-review-days=".length)).trim(), 10);
      if (!Number.isFinite(parsed) || parsed <= 0) throw new Error("--stale-review-days must be a positive integer");
      options.staleReviewDays = parsed;
      continue;
    }
    if (arg.startsWith("--retire-past-hours=")) {
      const parsed = Number.parseInt(String(arg.slice("--retire-past-hours=".length)).trim(), 10);
      if (!Number.isFinite(parsed) || parsed <= 0) throw new Error("--retire-past-hours must be a positive integer");
      options.retirePastHours = parsed;
      continue;
    }
    if (arg.startsWith("--limit=")) {
      const parsed = Number.parseInt(String(arg.slice("--limit=".length)).trim(), 10);
      if (!Number.isFinite(parsed) || parsed <= 0) throw new Error("--limit must be a positive integer");
      options.limit = parsed;
      continue;
    }

    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      throw new Error(`Missing value for ${arg}`);
    }

    if (arg === "--source") {
      options.source = String(next).trim() || options.source;
      index += 1;
      continue;
    }
    if (arg === "--fixture") {
      options.fixturePath = resolve(process.cwd(), String(next).trim());
      index += 1;
      continue;
    }
    if (arg === "--artifact") {
      options.artifactPath = resolve(process.cwd(), String(next).trim());
      index += 1;
      continue;
    }
    if (arg === "--project" || arg === "-p") {
      options.projectId = String(next).trim() || options.projectId;
      index += 1;
      continue;
    }
    if (arg === "--stale-review-days") {
      const parsed = Number.parseInt(String(next).trim(), 10);
      if (!Number.isFinite(parsed) || parsed <= 0) throw new Error("--stale-review-days must be a positive integer");
      options.staleReviewDays = parsed;
      index += 1;
      continue;
    }
    if (arg === "--retire-past-hours") {
      const parsed = Number.parseInt(String(next).trim(), 10);
      if (!Number.isFinite(parsed) || parsed <= 0) throw new Error("--retire-past-hours must be a positive integer");
      options.retirePastHours = parsed;
      index += 1;
      continue;
    }
    if (arg === "--limit") {
      const parsed = Number.parseInt(String(next).trim(), 10);
      if (!Number.isFinite(parsed) || parsed <= 0) throw new Error("--limit must be a positive integer");
      options.limit = parsed;
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeOptionalText(value) {
  const text = normalizeText(value);
  return text || null;
}

function normalizeStatus(value) {
  const normalized = normalizeText(value).toLowerCase();
  if (normalized === "published" || normalized === "draft" || normalized === "cancelled") return normalized;
  return "published";
}

function toIso(value) {
  if (value == null) return null;
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString();
  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);
    if (Number.isFinite(parsed.getTime())) return parsed.toISOString();
    return null;
  }
  if (typeof value === "object" && value && typeof value.toDate === "function") {
    try {
      const parsed = value.toDate();
      if (parsed instanceof Date && Number.isFinite(parsed.getTime())) return parsed.toISOString();
    } catch {
      return null;
    }
  }
  return null;
}

function toMs(value) {
  if (!value) return null;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asObject(value) {
  if (!value || typeof value !== "object") return {};
  return value;
}

function slug(value) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function toRelativePath(pathValue) {
  const cwdPrefix = `${process.cwd()}/`;
  if (pathValue.startsWith(cwdPrefix)) return pathValue.slice(cwdPrefix.length);
  return pathValue;
}

function evaluateFreshness(event, policy) {
  if (event.status !== "published") {
    return {
      state: "non_published",
      flagged: false,
      reason: null,
      action: null,
    };
  }

  const eventCutoffMs = toMs(event.endAt) ?? toMs(event.startAt);
  if (eventCutoffMs !== null && eventCutoffMs < policy.nowMs - policy.retirePastMs) {
    return {
      state: "retired",
      flagged: true,
      reason: "event ended beyond retirePastHours threshold",
      action: "Retire/archive this row and remove from active industry listing.",
    };
  }

  const verifiedMs = toMs(event.verifiedAt);
  if (verifiedMs === null || verifiedMs < policy.nowMs - policy.staleReviewMs) {
    return {
      state: "stale_review",
      flagged: true,
      reason: verifiedMs === null ? "verifiedAt missing" : "verifiedAt exceeded staleReviewDays threshold",
      action: "Re-verify source link and update verifiedAt before publish promotion.",
    };
  }

  return {
    state: "fresh",
    flagged: false,
    reason: null,
    action: null,
  };
}

async function loadFixtureEvents(fixturePath) {
  const raw = await readFile(fixturePath, "utf8");
  const parsed = JSON.parse(raw);
  const sources = asArray(parsed.sources);
  const events = [];

  for (let sourceIndex = 0; sourceIndex < sources.length; sourceIndex += 1) {
    const source = asObject(sources[sourceIndex]);
    const sourceId = normalizeText(source.sourceId) || `fixture-source-${sourceIndex + 1}`;
    const sourceName = normalizeText(source.sourceName) || sourceId;
    const sourceUrl = normalizeOptionalText(source.sourceUrl);
    const rows = asArray(source.events);
    for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
      const row = asObject(rows[rowIndex]);
      const title = normalizeText(row.title);
      const fallbackId = `${sourceId}-${slug(title || row.externalId || `row-${rowIndex + 1}`)}`;
      events.push({
        id: normalizeText(row.externalId) || fallbackId,
        title: title || "Untitled event",
        status: normalizeStatus(row.status),
        startAt: toIso(row.startAt),
        endAt: toIso(row.endAt),
        verifiedAt: toIso(row.verifiedAt),
        sourceId,
        sourceName,
        sourceUrl: normalizeOptionalText(row.sourceUrl) || sourceUrl,
        row: rowIndex + 1,
      });
    }
  }

  return events;
}

async function loadFirestoreEvents(projectId, limit) {
  const app =
    getApps().length > 0
      ? getApps()[0]
      : initializeApp({
          projectId,
        });
  const db = getFirestore(app);
  const snap = await db.collection("industryEvents").limit(Math.min(Math.max(limit, 1), 1000)).get();
  return snap.docs.map((docSnap) => {
    const raw = asObject(docSnap.data());
    return {
      id: docSnap.id,
      title: normalizeText(raw.title) || "Untitled event",
      status: normalizeStatus(raw.status),
      startAt: toIso(raw.startAt),
      endAt: toIso(raw.endAt),
      verifiedAt: toIso(raw.verifiedAt ?? raw.sourceVerifiedAt),
      sourceId: normalizeOptionalText(raw.sourceFeedId),
      sourceName: normalizeOptionalText(raw.sourceName),
      sourceUrl: normalizeOptionalText(raw.sourceUrl),
      row: null,
    };
  });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const staleReviewMs = options.staleReviewDays * 24 * 60 * 60 * 1000;
  const retirePastMs = options.retirePastHours * 60 * 60 * 1000;
  const nowMs = Date.now();

  let events;
  if (options.source === "fixture") {
    events = await loadFixtureEvents(options.fixturePath);
  } else if (options.source === "firestore") {
    events = await loadFirestoreEvents(options.projectId, options.limit);
  } else {
    throw new Error(`Unknown --source "${options.source}". Supported: fixture, firestore`);
  }

  const summary = {
    ok: true,
    source: options.source,
    projectId: options.projectId,
    scanned: 0,
    stateCounts: {
      fresh: 0,
      staleReview: 0,
      retired: 0,
      nonPublished: 0,
    },
    flagged: {
      staleReview: 0,
      retired: 0,
    },
    failures: [],
    flaggedRows: [],
    policy: {
      staleReviewDays: options.staleReviewDays,
      retirePastHours: options.retirePastHours,
      nowIso: new Date(nowMs).toISOString(),
    },
    fixturePath: toRelativePath(options.fixturePath),
    artifactPath: toRelativePath(options.artifactPath),
  };

  for (const event of events) {
    try {
      summary.scanned += 1;
      const decision = evaluateFreshness(event, { nowMs, staleReviewMs, retirePastMs });

      if (decision.state === "fresh") summary.stateCounts.fresh += 1;
      else if (decision.state === "stale_review") summary.stateCounts.staleReview += 1;
      else if (decision.state === "retired") summary.stateCounts.retired += 1;
      else summary.stateCounts.nonPublished += 1;

      if (decision.flagged) {
        if (decision.state === "stale_review") summary.flagged.staleReview += 1;
        if (decision.state === "retired") summary.flagged.retired += 1;
        summary.flaggedRows.push({
          id: event.id,
          title: event.title,
          sourceId: event.sourceId,
          sourceName: event.sourceName,
          sourceUrl: event.sourceUrl,
          state: decision.state,
          reason: decision.reason,
          action: decision.action,
          status: event.status,
          startAt: event.startAt,
          endAt: event.endAt,
          verifiedAt: event.verifiedAt,
          row: event.row,
        });
      }
    } catch (error) {
      summary.failures.push({
        id: event.id,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  await mkdir(dirname(options.artifactPath), { recursive: true });
  await writeFile(options.artifactPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");

  const shouldFail = options.strict && (summary.flaggedRows.length > 0 || summary.failures.length > 0);
  if (shouldFail) summary.ok = false;

  if (options.asJson) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  } else {
    const lines = [
      "Industry events freshness audit summary",
      `- source: ${summary.source}`,
      `- scanned: ${summary.scanned}`,
      `- fresh: ${summary.stateCounts.fresh}`,
      `- staleReview: ${summary.stateCounts.staleReview}`,
      `- retired: ${summary.stateCounts.retired}`,
      `- nonPublished: ${summary.stateCounts.nonPublished}`,
      `- failures: ${summary.failures.length}`,
      `- artifact: ${summary.artifactPath}`,
    ];
    process.stdout.write(`${lines.join("\n")}\n`);
  }

  if (shouldFail) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(`audit-industry-events-freshness failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
