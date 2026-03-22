#!/usr/bin/env node

/* eslint-disable no-console */

import { createSign } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { access } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  exchangePortalRulesRefreshToken,
  looksLikeRefreshToken,
  loadGoogleAuthorizedUserCredentials,
} from "./lib/google-oauth-refresh.mjs";

const __filename = fileURLToPath(import.meta.url);
const repoRoot = resolve(dirname(__filename), "..");

const DEFAULT_PROJECT_ID = "monsoonfire-portal";
const DEFAULT_FUNCTIONS_BASE_URL = "https://us-central1-monsoonfire-portal.cloudfunctions.net";
const DEFAULT_REPORT_PATH = resolve(repoRoot, "output", "qa", "portal-fixture-steward.json");
const DEFAULT_STATE_PATH = resolve(repoRoot, ".codex", "fixture-steward-state.json");
const DEFAULT_CREDENTIALS_PATH = resolve(repoRoot, "secrets", "portal", "portal-agent-staff.json");
const DEFAULT_PORTAL_AUTOMATION_ENV_PATH = resolve(repoRoot, "secrets", "portal", "portal-automation.env");
const FIXTURE_FLAG_BY_ARG = {
  "batch-piece": "seedBatchPiece",
  announcement: "seedAnnouncement",
  notification: "seedNotification",
  "direct-messages": "seedDirectMessages",
  "workshop-event": "seedWorkshopEvent",
};

export const DEFAULT_FIXTURE_FLAGS = Object.freeze({
  seedBatchPiece: true,
  seedAnnouncement: false,
  seedNotification: true,
  seedDirectMessages: true,
  seedWorkshopEvent: true,
});

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

function withDefaultFixtureFlags(flags = {}) {
  return {
    ...DEFAULT_FIXTURE_FLAGS,
    ...flags,
  };
}

export function buildFixtureIds({ prefix, runDateKey }) {
  const compact = String(runDateKey || "").replace(/-/g, "");
  const messageDocId = `${prefix}-message-${compact}`;
  return {
    compact,
    batchClientRequestId: `${prefix}-batch-${compact}`,
    pieceId: `${prefix}-piece-${compact}`,
    announcementId: `${prefix}-studio-update-${compact}`,
    notificationId: `${prefix}-notification-${compact}`,
    workshopEventId: `${prefix}-workshop-${compact}`,
    threadId: `${prefix}-thread-${compact}`,
    messageId: messageDocId,
    messageRfc822Id: `<${messageDocId}@monsoonfire.local>`,
  };
}

export function mergeFixtureState(existingFixture, currentFixture) {
  const existing = existingFixture && typeof existingFixture === "object" ? existingFixture : {};
  const current = currentFixture && typeof currentFixture === "object" ? currentFixture : {};
  return {
    runDate: String(current.runDate || existing.runDate || ""),
    uid: String(current.uid || existing.uid || ""),
    batchId: current.batchId ?? existing.batchId ?? null,
    pieceId: current.pieceId ?? existing.pieceId ?? null,
    announcementId: current.announcementId ?? existing.announcementId ?? null,
    notificationId: current.notificationId ?? existing.notificationId ?? null,
    workshopEventId: current.workshopEventId ?? existing.workshopEventId ?? null,
    threadId: current.threadId ?? existing.threadId ?? null,
    messageId: current.messageId ?? existing.messageId ?? null,
    fixtureFlags: withDefaultFixtureFlags({
      ...(existing.fixtureFlags || {}),
      ...(current.fixtureFlags || {}),
    }),
  };
}

export function buildFixtureCleanupPaths(fixture) {
  if (!fixture || typeof fixture !== "object") return [];
  return [
    fixture.threadId && fixture.messageId
      ? `directMessages/${fixture.threadId}/messages/${fixture.messageId}`
      : null,
    fixture.threadId ? `directMessages/${fixture.threadId}` : null,
    fixture.uid && fixture.notificationId
      ? `users/${fixture.uid}/notifications/${fixture.notificationId}`
      : null,
    fixture.announcementId ? `announcements/${fixture.announcementId}` : null,
    fixture.workshopEventId ? `events/${fixture.workshopEventId}` : null,
    fixture.batchId && fixture.pieceId ? `batches/${fixture.batchId}/pieces/${fixture.pieceId}` : null,
    fixture.batchId ? `batches/${fixture.batchId}` : null,
  ].filter(Boolean);
}

export function parseArgs(argv) {
  const options = {
    apiKey: String(process.env.PORTAL_FIREBASE_API_KEY || "").trim(),
    projectId: process.env.PORTAL_PROJECT_ID || DEFAULT_PROJECT_ID,
    functionsBaseUrl: process.env.PORTAL_FUNCTIONS_BASE_URL || DEFAULT_FUNCTIONS_BASE_URL,
    credentialsPath:
      process.env.PORTAL_AGENT_STAFF_CREDENTIALS ||
      DEFAULT_CREDENTIALS_PATH,
    credentialsJson: String(process.env.PORTAL_AGENT_STAFF_CREDENTIALS_JSON || "").trim(),
    reportPath: process.env.PORTAL_FIXTURE_STEWARD_REPORT || DEFAULT_REPORT_PATH,
    statePath: process.env.PORTAL_FIXTURE_STEWARD_STATE || DEFAULT_STATE_PATH,
    ttlDays: Number.parseInt(process.env.PORTAL_FIXTURE_STEWARD_TTL_DAYS || "21", 10) || 21,
    prefix: (process.env.PORTAL_FIXTURE_PREFIX || "qa-fixture").trim(),
    fixtureFlags: withDefaultFixtureFlags(),
    asJson: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg || !arg.startsWith("--")) continue;

    if (arg === "--api-key") {
      const next = argv[index + 1];
      if (!next || next.startsWith("--")) throw new Error("Missing value for --api-key");
      options.apiKey = String(next).trim();
      index += 1;
      continue;
    }

    if (arg === "--project") {
      const next = argv[index + 1];
      if (!next || next.startsWith("--")) throw new Error("Missing value for --project");
      options.projectId = String(next).trim();
      index += 1;
      continue;
    }

    if (arg === "--functions-base-url") {
      const next = argv[index + 1];
      if (!next || next.startsWith("--")) throw new Error("Missing value for --functions-base-url");
      options.functionsBaseUrl = String(next).trim().replace(/\/+$/, "");
      index += 1;
      continue;
    }

    if (arg === "--credentials") {
      const next = argv[index + 1];
      if (!next || next.startsWith("--")) throw new Error("Missing value for --credentials");
      options.credentialsPath = resolve(process.cwd(), String(next).trim());
      index += 1;
      continue;
    }

    if (arg === "--report") {
      const next = argv[index + 1];
      if (!next || next.startsWith("--")) throw new Error("Missing value for --report");
      options.reportPath = resolve(process.cwd(), String(next).trim());
      index += 1;
      continue;
    }

    if (arg === "--state") {
      const next = argv[index + 1];
      if (!next || next.startsWith("--")) throw new Error("Missing value for --state");
      options.statePath = resolve(process.cwd(), String(next).trim());
      index += 1;
      continue;
    }

    if (arg === "--ttl-days") {
      const next = argv[index + 1];
      if (!next || next.startsWith("--")) throw new Error("Missing value for --ttl-days");
      const ttl = Number.parseInt(next, 10);
      if (!Number.isFinite(ttl) || ttl < 1) throw new Error("--ttl-days must be >= 1");
      options.ttlDays = ttl;
      index += 1;
      continue;
    }

    if (arg === "--prefix") {
      const next = argv[index + 1];
      if (!next || next.startsWith("--")) throw new Error("Missing value for --prefix");
      options.prefix = String(next).trim();
      index += 1;
      continue;
    }

    if (arg === "--json") {
      options.asJson = true;
      continue;
    }

    if (arg.startsWith("--seed-") || arg.startsWith("--no-seed-")) {
      const enable = arg.startsWith("--seed-");
      const rawKey = enable ? arg.slice("--seed-".length) : arg.slice("--no-seed-".length);
      const fixtureKey = FIXTURE_FLAG_BY_ARG[rawKey];
      if (!fixtureKey) {
        throw new Error(`Unknown fixture flag ${arg}`);
      }
      options.fixtureFlags[fixtureKey] = enable;
      continue;
    }
  }

  if (!options.apiKey) {
    throw new Error("Missing PORTAL_FIREBASE_API_KEY (or pass --api-key).");
  }

  return options;
}

function truncate(value, max = 600) {
  if (typeof value !== "string") return "";
  return value.length <= max ? value : `${value.slice(0, max)}...[truncated]`;
}

async function pathExists(path) {
  try {
    await access(path, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function requestJson(url, init = {}) {
  const response = await fetch(url, init);
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
}

function b64url(input) {
  const raw = typeof input === "string" ? Buffer.from(input, "utf8") : Buffer.from(input);
  return raw
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
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

function encodeDocPath(path) {
  return path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function isPermissionDeniedStatus(status) {
  return status === 401 || status === 403;
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

function parseIsoDateOnly(value) {
  if (typeof value !== "string") return null;
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime())) return null;
  return parsed;
}

function dateDiffDays(a, b) {
  const millis = a.getTime() - b.getTime();
  return Math.floor(millis / 86400000);
}

async function readJsonFile(path, fallback) {
  try {
    const raw = await readFile(path, "utf8");
    if (!raw.trim()) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

async function writeJsonFile(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function loadServiceAccountFromEnv() {
  const parseServiceAccountJson = (raw) => {
    const text = String(raw || "").trim();
    if (!text) return null;
    try {
      const parsed = JSON.parse(text);
      if (!parsed.client_email || !parsed.private_key) return null;
      return parsed;
    } catch {
      return null;
    }
  };

  const inline =
    parseServiceAccountJson(process.env.FIREBASE_SERVICE_ACCOUNT_JSON) ||
    parseServiceAccountJson(process.env.FIREBASE_SERVICE_ACCOUNT_MONSOONFIRE_PORTAL);
  if (inline) return inline;

  const candidatePaths = [
    process.env.GOOGLE_APPLICATION_CREDENTIALS,
    process.env.FIREBASE_SERVICE_ACCOUNT_PATH,
    process.env.PORTAL_FIREBASE_SERVICE_ACCOUNT_PATH,
  ]
    .map((value) => String(value || "").trim())
    .filter(Boolean);

  for (const filePath of candidatePaths) {
    if (!existsSync(filePath)) continue;
    try {
      const raw = readFileSync(filePath, "utf8");
      const parsed = parseServiceAccountJson(raw);
      if (parsed) return parsed;
    } catch {
      // continue
    }
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

  return String(response.json.access_token);
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
      accessToken: String(parsed?.tokens?.access_token || "").trim(),
      refreshToken: String(parsed?.tokens?.refresh_token || "").trim(),
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
  const adcCredentials = await loadGoogleAuthorizedUserCredentials();
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
    const raw = String(entry.value || "").trim();
    if (!raw) continue;
    if (looksLikeRefreshToken(raw)) {
      try {
        const exchanged = await exchangePortalRulesRefreshToken(raw, {
          source: entry.source,
          adcCredentials,
          adcResultSource: `${entry.source} (adc-client exchange)`,
        });
        candidates.push({
          source: `${exchanged.source} (refresh-token exchange)`,
          token: exchanged.accessToken,
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

async function fireGet(projectId, token, docPath) {
  const firestoreBase = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents`;
  const url = `${firestoreBase}/${encodeDocPath(docPath)}`;
  return requestJson(url, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
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

async function verifyFirestoreWriteAccess(projectId, token) {
  const probeId = `portal-fixture-steward-probe-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
  const probePath = `_qaFixtureProbe/${probeId}`;
  const now = new Date();

  const upsert = await fireUpsert(projectId, token, probePath, {
    createdAt: now,
    updatedAt: now,
    source: "portal-fixture-steward",
  });

  if (!upsert.ok) {
    const message =
      upsert.json?.error?.message || upsert.json?.raw || `HTTP ${upsert.status}`;
    return {
      ok: false,
      status: upsert.status,
      message: String(message),
    };
  }

  const cleanup = await fireDelete(projectId, token, probePath);
  if (!cleanup.ok && cleanup.status !== 404) {
    const message =
      cleanup.json?.error?.message || cleanup.json?.raw || `HTTP ${cleanup.status}`;
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

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const runDate = formatPhoenixDate();
  const runIso = new Date().toISOString();

  const summary = {
    status: "passed",
    runAtIso: runIso,
    runDateKey: runDate.dateKey,
    projectId: options.projectId,
    reportPath: options.reportPath,
    statePath: options.statePath,
    ttlDays: options.ttlDays,
    fixtureFlags: options.fixtureFlags,
    usedAdminToken: false,
    warnings: [],
    steps: [],
    seeded: {},
    cleaned: [],
  };

  const creds = options.credentialsJson
    ? JSON.parse(options.credentialsJson)
    : JSON.parse(await readFile(options.credentialsPath, "utf8"));
  const refreshToken = String(creds.refreshToken || "").trim();
  const uid = String(creds.uid || "").trim();
  const email = String(creds.email || "").trim();
  const displayName = String(creds.displayName || "Portal QA Staff").trim();

  if (!refreshToken || !uid || !email) {
    throw new Error(`Invalid credentials file at ${options.credentialsPath}`);
  }

  const tokenResp = await requestJson(
    `https://securetoken.googleapis.com/v1/token?key=${encodeURIComponent(options.apiKey)}`,
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      }).toString(),
    }
  );

  if (!tokenResp.ok || !tokenResp.json?.id_token) {
    throw new Error(`Could not mint ID token from refresh token (status ${tokenResp.status}).`);
  }

  const idToken = String(tokenResp.json.id_token);

  const adminTokenCandidates = [];
  const serviceAccount = loadServiceAccountFromEnv();
  if (serviceAccount) {
    try {
      adminTokenCandidates.push({
        source: "service account",
        token: await mintServiceAccessToken(serviceAccount),
      });
    } catch (error) {
      summary.warnings.push(
        `Service account token mint failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  const envAdminCandidates = await resolveEnvAdminTokenCandidates();
  for (const candidate of envAdminCandidates) {
    if (!candidate.token) {
      summary.warnings.push(
        `Admin token candidate ${candidate.source} unavailable: ${truncate(String(candidate.error || "token resolution failed"), 220)}`
      );
      continue;
    }
    adminTokenCandidates.push({
      source: candidate.source,
      token: candidate.token,
    });
  }

  let firestoreToken = idToken;
  const adminTokenProbeWarnings = [];
  for (const candidate of adminTokenCandidates) {
    const adminProbe = await verifyFirestoreWriteAccess(options.projectId, candidate.token);
    if (!adminProbe.ok) {
      adminTokenProbeWarnings.push(
        `${candidate.source} token cannot write Firestore fixtures (status ${adminProbe.status}); trying next credential. ${truncate(adminProbe.message, 220)}`
      );
      continue;
    }
    firestoreToken = candidate.token;
    summary.usedAdminToken = true;
    break;
  }
  if (!summary.usedAdminToken && adminTokenProbeWarnings.length > 0) {
    summary.warnings.push(...adminTokenProbeWarnings);
  }
  const now = new Date();
  const fixtureIds = buildFixtureIds({
    prefix: options.prefix,
    runDateKey: runDate.dateKey,
  });
  let batchId = null;

  if (options.fixtureFlags.seedBatchPiece) {
    const createBatchResp = await requestJson(`${options.functionsBaseUrl}/createBatch`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({
        ownerUid: uid,
        ownerDisplayName: displayName,
        title: `QA Fixture ${runDate.dateKey}`,
        intakeMode: "STAFF_HANDOFF",
        estimatedCostCents: 1200,
        estimateNotes: "QA fixture steward seeded batch",
        clientRequestId: fixtureIds.batchClientRequestId,
      }),
    });

    if (!createBatchResp.ok) {
      throw new Error(`createBatch failed with status ${createBatchResp.status}`);
    }

    batchId =
      String(createBatchResp.json?.batchId || "").trim() ||
      String(createBatchResp.json?.existingBatchId || "").trim();
    if (!batchId) {
      throw new Error("createBatch response did not include a batchId.");
    }
  }

  summary.seeded = {
    uid,
    email,
    batchId,
    pieceId: options.fixtureFlags.seedBatchPiece ? fixtureIds.pieceId : null,
    announcementId: options.fixtureFlags.seedAnnouncement ? fixtureIds.announcementId : null,
    notificationId: options.fixtureFlags.seedNotification ? fixtureIds.notificationId : null,
    workshopEventId: options.fixtureFlags.seedWorkshopEvent ? fixtureIds.workshopEventId : null,
    threadId: options.fixtureFlags.seedDirectMessages ? fixtureIds.threadId : null,
    messageId: options.fixtureFlags.seedDirectMessages ? fixtureIds.messageId : null,
  };

  const upsertResults = [];

  if (options.fixtureFlags.seedBatchPiece && batchId) {
    upsertResults.push({
      step: "upsert piece",
      response: await fireUpsert(options.projectId, firestoreToken, `batches/${batchId}/pieces/${fixtureIds.pieceId}`, {
        pieceCode: `QA-${fixtureIds.compact.slice(-6)}`,
        shortDesc: "QA fixture piece for dashboard + my pieces canary",
        ownerName: displayName,
        stage: "GREENWARE",
        wareCategory: "STONEWARE",
        isArchived: false,
        createdAt: now,
        updatedAt: now,
      }),
    });
  }

  if (options.fixtureFlags.seedAnnouncement) {
    upsertResults.push({
      step: "upsert announcement",
      response: await fireUpsert(options.projectId, firestoreToken, `announcements/${fixtureIds.announcementId}`, {
        title: "QA fixture studio update",
        body: "QA fixture: validating dashboard Studio updates visibility.",
        kind: "studio_update",
        source: "qa_fixture",
        audience: "qa",
        createdAt: now,
        updatedAt: now,
        authorUid: uid,
        authorName: displayName,
        readBy: [],
      }),
    });
  }

  if (options.fixtureFlags.seedWorkshopEvent) {
    const workshopStartAt = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
    const workshopEndAt = new Date(workshopStartAt.getTime() + 2 * 60 * 60 * 1000);
    upsertResults.push({
      step: "upsert workshop event",
      response: await fireUpsert(options.projectId, firestoreToken, `events/${fixtureIds.workshopEventId}`, {
        title: `QA Fixture Workshop ${runDate.dateKey}`,
        summary: "Seeded workshop fixture for deterministic canary coverage.",
        description:
          "QA fixture workshop. Used by staff/event canaries to verify workshop rails and deterministic content availability.",
        location: "Monsoon Fire Studio",
        timezone: "America/Phoenix",
        startAt: workshopStartAt,
        endAt: workshopEndAt,
        capacity: 12,
        priceCents: 1800,
        currency: "USD",
        includesFiring: true,
        firingDetails: "Bisque + glaze discussion included",
        policyCopy:
          "Fixture policy: attendance-only billing for canary verification. Cancel anytime up to 3 hours before start.",
        addOns: [],
        waitlistEnabled: true,
        offerClaimWindowHours: 12,
        cancelCutoffHours: 3,
        status: "published",
        ticketedCount: 0,
        offeredCount: 0,
        checkedInCount: 0,
        waitlistCount: 0,
        fixture: {
          seededBy: "portal-fixture-steward",
          runDate: runDate.dateKey,
          prefix: options.prefix,
        },
        createdAt: now,
        updatedAt: now,
        publishedAt: now,
      }),
    });
  }

  if (options.fixtureFlags.seedNotification) {
    const notificationResult = await fireUpsert(
      options.projectId,
      firestoreToken,
      `users/${uid}/notifications/${fixtureIds.notificationId}`,
      {
        title: "QA fixture notification",
        body: "QA fixture: mark-read workflow validation target.",
        kind: "qa",
        status: "new",
        createdAt: now,
        updatedAt: now,
        readAt: null,
      }
    );
    upsertResults.push({ step: "upsert notification", response: notificationResult });
  }

  if (options.fixtureFlags.seedDirectMessages) {
    upsertResults.push({
      step: "upsert direct message thread",
      response: await fireUpsert(options.projectId, firestoreToken, `directMessages/${fixtureIds.threadId}`, {
        subject: "QA fixture direct message",
        kind: "support",
        participantUids: [uid],
        createdAt: now,
        updatedAt: now,
        lastMessagePreview: "QA fixture message preview",
        lastMessageAt: now,
        lastMessageId: fixtureIds.messageRfc822Id,
        lastSenderName: displayName,
        lastSenderEmail: email,
        references: [],
        lastReadAtByUid: {
          [uid]: now,
        },
      }),
    });

    upsertResults.push({
      step: "upsert direct message",
      response: await fireUpsert(
        options.projectId,
        firestoreToken,
        `directMessages/${fixtureIds.threadId}/messages/${fixtureIds.messageId}`,
        {
          messageId: fixtureIds.messageRfc822Id,
          subject: "QA fixture direct message",
          body: "QA fixture message for messages page canary.",
          fromUid: uid,
          fromName: displayName,
          fromEmail: email,
          replyToEmail: email,
          toUids: [],
          toEmails: [],
          sentAt: now,
          inReplyTo: null,
          references: [],
        }
      ),
    });
  }

  if (!Object.values(options.fixtureFlags).some(Boolean)) {
    summary.warnings.push("No fixture categories enabled for this run; steward performed TTL cleanup only.");
  }

  for (const result of upsertResults) {
    const ok = result.response.ok;
    const permissionDenied = !ok && isPermissionDeniedStatus(result.response.status);
    const optionalWithoutAdmin =
      !ok &&
      !summary.usedAdminToken &&
      (result.step === "upsert notification" || result.step === "upsert workshop event");
    summary.steps.push({
      step: result.step,
      status: ok ? "passed" : permissionDenied || optionalWithoutAdmin ? "skipped" : "failed",
      httpStatus: result.response.status,
    });

    if (!ok) {
      const message = result.response.json?.error?.message || result.response.json?.raw || "unknown error";
      if (permissionDenied) {
        summary.warnings.push(
          `${result.step} skipped due Firestore permissions (${result.response.status}): ${truncate(
            String(message),
            280
          )}`
        );
        continue;
      }
      if (optionalWithoutAdmin) {
        summary.warnings.push(
          `${result.step === "upsert notification" ? "Notification" : "Workshop"} fixture seed skipped without admin token: ${truncate(String(message), 280)}`
        );
      } else {
        throw new Error(`${result.step} failed (${result.response.status}): ${truncate(String(message), 280)}`);
      }
    }
  }

  const validations = [];
  if (options.fixtureFlags.seedBatchPiece && batchId) {
    validations.push({ key: "piece", path: `batches/${batchId}/pieces/${fixtureIds.pieceId}` });
  }
  if (options.fixtureFlags.seedAnnouncement) {
    validations.push({ key: "announcement", path: `announcements/${fixtureIds.announcementId}` });
  }
  if (options.fixtureFlags.seedDirectMessages) {
    validations.push({ key: "thread", path: `directMessages/${fixtureIds.threadId}` });
    validations.push({
      key: "message",
      path: `directMessages/${fixtureIds.threadId}/messages/${fixtureIds.messageId}`,
    });
  }
  if (options.fixtureFlags.seedNotification) {
    validations.push({
      key: "notification",
      path: `users/${uid}/notifications/${fixtureIds.notificationId}`,
    });
  }
  if (options.fixtureFlags.seedWorkshopEvent) {
    validations.push({ key: "workshopEvent", path: `events/${fixtureIds.workshopEventId}` });
  }

  for (const checkItem of validations) {
    const response = await fireGet(options.projectId, firestoreToken, checkItem.path);
    const passed = response.ok;
    const permissionDenied = !passed && isPermissionDeniedStatus(response.status);
    const optionalWithoutAdmin =
      !passed &&
      !summary.usedAdminToken &&
      (checkItem.key === "notification" || checkItem.key === "workshopEvent");

    summary.steps.push({
      step: `validate ${checkItem.key}`,
      status: passed ? "passed" : permissionDenied || optionalWithoutAdmin ? "skipped" : "failed",
      httpStatus: response.status,
    });

    if (!passed) {
      if (permissionDenied) {
        summary.warnings.push(
          `Fixture validation skipped for ${checkItem.key} due Firestore permissions (${response.status}).`
        );
        continue;
      }
      if (optionalWithoutAdmin) {
        summary.warnings.push(
          `${checkItem.key === "notification" ? "Notification" : "Workshop"} fixture validation skipped without admin token (status ${response.status}).`
        );
      } else {
        throw new Error(`Fixture validation failed for ${checkItem.key} (${response.status}).`);
      }
    }
  }

  const state = await readJsonFile(options.statePath, { fixtures: [] });
  const fixtures = Array.isArray(state.fixtures) ? state.fixtures : [];
  const existingFixtureForDate =
    fixtures.find((entry) => String(entry?.runDate || "") === runDate.dateKey) || null;

  const currentFixture = mergeFixtureState(existingFixtureForDate, {
    runDate: runDate.dateKey,
    uid,
    batchId: options.fixtureFlags.seedBatchPiece ? batchId : null,
    pieceId: options.fixtureFlags.seedBatchPiece ? fixtureIds.pieceId : null,
    announcementId: options.fixtureFlags.seedAnnouncement ? fixtureIds.announcementId : null,
    notificationId: options.fixtureFlags.seedNotification ? fixtureIds.notificationId : null,
    workshopEventId: options.fixtureFlags.seedWorkshopEvent ? fixtureIds.workshopEventId : null,
    threadId: options.fixtureFlags.seedDirectMessages ? fixtureIds.threadId : null,
    messageId: options.fixtureFlags.seedDirectMessages ? fixtureIds.messageId : null,
    fixtureFlags: options.fixtureFlags,
  });

  const deduped = fixtures.filter((entry) => String(entry?.runDate || "") !== runDate.dateKey);
  const shouldPersistCurrentFixture =
    Boolean(existingFixtureForDate) || Object.values(currentFixture.fixtureFlags || {}).some(Boolean);
  if (shouldPersistCurrentFixture) {
    deduped.push(currentFixture);
  }

  const cleaned = [];
  const retained = [];
  const today = parseIsoDateOnly(runDate.dateKey) || new Date();

  for (const fixture of deduped) {
    const fixtureDate = parseIsoDateOnly(String(fixture?.runDate || ""));
    if (!fixtureDate) {
      retained.push(fixture);
      continue;
    }

    const ageDays = dateDiffDays(today, fixtureDate);
    if (ageDays <= options.ttlDays) {
      retained.push(fixture);
      continue;
    }

    const stalePaths = buildFixtureCleanupPaths(fixture);

    let cleanupOk = true;
    for (const path of stalePaths) {
      const response = await fireDelete(options.projectId, firestoreToken, path);
      const ok = response.ok || response.status === 404;
      cleaned.push({ path, status: response.status, ok });
      if (!ok) cleanupOk = false;
    }

    if (!cleanupOk) {
      retained.push(fixture);
      summary.warnings.push(
        `TTL cleanup incomplete for fixture ${fixture.runDate}; retaining state entry for retry.`
      );
    }
  }

  summary.cleaned = cleaned;
  await writeJsonFile(options.statePath, { fixtures: retained });

  summary.finishedAtIso = new Date().toISOString();
  if (summary.steps.some((step) => step.status === "failed")) {
    summary.status = "failed";
  }
  if (summary.warnings.length > 0 && summary.status === "passed") {
    summary.status = "passed_with_warnings";
  }

  await mkdir(dirname(options.reportPath), { recursive: true });
  await writeFile(options.reportPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");

  if (options.asJson) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  } else {
    process.stdout.write(`status: ${summary.status}\n`);
    process.stdout.write(`run date: ${summary.runDateKey}\n`);
    process.stdout.write(`seeded batch: ${summary.seeded.batchId || "none"}\n`);
    process.stdout.write(`seeded notification: ${summary.seeded.notificationId || "none"}\n`);
    if (summary.warnings.length > 0) {
      summary.warnings.forEach((warning) => process.stdout.write(`warning: ${warning}\n`));
    }
    process.stdout.write(`report: ${options.reportPath}\n`);
  }

  if (summary.status === "failed") {
    process.exit(1);
  }
}

const isDirectRun = process.argv[1] ? resolve(process.argv[1]) === __filename : false;

if (isDirectRun) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`portal-fixture-steward failed: ${message}`);
    process.exit(1);
  });
}
