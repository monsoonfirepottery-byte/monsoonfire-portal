#!/usr/bin/env node

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
const DEFAULT_PREVIEW_PATH = resolve(REPO_ROOT, "output", "open-memory", "context-experimental-candidates.jsonl");
const DEFAULT_REPORT_PATH = resolve(REPO_ROOT, "output", "open-memory", "context-experimental-capture-latest.json");

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

function readString(flags, key, fallback = "") {
  const raw = String(flags[key] ?? "").trim();
  return raw || fallback;
}

function readNumber(flags, key, fallback, { min = -Number.MAX_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER } = {}) {
  const raw = String(flags[key] ?? "").trim();
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function sleep(ms) {
  return new Promise((resolveSleep) => {
    setTimeout(resolveSleep, Math.max(0, ms));
  });
}

function isRecoverableCaptureFailure(status, message) {
  const normalized = String(message ?? "").toLowerCase();
  if (status === 0 || status === 408 || status === 425 || status === 429) return true;
  if (status >= 500 && status <= 599) return true;
  return /request-failed|timeout|timed out|aborted|connect|temporarily unavailable|econn|socket hang up/.test(normalized);
}

function computeRetryDelayMs({ attemptIndex, baseDelayMs, backoffFactor, maxDelayMs }) {
  const base = Math.max(0, baseDelayMs);
  const safeFactor = Math.max(1, backoffFactor);
  const delay = base * Math.pow(safeFactor, Math.max(0, attemptIndex - 1));
  return Math.round(Math.min(Math.max(1, maxDelayMs), Math.max(1, delay)));
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

function readJsonl(path) {
  if (!existsSync(path)) {
    throw new Error(`Preview JSONL not found: ${path}`);
  }
  const raw = readFileSync(path, "utf8");
  const rows = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === "object") {
        rows.push(parsed);
      }
    } catch {}
  }
  return rows;
}

function normalizeCandidate(raw) {
  if (!raw || typeof raw !== "object") return null;
  const content = String(raw.content ?? "").trim();
  const source = String(raw.source ?? "open-memory:experimental-context-index").trim();
  if (!content || !source) return null;
  const tags = Array.isArray(raw.tags) ? raw.tags.map((value) => String(value ?? "").trim()).filter(Boolean).slice(0, 32) : [];
  const metadata = raw.metadata && typeof raw.metadata === "object" && !Array.isArray(raw.metadata) ? raw.metadata : {};
  const clientRequestId = String(raw.clientRequestId ?? "").trim();
  const tenantId = raw.tenantId === null || raw.tenantId === undefined ? undefined : String(raw.tenantId).trim() || undefined;
  const runId = String(raw.runId ?? "").trim() || undefined;
  const sourceConfidence = Number(raw.sourceConfidence ?? 0.7);
  const importance = Number(raw.importance ?? 0.7);
  const occurredAt = typeof raw.occurredAt === "string" && raw.occurredAt.trim() ? raw.occurredAt.trim() : undefined;

  return {
    content,
    source,
    tags,
    metadata,
    clientRequestId: clientRequestId || undefined,
    tenantId,
    runId,
    sourceConfidence: Number.isFinite(sourceConfidence) ? Math.max(0, Math.min(1, sourceConfidence)) : 0.7,
    importance: Number.isFinite(importance) ? Math.max(0, Math.min(1, importance)) : 0.7,
    occurredAt,
  };
}

function dedupeCandidates(rows) {
  const deduped = [];
  const seen = new Set();
  for (const row of rows) {
    const normalized = normalizeCandidate(row);
    if (!normalized) continue;
    const key = normalized.clientRequestId || `${normalized.source}|${normalized.content.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(normalized);
  }
  return deduped;
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

async function requestCapture(baseUrl, authHeader, adminToken, body, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${baseUrl}/api/memory/capture`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: authHeader,
        ...(adminToken ? { "x-studio-brain-admin-token": adminToken } : {}),
      },
      body: JSON.stringify(body),
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

async function requestPressure(baseUrl, authHeader, adminToken, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${baseUrl}/api/memory/pressure`, {
      method: "GET",
      headers: {
        authorization: authHeader,
        ...(adminToken ? { "x-studio-brain-admin-token": adminToken } : {}),
      },
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
      pressure: payload?.pressure ?? null,
      message: String(payload?.message ?? ""),
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      pressure: null,
      message: `request-failed:${error instanceof Error ? error.message : String(error)}`,
    };
  } finally {
    clearTimeout(timeout);
  }
}

function shouldDeferOnPressure(snapshot) {
  const pressure = snapshot?.pressure;
  if (!pressure || typeof pressure !== "object") return false;
  const activeImports = Number(pressure.activeImportRequests ?? 0);
  const maxImports = Number(pressure.thresholds?.maxActiveImportsBeforeBackfill ?? 0);
  return maxImports > 0 && activeImports >= maxImports;
}

function writeJson(path, payload) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  if (readBool(flags, "help", false)) {
    process.stdout.write(
      [
        "Open Memory Experimental Context Capture",
        "",
        "Usage:",
        "  node ./scripts/open-memory-context-experimental-capture.mjs --json true",
        "",
        "Options:",
        "  --preview-path <path>                    Candidate preview jsonl path",
        "  --base-url <url>                         Studio Brain base URL override",
        "  --admin-token <token>                    Optional admin token override",
        "  --max-writes <n>                         Max candidates written (default: 120)",
        "  --request-retries <n>                    Retry attempts for recoverable capture failures (default: 2)",
        "  --retry-delay-ms <n>                     Base delay for capture retries (default: 1000)",
        "  --retry-backoff-factor <n>               Backoff factor for capture retries (default: 2)",
        "  --retry-max-delay-ms <n>                 Max delay for capture retries (default: 10000)",
        "  --max-runtime-ms <n>                     Stop run after runtime budget is exceeded (default: 300000)",
        "  --write-delay-ms <n>                     Delay between writes (default: 2)",
        "  --timeout-ms <n>                         Request timeout (default: 30000)",
        "  --defer-on-pressure true|false           Skip writes when import pressure is high (default: true)",
        "  --pressure-timeout-ms <n>                Timeout for pressure endpoint checks (default: 5000)",
        "  --pressure-check-every <n>               Check pressure every N writes (default: 5)",
        "  --dry-run true|false                     Dry run mode (default: false)",
        "  --report <path>                          Report output path",
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

  const previewPath = resolve(REPO_ROOT, readString(flags, "preview-path", DEFAULT_PREVIEW_PATH));
  const baseUrl = readString(
    flags,
    "base-url",
    String(process.env.STUDIO_BRAIN_BASE_URL || resolveStudioBrainBaseUrlFromEnv({ env: process.env }) || "").replace(/\/$/, "")
  );
  if (!baseUrl) {
    throw new Error("Missing Studio Brain base URL. Set --base-url or STUDIO_BRAIN_BASE_URL.");
  }

  const dryRun = readBool(flags, "dry-run", false);
  const maxWrites = readInt(flags, "max-writes", 120, { min: 1, max: 500 });
  const requestRetries = readInt(flags, "request-retries", 2, { min: 0, max: 20 });
  const retryDelayMs = readInt(flags, "retry-delay-ms", 1000, { min: 0, max: 120_000 });
  const retryBackoffFactor = readNumber(flags, "retry-backoff-factor", 2, { min: 1, max: 5 });
  const retryMaxDelayMs = readInt(flags, "retry-max-delay-ms", 10_000, { min: 1, max: 300_000 });
  const maxRuntimeMs = readInt(flags, "max-runtime-ms", 300_000, { min: 10_000, max: 3_600_000 });
  const writeDelayMs = readInt(flags, "write-delay-ms", 2, { min: 0, max: 60_000 });
  const timeoutMs = readInt(flags, "timeout-ms", 30_000, { min: 2000, max: 300_000 });
  const deferOnPressure = readBool(flags, "defer-on-pressure", true);
  const pressureTimeoutMs = readInt(flags, "pressure-timeout-ms", 5000, { min: 1000, max: 120_000 });
  const pressureCheckEvery = readInt(flags, "pressure-check-every", 5, { min: 1, max: 500 });
  const adminToken = readString(flags, "admin-token", String(process.env.STUDIO_BRAIN_ADMIN_TOKEN || "").trim());
  const reportPath = readString(flags, "report", DEFAULT_REPORT_PATH);
  const printJson = readBool(flags, "json", false);

  const rawCandidates = readJsonl(previewPath);
  const candidates = dedupeCandidates(rawCandidates).slice(0, maxWrites);
  const authState = await ensureAuthHeader();
  if (!authState.ok || !authState.authHeader) {
    throw new Error(`Unable to resolve Studio Brain auth token (${authState.reason || "unknown"}).`);
  }

  let written = 0;
  let failed = 0;
  let timeoutErrors = 0;
  let retries = 0;
  const errors = [];
  const startedAtMs = Date.now();
  let stopReason = "completed";
  let runtimeBudgetExceeded = false;
  let pressureDeferred = false;
  let pressureChecks = 0;
  let lastPressureSnapshot = null;

  if (!dryRun) {
    if (deferOnPressure) {
      lastPressureSnapshot = await requestPressure(baseUrl, authState.authHeader, adminToken, pressureTimeoutMs);
      pressureChecks += 1;
      if (shouldDeferOnPressure(lastPressureSnapshot)) {
        pressureDeferred = true;
        stopReason = "pressure-deferred";
      }
    }
    for (let i = 0; i < candidates.length; i += 1) {
      if (pressureDeferred) {
        break;
      }
      if (Date.now() - startedAtMs > maxRuntimeMs) {
        runtimeBudgetExceeded = true;
        stopReason = "runtime-budget-exceeded";
        break;
      }
      if (deferOnPressure && i > 0 && i % pressureCheckEvery === 0) {
        lastPressureSnapshot = await requestPressure(baseUrl, authState.authHeader, adminToken, pressureTimeoutMs);
        pressureChecks += 1;
        if (shouldDeferOnPressure(lastPressureSnapshot)) {
          pressureDeferred = true;
          stopReason = "pressure-deferred";
          break;
        }
      }
      const candidate = candidates[i];
      let response = null;
      for (let attempt = 0; attempt <= requestRetries; attempt += 1) {
        if (Date.now() - startedAtMs > maxRuntimeMs) {
          runtimeBudgetExceeded = true;
          stopReason = "runtime-budget-exceeded";
          break;
        }
        response = await requestCapture(baseUrl, authState.authHeader, adminToken, candidate, timeoutMs);
        if (!response.ok && isExpiredIdTokenResponse(response.status, response.payload)) {
          const minted = await mintAuthHeader();
          if (minted.ok && minted.authHeader) {
            retries += 1;
            authState.authHeader = minted.authHeader;
            response = await requestCapture(baseUrl, authState.authHeader, adminToken, candidate, timeoutMs);
          }
        }
        if (response.ok) {
          break;
        }
        const message = String(response.payload?.message ?? `HTTP ${response.status}`);
        if (attempt >= requestRetries || !isRecoverableCaptureFailure(response.status, message)) {
          break;
        }
        retries += 1;
        const delayMs = computeRetryDelayMs({
          attemptIndex: attempt + 1,
          baseDelayMs: retryDelayMs,
          backoffFactor: retryBackoffFactor,
          maxDelayMs: retryMaxDelayMs,
        });
        await sleep(delayMs);
      }
      if (runtimeBudgetExceeded) {
        break;
      }
      if (!response) {
        response = {
          ok: false,
          status: 0,
          payload: { message: "request-failed:no-response" },
        };
      }
      if (response.ok) {
        written += 1;
      } else {
        failed += 1;
        const message = String(response.payload?.message ?? `HTTP ${response.status}`);
        if (response.status === 0 || /request-failed|timeout|timed out|aborted/i.test(message)) {
          timeoutErrors += 1;
        }
        errors.push({
          index: i,
          clientRequestId: candidate.clientRequestId ?? null,
          status: response.status,
          message,
        });
      }
      if (writeDelayMs > 0 && i < candidates.length - 1) {
        await sleep(writeDelayMs);
      }
    }
  }

  const report = {
    ok: failed === 0,
    generatedAt: new Date().toISOString(),
    config: {
      previewPath,
      baseUrl,
      dryRun,
      maxWrites,
      requestRetries,
      retryDelayMs,
      retryBackoffFactor,
      retryMaxDelayMs,
      maxRuntimeMs,
      writeDelayMs,
      timeoutMs,
      deferOnPressure,
      pressureTimeoutMs,
      pressureCheckEvery,
      reportPath,
    },
    auth: {
      source: authState.source,
    },
    pressure: {
      deferred: pressureDeferred,
      checks: pressureChecks,
      snapshot: lastPressureSnapshot,
    },
    totals: {
      previewRows: rawCandidates.length,
      eligible: candidates.length,
      attempted: dryRun ? 0 : written + failed,
      updated: written,
      failed,
      timeoutErrors,
      retries,
      pressureChecks,
    },
    execution: {
      stopReason,
      runtimeBudgetExceeded,
      pressureDeferred,
      elapsedMs: Date.now() - startedAtMs,
    },
    sample: candidates.slice(0, 10).map((row) => ({
      clientRequestId: row.clientRequestId ?? null,
      analysisType: String(row?.metadata?.analysisType ?? ""),
      source: row.source,
      tags: row.tags,
      content: row.content,
    })),
    errors: errors.slice(0, 40),
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
        totals: report.totals,
      },
      null,
      2
    )}\n`
  );
}

main().catch((error) => {
  process.stderr.write(`open-memory-context-experimental-capture failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
