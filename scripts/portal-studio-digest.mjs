#!/usr/bin/env node

/* eslint-disable no-console */

import { createHash, createSign } from "node:crypto";
import { access, mkdir, writeFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { mintStaffIdTokenFromPortalEnv } from "./lib/firebase-auth-token.mjs";

const __filename = fileURLToPath(import.meta.url);
const repoRoot = resolve(dirname(__filename), "..");

const DEFAULT_PROJECT_ID = "monsoonfire-portal";
const DEFAULT_REPORT_PATH = resolve(repoRoot, "output", "qa", "portal-studio-digest.json");
const DEFAULT_CREDENTIALS_PATH = resolve(repoRoot, "secrets", "portal", "portal-agent-staff.json");
const DEFAULT_PORTAL_AUTOMATION_ENV_PATH = resolve(repoRoot, "secrets", "portal", "portal-automation.env");
const GOOGLE_OAUTH_TOKEN_ENDPOINT = "https://www.googleapis.com/oauth2/v3/token";
const FIREBASE_CLI_OAUTH_CLIENT_ID =
  "563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com";
const FIREBASE_CLI_OAUTH_CLIENT_SECRET = String(process.env.FIREBASE_CLI_OAUTH_CLIENT_SECRET || "").trim();
const DAILY_DIGEST_ID_PREFIX = "studio-digest-";
const QA_ANNOUNCEMENT_ID_PREFIX = "qa-fixture-studio-update-";
const LEGACY_QA_ANNOUNCEMENT_ID_PREFIX = "qa-studio-update-";
const QA_WORKSHOP_ID_PREFIX = "qa-fixture-workshop-";
const STORE_PICKUP_NOTE = "Store pickup: clay, tools, and studio access orders are usually ready in 1-2 business days.";

function loadPortalAutomationEnv() {
  const configuredPath = String(process.env.PORTAL_AUTOMATION_ENV_PATH || "").trim();
  const envPath = configuredPath || DEFAULT_PORTAL_AUTOMATION_ENV_PATH;
  if (!envPath || !existsSync(envPath)) return;

  const raw = readFileSync(envPath, "utf8");
  const lines = raw.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex <= 0) continue;
    const key = trimmed.slice(0, separatorIndex).trim();
    if (!key || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    if (String(process.env[key] || "").trim()) continue;

    let value = trimmed.slice(separatorIndex + 1).trim();
    if (
      (value.startsWith("\"") && value.endsWith("\"")) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

loadPortalAutomationEnv();

function truncate(value, max = 600) {
  if (typeof value !== "string") return "";
  return value.length <= max ? value : `${value.slice(0, max)}...[truncated]`;
}

function b64url(input) {
  const raw = typeof input === "string" ? Buffer.from(input, "utf8") : Buffer.from(input);
  return raw
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function encodeDocPath(path) {
  return path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function toFirestoreValue(value) {
  if (value === null) return { nullValue: null };
  if (value instanceof Date) return { timestampValue: value.toISOString() };
  if (typeof value === "string") return { stringValue: value };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number") {
    if (Number.isInteger(value)) return { integerValue: String(value) };
    return { doubleValue: value };
  }
  if (Array.isArray(value)) {
    return { arrayValue: { values: value.map((entry) => toFirestoreValue(entry)) } };
  }
  if (typeof value === "object") {
    const fields = {};
    for (const [key, nested] of Object.entries(value)) {
      fields[key] = toFirestoreValue(nested);
    }
    return { mapValue: { fields } };
  }
  return { stringValue: String(value) };
}

function fromFirestoreValue(value) {
  if (!value || typeof value !== "object") return null;
  if ("stringValue" in value) return value.stringValue;
  if ("timestampValue" in value) return value.timestampValue;
  if ("booleanValue" in value) return value.booleanValue;
  if ("nullValue" in value) return null;
  if ("integerValue" in value) return Number(value.integerValue);
  if ("doubleValue" in value) return Number(value.doubleValue);
  if ("arrayValue" in value) {
    return Array.isArray(value.arrayValue?.values)
      ? value.arrayValue.values.map((entry) => fromFirestoreValue(entry))
      : [];
  }
  if ("mapValue" in value) {
    return Object.fromEntries(
      Object.entries(value.mapValue?.fields || {}).map(([key, nested]) => [key, fromFirestoreValue(nested)])
    );
  }
  return null;
}

function parseFirestoreDocument(document) {
  if (!document || typeof document !== "object") return null;
  const id = String(document.name || "").split("/").pop() || "";
  return {
    id,
    ...Object.fromEntries(
      Object.entries(document.fields || {}).map(([key, value]) => [key, fromFirestoreValue(value)])
    ),
  };
}

function safeDate(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value : null;
  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);
    return Number.isFinite(parsed.getTime()) ? parsed : null;
  }
  if (typeof value === "object") {
    if (typeof value.toDate === "function") {
      const parsed = value.toDate();
      return parsed instanceof Date && Number.isFinite(parsed.getTime()) ? parsed : null;
    }
    if (typeof value.timestampValue === "string") {
      const parsed = new Date(value.timestampValue);
      return Number.isFinite(parsed.getTime()) ? parsed : null;
    }
  }
  return null;
}

function safeString(value) {
  return String(value ?? "").trim();
}

function normalizeAnnouncementFlag(value) {
  return safeString(value).toLowerCase();
}

function isQaAnnouncement(doc) {
  return (
    safeString(doc?.id).startsWith(QA_ANNOUNCEMENT_ID_PREFIX) ||
    safeString(doc?.id).startsWith(LEGACY_QA_ANNOUNCEMENT_ID_PREFIX) ||
    normalizeAnnouncementFlag(doc?.source) === "qa_fixture" ||
    normalizeAnnouncementFlag(doc?.audience) === "qa"
  );
}

function isDailyDigest(doc) {
  return normalizeAnnouncementFlag(doc?.source) === "daily_digest" || safeString(doc?.id).startsWith(DAILY_DIGEST_ID_PREFIX);
}

function requestJson(url, init = {}) {
  return fetch(url, init).then(async (response) => {
    const text = await response.text();
    let json;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = { raw: truncate(text, 1200) };
    }
    return {
      ok: response.ok,
      status: response.status,
      json,
    };
  });
}

async function fireUpsert(projectId, token, docPath, payload) {
  const firestoreBase = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents`;
  const url = `${firestoreBase}/${encodeDocPath(docPath)}`;
  return requestJson(url, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      fields: Object.fromEntries(Object.entries(payload).map(([key, value]) => [key, toFirestoreValue(value)])),
    }),
  });
}

async function fireDelete(projectId, token, docPath) {
  const firestoreBase = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents`;
  const url = `${firestoreBase}/${encodeDocPath(docPath)}`;
  return requestJson(url, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
}

async function fireListDocuments(projectId, token, collectionId, pageToken = "") {
  const firestoreBase = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents`;
  const params = new URLSearchParams({
    pageSize: "500",
  });
  if (pageToken) params.set("pageToken", pageToken);
  const url = `${firestoreBase}/${encodeURIComponent(collectionId)}?${params.toString()}`;
  return requestJson(url, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
}

async function fireRunQuery(projectId, token, structuredQuery) {
  const firestoreBase = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents:runQuery`;
  const response = await requestJson(firestoreBase, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ structuredQuery }),
  });
  if (!response.ok) {
    const message = response.json?.error?.message || response.json?.raw || `HTTP ${response.status}`;
    throw new Error(`Firestore query failed: ${String(message)}`);
  }
  return Array.isArray(response.json)
    ? response.json
        .map((entry) => parseFirestoreDocument(entry.document))
        .filter(Boolean)
    : [];
}

function parseServiceAccountJson(raw) {
  const text = safeString(raw);
  if (!text) return null;
  try {
    const parsed = JSON.parse(text);
    if (!parsed.client_email || !parsed.private_key) return null;
    return parsed;
  } catch {
    return null;
  }
}

function loadServiceAccountFromEnv() {
  const inline =
    parseServiceAccountJson(process.env.FIREBASE_SERVICE_ACCOUNT_JSON) ||
    parseServiceAccountJson(process.env.FIREBASE_SERVICE_ACCOUNT_MONSOONFIRE_PORTAL);
  if (inline) return inline;

  const candidatePaths = [
    process.env.GOOGLE_APPLICATION_CREDENTIALS,
    process.env.FIREBASE_SERVICE_ACCOUNT_PATH,
    process.env.PORTAL_FIREBASE_SERVICE_ACCOUNT_PATH,
  ]
    .map((value) => safeString(value))
    .filter(Boolean);

  for (const filePath of candidatePaths) {
    if (!existsSync(filePath)) continue;
    const parsed = parseServiceAccountJson(readFileSync(filePath, "utf8"));
    if (parsed) return parsed;
  }

  return null;
}

async function mintServiceAccessToken(serviceAccount) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claim = {
    iss: serviceAccount.client_email,
    scope: "https://www.googleapis.com/auth/cloud-platform https://www.googleapis.com/auth/datastore",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };

  const unsigned = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claim))}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  const signature = signer.sign(serviceAccount.private_key);
  const assertion = `${unsigned}.${b64url(signature)}`;

  const response = await requestJson("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }).toString(),
  });

  if (!response.ok || !response.json?.access_token) {
    throw new Error(`Could not mint service access token (status ${response.status}).`);
  }

  return safeString(response.json.access_token);
}

function looksLikeRefreshToken(token) {
  return safeString(token).startsWith("1//");
}

async function exchangeRefreshToken(refreshToken, source) {
  const form = new URLSearchParams({
    refresh_token: refreshToken,
    client_id: FIREBASE_CLI_OAUTH_CLIENT_ID,
    grant_type: "refresh_token",
  });
  if (FIREBASE_CLI_OAUTH_CLIENT_SECRET) {
    form.set("client_secret", FIREBASE_CLI_OAUTH_CLIENT_SECRET);
  }

  const response = await requestJson(GOOGLE_OAUTH_TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });

  if (!response.ok || !response.json?.access_token) {
    const message =
      response.json?.error_description || response.json?.error || response.json?.raw || `HTTP ${response.status}`;
    throw new Error(`Unable to exchange refresh token from ${source}: ${String(message)}`);
  }

  return safeString(response.json.access_token);
}

function loadFirebaseCliTokens() {
  try {
    const configPath = resolve(homedir(), ".config", "configstore", "firebase-tools.json");
    if (!existsSync(configPath)) {
      return {
        accessToken: "",
        refreshToken: "",
      };
    }
    const raw = readFileSync(configPath, "utf8");
    const parsed = JSON.parse(raw);
    return {
      accessToken: safeString(parsed?.tokens?.access_token),
      refreshToken: safeString(parsed?.tokens?.refresh_token),
    };
  } catch {
    return {
      accessToken: "",
      refreshToken: "",
    };
  }
}

async function resolveEnvAdminTokenCandidates() {
  const firebaseCliTokens = loadFirebaseCliTokens();
  const candidateSources = [
    { source: "FIREBASE_RULES_API_TOKEN", value: process.env.FIREBASE_RULES_API_TOKEN },
    { source: "FIREBASE_ACCESS_TOKEN", value: process.env.FIREBASE_ACCESS_TOKEN },
    { source: "FIREBASE_TOKEN", value: process.env.FIREBASE_TOKEN },
  ];
  if (firebaseCliTokens.refreshToken) {
    candidateSources.push({
      source: "firebase-tools refresh token",
      value: firebaseCliTokens.refreshToken,
    });
  }
  if (firebaseCliTokens.accessToken) {
    candidateSources.push({
      source: "firebase-tools access token",
      value: firebaseCliTokens.accessToken,
    });
  }
  const candidates = [];

  for (const entry of candidateSources) {
    const raw = safeString(entry.value);
    if (!raw) continue;
    if (looksLikeRefreshToken(raw)) {
      try {
        const accessToken = await exchangeRefreshToken(raw, entry.source);
        candidates.push({
          source: `${entry.source} (refresh-token exchange)`,
          token: accessToken,
          error: "",
        });
      } catch (error) {
        const fallbackAccessToken = firebaseCliTokens.accessToken;
        if (fallbackAccessToken) {
          candidates.push({
            source: `${entry.source} (firebase-tools access fallback)`,
            token: fallbackAccessToken,
            error: "",
          });
          continue;
        }
        candidates.push({
          source: entry.source,
          token: "",
          error: error instanceof Error ? error.message : String(error),
        });
      }
      continue;
    }

    candidates.push({
      source: entry.source,
      token: raw,
      error: "",
    });
  }

  return candidates;
}

async function verifyFirestoreWriteAccess(projectId, token) {
  const probeId = `portal-studio-digest-probe-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const probePath = `_qaFixtureProbe/${probeId}`;
  const now = new Date();

  const upsert = await fireUpsert(projectId, token, probePath, {
    createdAt: now,
    updatedAt: now,
    source: "portal-studio-digest",
  });

  if (!upsert.ok) {
    const message = upsert.json?.error?.message || upsert.json?.raw || `HTTP ${upsert.status}`;
    return {
      ok: false,
      status: upsert.status,
      message: String(message),
    };
  }

  const cleanup = await fireDelete(projectId, token, probePath);
  if (!cleanup.ok && cleanup.status !== 404) {
    const message = cleanup.json?.error?.message || cleanup.json?.raw || `HTTP ${cleanup.status}`;
    return {
      ok: false,
      status: cleanup.status,
      message: `cleanup failed: ${String(message)}`,
    };
  }

  return {
    ok: true,
    status: 200,
    message: "",
  };
}

async function resolvePreferredFirestoreToken(projectId, idToken) {
  const warnings = [];
  const serviceAccount = loadServiceAccountFromEnv();
  const adminTokenCandidates = [];

  if (serviceAccount) {
    try {
      adminTokenCandidates.push({
        source: "service account",
        token: await mintServiceAccessToken(serviceAccount),
      });
    } catch (error) {
      warnings.push(`Service account token mint failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const envAdminCandidates = await resolveEnvAdminTokenCandidates();
  for (const candidate of envAdminCandidates) {
    if (!candidate.token) {
      warnings.push(
        `Admin token candidate ${candidate.source} unavailable: ${truncate(String(candidate.error || "token resolution failed"), 220)}`
      );
      continue;
    }
    adminTokenCandidates.push({
      source: candidate.source,
      token: candidate.token,
    });
  }

  for (const candidate of adminTokenCandidates) {
    const probe = await verifyFirestoreWriteAccess(projectId, candidate.token);
    if (!probe.ok) {
      warnings.push(
        `${candidate.source} token cannot write Firestore digest docs (status ${probe.status}); trying next credential. ${truncate(probe.message, 220)}`
      );
      continue;
    }

    return {
      token: candidate.token,
      usedAdminToken: true,
      warnings,
      source: candidate.source,
    };
  }

  return {
    token: idToken,
    usedAdminToken: false,
    warnings,
    source: "staff-id-token",
  };
}

function ensureWritableParent(path) {
  return access(dirname(path), fsConstants.F_OK).catch(async () => {
    await mkdir(dirname(path), { recursive: true });
  });
}

export function normalizeDigestText(value) {
  return safeString(value)
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function stableDigestFingerprint(value) {
  return createHash("sha256").update(normalizeDigestText(value)).digest("hex").slice(0, 20);
}

function formatPhoenixDate(date = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Phoenix",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(date);
  const map = {};
  for (const part of parts) map[part.type] = part.value;
  const dateKey = `${map.year}-${map.month}-${map.day}`;
  return {
    dateKey,
    compact: `${map.year}${map.month}${map.day}`,
  };
}

function formatPhoenixDateTime(value) {
  const parsed = safeDate(value);
  if (!parsed) return "a posted time soon";
  return parsed.toLocaleString("en-US", {
    timeZone: "America/Phoenix",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function describeKilnStatus({ activeFiring, nextFiring }) {
  const activeTitle = safeString(activeFiring?.title || activeFiring?.cycleType);
  const activeStatus = safeString(activeFiring?.status).toLowerCase() || "active";
  const nextStart = formatPhoenixDateTime(nextFiring?.startAt);
  const nextTitle = safeString(nextFiring?.title || nextFiring?.cycleType);

  if (activeFiring) {
    const title = activeTitle || "A firing";
    const nextClause = nextFiring ? ` Next up: ${nextTitle || "another firing"} on ${nextStart}.` : "";
    return `Kiln status: ${title} is ${activeStatus}.${nextClause}`.trim();
  }

  if (nextFiring) {
    return `Kiln status: next firing is ${nextTitle || "a posted firing"} on ${nextStart}.`;
  }

  return "Kiln status: no firing window is posted right now.";
}

function describeWorkshopStatus(nextWorkshop) {
  const title = safeString(nextWorkshop?.title);
  if (!nextWorkshop || !title) {
    return "Workshops: no new session is posted right now.";
  }
  return `Next workshop: ${title} on ${formatPhoenixDateTime(nextWorkshop.startAt)}.`;
}

function isQaWorkshopEvent(candidate) {
  return (
    safeString(candidate?.id).startsWith(QA_WORKSHOP_ID_PREFIX) ||
    normalizeAnnouncementFlag(candidate?.fixture?.seededBy) === "portal-fixture-steward" ||
    /^qa fixture/i.test(safeString(candidate?.title))
  );
}

export function pickNextWorkshopForDigest(eventCandidates, now = new Date()) {
  return (
    (Array.isArray(eventCandidates) ? eventCandidates : []).find((candidate) => {
      const startAt = safeDate(candidate?.startAt);
      const status = normalizeAnnouncementFlag(candidate?.status);
      return Boolean(
        startAt &&
        startAt.getTime() >= now.getTime() &&
        status === "published" &&
        !isQaWorkshopEvent(candidate)
      );
    }) || null
  );
}

export function buildStudioDigest({ activeFiring = null, nextFiring = null, nextWorkshop = null } = {}) {
  const title = "Studio operations snapshot";
  const body = [
    describeKilnStatus({ activeFiring, nextFiring }),
    describeWorkshopStatus(nextWorkshop),
    STORE_PICKUP_NOTE,
  ].join(" ");

  return {
    title,
    body,
    digestFingerprint: stableDigestFingerprint(`${title}\n${body}`),
  };
}

export function decideStudioDigestAction({ dateKey, nextDigestFingerprint, latestDigest = null, todaysDigest = null }) {
  if (todaysDigest) {
    return todaysDigest.digestFingerprint === nextDigestFingerprint
      ? { action: "skip", reason: "unchanged_today" }
      : { action: "upsert", reason: "refresh_today" };
  }

  if (latestDigest && latestDigest.digestFingerprint === nextDigestFingerprint) {
    return { action: "skip", reason: "unchanged_since_last_digest" };
  }

  return {
    action: "upsert",
    reason: latestDigest ? "changed_since_last_digest" : `first_digest_for_${dateKey}`,
  };
}

async function loadRecentAnnouncements(projectId, token) {
  return fireRunQuery(projectId, token, {
    from: [{ collectionId: "announcements" }],
    orderBy: [{ field: { fieldPath: "createdAt" }, direction: "DESCENDING" }],
    limit: 80,
  });
}

async function loadDigestInputs(projectId, token) {
  const now = new Date();

  const [activeCandidates, upcomingCandidates, eventCandidates] = await Promise.all([
    fireRunQuery(projectId, token, {
      from: [{ collectionId: "kilnFirings" }],
      where: {
        fieldFilter: {
          field: { fieldPath: "endAt" },
          op: "GREATER_THAN_OR_EQUAL",
          value: { timestampValue: now.toISOString() },
        },
      },
      orderBy: [{ field: { fieldPath: "endAt" }, direction: "ASCENDING" }],
      limit: 12,
    }),
    fireRunQuery(projectId, token, {
      from: [{ collectionId: "kilnFirings" }],
      where: {
        fieldFilter: {
          field: { fieldPath: "startAt" },
          op: "GREATER_THAN_OR_EQUAL",
          value: { timestampValue: now.toISOString() },
        },
      },
      orderBy: [{ field: { fieldPath: "startAt" }, direction: "ASCENDING" }],
      limit: 12,
    }),
    fireRunQuery(projectId, token, {
      from: [{ collectionId: "events" }],
      where: {
        fieldFilter: {
          field: { fieldPath: "startAt" },
          op: "GREATER_THAN_OR_EQUAL",
          value: { timestampValue: now.toISOString() },
        },
      },
      orderBy: [{ field: { fieldPath: "startAt" }, direction: "ASCENDING" }],
      limit: 40,
    }),
  ]);

  const activeFiring =
    activeCandidates.find((candidate) => {
      const startAt = safeDate(candidate?.startAt);
      const endAt = safeDate(candidate?.endAt);
      const status = normalizeAnnouncementFlag(candidate?.status);
      if (!startAt || !endAt || status === "cancelled") return false;
      const nowMs = now.getTime();
      return startAt.getTime() <= nowMs && endAt.getTime() >= nowMs;
    }) || null;

  const nextFiring =
    upcomingCandidates.find((candidate) => {
      const startAt = safeDate(candidate?.startAt);
      const status = normalizeAnnouncementFlag(candidate?.status);
      return Boolean(startAt && startAt.getTime() >= now.getTime() && status !== "cancelled");
    }) || null;

  const nextWorkshop = pickNextWorkshopForDigest(eventCandidates, now);

  return {
    activeFiring,
    nextFiring,
    nextWorkshop,
  };
}

async function cleanupQaAnnouncements(projectId, token) {
  const deleted = [];
  let pageToken = "";

  do {
    const response = await fireListDocuments(projectId, token, "announcements", pageToken);
    if (!response.ok) {
      const message = response.json?.error?.message || response.json?.raw || `HTTP ${response.status}`;
      throw new Error(`Could not list announcements for cleanup (${response.status}): ${String(message)}`);
    }

    const documents = Array.isArray(response.json?.documents) ? response.json.documents : [];
    for (const document of documents) {
      const parsed = parseFirestoreDocument(document);
      if (!parsed || !isQaAnnouncement(parsed)) continue;
      const deleteResponse = await fireDelete(projectId, token, `announcements/${parsed.id}`);
      const ok = deleteResponse.ok || deleteResponse.status === 404;
      deleted.push({
        id: parsed.id,
        status: deleteResponse.status,
        ok,
      });
      if (!ok) {
        const message =
          deleteResponse.json?.error?.message || deleteResponse.json?.raw || `HTTP ${deleteResponse.status}`;
        throw new Error(`Could not delete QA announcement ${parsed.id}: ${String(message)}`);
      }
    }

    pageToken = safeString(response.json?.nextPageToken);
  } while (pageToken);

  return {
    deletedCount: deleted.length,
    deleted,
  };
}

async function cleanupQaAnnouncementsViaFunction(functionsBaseUrl, idToken) {
  const baseUrl = safeString(functionsBaseUrl).replace(/\/+$/, "");
  if (!baseUrl) {
    throw new Error("Missing functions base URL for QA announcement cleanup.");
  }

  const response = await requestJson(`${baseUrl}/staffCleanupQaAnnouncements`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${idToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({}),
  });

  if (!response.ok || !response.json?.ok) {
    const message = response.json?.message || response.json?.error?.message || response.json?.raw || `HTTP ${response.status}`;
    throw new Error(`Cleanup endpoint failed (${response.status}): ${String(message)}`);
  }

  const deletedIdsSample = Array.isArray(response.json?.deletedIdsSample)
    ? response.json.deletedIdsSample.filter((entry) => typeof entry === "string")
    : [];

  return {
    deletedCount: Number(response.json?.deletedCount) || 0,
    deleted: deletedIdsSample.map((id) => ({
      id,
      status: 200,
      ok: true,
    })),
    deletedIdsSampleTruncated: response.json?.deletedIdsSampleTruncated === true,
    via: "functions-endpoint",
  };
}

function parseArgs(argv) {
  const options = {
    projectId: safeString(process.env.PORTAL_PROJECT_ID) || DEFAULT_PROJECT_ID,
    functionsBaseUrl: safeString(process.env.PORTAL_FUNCTIONS_BASE_URL),
    credentialsPath: safeString(process.env.PORTAL_AGENT_STAFF_CREDENTIALS) || DEFAULT_CREDENTIALS_PATH,
    reportPath: safeString(process.env.PORTAL_STUDIO_DIGEST_REPORT) || DEFAULT_REPORT_PATH,
    cleanupQaAnnouncements: false,
    cleanupOnly: false,
    asJson: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg || !arg.startsWith("--")) continue;

    if (arg === "--project") {
      const next = argv[index + 1];
      if (!next || next.startsWith("--")) throw new Error("Missing value for --project");
      options.projectId = safeString(next);
      index += 1;
      continue;
    }

    if (arg === "--credentials") {
      const next = argv[index + 1];
      if (!next || next.startsWith("--")) throw new Error("Missing value for --credentials");
      options.credentialsPath = resolve(process.cwd(), safeString(next));
      index += 1;
      continue;
    }

    if (arg === "--functions-base-url") {
      const next = argv[index + 1];
      if (!next || next.startsWith("--")) throw new Error("Missing value for --functions-base-url");
      options.functionsBaseUrl = safeString(next).replace(/\/+$/, "");
      index += 1;
      continue;
    }

    if (arg === "--report") {
      const next = argv[index + 1];
      if (!next || next.startsWith("--")) throw new Error("Missing value for --report");
      options.reportPath = resolve(process.cwd(), safeString(next));
      index += 1;
      continue;
    }

    if (arg === "--cleanup-qa-announcements") {
      options.cleanupQaAnnouncements = true;
      continue;
    }

    if (arg === "--cleanup-only") {
      options.cleanupOnly = true;
      continue;
    }

    if (arg === "--json") {
      options.asJson = true;
      continue;
    }
  }

  if (!options.functionsBaseUrl) {
    options.functionsBaseUrl = `https://us-central1-${options.projectId}.cloudfunctions.net`;
  }

  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const runDate = formatPhoenixDate();
  const summary = {
    status: "passed",
    runAtIso: new Date().toISOString(),
    projectId: options.projectId,
    reportPath: options.reportPath,
    cleanupQaAnnouncements: options.cleanupQaAnnouncements,
    cleanupOnly: options.cleanupOnly,
    digestDateKey: runDate.dateKey,
    functionsBaseUrl: options.functionsBaseUrl,
    authSource: "",
    warnings: [],
    cleanup: {
      deletedCount: 0,
      deleted: [],
      via: "",
    },
    digest: {
      action: "skip",
      reason: "not_evaluated",
      documentId: `${DAILY_DIGEST_ID_PREFIX}${runDate.compact}`,
      title: "",
      body: "",
      digestFingerprint: "",
      latestDigestFingerprint: "",
      todaysDigestFingerprint: "",
    },
  };

  const idTokenResult = await mintStaffIdTokenFromPortalEnv({
    env: process.env,
    defaultCredentialsPath: options.credentialsPath,
  });
  if (!idTokenResult.ok || !idTokenResult.token) {
    throw new Error(`Unable to mint staff Firebase token: ${idTokenResult.reason}`);
  }

  const firestoreToken = await resolvePreferredFirestoreToken(options.projectId, idTokenResult.token);
  summary.authSource = firestoreToken.source;
  summary.warnings.push(...firestoreToken.warnings);

  if (options.cleanupQaAnnouncements) {
    try {
      summary.cleanup = await cleanupQaAnnouncementsViaFunction(options.functionsBaseUrl, idTokenResult.token);
    } catch (error) {
      if (!firestoreToken.usedAdminToken) {
        throw error;
      }
      summary.warnings.push(
        `Cleanup endpoint unavailable; falling back to direct Firestore cleanup. ${truncate(
          error instanceof Error ? error.message : String(error),
          220
        )}`
      );
      summary.cleanup = {
        ...(await cleanupQaAnnouncements(options.projectId, firestoreToken.token)),
        via: "firestore-admin",
      };
    }
  }

  if (!options.cleanupOnly) {
    const [announcementRows, digestInputs] = await Promise.all([
      loadRecentAnnouncements(options.projectId, firestoreToken.token),
      loadDigestInputs(options.projectId, firestoreToken.token),
    ]);

    const dailyDigests = announcementRows.filter((row) => isDailyDigest(row));
    const todayDocumentId = `${DAILY_DIGEST_ID_PREFIX}${runDate.compact}`;
    const todaysDigest =
      dailyDigests.find((row) => safeString(row.id) === todayDocumentId || safeString(row.digestDateKey) === runDate.dateKey) ||
      null;
    const latestDigest = dailyDigests[0] || null;
    const builtDigest = buildStudioDigest(digestInputs);
    const decision = decideStudioDigestAction({
      dateKey: runDate.dateKey,
      nextDigestFingerprint: builtDigest.digestFingerprint,
      latestDigest,
      todaysDigest,
    });

    summary.digest = {
      ...summary.digest,
      ...builtDigest,
      action: decision.action,
      reason: decision.reason,
      latestDigestFingerprint: safeString(latestDigest?.digestFingerprint),
      todaysDigestFingerprint: safeString(todaysDigest?.digestFingerprint),
    };

    if (decision.action === "upsert") {
      const existingCreatedAt = safeDate(todaysDigest?.createdAt) || new Date();
      const existingReadBy = Array.isArray(todaysDigest?.readBy)
        ? todaysDigest.readBy.filter((entry) => typeof entry === "string")
        : [];
      const response = await fireUpsert(options.projectId, firestoreToken.token, `announcements/${todayDocumentId}`, {
        title: builtDigest.title,
        body: builtDigest.body,
        type: "update",
        source: "daily_digest",
        audience: "members",
        digestDateKey: runDate.dateKey,
        digestFingerprint: builtDigest.digestFingerprint,
        authorName: "Monsoon Fire",
        createdAt: existingCreatedAt,
        updatedAt: new Date(),
        readBy: existingReadBy,
      });
      if (!response.ok) {
        const message = response.json?.error?.message || response.json?.raw || `HTTP ${response.status}`;
        throw new Error(`Could not publish studio digest (${response.status}): ${String(message)}`);
      }
    }
  } else {
    summary.digest.reason = "cleanup_only";
  }

  await ensureWritableParent(options.reportPath);
  await writeFile(options.reportPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");

  if (options.asJson) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  } else {
    process.stdout.write(`status: ${summary.status}\n`);
    process.stdout.write(`digest action: ${summary.digest.action}\n`);
    process.stdout.write(`digest reason: ${summary.digest.reason}\n`);
    process.stdout.write(`cleanup deleted: ${summary.cleanup.deletedCount}\n`);
    process.stdout.write(`report: ${options.reportPath}\n`);
  }
}

const isDirectRun = process.argv[1] ? resolve(process.argv[1]) === __filename : false;

if (isDirectRun) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`portal-studio-digest failed: ${message}`);
    process.exit(1);
  });
}
