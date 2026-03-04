#!/usr/bin/env node

/* eslint-disable no-console */

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";

const __filename = fileURLToPath(import.meta.url);
const scriptsDir = dirname(__filename);
const functionsRoot = resolve(scriptsDir, "..");

const DEFAULT_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || "monsoonfire-portal";
const DEFAULT_FIXTURE_PATH = resolve(scriptsDir, "fixtures", "industry-events-source-fixture.json");
const DEFAULT_ARTIFACT_PATH = resolve(functionsRoot, "output", "industry-events", "import-report.json");

function parseArgs(argv) {
  const options = {
    projectId: DEFAULT_PROJECT_ID,
    source: "fixture",
    fixturePath: DEFAULT_FIXTURE_PATH,
    artifactPath: DEFAULT_ARTIFACT_PATH,
    dryRun: false,
    overwrite: false,
    strict: false,
    asJson: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg) continue;

    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }
    if (arg === "--overwrite") {
      options.overwrite = true;
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

function normalizeOptionalUrl(value) {
  const raw = normalizeText(value);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

function normalizeTags(value) {
  if (!Array.isArray(value)) return [];
  const out = [];
  for (const entry of value) {
    const normalized = normalizeText(entry).toLowerCase();
    if (!normalized || out.includes(normalized)) continue;
    out.push(normalized);
    if (out.length >= 20) break;
  }
  return out;
}

function normalizeMode(modeValue, context = {}) {
  const explicit = normalizeText(modeValue).toLowerCase();
  if (explicit === "local" || explicit === "remote" || explicit === "hybrid") return explicit;
  const hasLocation = normalizeText(context.location).length > 0;
  const hasRemoteUrl = normalizeText(context.remoteUrl).length > 0;
  if (hasLocation && hasRemoteUrl) return "hybrid";
  if (hasRemoteUrl) return "remote";
  return "local";
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

function toTimestamp(value) {
  const iso = toIso(value);
  if (!iso) return null;
  return Timestamp.fromDate(new Date(iso));
}

function slug(value) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeTitleForHash(title) {
  return normalizeText(title).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

function isoDayKey(iso) {
  if (!iso) return "unknown-date";
  return String(iso).slice(0, 10);
}

function buildTitleDateHash(title, startAtIso) {
  const digest = createHash("sha256");
  digest.update(`${normalizeTitleForHash(title)}|${isoDayKey(startAtIso)}`);
  return digest.digest("hex").slice(0, 20);
}

function buildSourceUrlKey(url) {
  const normalized = normalizeOptionalUrl(url);
  if (!normalized) return null;
  return normalized.toLowerCase();
}

function safeDocId(value) {
  const normalized = slug(value);
  if (!normalized) return "";
  return normalized.slice(0, 96);
}

function buildDocId(row, sourceId, titleDateHash) {
  const explicit = safeDocId(row.eventId || row.externalId || row.id || "");
  if (explicit) return `${safeDocId(sourceId) || "source"}-${explicit}`.slice(0, 120);
  const fromTitle = safeDocId(row.title || "");
  if (fromTitle) return `${safeDocId(sourceId) || "source"}-${fromTitle}-${titleDateHash.slice(0, 8)}`.slice(0, 120);
  return `${safeDocId(sourceId) || "source"}-row-${titleDateHash.slice(0, 12)}`;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asObject(value) {
  if (!value || typeof value !== "object") return {};
  return value;
}

async function loadFixtureRows(fixturePath) {
  const raw = await readFile(fixturePath, "utf8");
  const parsed = JSON.parse(raw);
  const sources = asArray(parsed.sources);
  const rows = [];

  for (let sourceIndex = 0; sourceIndex < sources.length; sourceIndex += 1) {
    const source = asObject(sources[sourceIndex]);
    const sourceId = normalizeText(source.sourceId) || `fixture-source-${sourceIndex + 1}`;
    const sourceName = normalizeText(source.sourceName) || sourceId;
    const sourceUrl = normalizeOptionalUrl(source.sourceUrl);
    const connector = normalizeText(source.connector || source.type) || "fixture";
    const events = asArray(source.events);

    for (let eventIndex = 0; eventIndex < events.length; eventIndex += 1) {
      rows.push({
        source: {
          sourceId,
          sourceName,
          sourceUrl,
          connector,
        },
        row: asObject(events[eventIndex]),
        sourceIndex,
        eventIndex,
      });
    }
  }

  return rows;
}

const CONNECTORS = {
  fixture: async (options) => loadFixtureRows(options.fixturePath),
};

function toRelativePath(pathValue) {
  const cwdPrefix = `${process.cwd()}/`;
  if (pathValue.startsWith(cwdPrefix)) return pathValue.slice(cwdPrefix.length);
  return pathValue;
}

function buildDraftPayload(meta, normalized, importBatchId) {
  return {
    title: normalized.title,
    summary: normalized.summary,
    description: normalized.description,
    mode: normalized.mode,
    status: "draft",
    startAt: toTimestamp(normalized.startAt),
    endAt: toTimestamp(normalized.endAt),
    timezone: normalized.timezone,
    location: normalized.location,
    city: normalized.city,
    region: normalized.region,
    country: normalized.country,
    remoteUrl: normalized.remoteUrl,
    registrationUrl: normalized.registrationUrl,
    sourceName: normalized.sourceName,
    sourceUrl: normalized.sourceUrl,
    featured: false,
    tags: normalized.tags,
    verifiedAt: toTimestamp(normalized.verifiedAt),
    sourceVerifiedAt: toTimestamp(normalized.verifiedAt),
    needsReview: true,
    reviewByAt: Timestamp.fromMillis(Date.now() + 7 * 24 * 60 * 60 * 1000),
    freshnessState: "non_published",
    freshnessCheckedAt: Timestamp.now(),
    sourceConnector: meta.source.connector,
    sourceFeedId: meta.source.sourceId,
    sourceRecordId: normalized.sourceRecordId,
    sourceTitleDateHash: normalized.titleDateHash,
    sourceImportedAt: Timestamp.now(),
    sourceImportBatchId: importBatchId,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const connector = CONNECTORS[options.source];
  if (!connector) {
    throw new Error(`Unknown --source "${options.source}". Supported: ${Object.keys(CONNECTORS).join(", ")}`);
  }

  const rows = await connector(options);
  const importBatchId = `industry-events-import-${new Date().toISOString()}`;
  const seenSourceUrls = new Set();
  const seenTitleDateHashes = new Set();
  const accepted = [];

  const summary = {
    ok: true,
    source: options.source,
    projectId: options.projectId,
    dryRun: options.dryRun,
    overwrite: options.overwrite,
    requested: rows.length,
    accepted: 0,
    triageDraftCount: 0,
    duplicatesSuppressed: 0,
    duplicateReasons: {
      sourceUrl: 0,
      titleDateHash: 0,
    },
    skippedExisting: 0,
    created: 0,
    updated: 0,
    failed: 0,
    errors: [],
    duplicates: [],
    acceptedPreview: [],
    fixturePath: toRelativePath(options.fixturePath),
    artifactPath: toRelativePath(options.artifactPath),
    importBatchId,
  };

  for (const meta of rows) {
    try {
      const raw = asObject(meta.row);

      const title = normalizeText(raw.title);
      if (!title) throw new Error("title is required");
      const startAt = toIso(raw.startAt);
      if (!startAt) throw new Error("startAt must be a valid date");

      const sourceUrl = normalizeOptionalUrl(raw.sourceUrl) || meta.source.sourceUrl || null;
      const sourceUrlKey = buildSourceUrlKey(sourceUrl);
      if (sourceUrlKey && seenSourceUrls.has(sourceUrlKey)) {
        summary.duplicatesSuppressed += 1;
        summary.duplicateReasons.sourceUrl += 1;
        summary.duplicates.push({
          sourceId: meta.source.sourceId,
          row: meta.eventIndex + 1,
          reason: "sourceUrl",
          sourceUrl,
          title,
        });
        continue;
      }

      const titleDateHash = buildTitleDateHash(title, startAt);
      if (seenTitleDateHashes.has(titleDateHash)) {
        summary.duplicatesSuppressed += 1;
        summary.duplicateReasons.titleDateHash += 1;
        summary.duplicates.push({
          sourceId: meta.source.sourceId,
          row: meta.eventIndex + 1,
          reason: "titleDateHash",
          title,
          startAt,
          titleDateHash,
        });
        continue;
      }

      if (sourceUrlKey) seenSourceUrls.add(sourceUrlKey);
      seenTitleDateHashes.add(titleDateHash);

      const summaryText = normalizeText(raw.summary) || `Imported from ${meta.source.sourceName}.`;
      const location = normalizeOptionalText(raw.location || raw.venue);
      const remoteUrl = normalizeOptionalUrl(raw.remoteUrl || raw.virtualUrl);
      const normalized = {
        title,
        summary: summaryText,
        description: normalizeOptionalText(raw.description),
        mode: normalizeMode(raw.mode, { location, remoteUrl }),
        startAt,
        endAt: toIso(raw.endAt),
        timezone: normalizeOptionalText(raw.timezone),
        location,
        city: normalizeOptionalText(raw.city),
        region: normalizeOptionalText(raw.region || raw.state),
        country: normalizeOptionalText(raw.country),
        remoteUrl,
        registrationUrl: normalizeOptionalUrl(raw.registrationUrl || raw.registerUrl),
        sourceName: normalizeOptionalText(raw.sourceName) || meta.source.sourceName || null,
        sourceUrl,
        tags: normalizeTags(raw.tags),
        verifiedAt: toIso(raw.verifiedAt),
        sourceRecordId: normalizeOptionalText(raw.externalId || raw.id),
        titleDateHash,
      };

      const docId = buildDocId(raw, meta.source.sourceId, titleDateHash);
      accepted.push({ docId, normalized, meta });

      if (summary.acceptedPreview.length < 25) {
        summary.acceptedPreview.push({
          docId,
          title,
          sourceId: meta.source.sourceId,
          sourceRecordId: normalized.sourceRecordId,
          sourceUrl: normalized.sourceUrl,
          dedupeKey: titleDateHash,
          status: "draft",
        });
      }
    } catch (error) {
      summary.failed += 1;
      summary.errors.push({
        sourceId: meta.source?.sourceId || "unknown",
        row: meta.eventIndex + 1,
        message: error instanceof Error ? error.message : String(error),
        rawExternalId: normalizeOptionalText(meta.row?.externalId || meta.row?.id),
      });
    }
  }

  summary.accepted = accepted.length;
  summary.triageDraftCount = accepted.length;

  if (!options.dryRun && accepted.length > 0) {
    const app =
      getApps().length > 0
        ? getApps()[0]
        : initializeApp({
            projectId: options.projectId,
          });
    const db = getFirestore(app);

    for (const entry of accepted) {
      const ref = db.collection("industryEvents").doc(entry.docId);
      const existing = await ref.get();
      const exists = existing.exists;
      if (exists && !options.overwrite) {
        summary.skippedExisting += 1;
        continue;
      }

      const payload = buildDraftPayload(entry.meta, entry.normalized, importBatchId);
      payload.createdAt = existing.get("createdAt") ?? Timestamp.now();
      payload.createdByUid = existing.get("createdByUid") ?? "industry-events-import-script";
      payload.updatedAt = Timestamp.now();
      payload.updatedByUid = "industry-events-import-script";

      await ref.set(payload, { merge: true });
      if (exists) summary.updated += 1;
      else summary.created += 1;
    }
  }

  await mkdir(dirname(options.artifactPath), { recursive: true });
  await writeFile(options.artifactPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");

  const shouldFail = options.strict && (summary.failed > 0 || summary.accepted === 0);
  if (shouldFail) summary.ok = false;

  if (options.asJson) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  } else {
    const lines = [
      "Industry events import summary",
      `- source: ${summary.source}`,
      `- requested: ${summary.requested}`,
      `- accepted: ${summary.accepted}`,
      `- triageDraftCount: ${summary.triageDraftCount}`,
      `- duplicatesSuppressed: ${summary.duplicatesSuppressed} (sourceUrl=${summary.duplicateReasons.sourceUrl}, titleDateHash=${summary.duplicateReasons.titleDateHash})`,
      `- failed: ${summary.failed}`,
      `- dryRun: ${summary.dryRun ? "yes" : "no"}`,
      `- artifact: ${summary.artifactPath}`,
    ];
    process.stdout.write(`${lines.join("\n")}\n`);
  }

  if (shouldFail) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(`import-industry-events failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
