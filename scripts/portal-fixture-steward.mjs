#!/usr/bin/env node

/* eslint-disable no-console */

import { createSign } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { access } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const repoRoot = resolve(dirname(__filename), "..");

const DEFAULT_API_KEY = "AIzaREDACTED";
const DEFAULT_PROJECT_ID = "monsoonfire-portal";
const DEFAULT_FUNCTIONS_BASE_URL = "https://us-central1-monsoonfire-portal.cloudfunctions.net";
const DEFAULT_REPORT_PATH = resolve(repoRoot, "output", "qa", "portal-fixture-steward.json");
const DEFAULT_STATE_PATH = resolve(repoRoot, ".codex", "fixture-steward-state.json");

function parseArgs(argv) {
  const options = {
    apiKey: process.env.PORTAL_FIREBASE_API_KEY || DEFAULT_API_KEY,
    projectId: process.env.PORTAL_PROJECT_ID || DEFAULT_PROJECT_ID,
    functionsBaseUrl: process.env.PORTAL_FUNCTIONS_BASE_URL || DEFAULT_FUNCTIONS_BASE_URL,
    credentialsPath:
      process.env.PORTAL_AGENT_STAFF_CREDENTIALS ||
      resolve(homedir(), ".ssh", "portal-agent-staff.json"),
    credentialsJson: String(process.env.PORTAL_AGENT_STAFF_CREDENTIALS_JSON || "").trim(),
    reportPath: process.env.PORTAL_FIXTURE_STEWARD_REPORT || DEFAULT_REPORT_PATH,
    statePath: process.env.PORTAL_FIXTURE_STEWARD_STATE || DEFAULT_STATE_PATH,
    ttlDays: Number.parseInt(process.env.PORTAL_FIXTURE_STEWARD_TTL_DAYS || "21", 10) || 21,
    prefix: (process.env.PORTAL_FIXTURE_PREFIX || "qa-fixture").trim(),
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
  const raw = String(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || process.env.FIREBASE_SERVICE_ACCOUNT_MONSOONFIRE_PORTAL || "").trim();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed.client_email || !parsed.private_key) return null;
    return parsed;
  } catch {
    return null;
  }
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

  let adminToken = "";
  const serviceAccount = loadServiceAccountFromEnv();
  if (serviceAccount) {
    try {
      adminToken = await mintServiceAccessToken(serviceAccount);
      summary.usedAdminToken = true;
    } catch (error) {
      summary.warnings.push(
        `Service account token mint failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  const firestoreToken = adminToken || idToken;
  const now = new Date();
  const runNonce = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const batchClientRequestId = `${options.prefix}-batch-${runDate.compact}-${runNonce}`;

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
      clientRequestId: batchClientRequestId,
    }),
  });

  if (!createBatchResp.ok) {
    throw new Error(`createBatch failed with status ${createBatchResp.status}`);
  }

  const batchId =
    String(createBatchResp.json?.batchId || "").trim() ||
    String(createBatchResp.json?.existingBatchId || "").trim();
  if (!batchId) {
    throw new Error("createBatch response did not include a batchId.");
  }

  const pieceId = `${options.prefix}-piece-${runDate.compact}-${runNonce}`;
  const announcementId = `${options.prefix}-studio-update-${runDate.compact}-${runNonce}`;
  const notificationId = `${options.prefix}-notification-${runDate.compact}-${runNonce}`;
  const threadId = `${options.prefix}-thread-${runDate.compact}-${runNonce}`;
  const messageId = `${options.prefix}-message-${runDate.compact}-${runNonce}`;

  summary.seeded = {
    uid,
    email,
    batchId,
    pieceId,
    announcementId,
    notificationId,
    threadId,
    messageId,
  };

  const upsertResults = [];

  upsertResults.push({
    step: "upsert piece",
    response: await fireUpsert(options.projectId, firestoreToken, `batches/${batchId}/pieces/${pieceId}`, {
      pieceCode: `QA-${runDate.compact.slice(-6)}`,
      shortDesc: "QA fixture piece for dashboard + my pieces canary",
      ownerName: displayName,
      stage: "GREENWARE",
      wareCategory: "STONEWARE",
      isArchived: false,
      createdAt: now,
      updatedAt: now,
    }),
  });

  upsertResults.push({
    step: "upsert announcement",
    response: await fireUpsert(options.projectId, firestoreToken, `announcements/${announcementId}`, {
      title: "QA fixture studio update",
      body: "QA fixture: validating dashboard Studio updates visibility.",
      kind: "studio_update",
      createdAt: now,
      updatedAt: now,
      authorUid: uid,
      authorName: displayName,
      readBy: [],
    }),
  });

  const notificationResult = await fireUpsert(
    options.projectId,
    firestoreToken,
    `users/${uid}/notifications/${notificationId}`,
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

  upsertResults.push({
    step: "upsert direct message thread",
    response: await fireUpsert(options.projectId, firestoreToken, `directMessages/${threadId}`, {
      subject: "QA fixture direct message",
      kind: "support",
      participantUids: [uid],
      createdAt: now,
      updatedAt: now,
      lastMessagePreview: "QA fixture message preview",
      lastMessageAt: now,
      lastMessageId: `<${messageId}@monsoonfire.local>`,
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
      `directMessages/${threadId}/messages/${messageId}`,
      {
        messageId: `<${messageId}@monsoonfire.local>`,
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

  for (const result of upsertResults) {
    const ok = result.response.ok;
    summary.steps.push({
      step: result.step,
      status: ok ? "passed" : "failed",
      httpStatus: result.response.status,
    });

    if (!ok) {
      const message = result.response.json?.error?.message || result.response.json?.raw || "unknown error";
      if (result.step === "upsert notification" && !summary.usedAdminToken) {
        summary.warnings.push(`Notification fixture seed skipped without admin token: ${truncate(String(message), 280)}`);
      } else {
        throw new Error(`${result.step} failed (${result.response.status}): ${truncate(String(message), 280)}`);
      }
    }
  }

  const validations = [
    { key: "piece", path: `batches/${batchId}/pieces/${pieceId}` },
    { key: "announcement", path: `announcements/${announcementId}` },
    { key: "thread", path: `directMessages/${threadId}` },
    { key: "message", path: `directMessages/${threadId}/messages/${messageId}` },
    { key: "notification", path: `users/${uid}/notifications/${notificationId}` },
  ];

  for (const checkItem of validations) {
    const response = await fireGet(options.projectId, firestoreToken, checkItem.path);
    const passed = response.ok;

    summary.steps.push({
      step: `validate ${checkItem.key}`,
      status: passed ? "passed" : "failed",
      httpStatus: response.status,
    });

    if (!passed) {
      if (checkItem.key === "notification" && !summary.usedAdminToken) {
        summary.warnings.push(
          `Notification fixture validation skipped without admin token (status ${response.status}).`
        );
      } else {
        throw new Error(`Fixture validation failed for ${checkItem.key} (${response.status}).`);
      }
    }
  }

  const state = await readJsonFile(options.statePath, { fixtures: [] });
  const fixtures = Array.isArray(state.fixtures) ? state.fixtures : [];

  const currentFixture = {
    runDate: runDate.dateKey,
    uid,
    batchId,
    pieceId,
    announcementId,
    notificationId,
    threadId,
    messageId,
  };

  const deduped = fixtures.filter((entry) => String(entry?.runDate || "") !== runDate.dateKey);
  deduped.push(currentFixture);

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

    const stalePaths = [
      `directMessages/${fixture.threadId}/messages/${fixture.messageId}`,
      `directMessages/${fixture.threadId}`,
      `users/${fixture.uid}/notifications/${fixture.notificationId}`,
      `announcements/${fixture.announcementId}`,
      `batches/${fixture.batchId}/pieces/${fixture.pieceId}`,
      `batches/${fixture.batchId}`,
    ];

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
    process.stdout.write(`seeded batch: ${batchId}\n`);
    process.stdout.write(`seeded notification: ${notificationId}\n`);
    if (summary.warnings.length > 0) {
      summary.warnings.forEach((warning) => process.stdout.write(`warning: ${warning}\n`));
    }
    process.stdout.write(`report: ${options.reportPath}\n`);
  }

  if (summary.status === "failed") {
    process.exit(1);
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`portal-fixture-steward failed: ${message}`);
  process.exit(1);
});
