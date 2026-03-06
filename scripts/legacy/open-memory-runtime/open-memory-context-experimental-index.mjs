#!/usr/bin/env node

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { mintStaffIdTokenFromPortalEnv, normalizeBearer } from "./lib/firebase-auth-token.mjs";
import { resolveStudioBrainBaseUrlFromEnv } from "./studio-brain-url-resolution.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..");

const DEFAULT_STUDIO_ENV_PATH = resolve(REPO_ROOT, "secrets", "studio-brain", "studio-brain-automation.env");
const DEFAULT_PORTAL_ENV_PATH = resolve(REPO_ROOT, "secrets", "portal", "portal-automation.env");
const DEFAULT_REPORT_PATH = resolve(REPO_ROOT, "output", "open-memory", "context-experimental-index-latest.json");
const DEFAULT_PREVIEW_PATH = resolve(REPO_ROOT, "output", "open-memory", "context-experimental-candidates.jsonl");
const DEFAULT_CAPTURE_FAILURE_SPOOL_PATH = resolve(
  REPO_ROOT,
  "output",
  "open-memory",
  "context-experimental-capture-failures.jsonl"
);

const STOP_WORDS = new Set([
  "a",
  "about",
  "after",
  "again",
  "all",
  "also",
  "an",
  "and",
  "any",
  "are",
  "as",
  "at",
  "be",
  "because",
  "been",
  "before",
  "being",
  "both",
  "but",
  "by",
  "can",
  "could",
  "did",
  "do",
  "does",
  "doing",
  "done",
  "for",
  "from",
  "further",
  "had",
  "has",
  "have",
  "having",
  "he",
  "her",
  "here",
  "hers",
  "him",
  "his",
  "how",
  "i",
  "if",
  "in",
  "into",
  "is",
  "it",
  "its",
  "itself",
  "just",
  "me",
  "more",
  "most",
  "my",
  "new",
  "no",
  "nor",
  "not",
  "now",
  "of",
  "off",
  "on",
  "once",
  "only",
  "or",
  "other",
  "our",
  "ours",
  "out",
  "over",
  "own",
  "same",
  "she",
  "should",
  "so",
  "some",
  "such",
  "than",
  "that",
  "the",
  "their",
  "theirs",
  "them",
  "then",
  "there",
  "these",
  "they",
  "this",
  "those",
  "through",
  "to",
  "too",
  "under",
  "until",
  "up",
  "very",
  "was",
  "we",
  "were",
  "what",
  "when",
  "where",
  "which",
  "while",
  "who",
  "will",
  "with",
  "you",
  "your",
  "subject",
  "message",
  "messages",
  "email",
  "emails",
  "thread",
  "threads",
  "thanks",
  "thank",
  "please",
  "hello",
  "hi",
  "regards",
  "best",
  "re",
  "fw",
  "fwd",
  "nbsp",
  "zwnj",
  "amp",
  "quot",
  "http",
  "https",
]);

const NOISE_MAILBOX_LOCAL_PARTS = new Set([
  "admin",
  "alert",
  "alerts",
  "billing",
  "bot",
  "comms",
  "digest",
  "do-not-reply",
  "donotreply",
  "help",
  "hello",
  "hr",
  "info",
  "mailer-daemon",
  "marketing",
  "news",
  "newsletter",
  "no-reply",
  "noreply",
  "notification",
  "notifications",
  "ops",
  "postmaster",
  "press",
  "receipts",
  "support",
  "system",
  "updates",
]);

const HIGH_SIGNAL_CATEGORY_SET = new Set(["decision", "action", "risk", "escalation", "timeline"]);

const SIGNAL_RULES = {
  decision: [
    /\bdecid(?:e|ed|es|ing)\b/i,
    /\bdecision\b/i,
    /\bagree(?:d|ment)?\b/i,
    /\bapproved?\b/i,
    /\bconfirmed\b/i,
    /\bgo\/no-go\b/i,
    /\bwe will\b/i,
  ],
  action: [
    /\baction item\b/i,
    /\bnext step\b/i,
    /\bfollow[- ]?up\b/i,
    /\bowner\b/i,
    /\bassigned?\b/i,
    /\bneed to\b/i,
    /\bdeadline\b/i,
    /\bdue\b/i,
  ],
  risk: [
    /\brisk\b/i,
    /\bblocked?\b/i,
    /\bblocker\b/i,
    /\bissue\b/i,
    /\bconcern\b/i,
    /\bfailure\b/i,
    /\boutage\b/i,
    /\bsecurity\b/i,
    /\bcompliance\b/i,
  ],
  escalation: [/\bescalat(?:e|ed|ion)\b/i, /\burgent\b/i, /\bsev[0-9]\b/i, /\bimmediate\b/i, /\bcritical\b/i],
  timeline: [/\btimeline\b/i, /\bschedule\b/i, /\bmilestone\b/i, /\blaunch\b/i, /\bship\b/i, /\bq[1-4]\b/i],
  closure: [/\bresolved?\b/i, /\bclosed?\b/i, /\bcompleted?\b/i, /\bfixed\b/i, /\bdone\b/i],
};

const SIGNAL_WEIGHTS = {
  decision: 1.2,
  action: 1.1,
  risk: 1.0,
  escalation: 1.35,
  timeline: 0.8,
  closure: 0.45,
};

const DEFAULT_FALLBACK_SEARCH_SEEDS = [
  "risk",
  "decision",
  "deadline",
  "escalation",
  "incident",
  "outage",
  "blocker",
  "owner",
  "security",
];

function parseArgs(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = String(argv[i] ?? "");
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    if (key.includes("=")) {
      const [rawKey, ...rest] = key.split("=");
      flags[rawKey.trim().toLowerCase()] = rest.join("=");
      continue;
    }
    const next = argv[i + 1];
    if (next && !String(next).startsWith("--")) {
      flags[key.trim().toLowerCase()] = String(next);
      i += 1;
    } else {
      flags[key.trim().toLowerCase()] = "true";
    }
  }
  return flags;
}

function readBool(flags, key, fallback = false) {
  const raw = String(flags[key] ?? "").trim().toLowerCase();
  if (!raw) return fallback;
  if (["1", "true", "yes", "on"].includes(raw)) return true;
  if (["0", "false", "no", "off"].includes(raw)) return false;
  return fallback;
}

function readInt(flags, key, fallback, { min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER } = {}) {
  const raw = String(flags[key] ?? "").trim();
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function readNumber(flags, key, fallback, { min = -Number.MAX_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER } = {}) {
  const raw = String(flags[key] ?? "").trim();
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function readString(flags, key, fallback = "") {
  const raw = String(flags[key] ?? "").trim();
  return raw || fallback;
}

function parseCsv(value) {
  return String(value ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function stableHash(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function sleep(ms) {
  return new Promise((resolveSleep) => {
    setTimeout(resolveSleep, Math.max(0, ms));
  });
}

function loadEnvFile(filePath) {
  if (!filePath || !existsSync(filePath)) {
    return { attempted: false, loaded: false, keysLoaded: 0, filePath };
  }
  const raw = readFileSync(filePath, "utf8");
  const lines = raw.split(/\r?\n/);
  let keysLoaded = 0;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const normalized = trimmed.startsWith("export ") ? trimmed.slice("export ".length).trim() : trimmed;
    const separator = normalized.indexOf("=");
    if (separator <= 0) continue;
    const key = normalized.slice(0, separator).trim();
    let value = normalized.slice(separator + 1).trim();
    if (!key || process.env[key]) continue;
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
    keysLoaded += 1;
  }
  return { attempted: true, loaded: keysLoaded > 0, keysLoaded, filePath };
}

function safeRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function isExpiredIdTokenResponse(status, payload) {
  if (status !== 401) return false;
  const message =
    typeof payload?.message === "string"
      ? payload.message
      : typeof payload?.error?.message === "string"
        ? payload.error.message
        : typeof payload?.raw === "string"
          ? payload.raw
          : "";
  return /id-token-expired|auth\/id-token-expired|token.*expired/i.test(message);
}

async function requestJson(baseUrl, authHeader, adminToken, path, { method = "POST", body = undefined, timeoutMs = 30_000 } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers = {
      authorization: authHeader,
      ...(adminToken ? { "x-studio-brain-admin-token": adminToken } : {}),
    };
    if (body !== undefined) {
      headers["content-type"] = "application/json";
    }
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    const raw = await response.text();
    let payload = {};
    try {
      payload = raw ? JSON.parse(raw) : {};
    } catch {
      payload = { raw };
    }
    return {
      ok: response.ok,
      status: response.status,
      payload,
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      payload: { message: `request-failed:${error instanceof Error ? error.message : String(error)}` },
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function mintAuthHeader() {
  const minted = await mintStaffIdTokenFromPortalEnv({
    env: process.env,
    defaultCredentialsPath: resolve(REPO_ROOT, "secrets", "portal", "portal-agent-staff.json"),
    preferRefreshToken: true,
  });
  if (!minted.ok || !minted.token) {
    return { ok: false, reason: minted.reason || "unable-to-mint-token", authHeader: "" };
  }
  const authHeader = normalizeBearer(minted.token);
  process.env.STUDIO_BRAIN_ID_TOKEN = minted.token;
  process.env.STUDIO_BRAIN_AUTH_TOKEN = authHeader;
  return { ok: true, reason: "", authHeader };
}

async function ensureAuthHeader() {
  const existing = normalizeBearer(process.env.STUDIO_BRAIN_AUTH_TOKEN || process.env.STUDIO_BRAIN_ID_TOKEN || "");
  if (existing) {
    return { ok: true, authHeader: existing, source: "preconfigured" };
  }
  const minted = await mintAuthHeader();
  if (!minted.ok || !minted.authHeader) {
    return { ok: false, authHeader: "", source: "missing", reason: minted.reason };
  }
  return { ok: true, authHeader: minted.authHeader, source: "minted" };
}

async function requestWithRefresh({
  baseUrl,
  authState,
  adminToken,
  path,
  method = "POST",
  body = undefined,
  timeoutMs = 30_000,
}) {
  let response = await requestJson(baseUrl, authState.authHeader, adminToken, path, { method, body, timeoutMs });
  if (!response.ok && isExpiredIdTokenResponse(response.status, response.payload)) {
    const minted = await mintAuthHeader();
    if (minted.ok && minted.authHeader) {
      authState.authHeader = minted.authHeader;
      response = await requestJson(baseUrl, authState.authHeader, adminToken, path, { method, body, timeoutMs });
    }
  }
  return response;
}

function normalizeText(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function toIsoDate(value) {
  if (!Number.isFinite(value)) return null;
  return new Date(value).toISOString();
}

function parseTimestamp(value) {
  if (!value) return null;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function toCanonicalEmail(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) return "";
  if (/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(normalized)) return normalized;
  return "";
}

function normalizeParticipantEmail(value) {
  const canonical = toCanonicalEmail(value);
  if (!canonical) return "";
  const [localRaw, domainRaw] = canonical.split("@");
  const local = String(localRaw ?? "").trim();
  const domain = String(domainRaw ?? "").trim();
  if (!local || !domain) return "";
  const plusIndex = local.indexOf("+");
  const normalizedLocal = plusIndex >= 0 ? local.slice(0, plusIndex) : local;
  if (!normalizedLocal) return "";
  return `${normalizedLocal}@${domain}`;
}

function isLikelyNoiseMailbox(email) {
  const normalized = normalizeParticipantEmail(email);
  if (!normalized) return true;
  const [local, domain] = normalized.split("@");
  if (!local || !domain) return true;
  if (NOISE_MAILBOX_LOCAL_PARTS.has(local)) return true;
  if (/^(noreply|donotreply|no-reply|mailer-daemon|postmaster)/.test(local)) return true;
  if (/^(notifications?|alerts?|updates?|digest|support|help|info|marketing)$/.test(local)) return true;
  if (/(^|\.)no-?reply\./.test(domain)) return true;
  return false;
}

function participantIdentityWeight(email) {
  const normalized = normalizeParticipantEmail(email);
  if (!normalized) return 0.2;
  const [local] = normalized.split("@");
  if (NOISE_MAILBOX_LOCAL_PARTS.has(local)) return 0.45;
  if (/^(team|ops|support|help|sales|admin)$/.test(local)) return 0.58;
  return 1;
}

function extractEmails(value) {
  const raw = String(value ?? "");
  const found = raw.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [];
  const emails = [];
  const seen = new Set();
  for (const item of found) {
    const canonical = normalizeParticipantEmail(item);
    if (!canonical || seen.has(canonical)) continue;
    seen.add(canonical);
    emails.push(canonical);
  }
  return emails;
}

function collectMetadataStrings(value, depth = 0, out = [], maxItems = 80) {
  if (out.length >= maxItems) return out;
  if (value === null || value === undefined) return out;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    const text = normalizeText(value);
    if (text) out.push(text);
    return out;
  }
  if (depth > 3) return out;
  if (Array.isArray(value)) {
    for (const entry of value) {
      if (out.length >= maxItems) break;
      collectMetadataStrings(entry, depth + 1, out, maxItems);
    }
    return out;
  }
  if (typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) {
      if (out.length >= maxItems) break;
      const keyText = normalizeText(key);
      if (keyText) out.push(keyText);
      collectMetadataStrings(entry, depth + 1, out, maxItems);
    }
  }
  return out;
}

function tokenize(value) {
  const normalized = String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9@._ -]+/g, " ");
  return normalized
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 4)
    .filter((token) => token.length <= 32)
    .filter((token) => !token.includes("@"))
    .filter((token) => !STOP_WORDS.has(token))
    .filter((token) => /^[a-z0-9._-]+$/.test(token))
    .filter((token) => !/^https?/.test(token))
    .filter((token) => !/^\d+$/.test(token));
}

function topEntries(map, limit, minCount = 1) {
  return [...map.entries()]
    .filter(([, count]) => Number(count) >= minCount)
    .sort((a, b) => {
      if (b[1] !== a[1]) return b[1] - a[1];
      return String(a[0]).localeCompare(String(b[0]));
    })
    .slice(0, limit);
}

function sourceMatches(source, prefixes) {
  if (!prefixes.length) return true;
  const normalized = String(source ?? "").toLowerCase();
  return prefixes.some((prefix) => normalized.startsWith(prefix.toLowerCase()));
}

function detectCategories(text) {
  const categories = [];
  let signalScore = 0;
  for (const [category, patterns] of Object.entries(SIGNAL_RULES)) {
    if (patterns.some((pattern) => pattern.test(text))) {
      categories.push(category);
      signalScore += SIGNAL_WEIGHTS[category] || 1;
    }
  }
  return {
    categories,
    signalScore: Number(signalScore.toFixed(4)),
  };
}

function extractLoopKeys(metadata) {
  const loopKeys = new Set();
  const direct = metadata.loopKey;
  if (typeof direct === "string" && direct.trim()) {
    loopKeys.add(direct.trim());
  }
  const list = metadata.loopKeys;
  if (Array.isArray(list)) {
    for (const item of list) {
      const key = normalizeText(item);
      if (key) loopKeys.add(key);
    }
  }
  const signalLoopKeys = Array.isArray(metadata?.signalIndex?.loopKeys) ? metadata.signalIndex.loopKeys : [];
  for (const item of signalLoopKeys) {
    const key = normalizeText(item);
    if (key) loopKeys.add(key);
  }
  return [...loopKeys];
}

function extractParticipants(memory, metadataText, { participantNoiseFilter = true } = {}) {
  const metadata = safeRecord(memory?.metadata);
  const participants = new Set();
  const addEmails = (value) => {
    for (const email of extractEmails(value)) {
      if (participantNoiseFilter && isLikelyNoiseMailbox(email)) continue;
      participants.add(email);
    }
  };
  addEmails(memory?.content);
  addEmails(metadataText);
  const participantFields = [
    metadata.from,
    metadata.to,
    metadata.cc,
    metadata.bcc,
    metadata.sender,
    metadata.recipient,
    metadata.recipients,
    metadata.owner,
    metadata.owners,
    metadata.actor,
    metadata.actors,
    metadata.participants,
    metadata.contacts,
    metadata.emailAddresses,
  ];
  for (const field of participantFields) {
    if (Array.isArray(field)) {
      for (const entry of field) addEmails(entry);
    } else {
      addEmails(field);
    }
  }
  return [...participants].slice(0, 20);
}

function extractThreadKey(memory, metadataText) {
  const metadata = safeRecord(memory?.metadata);
  const preferred = [
    metadata.threadSignature,
    metadata.normalizedMessageId,
    metadata.messageId,
    metadata.threadId,
    metadata.conversationId,
    metadata.threadKey,
  ];
  for (const candidate of preferred) {
    const value = normalizeText(candidate).toLowerCase();
    if (value) return value;
  }
  const subject = normalizeText(metadata.subject).toLowerCase().replace(/^(re|fw|fwd)\s*:\s*/g, "");
  if (subject) return `subject:${subject}`;
  const fallback = normalizeText(metadataText).toLowerCase();
  if (fallback) return `meta:${stableHash(fallback).slice(0, 20)}`;
  const id = normalizeText(memory?.id).toLowerCase();
  return id ? `memory:${id}` : `unknown:${stableHash(JSON.stringify(memory)).slice(0, 20)}`;
}

function buildMemoryModels(rows, { sourcePrefixes, includeNonMailLike, participantNoiseFilter = true, maxTopicsPerMemory = 6 }) {
  const models = [];
  const skipped = {
    bySource: 0,
    malformed: 0,
  };
  for (const row of rows) {
    if (!row || typeof row !== "object") {
      skipped.malformed += 1;
      continue;
    }
    const source = normalizeText(row.source).toLowerCase();
    if (!includeNonMailLike && !sourceMatches(source, sourcePrefixes)) {
      skipped.bySource += 1;
      continue;
    }
    const metadata = safeRecord(row.metadata);
    const metadataFragments = collectMetadataStrings(metadata);
    const metadataText = metadataFragments.join(" ");
    const content = normalizeText(row.content);
    const textForSignals = normalizeText(`${metadataText} ${content}`.trim());
    const signal = detectCategories(textForSignals);
    const tokens = tokenize(`${metadata.subject ?? ""} ${content}`);
    const topicCounts = new Map();
    for (const token of tokens) {
      topicCounts.set(token, (topicCounts.get(token) || 0) + 1);
    }
    const topTopics = topEntries(topicCounts, maxTopicsPerMemory, 2).map(([token]) => token);
    const participants = extractParticipants(row, metadataText, {
      participantNoiseFilter,
    });
    const createdAt = parseTimestamp(row.createdAt);
    const occurredAt = parseTimestamp(row.occurredAt);
    const timestampMs = occurredAt ?? createdAt ?? Date.now();
    const importance = clamp(Number(row.importance ?? 0), 0, 1);
    const sourceConfidence = clamp(Number(row.sourceConfidence ?? 0), 0, 1);
    models.push({
      id: normalizeText(row.id),
      source,
      createdAt: createdAt ? new Date(createdAt).toISOString() : null,
      occurredAt: occurredAt ? new Date(occurredAt).toISOString() : null,
      timestampMs,
      threadKey: extractThreadKey(row, metadataText),
      participants,
      categories: signal.categories,
      signalScore: signal.signalScore + importance * 0.4 + sourceConfidence * 0.2,
      closureCue: signal.categories.includes("closure"),
      topics: topTopics,
      loopKeys: extractLoopKeys(metadata),
      snippet: content.length > 280 ? `${content.slice(0, 279).trimEnd()}…` : content,
      sourceMemory: row,
    });
  }
  return { models, skipped };
}

function extractSearchSeeds(rows, { searchSeedLimit, minTermFrequency }) {
  const termCounts = new Map();
  const domainCounts = new Map();
  for (const row of rows) {
    const metadata = safeRecord(row?.metadata);
    const subject = normalizeText(metadata.subject);
    const content = normalizeText(row?.content);
    for (const token of tokenize(`${subject} ${content}`)) {
      termCounts.set(token, (termCounts.get(token) || 0) + 1);
    }
    for (const email of extractEmails(`${metadata.from ?? ""} ${metadata.to ?? ""} ${metadata.cc ?? ""} ${metadata.bcc ?? ""}`)) {
      const domain = email.split("@")[1] || "";
      if (!domain) continue;
      domainCounts.set(domain, (domainCounts.get(domain) || 0) + 1);
    }
  }

  const seedTerms = topEntries(termCounts, searchSeedLimit * 2, minTermFrequency)
    .map(([term]) => String(term))
    .filter((term) => /^[a-z][a-z0-9._-]{2,31}$/.test(term))
    .filter((term) => !STOP_WORDS.has(term));
  const seedDomains = topEntries(domainCounts, Math.max(1, Math.floor(searchSeedLimit / 3)), 2).map(([domain]) => String(domain));
  const seeds = [];
  const seen = new Set();
  for (const seed of [...seedTerms, ...seedDomains, "risk", "decision", "deadline", "escalation"]) {
    const normalized = normalizeText(seed).toLowerCase();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    seeds.push(normalized);
    if (seeds.length >= searchSeedLimit) break;
  }
  return seeds;
}

function dedupeRowsById(rows) {
  const byId = new Map();
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const id = normalizeText(row.id);
    if (!id) continue;
    if (!byId.has(id)) {
      byId.set(id, row);
    }
  }
  return [...byId.values()];
}

function buildRerankSeedTokenSet(seedQueries) {
  const seedTokens = new Set();
  for (const seed of seedQueries) {
    for (const token of tokenize(seed)) {
      seedTokens.add(token);
    }
  }
  return seedTokens;
}

function rowTimestampMs(row) {
  const occurredAt = parseTimestamp(row?.occurredAt);
  if (occurredAt) return occurredAt;
  const createdAt = parseTimestamp(row?.createdAt);
  if (createdAt) return createdAt;
  return Date.now() - 90 * 86_400_000;
}

function buildRerankText(row) {
  const metadata = safeRecord(row?.metadata);
  const metadataText = collectMetadataStrings(metadata).join(" ");
  return normalizeText(`${metadata.subject ?? ""} ${row?.content ?? ""} ${metadataText}`.trim());
}

function rerankRetrievedRows({
  retrievalRows,
  seedQueries,
  topK,
  signalWeight,
  recencyWeight,
  seedOverlapWeight,
  queryRankWeight,
}) {
  const nowMs = Date.now();
  const seedTokens = buildRerankSeedTokenSet(seedQueries);
  const scored = new Map();
  const boundedTopK = Math.max(20, topK);
  const totalWeight = Math.max(0.0001, signalWeight + recencyWeight + seedOverlapWeight + queryRankWeight);
  const normalizedSignalWeight = signalWeight / totalWeight;
  const normalizedRecencyWeight = recencyWeight / totalWeight;
  const normalizedSeedWeight = seedOverlapWeight / totalWeight;
  const normalizedQueryRankWeight = queryRankWeight / totalWeight;

  for (const item of retrievalRows) {
    const row = item?.row;
    if (!row || typeof row !== "object") continue;
    const rowId = normalizeText(row.id) || stableHash(JSON.stringify(row)).slice(0, 24);
    const text = buildRerankText(row);
    if (!text) continue;
    const signal = detectCategories(text);
    const signalScore = clamp((signal.signalScore + signal.categories.length * 0.22) / 3.8, 0, 1);
    const tokens = new Set(tokenize(text));
    let overlapCount = 0;
    for (const token of tokens) {
      if (seedTokens.has(token)) overlapCount += 1;
    }
    const seedOverlapScore =
      seedTokens.size > 0
        ? clamp(overlapCount / Math.max(1, Math.min(12, seedTokens.size)), 0, 1)
        : 0;
    const ageDays = Math.max(0, (nowMs - rowTimestampMs(row)) / 86_400_000);
    const recencyScore = ageDays <= 30 ? 1 : ageDays <= 90 ? 0.72 : ageDays <= 180 ? 0.45 : 0.2;
    const queryRankBase =
      item.origin === "search" ? clamp(1 - (Math.max(0, Number(item.rank ?? 1) - 1) / 12), 0.12, 1) : 0.62;
    const highSignalCategoryCount = signal.categories.filter((category) => HIGH_SIGNAL_CATEGORY_SET.has(category)).length;
    const queryIntentBoost =
      item.origin === "search" && highSignalCategoryCount > 0
        ? clamp(highSignalCategoryCount * 0.045, 0, 0.18)
        : 0;

    const finalScore = clamp(
      signalScore * normalizedSignalWeight +
        recencyScore * normalizedRecencyWeight +
        seedOverlapScore * normalizedSeedWeight +
        queryRankBase * normalizedQueryRankWeight +
        queryIntentBoost,
      0,
      1.4
    );

    const existing = scored.get(rowId);
    if (!existing || finalScore > existing.finalScore) {
      scored.set(rowId, {
        row,
        id: rowId,
        finalScore,
        signalScore,
        recencyScore,
        seedOverlapScore,
        queryRankScore: queryRankBase,
        categories: signal.categories,
        origins: new Set([String(item.origin || "unknown")]),
      });
    } else {
      existing.origins.add(String(item.origin || "unknown"));
      existing.seedOverlapScore = Math.max(existing.seedOverlapScore, seedOverlapScore);
      existing.signalScore = Math.max(existing.signalScore, signalScore);
      existing.recencyScore = Math.max(existing.recencyScore, recencyScore);
      existing.queryRankScore = Math.max(existing.queryRankScore, queryRankBase);
      existing.finalScore = Math.max(existing.finalScore, finalScore);
      existing.categories = [...new Set([...(existing.categories || []), ...signal.categories])];
    }
  }

  const ranked = [...scored.values()].sort((a, b) => {
    if (b.finalScore !== a.finalScore) return b.finalScore - a.finalScore;
    if (b.signalScore !== a.signalScore) return b.signalScore - a.signalScore;
    if (b.seedOverlapScore !== a.seedOverlapScore) return b.seedOverlapScore - a.seedOverlapScore;
    return String(a.id).localeCompare(String(b.id));
  });
  const retained = ranked.slice(0, boundedTopK);
  const rows = retained.map((entry) => entry.row);
  const avgSeedOverlap =
    retained.length > 0
      ? Number((retained.reduce((sum, entry) => sum + entry.seedOverlapScore, 0) / retained.length).toFixed(4))
      : 0;
  const avgFinalScore =
    retained.length > 0
      ? Number((retained.reduce((sum, entry) => sum + entry.finalScore, 0) / retained.length).toFixed(4))
      : 0;
  const signalDominantRows = retained.filter(
    (entry) => entry.signalScore >= entry.seedOverlapScore && entry.signalScore >= 0.58
  ).length;

  return {
    rows,
    telemetry: {
      inputRows: retrievalRows.length,
      uniqueRows: ranked.length,
      retainedRows: rows.length,
      signalDominantRows,
      avgSeedOverlap,
      avgFinalScore,
      weights: {
        signal: Number(normalizedSignalWeight.toFixed(4)),
        recency: Number(normalizedRecencyWeight.toFixed(4)),
        seedOverlap: Number(normalizedSeedWeight.toFixed(4)),
        queryRank: Number(normalizedQueryRankWeight.toFixed(4)),
      },
      topRows: retained.slice(0, 12).map((entry) => ({
        id: entry.id,
        score: Number(entry.finalScore.toFixed(4)),
        signalScore: Number(entry.signalScore.toFixed(4)),
        seedOverlapScore: Number(entry.seedOverlapScore.toFixed(4)),
        recencyScore: Number(entry.recencyScore.toFixed(4)),
        queryRankScore: Number(entry.queryRankScore.toFixed(4)),
        origins: [...entry.origins],
        categories: entry.categories.slice(0, 5),
      })),
    },
  };
}

function inferRelationshipType(topCategories) {
  const categories = new Set((topCategories || []).map((value) => String(value).toLowerCase()));
  if (categories.has("risk") || categories.has("escalation")) return "risk-escalation-channel";
  if (categories.has("decision") && categories.has("action")) return "decision-action-channel";
  if (categories.has("timeline") && (categories.has("decision") || categories.has("action"))) return "execution-thread";
  return "general-collaboration";
}

function buildParticipantPairEdges(models, { minEdgeSupport, minEdgeConfidence, maxEdges }) {
  const participantExposure = new Map();
  const edgeStats = new Map();
  const nowMs = Date.now();
  const recent14dMs = 14 * 86_400_000;
  const recent30dMs = 30 * 86_400_000;

  for (const model of models) {
    for (const participant of model.participants) {
      participantExposure.set(participant, (participantExposure.get(participant) || 0) + 1);
    }
    const participants = [...new Set(model.participants)].sort((a, b) => a.localeCompare(b)).slice(0, 8);
    if (participants.length < 2) continue;
    for (let i = 0; i < participants.length; i += 1) {
      for (let j = i + 1; j < participants.length; j += 1) {
        const left = participants[i];
        const right = participants[j];
        const key = `${left}::${right}`;
        const current =
          edgeStats.get(key) ||
          {
            left,
            right,
            support: 0,
            weightedSupport: 0,
            highSignalSupport: 0,
            weightedHighSignalSupport: 0,
            participantQualitySum: 0,
            supportRecent14d: 0,
            supportRecent30d: 0,
            firstSeenAtMs: Number.MAX_SAFE_INTEGER,
            lastSeenAtMs: 0,
            threadKeys: new Set(),
            memoryIds: new Set(),
            topicCounts: new Map(),
            categoryCounts: new Map(),
          };
        const pairQuality = (participantIdentityWeight(left) + participantIdentityWeight(right)) / 2;
        current.support += 1;
        current.weightedSupport += pairQuality;
        current.participantQualitySum += pairQuality;
        if (model.signalScore >= 1.4 || model.categories.includes("risk") || model.categories.includes("escalation")) {
          current.highSignalSupport += 1;
          current.weightedHighSignalSupport += pairQuality;
        }
        if (nowMs - model.timestampMs <= recent30dMs) current.supportRecent30d += 1;
        if (nowMs - model.timestampMs <= recent14dMs) current.supportRecent14d += 1;
        current.firstSeenAtMs = Math.min(current.firstSeenAtMs, model.timestampMs);
        current.lastSeenAtMs = Math.max(current.lastSeenAtMs, model.timestampMs);
        current.threadKeys.add(model.threadKey);
        current.memoryIds.add(model.id);
        for (const topic of model.topics.slice(0, 4)) {
          current.topicCounts.set(topic, (current.topicCounts.get(topic) || 0) + 1);
        }
        for (const category of model.categories) {
          current.categoryCounts.set(category, (current.categoryCounts.get(category) || 0) + 1);
        }
        edgeStats.set(key, current);
      }
    }
  }

  const candidates = [];
  for (const stats of edgeStats.values()) {
    if (stats.support < minEdgeSupport) continue;
    const exposureLeft = participantExposure.get(stats.left) || 1;
    const exposureRight = participantExposure.get(stats.right) || 1;
    const overlapRatio = clamp(stats.support / Math.max(1, Math.min(exposureLeft, exposureRight)), 0, 1);
    const weightedSupport = Math.max(0.0001, Number(stats.weightedSupport ?? stats.support));
    const signalRatio = clamp(stats.weightedHighSignalSupport / weightedSupport, 0, 1);
    const threadDiversity = clamp(stats.threadKeys.size / Math.max(1, stats.support), 0, 1);
    const temporalSpanDays = clamp((stats.lastSeenAtMs - stats.firstSeenAtMs) / 86_400_000, 0, 3650);
    const temporalStabilityScore = temporalSpanDays >= 30 ? 1 : clamp(temporalSpanDays / 30, 0, 1);
    const supportScore = clamp(Math.log1p(weightedSupport) / Math.log(12), 0, 1) * 0.29;
    const overlapScore = overlapRatio * 0.21;
    const signalScore = signalRatio * 0.2;
    const diversityScore = threadDiversity * 0.09;
    const participantQuality = clamp(stats.participantQualitySum / Math.max(1, stats.support), 0, 1);
    const participantScore = participantQuality * 0.08;
    const burstScore = clamp(stats.supportRecent14d / Math.max(1, stats.supportRecent30d || stats.support), 0, 1) * 0.07;
    const temporalScore = temporalStabilityScore * 0.06;
    const lastSeenAgeDays = Math.max(0, (nowMs - stats.lastSeenAtMs) / 86_400_000);
    const recencyScore = lastSeenAgeDays <= 30 ? 0.1 : lastSeenAgeDays <= 90 ? 0.05 : 0;
    const confidence = clamp(
      0.12 + supportScore + overlapScore + signalScore + diversityScore + participantScore + burstScore + temporalScore + recencyScore,
      0,
      0.995
    );
    if (confidence < minEdgeConfidence) continue;
    const topTopics = topEntries(stats.topicCounts, 5, 1).map(([topic]) => topic);
    const topCategories = topEntries(stats.categoryCounts, 5, 1).map(([category]) => category);
    const relationshipType = inferRelationshipType(topCategories);
    const score = confidence * 2 + Math.log1p(weightedSupport) * 0.78 + signalRatio * 0.42 + burstScore * 1.3;
    candidates.push({
      kind: "participant-pair",
      key: `${stats.left}::${stats.right}`,
      left: stats.left,
      right: stats.right,
      support: stats.support,
      weightedSupport: Number(weightedSupport.toFixed(4)),
      highSignalSupport: stats.highSignalSupport,
      weightedSignalRatio: Number(signalRatio.toFixed(4)),
      threadCount: stats.threadKeys.size,
      relationshipType,
      overlapRatio: Number(overlapRatio.toFixed(4)),
      signalRatio: Number(signalRatio.toFixed(4)),
      confidence: Number(confidence.toFixed(4)),
      score: Number(score.toFixed(4)),
      temporalSpanDays: Number(temporalSpanDays.toFixed(2)),
      participantQuality: Number(participantQuality.toFixed(4)),
      supportRecent14d: stats.supportRecent14d,
      supportRecent30d: stats.supportRecent30d,
      confidenceBreakdown: {
        support: Number(supportScore.toFixed(4)),
        overlap: Number(overlapScore.toFixed(4)),
        signal: Number(signalScore.toFixed(4)),
        diversity: Number(diversityScore.toFixed(4)),
        participant: Number(participantScore.toFixed(4)),
        burst: Number(burstScore.toFixed(4)),
        temporal: Number(temporalScore.toFixed(4)),
        recency: Number(recencyScore.toFixed(4)),
      },
      firstSeenAt: toIsoDate(stats.firstSeenAtMs),
      lastSeenAt: toIsoDate(stats.lastSeenAtMs),
      topTopics,
      topCategories,
      sourceMemoryIds: [...stats.memoryIds].slice(0, 24),
    });
  }

  return candidates.sort((a, b) => (b.confidence !== a.confidence ? b.confidence - a.confidence : b.support - a.support)).slice(0, maxEdges);
}

function buildDecisionFlowMotifs(models, { minMotifScore, maxMotifs }) {
  const byThread = new Map();
  for (const model of models) {
    if (!model?.threadKey) continue;
    if (!byThread.has(model.threadKey)) {
      byThread.set(model.threadKey, []);
    }
    byThread.get(model.threadKey).push(model);
  }

  const motifStats = new Map();
  const updateMotif = ({ kind, key, first, second, threadKey }) => {
    const nowMs = Date.now();
    const existing =
      motifStats.get(key) ||
      {
        kind,
        key,
        support: 0,
        threadKeys: new Set(),
        sourceMemoryIds: new Set(),
        topics: new Map(),
        actors: new Set(),
        firstSeenAtMs: Number.MAX_SAFE_INTEGER,
        lastSeenAtMs: 0,
        cumulativeSignal: 0,
        recentHits: 0,
      };
    existing.support += 1;
    existing.threadKeys.add(threadKey);
    existing.sourceMemoryIds.add(first.id);
    existing.sourceMemoryIds.add(second.id);
    for (const actor of [...first.participants, ...second.participants]) {
      existing.actors.add(actor);
    }
    for (const topic of [...first.topics, ...second.topics]) {
      existing.topics.set(topic, (existing.topics.get(topic) || 0) + 1);
    }
    existing.firstSeenAtMs = Math.min(existing.firstSeenAtMs, first.timestampMs, second.timestampMs);
    existing.lastSeenAtMs = Math.max(existing.lastSeenAtMs, first.timestampMs, second.timestampMs);
    existing.cumulativeSignal += Math.max(0, first.signalScore) + Math.max(0, second.signalScore);
    if (nowMs - Math.max(first.timestampMs, second.timestampMs) <= 30 * 86_400_000) {
      existing.recentHits += 1;
    }
    motifStats.set(key, existing);
  };

  for (const [threadKey, rows] of byThread.entries()) {
    const sorted = [...rows].sort((a, b) => a.timestampMs - b.timestampMs);
    for (let i = 0; i < sorted.length; i += 1) {
      const current = sorted[i];
      const hasDecision = current.categories.includes("decision");
      const hasRisk = current.categories.includes("risk");
      if (!hasDecision && !hasRisk) continue;
      for (let j = i + 1; j < sorted.length; j += 1) {
        const next = sorted[j];
        const deltaDays = Math.max(0, (next.timestampMs - current.timestampMs) / 86_400_000);
        if (deltaDays > 14) break;
        if (hasDecision && next.categories.includes("action")) {
          const actorsKey = [...new Set([...current.participants, ...next.participants])]
            .sort((a, b) => a.localeCompare(b))
            .slice(0, 3)
            .join("|");
          const key = `decision-handoff::${actorsKey || threadKey.slice(0, 28)}`;
          updateMotif({
            kind: "decision-handoff",
            key,
            first: current,
            second: next,
            threadKey,
          });
          break;
        }
        if (hasRisk && next.categories.includes("escalation")) {
          const actorsKey = [...new Set([...current.participants, ...next.participants])]
            .sort((a, b) => a.localeCompare(b))
            .slice(0, 3)
            .join("|");
          const key = `risk-escalation::${actorsKey || threadKey.slice(0, 28)}`;
          updateMotif({
            kind: "risk-escalation",
            key,
            first: current,
            second: next,
            threadKey,
          });
          break;
        }
      }
    }
  }

  const nowMs = Date.now();
  const motifs = [];
  for (const stats of motifStats.values()) {
    const avgSignal = stats.cumulativeSignal / Math.max(1, stats.support * 2);
    const signalScore = clamp(avgSignal / 2.2, 0, 1);
    const supportScore = clamp(Math.log1p(stats.support) / Math.log(10), 0, 1);
    const recencyScore = clamp(stats.recentHits / Math.max(1, stats.support), 0, 1);
    const actorDiversity = clamp(stats.actors.size / Math.max(1, stats.support * 2), 0, 1);
    const lastSeenAgeDays = Math.max(0, (nowMs - stats.lastSeenAtMs) / 86_400_000);
    const freshness = lastSeenAgeDays <= 30 ? 1 : lastSeenAgeDays <= 90 ? 0.65 : 0.35;
    const confidence = clamp(0.22 + supportScore * 0.36 + signalScore * 0.2 + recencyScore * 0.12 + actorDiversity * 0.1, 0, 0.98);
    const score = confidence * 2 + supportScore * 0.9 + recencyScore * 0.55 + freshness * 0.45;
    if (score < minMotifScore) continue;
    const actors = [...stats.actors].slice(0, 8);
    const topTopics = topEntries(stats.topics, 5, 1).map(([topic]) => topic);
    const summary =
      stats.kind === "decision-handoff"
        ? `${actors.slice(0, 3).join(", ") || "Participants"} repeatedly convert decisions into tracked action handoffs`
        : `${actors.slice(0, 3).join(", ") || "Participants"} repeatedly move risks into explicit escalation`;
    motifs.push({
      kind: stats.kind,
      key: stats.key,
      summary,
      support: stats.support,
      threadCount: stats.threadKeys.size,
      actorCount: stats.actors.size,
      actors,
      topTopics,
      sourceMemoryIds: [...stats.sourceMemoryIds].slice(0, 24),
      confidence: Number(confidence.toFixed(4)),
      score: Number(score.toFixed(4)),
      firstSeenAt: toIsoDate(stats.firstSeenAtMs),
      lastSeenAt: toIsoDate(stats.lastSeenAtMs),
    });
  }
  return motifs.sort((a, b) => (b.score !== a.score ? b.score - a.score : b.support - a.support)).slice(0, maxMotifs);
}

function mergeMotifCandidates(base, extra, maxMotifs) {
  const byKey = new Map();
  for (const motif of [...base, ...extra]) {
    if (!motif || typeof motif !== "object") continue;
    const key = `${String(motif.kind || "unknown")}::${String(motif.key || "")}`;
    if (!String(motif.key || "").trim()) continue;
    const existing = byKey.get(key);
    if (!existing || Number(motif.score ?? 0) > Number(existing.score ?? 0)) {
      byKey.set(key, motif);
    }
  }
  return [...byKey.values()]
    .sort((a, b) =>
      Number(b.score ?? 0) !== Number(a.score ?? 0)
        ? Number(b.score ?? 0) - Number(a.score ?? 0)
        : Number(b.support ?? 0) - Number(a.support ?? 0)
    )
    .slice(0, maxMotifs);
}

function buildRelationshipBridgeMotifs(relationshipEdges, { minMotifScore, maxMotifs }) {
  const actorStats = new Map();
  for (const edge of relationshipEdges) {
    if (!edge || typeof edge !== "object") continue;
    const left = normalizeParticipantEmail(edge.left);
    const right = normalizeParticipantEmail(edge.right);
    if (!left || !right || left === right) continue;
    const edgeSupport = Math.max(1, Number(edge.support ?? 1));
    const edgeWeightedSupport = Math.max(edgeSupport, Number(edge.weightedSupport ?? edgeSupport));
    const edgeConfidence = clamp(Number(edge.confidence ?? 0), 0, 1);
    const relationshipType = String(edge.relationshipType || edge.kind || "general-collaboration");
    const edgeLastSeenAtMs = parseTimestamp(edge.lastSeenAt) ?? Date.now();
    const sourceMemoryIds = Array.isArray(edge.sourceMemoryIds) ? edge.sourceMemoryIds : [];
    const topTopics = Array.isArray(edge.topTopics) ? edge.topTopics : [];

    const updateActor = (actor, counterparty) => {
      const current =
        actorStats.get(actor) ||
        {
          actor,
          counterparties: new Set(),
          weightedSupport: 0,
          support: 0,
          edgeCount: 0,
          confidenceSum: 0,
          relationshipTypes: new Set(),
          topTopicCounts: new Map(),
          sourceMemoryIds: new Set(),
          lastSeenAtMs: 0,
        };
      current.counterparties.add(counterparty);
      current.weightedSupport += edgeWeightedSupport;
      current.support += edgeSupport;
      current.edgeCount += 1;
      current.confidenceSum += edgeConfidence;
      current.relationshipTypes.add(relationshipType);
      current.lastSeenAtMs = Math.max(current.lastSeenAtMs, edgeLastSeenAtMs);
      for (const topic of topTopics.slice(0, 4)) {
        const normalized = normalizeText(topic).toLowerCase();
        if (!normalized) continue;
        current.topTopicCounts.set(normalized, (current.topTopicCounts.get(normalized) || 0) + 1);
      }
      for (const memoryId of sourceMemoryIds.slice(0, 24)) {
        const normalized = normalizeText(memoryId);
        if (normalized) current.sourceMemoryIds.add(normalized);
      }
      actorStats.set(actor, current);
    };

    updateActor(left, right);
    updateActor(right, left);
  }

  const motifs = [];
  for (const actor of actorStats.values()) {
    const counterpartyCount = actor.counterparties.size;
    if (counterpartyCount < 3) continue;
    const averageConfidence = actor.confidenceSum / Math.max(1, actor.edgeCount);
    const weightedSupportScore = clamp(Math.log1p(actor.weightedSupport) / Math.log(14), 0, 1);
    const bridgeScore = clamp(counterpartyCount / 8, 0, 1);
    const diversityScore = clamp(actor.relationshipTypes.size / Math.max(1, actor.edgeCount), 0, 1);
    const score =
      0.85 + bridgeScore * 1.05 + weightedSupportScore * 0.85 + averageConfidence * 0.65 + diversityScore * 0.32;
    if (score < minMotifScore) continue;
    const confidence = clamp(0.25 + bridgeScore * 0.4 + averageConfidence * 0.3 + diversityScore * 0.12, 0, 0.995);
    const topTopics = topEntries(actor.topTopicCounts, 5, 1).map(([topic]) => String(topic));
    motifs.push({
      kind: "actor-bridge-hub",
      key: `actor-bridge-hub:${actor.actor}`,
      score: Number(score.toFixed(4)),
      confidence: Number(confidence.toFixed(4)),
      summary: `${actor.actor} bridges ${counterpartyCount} participants across ${actor.relationshipTypes.size} relationship channels`,
      support: Math.round(actor.support),
      actorCount: 1,
      threadCount: counterpartyCount,
      actors: [actor.actor, ...[...actor.counterparties].slice(0, 5)],
      topTopics,
      sourceMemoryIds: [...actor.sourceMemoryIds].slice(0, 24),
      firstSeenAt: null,
      lastSeenAt: toIsoDate(actor.lastSeenAtMs),
      relationshipTypes: [...actor.relationshipTypes].slice(0, 6),
      bridgeCounterpartyCount: counterpartyCount,
    });
  }

  return motifs
    .sort((a, b) => (b.score !== a.score ? b.score - a.score : b.confidence - a.confidence))
    .slice(0, maxMotifs);
}

function buildMotifCandidates(models, { minMotifScore, maxMotifs, minEdgeSupport }) {
  const threadStats = new Map();
  const actorStats = new Map();
  const topicStats = new Map();

  for (const model of models) {
    const thread =
      threadStats.get(model.threadKey) ||
      {
        threadKey: model.threadKey,
        support: 0,
        highSignalSupport: 0,
        categoryCounts: new Map(),
        topicCounts: new Map(),
        actors: new Set(),
        memoryIds: new Set(),
        firstSeenAtMs: Number.MAX_SAFE_INTEGER,
        lastSeenAtMs: 0,
        closureCues: 0,
      };
    thread.support += 1;
    if (model.signalScore >= 1.4) thread.highSignalSupport += 1;
    for (const category of model.categories) {
      thread.categoryCounts.set(category, (thread.categoryCounts.get(category) || 0) + 1);
    }
    for (const topic of model.topics.slice(0, 5)) {
      thread.topicCounts.set(topic, (thread.topicCounts.get(topic) || 0) + 1);
      const topicState =
        topicStats.get(topic) ||
        {
          topic,
          support: 0,
          highSignalSupport: 0,
          threads: new Set(),
          actors: new Set(),
          memoryIds: new Set(),
          lastSeenAtMs: 0,
        };
      topicState.support += 1;
      if (model.signalScore >= 1.4) topicState.highSignalSupport += 1;
      topicState.threads.add(model.threadKey);
      for (const actor of model.participants) {
        topicState.actors.add(actor);
      }
      topicState.memoryIds.add(model.id);
      topicState.lastSeenAtMs = Math.max(topicState.lastSeenAtMs, model.timestampMs);
      topicStats.set(topic, topicState);
    }
    if (model.closureCue) thread.closureCues += 1;
    for (const actor of model.participants) {
      thread.actors.add(actor);
      const actorState =
        actorStats.get(actor) ||
        {
          actor,
          support: 0,
          highSignalSupport: 0,
          threads: new Set(),
          topicCounts: new Map(),
          memoryIds: new Set(),
          lastSeenAtMs: 0,
        };
      actorState.support += 1;
      if (model.signalScore >= 1.4) actorState.highSignalSupport += 1;
      actorState.threads.add(model.threadKey);
      for (const topic of model.topics.slice(0, 4)) {
        actorState.topicCounts.set(topic, (actorState.topicCounts.get(topic) || 0) + 1);
      }
      actorState.memoryIds.add(model.id);
      actorState.lastSeenAtMs = Math.max(actorState.lastSeenAtMs, model.timestampMs);
      actorStats.set(actor, actorState);
    }
    thread.memoryIds.add(model.id);
    thread.firstSeenAtMs = Math.min(thread.firstSeenAtMs, model.timestampMs);
    thread.lastSeenAtMs = Math.max(thread.lastSeenAtMs, model.timestampMs);
    threadStats.set(model.threadKey, thread);
  }

  const motifs = [];
  const nowMs = Date.now();

  for (const thread of threadStats.values()) {
    if (thread.support < 2) continue;
    const riskCount = Number(thread.categoryCounts.get("risk") || 0);
    const escalationCount = Number(thread.categoryCounts.get("escalation") || 0);
    const actionCount = Number(thread.categoryCounts.get("action") || 0);
    const decisionCount = Number(thread.categoryCounts.get("decision") || 0);
    const closureCount = Number(thread.categoryCounts.get("closure") || 0);
    const unresolved = thread.closureCues <= 0 && closureCount <= 0;
    const topTopics = topEntries(thread.topicCounts, 5, 1).map(([topic]) => topic);
    const actors = [...thread.actors].slice(0, 6);
    const common = {
      support: thread.support,
      actorCount: thread.actors.size,
      threadCount: 1,
      actors,
      topTopics,
      sourceMemoryIds: [...thread.memoryIds].slice(0, 24),
      firstSeenAt: toIsoDate(thread.firstSeenAtMs),
      lastSeenAt: toIsoDate(thread.lastSeenAtMs),
    };

    if (riskCount + escalationCount >= 2 && unresolved) {
      const score = 1 + (riskCount + escalationCount) * 0.45 + thread.highSignalSupport * 0.2 + Math.min(1, thread.support / 6);
      motifs.push({
        kind: "thread-risk-loop",
        key: `thread-risk-loop:${thread.threadKey}`,
        score: Number(score.toFixed(4)),
        confidence: Number(clamp(0.35 + score / 6, 0, 0.99).toFixed(4)),
        summary: `Recurring unresolved risk/escalation thread with ${thread.support} memories and ${thread.actors.size} actors`,
        ...common,
      });
    }

    if (decisionCount + actionCount >= 3 && unresolved) {
      const score = 1 + (decisionCount + actionCount) * 0.35 + thread.highSignalSupport * 0.22;
      motifs.push({
        kind: "thread-commitment-open-loop",
        key: `thread-commitment-open-loop:${thread.threadKey}`,
        score: Number(score.toFixed(4)),
        confidence: Number(clamp(0.32 + score / 6.5, 0, 0.99).toFixed(4)),
        summary: `Decision/action signals are accumulating without closure (${decisionCount + actionCount} cues)`,
        ...common,
      });
    }

    if (escalationCount >= 2) {
      const score = 1 + escalationCount * 0.5 + thread.highSignalSupport * 0.2;
      motifs.push({
        kind: "thread-escalation-hotspot",
        key: `thread-escalation-hotspot:${thread.threadKey}`,
        score: Number(score.toFixed(4)),
        confidence: Number(clamp(0.33 + score / 6.2, 0, 0.99).toFixed(4)),
        summary: `Escalation hotspot across ${thread.support} memories (${escalationCount} escalation cues)`,
        ...common,
      });
    }
  }

  for (const actor of actorStats.values()) {
    if (actor.highSignalSupport < minEdgeSupport || actor.threads.size < 2) continue;
    const score = 1 + actor.highSignalSupport * 0.3 + actor.threads.size * 0.22;
    const topTopics = topEntries(actor.topicCounts, 5, 1).map(([topic]) => topic);
    motifs.push({
      kind: "actor-hotspot",
      key: `actor-hotspot:${actor.actor}`,
      score: Number(score.toFixed(4)),
      confidence: Number(clamp(0.34 + score / 7, 0, 0.99).toFixed(4)),
      summary: `${actor.actor} appears in concentrated high-signal traffic (${actor.highSignalSupport}/${actor.support})`,
      support: actor.support,
      actorCount: 1,
      threadCount: actor.threads.size,
      actors: [actor.actor],
      topTopics,
      sourceMemoryIds: [...actor.memoryIds].slice(0, 24),
      firstSeenAt: null,
      lastSeenAt: toIsoDate(actor.lastSeenAtMs),
    });
  }

  for (const topic of topicStats.values()) {
    if (topic.support < minEdgeSupport || topic.threads.size < 2) continue;
    const score = 0.9 + topic.highSignalSupport * 0.28 + topic.threads.size * 0.15;
    const confidence = clamp(0.28 + score / 7.5 + (topic.highSignalSupport / Math.max(1, topic.support)) * 0.18, 0, 0.99);
    motifs.push({
      kind: "topic-hotspot",
      key: `topic-hotspot:${topic.topic}`,
      score: Number(score.toFixed(4)),
      confidence: Number(confidence.toFixed(4)),
      summary: `Topic "${topic.topic}" spans ${topic.threads.size} threads with ${topic.highSignalSupport} high-signal hits`,
      support: topic.support,
      actorCount: topic.actors.size,
      threadCount: topic.threads.size,
      actors: [...topic.actors].slice(0, 6),
      topTopics: [topic.topic],
      sourceMemoryIds: [...topic.memoryIds].slice(0, 24),
      firstSeenAt: null,
      lastSeenAt: toIsoDate(topic.lastSeenAtMs),
    });
  }

  return motifs
    .filter((motif) => motif.score >= minMotifScore)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (b.confidence !== a.confidence) return b.confidence - a.confidence;
      return b.support - a.support;
    })
    .slice(0, maxMotifs);
}

function buildCandidateCaptures({
  motifs,
  edges,
  maxWrites,
  captureSource,
  tenantId,
  runId,
  generatedAt,
}) {
  const candidates = [];
  const seenClientRequestIds = new Set();
  const windowAnchor = generatedAt.slice(0, 10);
  const contextIndexVersion = "experimental-context-index.v3";

  const motifBudget = Math.min(motifs.length, Math.max(1, Math.floor(maxWrites * 0.45)));
  const edgeBudget = Math.min(edges.length, Math.max(0, maxWrites - motifBudget));

  for (const motif of motifs.slice(0, motifBudget)) {
    const content = `Context motif (${motif.kind}): ${motif.summary}. Support=${motif.support}, threads=${motif.threadCount}, actors=${motif.actorCount}, confidence=${Math.round(motif.confidence * 100)}%.`;
    const clientRequestId = `ctx-exp-${stableHash(`${windowAnchor}|motif|${motif.key}`).slice(0, 24)}`;
    if (seenClientRequestIds.has(clientRequestId)) continue;
    seenClientRequestIds.add(clientRequestId);
    candidates.push({
      content,
      source: captureSource,
      tags: [
        "context-index",
        "experimental",
        "motif",
        String(motif.kind).replace(/[^a-z0-9-]+/gi, "-").toLowerCase(),
        motif.noveltyScore !== undefined && Number(motif.noveltyScore) < 0.35 ? "novelty-low" : "",
        motif.noveltyScore !== undefined && Number(motif.noveltyScore) >= 0.75 ? "novelty-high" : "",
        ...motif.topTopics.slice(0, 2),
      ].filter(Boolean),
      metadata: {
        analysisType: "experimental-context-motif",
        contextIndexVersion,
        motifKind: motif.kind,
        motifKey: motif.key,
        score: motif.score,
        confidence: motif.confidence,
        support: motif.support,
        threadCount: motif.threadCount,
        actorCount: motif.actorCount,
        actors: motif.actors,
        topics: motif.topTopics,
        sourceMemoryIds: motif.sourceMemoryIds,
        firstSeenAt: motif.firstSeenAt,
        lastSeenAt: motif.lastSeenAt,
        noveltyScore: motif.noveltyScore ?? null,
        priorCapturedAt: motif.priorCapturedAt ?? null,
        confidenceDeltaFromPrior: motif.confidenceDeltaFromPrior ?? null,
        adjustedScore: motif.adjustedScore ?? motif.score,
      },
      tenantId: tenantId || undefined,
      runId,
      clientRequestId,
      sourceConfidence: clamp(motif.confidence, 0, 1),
      importance: clamp(0.45 + motif.confidence * 0.5, 0, 1),
    });
  }

  for (const edge of edges.slice(0, edgeBudget)) {
    const themes = edge.topTopics.length > 0 ? edge.topTopics.slice(0, 3).join(", ") : "mixed context";
    const relationshipType = String(edge.relationshipType || "general-collaboration");
    const content = `Relationship signal (${relationshipType}): ${edge.left} and ${edge.right} repeatedly co-occur in high-signal context (${edge.support} memories across ${edge.threadCount} threads, confidence ${Math.round(edge.confidence * 100)}%). Themes: ${themes}.`;
    const clientRequestId = `ctx-exp-${stableHash(`${windowAnchor}|edge|${edge.key}`).slice(0, 24)}`;
    if (seenClientRequestIds.has(clientRequestId)) continue;
    seenClientRequestIds.add(clientRequestId);
    candidates.push({
      content,
      source: captureSource,
      tags: [
        "context-index",
        "experimental",
        "relationship",
        String(relationshipType).replace(/[^a-z0-9-]+/gi, "-").toLowerCase(),
        edge.noveltyScore !== undefined && Number(edge.noveltyScore) < 0.35 ? "novelty-low" : "",
        edge.noveltyScore !== undefined && Number(edge.noveltyScore) >= 0.75 ? "novelty-high" : "",
        ...edge.topTopics.slice(0, 2),
      ].filter(Boolean),
      metadata: {
        analysisType: "experimental-context-relationship",
        contextIndexVersion,
        relationshipKind: edge.kind,
        relationshipKey: edge.key,
        relationshipType,
        left: edge.left,
        right: edge.right,
        support: edge.support,
        weightedSupport: edge.weightedSupport,
        highSignalSupport: edge.highSignalSupport,
        weightedSignalRatio: edge.weightedSignalRatio,
        threadCount: edge.threadCount,
        overlapRatio: edge.overlapRatio,
        signalRatio: edge.signalRatio,
        participantQuality: edge.participantQuality,
        supportRecent14d: edge.supportRecent14d,
        supportRecent30d: edge.supportRecent30d,
        confidence: edge.confidence,
        confidenceBreakdown: edge.confidenceBreakdown,
        score: edge.score,
        temporalSpanDays: edge.temporalSpanDays,
        firstSeenAt: edge.firstSeenAt,
        lastSeenAt: edge.lastSeenAt,
        topTopics: edge.topTopics,
        topCategories: edge.topCategories,
        sourceMemoryIds: edge.sourceMemoryIds,
        noveltyScore: edge.noveltyScore ?? null,
        priorCapturedAt: edge.priorCapturedAt ?? null,
        confidenceDeltaFromPrior: edge.confidenceDeltaFromPrior ?? null,
        adjustedScore: edge.adjustedScore ?? edge.score,
      },
      tenantId: tenantId || undefined,
      runId,
      clientRequestId,
      sourceConfidence: clamp(edge.confidence, 0, 1),
      importance: clamp(0.4 + edge.confidence * 0.55, 0, 1),
    });
  }

  return candidates.slice(0, maxWrites);
}

function buildRecentCaptureNoveltyIndex(rows, { captureSource, dedupeWindowDays }) {
  const motifByKey = new Map();
  const edgeByKey = new Map();
  const normalizedCaptureSource = normalizeText(captureSource).toLowerCase();
  const nowMs = Date.now();
  const windowMs = Math.max(1, dedupeWindowDays) * 86_400_000;
  let syntheticRowsScanned = 0;
  let syntheticRowsInWindow = 0;

  const shouldInclude = (rowSource) => {
    const normalized = normalizeText(rowSource).toLowerCase();
    if (!normalizedCaptureSource) return true;
    return normalized === normalizedCaptureSource || normalized.startsWith(`${normalizedCaptureSource}:`);
  };

  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    if (!shouldInclude(row.source)) continue;
    const metadata = safeRecord(row.metadata);
    const analysisType = normalizeText(metadata.analysisType).toLowerCase();
    if (!analysisType.startsWith("experimental-context-")) continue;
    syntheticRowsScanned += 1;
    const capturedAtMs = rowTimestampMs(row);
    if (nowMs - capturedAtMs <= windowMs) syntheticRowsInWindow += 1;
    const confidence = clamp(Number(metadata.confidence ?? row.sourceConfidence ?? 0), 0, 1);
    if (analysisType === "experimental-context-motif") {
      const motifKey = normalizeText(metadata.motifKey);
      if (!motifKey) continue;
      const existing = motifByKey.get(motifKey);
      if (!existing || capturedAtMs > existing.capturedAtMs) {
        motifByKey.set(motifKey, {
          capturedAtMs,
          capturedAt: toIsoDate(capturedAtMs),
          confidence,
        });
      }
      continue;
    }
    if (analysisType === "experimental-context-relationship") {
      const relationshipKey = normalizeText(metadata.relationshipKey);
      if (!relationshipKey) continue;
      const existing = edgeByKey.get(relationshipKey);
      if (!existing || capturedAtMs > existing.capturedAtMs) {
        edgeByKey.set(relationshipKey, {
          capturedAtMs,
          capturedAt: toIsoDate(capturedAtMs),
          confidence,
        });
      }
    }
  }

  return {
    motifByKey,
    edgeByKey,
    syntheticRowsScanned,
    syntheticRowsInWindow,
  };
}

function applyNoveltyAdjustments({
  motifs,
  edges,
  noveltyIndex,
  dedupeWindowDays,
  noveltyWeight,
  refreshConfidenceDelta,
}) {
  const nowMs = Date.now();
  const effectiveDedupeDays = Math.max(1, dedupeWindowDays);
  const scoreBoostWeight = Math.max(0, noveltyWeight);
  const confidenceDeltaFloor = Math.max(0, refreshConfidenceDelta);
  let motifSuppressed = 0;
  let edgeSuppressed = 0;
  let reusedKeys = 0;
  let noveltyScoreSum = 0;
  let noveltyCount = 0;

  const decorate = (items, byKey, keyField) => {
    const out = [];
    for (const item of items) {
      if (!item || typeof item !== "object") continue;
      const key = normalizeText(item[keyField]);
      const prior = key ? byKey.get(key) : null;
      const priorAgeDays =
        prior && Number.isFinite(prior.capturedAtMs) ? Math.max(0, (nowMs - prior.capturedAtMs) / 86_400_000) : null;
      const noveltyScore =
        priorAgeDays === null ? 1 : clamp(priorAgeDays / Math.max(1, effectiveDedupeDays * 1.8), 0, 1);
      const confidenceDelta =
        priorAgeDays === null ? Number(item.confidence ?? 0) : Number(item.confidence ?? 0) - Number(prior.confidence ?? 0);
      const duplicateWindowHit =
        priorAgeDays !== null && priorAgeDays <= effectiveDedupeDays && confidenceDelta < confidenceDeltaFloor;
      const adjustedScore = Number(item.score ?? 0) + noveltyScore * scoreBoostWeight - (duplicateWindowHit ? 0.55 : 0);
      const enriched = {
        ...item,
        noveltyScore: Number(noveltyScore.toFixed(4)),
        priorCapturedAt: prior?.capturedAt ?? null,
        confidenceDeltaFromPrior: Number(confidenceDelta.toFixed(4)),
        duplicateWindowHit,
        adjustedScore: Number(adjustedScore.toFixed(4)),
      };
      if (priorAgeDays !== null) reusedKeys += 1;
      noveltyScoreSum += noveltyScore;
      noveltyCount += 1;
      out.push(enriched);
    }
    return out.sort((a, b) => (b.adjustedScore !== a.adjustedScore ? b.adjustedScore - a.adjustedScore : b.score - a.score));
  };

  const decoratedMotifs = decorate(motifs, noveltyIndex.motifByKey, "key");
  const decoratedEdges = decorate(edges, noveltyIndex.edgeByKey, "key");
  const filteredMotifs = [];
  for (const motif of decoratedMotifs) {
    if (motif.duplicateWindowHit) {
      motifSuppressed += 1;
      continue;
    }
    filteredMotifs.push(motif);
  }
  const filteredEdges = [];
  for (const edge of decoratedEdges) {
    if (edge.duplicateWindowHit) {
      edgeSuppressed += 1;
      continue;
    }
    filteredEdges.push(edge);
  }

  const avgNoveltyScore = noveltyCount > 0 ? Number((noveltyScoreSum / noveltyCount).toFixed(4)) : 0;

  return {
    motifs: filteredMotifs,
    edges: filteredEdges,
    telemetry: {
      dedupeWindowDays: effectiveDedupeDays,
      noveltyWeight: Number(scoreBoostWeight.toFixed(4)),
      refreshConfidenceDelta: Number(confidenceDeltaFloor.toFixed(4)),
      motifSuppressed,
      edgeSuppressed,
      suppressedCandidates: motifSuppressed + edgeSuppressed,
      reusedKeys,
      avgNoveltyScore,
      sourceSyntheticRowsScanned: noveltyIndex.syntheticRowsScanned,
      sourceSyntheticRowsInWindow: noveltyIndex.syntheticRowsInWindow,
    },
  };
}

async function fetchRecentRows({
  baseUrl,
  authState,
  adminToken,
  tenantId,
  limit,
  timeoutMs,
  retryAttempts = 3,
  retryDelayMs = 1500,
}) {
  const query = new URLSearchParams();
  query.set("limit", String(limit));
  if (tenantId) query.set("tenantId", tenantId);

  let lastStatus = 0;
  let lastMessage = "unknown";
  for (let attempt = 1; attempt <= retryAttempts; attempt += 1) {
    const response = await requestWithRefresh({
      baseUrl,
      authState,
      adminToken,
      path: `/api/memory/recent?${query.toString()}`,
      method: "GET",
      timeoutMs,
    });
    if (response.ok) {
      const rows = Array.isArray(response.payload?.rows) ? response.payload.rows : [];
      return rows;
    }

    lastStatus = response.status;
    lastMessage = String(response.payload?.message ?? "unknown");
    const recoverable =
      response.status === 0 ||
      response.status >= 500 ||
      /timeout|aborted|temporarily|deferred|connect|request-failed/i.test(lastMessage);
    if (!recoverable || attempt >= retryAttempts) {
      break;
    }
    await sleep(retryDelayMs * attempt);
  }

  throw new Error(`Unable to fetch recent memories (status=${lastStatus}): ${lastMessage}`);
}

async function fetchSearchRows({
  baseUrl,
  authState,
  adminToken,
  tenantId,
  query,
  limit,
  timeoutMs,
}) {
  const response = await requestWithRefresh({
    baseUrl,
    authState,
    adminToken,
    path: "/api/memory/search",
    method: "POST",
    timeoutMs,
    body: {
      query,
      limit,
      queryLane: "bulk",
      bulk: true,
      tenantId: tenantId || undefined,
      retrievalMode: "hybrid",
      expandRelationships: true,
      maxHops: 1,
      rerank: {
        profile: "experimental-context-index-v2",
        highSignalCategories: ["decision", "action", "risk", "escalation", "timeline"],
      },
    },
  });
  return {
    ok: response.ok,
    status: response.status,
    message: String(response.payload?.message ?? ""),
    rows: Array.isArray(response.payload?.rows) ? response.payload.rows : [],
    degradation:
      response.payload?.degradation && typeof response.payload.degradation === "object" ? response.payload.degradation : null,
  };
}

async function fetchPressureSnapshot({ baseUrl, authState, adminToken, timeoutMs }) {
  const response = await requestWithRefresh({
    baseUrl,
    authState,
    adminToken,
    path: "/api/memory/pressure",
    method: "GET",
    timeoutMs,
  });
  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      message: String(response.payload?.message ?? ""),
      pressure: null,
    };
  }
  const pressure = response.payload?.pressure && typeof response.payload.pressure === "object" ? response.payload.pressure : null;
  return {
    ok: true,
    status: response.status,
    message: "",
    pressure,
  };
}

function writeJson(path, payload) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function writeJsonl(path, rows) {
  mkdirSync(dirname(path), { recursive: true });
  const serialized = rows.map((row) => JSON.stringify(row)).join("\n");
  writeFileSync(path, serialized ? `${serialized}\n` : "", "utf8");
}

function readJsonl(path) {
  if (!existsSync(path)) return [];
  const raw = readFileSync(path, "utf8");
  if (!raw.trim()) return [];
  const rows = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === "object") rows.push(parsed);
    } catch {}
  }
  return rows;
}

function isRecoverableCaptureWriteFailure(status, message) {
  const normalizedMessage = String(message || "").toLowerCase();
  return (
    status === 0
    || status >= 500
    || /request-failed|timeout|aborted|temporarily|deferred|connect|fetch failed|socket|network/.test(normalizedMessage)
  );
}

function isCaptureCandidatePayload(value) {
  if (!value || typeof value !== "object") return false;
  const row = value;
  return Boolean(
    typeof row.clientRequestId === "string"
      && row.clientRequestId.trim()
      && typeof row.content === "string"
      && row.content.trim()
  );
}

function annotateSpoolCandidate(candidate, hint = {}) {
  const existingMetadata = candidate?.metadata && typeof candidate.metadata === "object" ? candidate.metadata : {};
  const existingHint = existingMetadata.spoolHint && typeof existingMetadata.spoolHint === "object" ? existingMetadata.spoolHint : {};
  return {
    ...candidate,
    metadata: {
      ...existingMetadata,
      spoolHint: {
        ...existingHint,
        ...hint,
      },
    },
  };
}

function resolveOptionalPath(rawValue, fallback = "") {
  const raw = String(rawValue || fallback || "").trim();
  if (!raw) return "";
  const lowered = raw.toLowerCase();
  if (["false", "0", "no", "off", "none", "disabled", "null"].includes(lowered)) {
    return "";
  }
  return resolve(process.cwd(), raw);
}

function buildCaptureWriteOutcomeMessage(response) {
  if (response?.payload?.message) return String(response.payload.message);
  const status = Number(response?.status || 0);
  return status > 0 ? `HTTP ${status}` : "request-failed:unknown";
}

async function writeCaptureCandidateWithRetries({
  baseUrl,
  authState,
  adminToken,
  candidate,
  timeoutMs,
  retryAttempts,
  retryDelayMs,
  retryBackoffFactor,
  retryMaxDelayMs,
}) {
  let lastResponse = null;
  let lastMessage = "request-failed:unknown";
  let recoverable = false;

  for (let attempt = 1; attempt <= retryAttempts; attempt += 1) {
    const response = await requestWithRefresh({
      baseUrl,
      authState,
      adminToken,
      path: "/api/memory/capture",
      method: "POST",
      body: candidate,
      timeoutMs,
    });
    if (response.ok) {
      return {
        ok: true,
        attempts: attempt,
        response,
        status: Number(response.status || 200),
        message: "",
        recoverable: false,
      };
    }

    lastResponse = response;
    lastMessage = buildCaptureWriteOutcomeMessage(response);
    recoverable = isRecoverableCaptureWriteFailure(Number(response.status || 0), lastMessage);
    if (!recoverable || attempt >= retryAttempts) {
      break;
    }

    const delayMs = Math.min(retryMaxDelayMs, Math.round(retryDelayMs * Math.pow(retryBackoffFactor, attempt - 1)));
    if (delayMs > 0) await sleep(delayMs);
  }

  return {
    ok: false,
    attempts: retryAttempts,
    response: lastResponse,
    status: Number(lastResponse?.status || 0),
    message: lastMessage,
    recoverable,
  };
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  if (readBool(flags, "help", false)) {
    process.stdout.write(
      [
        "Open Memory Experimental Context Index",
        "",
        "Usage:",
        "  node ./scripts/open-memory-context-experimental-index.mjs --dry-run true --json true",
        "",
        "Options:",
        "  --base-url <url>                         Studio Brain base URL override",
        "  --tenant-id <id>                         Optional tenant id",
        "  --admin-token <token>                    Optional admin token override",
        "  --limit <n>                              Recent memory fetch limit (default: 200)",
        "  --search-limit <n>                       Search limit per seed query (default: 60)",
        "  --search-seed-limit <n>                  Maximum extracted seed queries (default: 12)",
        "  --max-search-queries <n>                 Maximum search calls (default: 12)",
        "  --rerank-top-k <n>                       Max rows retained after retrieval rerank (default: 260)",
        "  --rerank-signal-weight <n>               Retrieval rerank signal weight (default: 0.55)",
        "  --rerank-recency-weight <n>              Retrieval rerank recency weight (default: 0.2)",
        "  --rerank-seed-overlap-weight <n>         Retrieval rerank seed overlap weight (default: 0.25)",
        "  --rerank-query-rank-weight <n>           Retrieval rerank query rank prior weight (default: 0.12)",
        "  --max-consecutive-search-failures <n>    Stop query expansion after N consecutive failures (default: 3)",
        "  --recent-retries <n>                     Retry attempts for /recent fetch (default: 3)",
        "  --recent-retry-delay-ms <n>              Backoff base delay for /recent retries (default: 1500)",
        "  --defer-on-pressure true|false           Skip discovery when ingest pressure is high (default: true)",
        "  --pressure-timeout-ms <n>                Timeout for pressure snapshot request (default: 5000)",
        "  --pressure-fallback-mode <mode>          Pressure behavior: defer|minimal|force (default: minimal)",
        "  --pressure-fallback-recent-limit <n>     Max /recent limit during pressure fallback (default: 84)",
        "  --pressure-fallback-search-limit <n>     Max search limit during pressure fallback (default: 12)",
        "  --pressure-fallback-search-seed-limit <n> Max search seed count during pressure fallback (default: 3)",
        "  --pressure-fallback-max-search-queries <n> Max search queries during pressure fallback (default: 1)",
        "  --pressure-fallback-rerank-top-k <n>     Max rerank rows during pressure fallback (default: 96)",
        "  --pressure-fallback-max-motifs <n>       Max motifs during pressure fallback (default: 10)",
        "  --pressure-fallback-max-edges <n>        Max relationship edges during pressure fallback (default: 18)",
        "  --pressure-fallback-max-writes <n>       Max writes during pressure fallback (default: 6)",
        "  --pressure-fallback-hard-ratio <n>       If active/max import ratio exceeds this, disable fallback search (default: 1.6)",
        "  --min-term-frequency <n>                 Min frequency for extracted search terms (default: 2)",
        "  --source-prefixes <csv>                  Source prefixes for mail-like scope (default: mail:,email)",
        "  --include-non-mail-like true|false       Include non-mail-like rows (default: false)",
        "  --participant-noise-filter true|false    Filter noise/robotic mailboxes for relationship edges (default: true)",
        "  --allow-search-only-on-recent-failure true|false Continue with search seeds when /recent fails (default: true)",
        "  --min-edge-support <n>                   Min support for edge candidates (default: 3)",
        "  --min-edge-confidence <n>                Min confidence for edge candidates (default: 0.62)",
        "  --min-motif-score <n>                    Min score for motif candidates (default: 1.4)",
        "  --dedupe-window-days <n>                 Suppress near-duplicate synthetic captures seen in this window (default: 14)",
        "  --novelty-weight <n>                     Score boost for novel motifs/edges (default: 0.24)",
        "  --refresh-confidence-delta <n>           Confidence delta required to refresh a recent duplicate key (default: 0.08)",
        "  --max-motifs <n>                         Max motif candidates (default: 20)",
        "  --max-edges <n>                          Max relationship edge candidates (default: 40)",
        "  --max-writes <n>                         Max synthetic memories to capture (default: 120)",
        "  --write-delay-ms <n>                     Delay between capture writes (default: 2)",
        "  --capture-write-retries <n>              Retry attempts per capture write (default: 3)",
        "  --capture-write-retry-delay-ms <n>       Base delay for capture write retries (default: 900)",
        "  --capture-write-retry-backoff-factor <n> Backoff factor for capture write retries (default: 1.8)",
        "  --capture-write-retry-max-delay-ms <n>   Max retry delay for capture write retries (default: 8000)",
        "  --capture-failure-circuit-breaker-threshold <n> Open breaker after N consecutive write failures (default: 6)",
        "  --capture-failure-spool-path <path|false> JSONL queue for failed/deferred captures",
        "  --capture-spool-replay-max <n>           Max queued capture rows replayed each run (default: 36)",
        "  --capture-spool-replay-ratio <n>         Portion of write budget reserved for spool replay (default: 0.45)",
        "  --capture-spool-max-rows <n>             Hard cap for queued capture rows on disk (default: 1600)",
        "  --capture-source <value>                 Source for captured synthetic memories",
        "  --dry-run true|false                     Dry run mode (default: false)",
        "  --timeout-ms <n>                         Request timeout (default: 30000)",
        "  --report <path>                          Report output path",
        "  --preview-path <path>                    JSONL preview output path",
        "  --json true|false                        Print machine-readable report",
      ].join("\n")
    );
    return;
  }

  const loadStudioEnv = readBool(flags, "load-env-file", true);
  const loadPortalEnv = readBool(flags, "load-portal-env-file", true);
  const studioEnvPath = readString(flags, "env-file", DEFAULT_STUDIO_ENV_PATH);
  const portalEnvPath = readString(flags, "portal-env-file", DEFAULT_PORTAL_ENV_PATH);
  if (loadStudioEnv) loadEnvFile(studioEnvPath);
  if (loadPortalEnv) loadEnvFile(portalEnvPath);

  const baseUrl = readString(
    flags,
    "base-url",
    String(process.env.STUDIO_BRAIN_BASE_URL || resolveStudioBrainBaseUrlFromEnv({ env: process.env }) || "").replace(/\/$/, "")
  );
  if (!baseUrl) {
    throw new Error("Missing Studio Brain base URL. Set --base-url or STUDIO_BRAIN_BASE_URL.");
  }

  const authState = await ensureAuthHeader();
  if (!authState.ok || !authState.authHeader) {
    throw new Error(`Unable to resolve Studio Brain auth token (${authState.reason || "unknown"}).`);
  }

  const tenantId = readString(flags, "tenant-id", "");
  const adminToken = readString(flags, "admin-token", String(process.env.STUDIO_BRAIN_ADMIN_TOKEN || "").trim());
  const dryRun = readBool(flags, "dry-run", false);
  const recentLimit = readInt(flags, "limit", 200, { min: 20, max: 200 });
  const searchLimit = readInt(flags, "search-limit", 60, { min: 5, max: 100 });
  const searchSeedLimit = readInt(flags, "search-seed-limit", 12, { min: 1, max: 100 });
  const maxSearchQueries = readInt(flags, "max-search-queries", 12, { min: 1, max: 100 });
  const rerankTopK = readInt(flags, "rerank-top-k", 260, { min: 20, max: 5000 });
  const rerankSignalWeight = readNumber(flags, "rerank-signal-weight", 0.55, { min: 0, max: 1 });
  const rerankRecencyWeight = readNumber(flags, "rerank-recency-weight", 0.2, { min: 0, max: 1 });
  const rerankSeedOverlapWeight = readNumber(flags, "rerank-seed-overlap-weight", 0.25, { min: 0, max: 1 });
  const rerankQueryRankWeight = readNumber(flags, "rerank-query-rank-weight", 0.12, { min: 0, max: 1 });
  const maxConsecutiveSearchFailures = readInt(flags, "max-consecutive-search-failures", 3, { min: 1, max: 25 });
  const recentRetries = readInt(flags, "recent-retries", 3, { min: 1, max: 20 });
  const recentRetryDelayMs = readInt(flags, "recent-retry-delay-ms", 1500, { min: 0, max: 120_000 });
  const deferOnPressure = readBool(flags, "defer-on-pressure", true);
  const pressureTimeoutMs = readInt(flags, "pressure-timeout-ms", 5000, { min: 1000, max: 120_000 });
  const pressureFallbackModeRaw = readString(flags, "pressure-fallback-mode", "minimal").toLowerCase();
  const pressureFallbackMode =
    pressureFallbackModeRaw === "defer" || pressureFallbackModeRaw === "minimal" || pressureFallbackModeRaw === "force"
      ? pressureFallbackModeRaw
      : "minimal";
  const pressureFallbackRecentLimit = readInt(flags, "pressure-fallback-recent-limit", 84, { min: 10, max: 200 });
  const pressureFallbackSearchLimit = readInt(flags, "pressure-fallback-search-limit", 12, { min: 1, max: 100 });
  const pressureFallbackSearchSeedLimit = readInt(flags, "pressure-fallback-search-seed-limit", 3, { min: 1, max: 100 });
  const pressureFallbackMaxSearchQueries = readInt(flags, "pressure-fallback-max-search-queries", 1, {
    min: 0,
    max: 100,
  });
  const pressureFallbackRerankTopK = readInt(flags, "pressure-fallback-rerank-top-k", 96, { min: 20, max: 5000 });
  const pressureFallbackMaxMotifs = readInt(flags, "pressure-fallback-max-motifs", 10, { min: 1, max: 500 });
  const pressureFallbackMaxEdges = readInt(flags, "pressure-fallback-max-edges", 18, { min: 1, max: 500 });
  const pressureFallbackMaxWrites = readInt(flags, "pressure-fallback-max-writes", 6, { min: 1, max: 500 });
  const pressureFallbackHardRatio = readNumber(flags, "pressure-fallback-hard-ratio", 1.6, { min: 1, max: 12 });
  const minTermFrequency = readInt(flags, "min-term-frequency", 2, { min: 1, max: 20 });
  const sourcePrefixes = parseCsv(readString(flags, "source-prefixes", "mail:,email"));
  const includeNonMailLike = readBool(flags, "include-non-mail-like", false);
  const participantNoiseFilter = readBool(flags, "participant-noise-filter", true);
  const allowSearchOnlyOnRecentFailure = readBool(flags, "allow-search-only-on-recent-failure", true);
  const minEdgeSupport = readInt(flags, "min-edge-support", 3, { min: 1, max: 100 });
  const minEdgeConfidence = readNumber(flags, "min-edge-confidence", 0.62, { min: 0, max: 1 });
  const minMotifScore = readNumber(flags, "min-motif-score", 1.4, { min: 0, max: 10 });
  const dedupeWindowDays = readInt(flags, "dedupe-window-days", 14, { min: 1, max: 365 });
  const noveltyWeight = readNumber(flags, "novelty-weight", 0.24, { min: 0, max: 2 });
  const refreshConfidenceDelta = readNumber(flags, "refresh-confidence-delta", 0.08, { min: 0, max: 1 });
  const maxMotifs = readInt(flags, "max-motifs", 20, { min: 1, max: 500 });
  const maxEdges = readInt(flags, "max-edges", 40, { min: 1, max: 500 });
  const maxWrites = readInt(flags, "max-writes", 120, { min: 1, max: 500 });
  const writeDelayMs = readInt(flags, "write-delay-ms", 2, { min: 0, max: 60000 });
  const captureWriteRetries = readInt(flags, "capture-write-retries", 3, { min: 1, max: 12 });
  const captureWriteRetryDelayMs = readInt(flags, "capture-write-retry-delay-ms", 900, { min: 0, max: 120_000 });
  const captureWriteRetryBackoffFactor = readNumber(flags, "capture-write-retry-backoff-factor", 1.8, { min: 1, max: 6 });
  const captureWriteRetryMaxDelayMs = readInt(flags, "capture-write-retry-max-delay-ms", 8_000, { min: 50, max: 300_000 });
  const captureFailureCircuitBreakerThreshold = readInt(flags, "capture-failure-circuit-breaker-threshold", 6, {
    min: 0,
    max: 120,
  });
  const captureFailureSpoolPath = resolveOptionalPath(
    readString(flags, "capture-failure-spool-path", DEFAULT_CAPTURE_FAILURE_SPOOL_PATH),
    DEFAULT_CAPTURE_FAILURE_SPOOL_PATH
  );
  const captureSpoolReplayMax = readInt(flags, "capture-spool-replay-max", 36, { min: 0, max: 2000 });
  const captureSpoolReplayRatio = readNumber(flags, "capture-spool-replay-ratio", 0.45, { min: 0, max: 1 });
  const captureSpoolMaxRows = readInt(flags, "capture-spool-max-rows", 1600, { min: 50, max: 20000 });
  const captureSource = readString(flags, "capture-source", "open-memory:experimental-context-index");
  const timeoutMs = readInt(flags, "timeout-ms", 30_000, { min: 2000, max: 300_000 });
  const reportPath = readString(flags, "report", DEFAULT_REPORT_PATH);
  const previewPath = readString(flags, "preview-path", DEFAULT_PREVIEW_PATH);
  const printJson = readBool(flags, "json", false);
  const generatedAt = new Date().toISOString();
  const runId = readString(
    flags,
    "run-id",
    `context-experimental-index-${generatedAt.replace(/[^0-9]/g, "").slice(0, 14)}`
  );

  const pressureSnapshot = await fetchPressureSnapshot({
    baseUrl,
    authState,
    adminToken,
    timeoutMs: pressureTimeoutMs,
  });
  const pressure = pressureSnapshot.pressure && typeof pressureSnapshot.pressure === "object" ? pressureSnapshot.pressure : null;
  const activeImports = Number(pressure?.activeImportRequests ?? 0);
  const maxImports = Number(pressure?.thresholds?.maxActiveImportsBeforeBackfill ?? 0);
  const pressureThresholdReached = deferOnPressure && pressureSnapshot.ok && maxImports > 0 && activeImports >= maxImports;
  const pressureRatio = maxImports > 0 ? activeImports / maxImports : 0;
  const pressureFallbackEnabled = pressureThresholdReached && pressureFallbackMode !== "defer";
  const pressureDeferred = pressureThresholdReached && !pressureFallbackEnabled;
  const pressureFallbackAggressive = pressureFallbackEnabled && pressureRatio >= pressureFallbackHardRatio;
  const effectiveRecentLimit = pressureFallbackEnabled ? Math.min(recentLimit, pressureFallbackRecentLimit) : recentLimit;
  const effectiveSearchLimit = pressureFallbackEnabled ? Math.min(searchLimit, pressureFallbackSearchLimit) : searchLimit;
  const effectiveSearchSeedLimit = pressureFallbackEnabled
    ? Math.min(searchSeedLimit, pressureFallbackSearchSeedLimit)
    : searchSeedLimit;
  const effectiveMaxSearchQueries = pressureFallbackEnabled
    ? pressureFallbackAggressive
      ? 0
      : Math.min(maxSearchQueries, pressureFallbackMaxSearchQueries)
    : maxSearchQueries;
  const effectiveRerankTopK = pressureFallbackEnabled ? Math.min(rerankTopK, pressureFallbackRerankTopK) : rerankTopK;
  const effectiveMaxMotifs = pressureFallbackEnabled ? Math.min(maxMotifs, pressureFallbackMaxMotifs) : maxMotifs;
  const effectiveMaxEdges = pressureFallbackEnabled ? Math.min(maxEdges, pressureFallbackMaxEdges) : maxEdges;
  const effectiveMaxWrites = pressureFallbackEnabled ? Math.min(maxWrites, pressureFallbackMaxWrites) : maxWrites;
  if (pressureDeferred) {
    const report = {
      ok: true,
      generatedAt,
      config: {
        baseUrl,
        tenantId: tenantId || null,
        dryRun,
        recentLimit,
        searchLimit,
        searchSeedLimit,
        maxSearchQueries,
        rerankTopK,
        rerankSignalWeight,
        rerankRecencyWeight,
        rerankSeedOverlapWeight,
        rerankQueryRankWeight,
        maxConsecutiveSearchFailures,
        recentRetries,
        recentRetryDelayMs,
        deferOnPressure,
        pressureTimeoutMs,
        pressureFallbackMode,
        pressureFallbackRecentLimit,
        pressureFallbackSearchLimit,
        pressureFallbackSearchSeedLimit,
        pressureFallbackMaxSearchQueries,
        pressureFallbackRerankTopK,
        pressureFallbackMaxMotifs,
        pressureFallbackMaxEdges,
        pressureFallbackMaxWrites,
        pressureFallbackHardRatio,
        minTermFrequency,
        sourcePrefixes,
        includeNonMailLike,
        participantNoiseFilter,
        allowSearchOnlyOnRecentFailure,
        minEdgeSupport,
        minEdgeConfidence,
        minMotifScore,
        dedupeWindowDays,
        noveltyWeight,
        refreshConfidenceDelta,
        maxMotifs,
        maxEdges,
        maxWrites,
        writeDelayMs,
        captureSource,
        runId,
        timeoutMs,
        effective: {
          recentLimit: effectiveRecentLimit,
          searchLimit: effectiveSearchLimit,
          searchSeedLimit: effectiveSearchSeedLimit,
          maxSearchQueries: effectiveMaxSearchQueries,
          rerankTopK: effectiveRerankTopK,
          maxMotifs: effectiveMaxMotifs,
          maxEdges: effectiveMaxEdges,
          maxWrites: effectiveMaxWrites,
        },
      },
      auth: {
        source: authState.source,
      },
      pressure: {
        deferred: true,
        mode: "deferred",
        thresholdReached: pressureThresholdReached,
        ratio: Number(pressureRatio.toFixed(4)),
        snapshot: pressureSnapshot,
      },
      telemetry: {
        recentRows: 0,
        searchQueriesAttempted: 0,
        searchQueriesFailed: 0,
        rerank: {
          inputRows: 0,
          uniqueRows: 0,
          retainedRows: 0,
          signalDominantRows: 0,
          avgSeedOverlap: 0,
          avgFinalScore: 0,
          weights: {
            signal: 0,
            recency: 0,
            seedOverlap: 0,
            queryRank: 0,
          },
          topRows: [],
        },
        novelty: {
          dedupeWindowDays,
          noveltyWeight,
          refreshConfidenceDelta,
          motifSuppressed: 0,
          edgeSuppressed: 0,
          suppressedCandidates: 0,
          reusedKeys: 0,
          avgNoveltyScore: 0,
          sourceSyntheticRowsScanned: 0,
          sourceSyntheticRowsInWindow: 0,
        },
        gatheredRows: 0,
        dedupedRows: 0,
        scanned: 0,
        skipped: {
          bySource: 0,
          malformed: 0,
        },
        previewPath,
        reportPath,
      },
      totals: {
        scanned: 0,
        eligible: 0,
        updated: 0,
        failed: 0,
        timeoutErrors: 0,
        alreadyIndexedSkipped: 0,
        relationshipProbes: 0,
        relationshipMemoriesAugmented: 0,
        relationshipEdgesAdded: 0,
        relationshipEdgesCaptured: 0,
        relationshipCandidates: 0,
        motifsDetected: 0,
        decisionFlowMotifsDetected: 0,
        bridgeHubMotifsDetected: 0,
        noveltySuppressedCandidates: 0,
        noveltyReusedKeys: 0,
        noveltyAvgScore: 0,
        rerankRowsInput: 0,
        rerankRowsRetained: 0,
        rerankSignalDominantRows: 0,
        rerankAvgSeedOverlap: 0,
        rerankAvgScore: 0,
        capturesAttempted: 0,
        capturesWritten: 0,
        requestRetries: 0,
        recoverableHttpErrors: 0,
        fatalHttpErrors: 0,
        downshiftCount: 0,
        cooldownCount: 0,
      },
      phases: [
        {
          phaseName: "experimental-context-index",
          stopReason: "pressure-deferred",
          last: {
            wave: 1,
            ok: true,
            scanned: 0,
            eligible: 0,
            updated: 0,
            failed: 0,
            motifsDetected: 0,
            relationshipCandidates: 0,
            relationshipEdgesAdded: 0,
            message: "Backfill deferred due current memory ingest pressure.",
          },
        },
      ],
      sample: {
        topMotifs: [],
        topBridgeHubMotifs: [],
        topRelationshipEdges: [],
        topRerankedRows: [],
        capturePreview: [],
      },
      searchDiagnostics: [],
      errors: [],
    };

    writeJson(reportPath, report);
    if (printJson) {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      return;
    }
    process.stdout.write(
      `${JSON.stringify(
        {
          ok: report.ok,
          reportPath,
          previewPath,
          stopReason: "pressure-deferred",
          totals: report.totals,
        },
        null,
        2
      )}\n`
    );
    return;
  }

  let recentRows = [];
  let recentFetchError = null;
  try {
    recentRows = await fetchRecentRows({
      baseUrl,
      authState,
      adminToken,
      tenantId,
      limit: effectiveRecentLimit,
      timeoutMs,
      retryAttempts: recentRetries,
      retryDelayMs: recentRetryDelayMs,
    });
  } catch (error) {
    recentFetchError = error instanceof Error ? error.message : String(error);
  }

  if (recentFetchError && !allowSearchOnlyOnRecentFailure) {
    const report = {
      ok: false,
      generatedAt,
      config: {
        baseUrl,
        tenantId: tenantId || null,
        dryRun,
        recentLimit,
        searchLimit,
        searchSeedLimit,
        maxSearchQueries,
        rerankTopK,
        rerankSignalWeight,
        rerankRecencyWeight,
        rerankSeedOverlapWeight,
        rerankQueryRankWeight,
        maxConsecutiveSearchFailures,
        recentRetries,
        recentRetryDelayMs,
        deferOnPressure,
        pressureTimeoutMs,
        pressureFallbackMode,
        pressureFallbackRecentLimit,
        pressureFallbackSearchLimit,
        pressureFallbackSearchSeedLimit,
        pressureFallbackMaxSearchQueries,
        pressureFallbackRerankTopK,
        pressureFallbackMaxMotifs,
        pressureFallbackMaxEdges,
        pressureFallbackMaxWrites,
        pressureFallbackHardRatio,
        minTermFrequency,
        sourcePrefixes,
        includeNonMailLike,
        participantNoiseFilter,
        allowSearchOnlyOnRecentFailure,
        minEdgeSupport,
        minEdgeConfidence,
        minMotifScore,
        dedupeWindowDays,
        noveltyWeight,
        refreshConfidenceDelta,
        maxMotifs,
        maxEdges,
        maxWrites,
        writeDelayMs,
        captureSource,
        runId,
        timeoutMs,
        effective: {
          recentLimit: effectiveRecentLimit,
          searchLimit: effectiveSearchLimit,
          searchSeedLimit: effectiveSearchSeedLimit,
          maxSearchQueries: effectiveMaxSearchQueries,
          rerankTopK: effectiveRerankTopK,
          maxMotifs: effectiveMaxMotifs,
          maxEdges: effectiveMaxEdges,
          maxWrites: effectiveMaxWrites,
        },
      },
      auth: {
        source: authState.source,
      },
      pressure: {
        deferred: false,
        mode: pressureFallbackEnabled ? "fallback-minimal" : "normal",
        thresholdReached: pressureThresholdReached,
        ratio: Number(pressureRatio.toFixed(4)),
        snapshot: pressureSnapshot,
      },
      telemetry: {
        recentRows: 0,
        searchQueriesAttempted: 0,
        searchQueriesFailed: 0,
        rerank: {
          inputRows: 0,
          uniqueRows: 0,
          retainedRows: 0,
          signalDominantRows: 0,
          avgSeedOverlap: 0,
          avgFinalScore: 0,
          weights: {
            signal: 0,
            recency: 0,
            seedOverlap: 0,
            queryRank: 0,
          },
          topRows: [],
        },
        novelty: {
          dedupeWindowDays,
          noveltyWeight,
          refreshConfidenceDelta,
          motifSuppressed: 0,
          edgeSuppressed: 0,
          suppressedCandidates: 0,
          reusedKeys: 0,
          avgNoveltyScore: 0,
          sourceSyntheticRowsScanned: 0,
          sourceSyntheticRowsInWindow: 0,
        },
        gatheredRows: 0,
        dedupedRows: 0,
        scanned: 0,
        skipped: {
          bySource: 0,
          malformed: 0,
        },
        previewPath,
        reportPath,
      },
      totals: {
        scanned: 0,
        eligible: 0,
        updated: 0,
        failed: 0,
        timeoutErrors: 0,
        alreadyIndexedSkipped: 0,
        relationshipProbes: 0,
        relationshipMemoriesAugmented: 0,
        relationshipEdgesAdded: 0,
        relationshipEdgesCaptured: 0,
        relationshipCandidates: 0,
        motifsDetected: 0,
        decisionFlowMotifsDetected: 0,
        bridgeHubMotifsDetected: 0,
        noveltySuppressedCandidates: 0,
        noveltyReusedKeys: 0,
        noveltyAvgScore: 0,
        rerankRowsInput: 0,
        rerankRowsRetained: 0,
        rerankSignalDominantRows: 0,
        rerankAvgSeedOverlap: 0,
        rerankAvgScore: 0,
        capturesAttempted: 0,
        capturesWritten: 0,
        requestRetries: 0,
        recoverableHttpErrors: 0,
        fatalHttpErrors: 1,
        downshiftCount: 0,
        cooldownCount: 0,
      },
      phases: [
        {
          phaseName: "experimental-context-index",
          stopReason: "recent-fetch-failed",
          last: {
            wave: 1,
            ok: false,
            scanned: 0,
            eligible: 0,
            updated: 0,
            failed: 0,
            motifsDetected: 0,
            relationshipCandidates: 0,
            relationshipEdgesAdded: 0,
            message: recentFetchError,
          },
        },
      ],
      sample: {
        topMotifs: [],
        topBridgeHubMotifs: [],
        topRelationshipEdges: [],
        topRerankedRows: [],
        capturePreview: [],
      },
      searchDiagnostics: [],
      errors: [
        {
          kind: "recent-fetch-failed",
          message: recentFetchError,
        },
      ],
    };

    writeJson(reportPath, report);
    writeJsonl(previewPath, []);
    if (printJson) {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      return;
    }
    process.stdout.write(
      `${JSON.stringify(
        {
          ok: report.ok,
          reportPath,
          previewPath,
          stopReason: "recent-fetch-failed",
          totals: report.totals,
          error: recentFetchError,
        },
        null,
        2
      )}\n`
    );
    return;
  }

  const seedQueries =
    recentRows.length > 0
      ? extractSearchSeeds(recentRows, { searchSeedLimit: effectiveSearchSeedLimit, minTermFrequency })
      : DEFAULT_FALLBACK_SEARCH_SEEDS.slice(0, Math.max(1, effectiveSearchSeedLimit));
  const retrievalRows = recentRows.map((row, index) => ({
    origin: "recent",
    query: "__recent__",
    rank: index + 1,
    row,
  }));
  const searchDiagnostics = [];
  if (recentFetchError && allowSearchOnlyOnRecentFailure) {
    searchDiagnostics.push({
      query: "__recent__",
      ok: false,
      status: 0,
      rows: 0,
      message: `recent-fetch-failed:${recentFetchError}`,
    });
  }
  let consecutiveSearchFailures = 0;
  for (const query of seedQueries.slice(0, effectiveMaxSearchQueries)) {
    const searchResult = await fetchSearchRows({
      baseUrl,
      authState,
      adminToken,
      tenantId,
      query,
      limit: effectiveSearchLimit,
      timeoutMs,
    });
    searchDiagnostics.push({
      query,
      ok: searchResult.ok,
      status: searchResult.status,
      rows: searchResult.rows.length,
      message: searchResult.ok ? "" : searchResult.message,
      deferredByServer: searchResult.status === 503 && /query-shed|deferred/i.test(searchResult.message),
      degradationApplied: Boolean(searchResult.degradation?.applied),
      degradationLane:
        typeof searchResult.degradation?.lane === "string" && searchResult.degradation.lane
          ? searchResult.degradation.lane
          : null,
      degradationReasons: Array.isArray(searchResult.degradation?.reasons)
        ? searchResult.degradation.reasons.slice(0, 8)
        : [],
    });
    if (searchResult.ok && searchResult.rows.length > 0) {
      for (let index = 0; index < searchResult.rows.length; index += 1) {
        retrievalRows.push({
          origin: "search",
          query,
          rank: index + 1,
          row: searchResult.rows[index],
        });
      }
      consecutiveSearchFailures = 0;
      continue;
    }
    consecutiveSearchFailures += 1;
    if (consecutiveSearchFailures >= maxConsecutiveSearchFailures) {
      searchDiagnostics.push({
        query: "__early-stop__",
        ok: false,
        status: 0,
        rows: 0,
        message: `stopped-after-consecutive-search-failures:${consecutiveSearchFailures}`,
      });
      break;
    }
  }

  const rerank = rerankRetrievedRows({
    retrievalRows,
    seedQueries,
    topK: effectiveRerankTopK,
    signalWeight: rerankSignalWeight,
    recencyWeight: rerankRecencyWeight,
    seedOverlapWeight: rerankSeedOverlapWeight,
    queryRankWeight: rerankQueryRankWeight,
  });
  const dedupedRows = dedupeRowsById(rerank.rows);
  const effectiveIncludeNonMailLike = includeNonMailLike || pressureFallbackEnabled;
  let { models, skipped } = buildMemoryModels(dedupedRows, {
    sourcePrefixes,
    includeNonMailLike: effectiveIncludeNonMailLike,
    participantNoiseFilter,
  });
  let sourceFilterRelaxed = false;
  if (models.length <= 0 && dedupedRows.length > 0 && !effectiveIncludeNonMailLike && skipped.bySource >= dedupedRows.length) {
    const relaxed = buildMemoryModels(dedupedRows, {
      sourcePrefixes,
      includeNonMailLike: true,
      participantNoiseFilter,
    });
    if (relaxed.models.length > 0) {
      models = relaxed.models;
      skipped = relaxed.skipped;
      sourceFilterRelaxed = true;
    }
  }

  const candidateEdgePoolSize = Math.max(effectiveMaxEdges * 2, effectiveMaxEdges + 16);
  const candidateMotifPoolSize = Math.max(effectiveMaxMotifs * 3, effectiveMaxMotifs + 24);
  const relationshipEdgesPool = buildParticipantPairEdges(models, {
    minEdgeSupport,
    minEdgeConfidence,
    maxEdges: candidateEdgePoolSize,
  });
  const baselineMotifs = buildMotifCandidates(models, {
    minMotifScore,
    maxMotifs: candidateMotifPoolSize,
    minEdgeSupport,
  });
  const decisionFlowMotifs = buildDecisionFlowMotifs(models, {
    minMotifScore,
    maxMotifs: candidateMotifPoolSize,
  });
  const bridgeHubMotifs = buildRelationshipBridgeMotifs(relationshipEdgesPool, {
    minMotifScore,
    maxMotifs: candidateMotifPoolSize,
  });
  const mergedMotifsCore = mergeMotifCandidates(baselineMotifs, decisionFlowMotifs, candidateMotifPoolSize);
  const mergedMotifs = mergeMotifCandidates(mergedMotifsCore, bridgeHubMotifs, candidateMotifPoolSize);
  const noveltyIndex = buildRecentCaptureNoveltyIndex(recentRows, {
    captureSource,
    dedupeWindowDays,
  });
  const noveltyAdjusted = applyNoveltyAdjustments({
    motifs: mergedMotifs,
    edges: relationshipEdgesPool,
    noveltyIndex,
    dedupeWindowDays,
    noveltyWeight,
    refreshConfidenceDelta,
  });
  const motifs = noveltyAdjusted.motifs.slice(0, effectiveMaxMotifs);
  const relationshipEdges = noveltyAdjusted.edges.slice(0, effectiveMaxEdges);
  const generatedCaptureCandidates = buildCandidateCaptures({
    motifs,
    edges: relationshipEdges,
    maxWrites: effectiveMaxWrites,
    captureSource,
    tenantId: tenantId || null,
    runId,
    generatedAt,
  });

  let spoolReplayRows = [];
  let spoolRowsDeferred = [];
  let spoolLoadError = "";
  if (!dryRun && captureFailureSpoolPath && captureSpoolReplayMax > 0) {
    try {
      const loadedRows = readJsonl(captureFailureSpoolPath).filter((row) => isCaptureCandidatePayload(row));
      if (loadedRows.length > 0) {
        const replayBudget = Math.max(
          0,
          Math.min(
            captureSpoolReplayMax,
            effectiveMaxWrites > 0
              ? Math.max(1, Math.floor(effectiveMaxWrites * captureSpoolReplayRatio))
              : 0
          )
        );
        spoolReplayRows = loadedRows.slice(0, replayBudget);
        spoolRowsDeferred = loadedRows.slice(replayBudget);
      }
    } catch (error) {
      spoolLoadError = error instanceof Error ? error.message : String(error);
    }
  }

  const mergedCandidatesInput = [...spoolReplayRows, ...generatedCaptureCandidates];
  const captureCandidates = [];
  const skippedDuplicates = new Set();
  const seenCandidateIds = new Set();
  const candidateOverflow = [];
  for (const candidate of mergedCandidatesInput) {
    if (!isCaptureCandidatePayload(candidate)) continue;
    const key = String(candidate.clientRequestId || "").trim();
    if (!key) continue;
    if (seenCandidateIds.has(key)) {
      skippedDuplicates.add(key);
      continue;
    }
    seenCandidateIds.add(key);
    if (captureCandidates.length < effectiveMaxWrites) {
      captureCandidates.push(candidate);
    } else {
      candidateOverflow.push(
        annotateSpoolCandidate(candidate, {
          reason: "deferred-max-write-budget",
          deferredAt: generatedAt,
          runId,
        })
      );
    }
  }
  if (candidateOverflow.length > 0) {
    spoolRowsDeferred = [...spoolRowsDeferred, ...candidateOverflow];
  }

  writeJsonl(previewPath, captureCandidates);

  let written = 0;
  let attempted = 0;
  let failed = 0;
  let timeoutErrors = 0;
  let recoverableWriteErrors = 0;
  let fatalWriteErrors = 0;
  let requestRetries = 0;
  let motifWrites = 0;
  let relationshipWrites = 0;
  let consecutiveWriteFailures = 0;
  let circuitBreakerTriggered = false;
  let circuitBreakerAtIndex = -1;
  const circuitBreakerTriggeredAt = new Date().toISOString();
  const writeErrors = [];
  const spooledCandidates = [...spoolRowsDeferred];
  let spoolWriteError = "";
  let spoolRowsTrimmed = 0;

  if (!dryRun) {
    for (let index = 0; index < captureCandidates.length; index += 1) {
      const candidate = captureCandidates[index];
      attempted += 1;
      const outcome = await writeCaptureCandidateWithRetries({
        baseUrl,
        authState,
        adminToken,
        candidate,
        timeoutMs,
        retryAttempts: captureWriteRetries,
        retryDelayMs: captureWriteRetryDelayMs,
        retryBackoffFactor: captureWriteRetryBackoffFactor,
        retryMaxDelayMs: captureWriteRetryMaxDelayMs,
      });
      requestRetries += Math.max(0, outcome.attempts - 1);
      if (outcome.ok) {
        consecutiveWriteFailures = 0;
        written += 1;
        const analysisType = String(candidate?.metadata?.analysisType ?? "");
        if (analysisType === "experimental-context-motif") motifWrites += 1;
        if (analysisType === "experimental-context-relationship") relationshipWrites += 1;
      } else {
        consecutiveWriteFailures += 1;
        failed += 1;
        const message = String(outcome.message || `HTTP ${outcome.status || 0}`);
        writeErrors.push({
          index,
          clientRequestId: candidate.clientRequestId,
          status: outcome.status,
          message,
          attempts: outcome.attempts,
        });
        if (outcome.recoverable) {
          recoverableWriteErrors += 1;
          timeoutErrors += 1;
        } else {
          fatalWriteErrors += 1;
        }
        spooledCandidates.push(
          annotateSpoolCandidate(candidate, {
            reason: "capture-write-failed",
            failedAt: new Date().toISOString(),
            status: outcome.status,
            message,
            attempts: outcome.attempts,
            runId,
          })
        );
        if (
          captureFailureCircuitBreakerThreshold > 0
          && consecutiveWriteFailures >= captureFailureCircuitBreakerThreshold
        ) {
          circuitBreakerTriggered = true;
          circuitBreakerAtIndex = index;
          for (let pendingIndex = index + 1; pendingIndex < captureCandidates.length; pendingIndex += 1) {
            const pendingCandidate = captureCandidates[pendingIndex];
            spooledCandidates.push(
              annotateSpoolCandidate(pendingCandidate, {
                reason: "capture-circuit-breaker-deferred",
                deferredAt: circuitBreakerTriggeredAt,
                triggerFailureCount: consecutiveWriteFailures,
                triggerIndex: index,
                runId,
              })
            );
          }
          break;
        }
      }
      if (writeDelayMs > 0 && index < captureCandidates.length - 1 && !circuitBreakerTriggered) {
        await sleep(writeDelayMs);
      }
    }
  }

  if (!dryRun && captureFailureSpoolPath) {
    try {
      const bounded = spooledCandidates.slice(0, Math.max(0, captureSpoolMaxRows));
      spoolRowsTrimmed = Math.max(0, spooledCandidates.length - bounded.length);
      writeJsonl(captureFailureSpoolPath, bounded);
    } catch (error) {
      spoolWriteError = error instanceof Error ? error.message : String(error);
      writeErrors.push({
        kind: "capture-spool-write-failed",
        status: 0,
        message: spoolWriteError,
      });
    }
  }

  let stopReason = "target-reached";
  if (models.length <= 0) {
    stopReason = "no-source-rows";
  } else if (captureCandidates.length <= 0) {
    stopReason = "no-candidates";
  } else if (dryRun) {
    stopReason = "dry-run";
  } else if (circuitBreakerTriggered && written > 0) {
    stopReason = "circuit-breaker-open";
  } else if (failed > 0 && written <= 0) {
    stopReason = "write-failures";
  } else if (
    captureCandidates.length >= effectiveMaxWrites &&
    (motifs.length + relationshipEdges.length) > captureCandidates.length
  ) {
    stopReason = "max-writes-reached";
  }

  const message =
    stopReason === "no-source-rows"
      ? "No usable source rows were available for context indexing."
      : stopReason === "no-candidates"
        ? "No high-signal context motifs or relationship candidates exceeded thresholds."
        : `${motifs.length} motifs and ${relationshipEdges.length} relationship candidates evaluated; novelty suppressed ${
            noveltyAdjusted.telemetry.suppressedCandidates
          } near-duplicate candidates; ${
            dryRun ? "dry-run preview generated" : `${written} captures written`
          }${
            circuitBreakerTriggered
              ? `; capture circuit breaker opened after ${captureFailureCircuitBreakerThreshold} consecutive failures`
              : ""
          }.`;
  const recentFetchRecoverable = Boolean(
    recentFetchError && /timeout|aborted|request-failed|connect|temporarily|deferred/i.test(recentFetchError)
  );
  const recentFetchFatal = Boolean(recentFetchError && !recentFetchRecoverable);

  const report = {
    ok: stopReason !== "write-failures",
    generatedAt,
    config: {
      baseUrl,
      tenantId: tenantId || null,
      dryRun,
      recentLimit,
      searchLimit,
      searchSeedLimit,
      maxSearchQueries,
      rerankTopK,
      rerankSignalWeight,
      rerankRecencyWeight,
      rerankSeedOverlapWeight,
      rerankQueryRankWeight,
      maxConsecutiveSearchFailures,
      recentRetries,
      recentRetryDelayMs,
      deferOnPressure,
      pressureTimeoutMs,
      pressureFallbackMode,
      pressureFallbackRecentLimit,
      pressureFallbackSearchLimit,
      pressureFallbackSearchSeedLimit,
      pressureFallbackMaxSearchQueries,
      pressureFallbackRerankTopK,
      pressureFallbackMaxMotifs,
      pressureFallbackMaxEdges,
      pressureFallbackMaxWrites,
      pressureFallbackHardRatio,
      minTermFrequency,
      sourcePrefixes,
      includeNonMailLike,
      participantNoiseFilter,
      allowSearchOnlyOnRecentFailure,
      minEdgeSupport,
      minEdgeConfidence,
      minMotifScore,
      dedupeWindowDays,
      noveltyWeight,
      refreshConfidenceDelta,
      maxMotifs,
      maxEdges,
      maxWrites,
      writeDelayMs,
      captureWriteRetries,
      captureWriteRetryDelayMs,
      captureWriteRetryBackoffFactor,
      captureWriteRetryMaxDelayMs,
      captureFailureCircuitBreakerThreshold,
      captureFailureSpoolPath: captureFailureSpoolPath || null,
      captureSpoolReplayMax,
      captureSpoolReplayRatio,
      captureSpoolMaxRows,
      captureSource,
      runId,
      timeoutMs,
      effective: {
        recentLimit: effectiveRecentLimit,
        searchLimit: effectiveSearchLimit,
        searchSeedLimit: effectiveSearchSeedLimit,
        maxSearchQueries: effectiveMaxSearchQueries,
        rerankTopK: effectiveRerankTopK,
        maxMotifs: effectiveMaxMotifs,
        maxEdges: effectiveMaxEdges,
        maxWrites: effectiveMaxWrites,
      },
    },
    auth: {
      source: authState.source,
    },
    pressure: {
      deferred: false,
      mode: pressureFallbackEnabled ? "fallback-minimal" : "normal",
      thresholdReached: pressureThresholdReached,
      ratio: Number(pressureRatio.toFixed(4)),
      snapshot: pressureSnapshot,
    },
    telemetry: {
      recentRows: recentRows.length,
      recentFetchError: recentFetchError || null,
      searchQueriesAttempted: searchDiagnostics.length,
      searchQueriesFailed: searchDiagnostics.filter((row) => !row.ok).length,
      rerank: rerank.telemetry,
      novelty: noveltyAdjusted.telemetry,
      gatheredRows: retrievalRows.length,
      dedupedRows: dedupedRows.length,
      scanned: models.length,
      skipped,
      sourceFilterRelaxed,
      spoolReplayLoaded: spoolReplayRows.length,
      spoolDeferredPreRun: spoolRowsDeferred.length,
      spoolOverflowDeferred: candidateOverflow.length,
      spoolLoadError: spoolLoadError || null,
      spoolPath: captureFailureSpoolPath || null,
      spoolPendingAfterRun: !dryRun && captureFailureSpoolPath ? Math.min(spooledCandidates.length, captureSpoolMaxRows) : null,
      spoolRowsTrimmed,
      spoolWriteError: spoolWriteError || null,
      captureCircuitBreakerTriggered: circuitBreakerTriggered,
      captureCircuitBreakerIndex: circuitBreakerAtIndex,
      captureSkippedDuplicateCandidates: skippedDuplicates.size,
      previewPath,
      reportPath,
    },
    totals: {
      scanned: models.length,
      eligible: captureCandidates.length,
      updated: written,
      failed,
      timeoutErrors,
      alreadyIndexedSkipped: 0,
      relationshipProbes: relationshipEdges.length,
      relationshipMemoriesAugmented: relationshipEdges.length > 0 ? Math.min(models.length, relationshipEdges.length * 2) : 0,
      relationshipEdgesAdded: relationshipWrites,
      relationshipEdgesCaptured: relationshipWrites,
      relationshipCandidates: relationshipEdges.length,
      motifsDetected: motifs.length,
      decisionFlowMotifsDetected: decisionFlowMotifs.length,
      bridgeHubMotifsDetected: bridgeHubMotifs.length,
      noveltySuppressedCandidates: noveltyAdjusted.telemetry.suppressedCandidates,
      noveltyReusedKeys: noveltyAdjusted.telemetry.reusedKeys,
      noveltyAvgScore: noveltyAdjusted.telemetry.avgNoveltyScore,
      rerankRowsInput: rerank.telemetry.inputRows,
      rerankRowsRetained: rerank.telemetry.retainedRows,
      rerankSignalDominantRows: rerank.telemetry.signalDominantRows,
      rerankAvgSeedOverlap: rerank.telemetry.avgSeedOverlap,
      rerankAvgScore: rerank.telemetry.avgFinalScore,
      searchQueriesAttempted: searchDiagnostics.length,
      searchQueriesFailed: searchDiagnostics.filter((row) => !row.ok).length,
      capturesAttempted: attempted,
      capturesWritten: written,
      capturesQueuedForRetry: !dryRun && captureFailureSpoolPath ? Math.min(spooledCandidates.length, captureSpoolMaxRows) : 0,
      requestRetries,
      recoverableHttpErrors:
        searchDiagnostics.filter((row) => !row.ok && (row.status === 0 || row.status >= 500)).length +
        (recentFetchRecoverable ? 1 : 0) +
        recoverableWriteErrors,
      fatalHttpErrors:
        searchDiagnostics.filter((row) => !row.ok && row.status > 0 && row.status < 500).length +
        (recentFetchFatal ? 1 : 0) +
        fatalWriteErrors,
      searchQueriesDegraded: searchDiagnostics.filter((row) => row.degradationApplied).length,
      searchQueriesDeferred: searchDiagnostics.filter((row) => row.deferredByServer).length,
      searchDegradationRate:
        searchDiagnostics.length > 0
          ? Number(
              (
                searchDiagnostics.filter((row) => row.degradationApplied).length / Math.max(1, searchDiagnostics.length)
              ).toFixed(4)
            )
          : 0,
      downshiftCount: 0,
      cooldownCount: 0,
    },
    phases: [
      {
        phaseName: "experimental-context-index",
        stopReason,
        last: {
          wave: 1,
          ok: stopReason !== "write-failures",
          scanned: models.length,
          eligible: captureCandidates.length,
          updated: written,
          failed,
          circuitBreakerTriggered,
          motifsDetected: motifs.length,
          relationshipCandidates: relationshipEdges.length,
          relationshipEdgesAdded: relationshipWrites,
          message,
        },
      },
    ],
    sample: {
      topMotifs: motifs.slice(0, 6),
      topBridgeHubMotifs: bridgeHubMotifs.slice(0, 6),
      topRelationshipEdges: relationshipEdges.slice(0, 8),
      topRerankedRows: rerank.telemetry.topRows.slice(0, 10),
      capturePreview: captureCandidates.slice(0, 10).map((row) => ({
        clientRequestId: row.clientRequestId,
        analysisType: row.metadata.analysisType,
        content: row.content,
        tags: row.tags,
      })),
    },
    searchDiagnostics,
    errors: [
      ...(recentFetchError
        ? [
            {
              kind: "recent-fetch-failed",
              message: recentFetchError,
              fallbackModeApplied: allowSearchOnlyOnRecentFailure,
            },
          ]
        : []),
      ...(spoolLoadError
        ? [
            {
              kind: "capture-spool-load-failed",
              message: spoolLoadError,
            },
          ]
        : []),
      ...writeErrors.slice(0, 40),
    ],
  };

  writeJson(reportPath, report);

  if (printJson) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return;
  }

  process.stdout.write(
    `${JSON.stringify(
      {
        ok: report.ok,
        reportPath,
        previewPath,
        stopReason,
        totals: report.totals,
      },
      null,
      2
    )}\n`
  );
}

main().catch((error) => {
  process.stderr.write(`open-memory-context-experimental-index failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
