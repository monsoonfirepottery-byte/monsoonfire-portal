#!/usr/bin/env node

import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { mintStaffIdTokenFromPortalEnv, normalizeBearer } from "./lib/firebase-auth-token.mjs";
import { resolveStudioBrainBaseUrlFromEnv } from "./studio-brain-url-resolution.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..");

const DEFAULT_STUDIO_ENV_PATH = resolve(REPO_ROOT, "secrets", "studio-brain", "studio-brain-automation.env");
const DEFAULT_PORTAL_ENV_PATH = resolve(REPO_ROOT, "secrets", "portal", "portal-automation.env");
const DEFAULT_REPORT_PATH = resolve(REPO_ROOT, "output", "open-memory", "backfill-converge-latest.json");

function parseArgs(argv) {
  const flags = {};
  const positionals = [];
  for (let i = 0; i < argv.length; i += 1) {
    const token = String(argv[i] ?? "");
    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }
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
  return { flags, positionals };
}

function readBoolFlag(flags, name, fallback = false) {
  const raw = String(flags[name] ?? "").trim().toLowerCase();
  if (!raw) return fallback;
  if (["1", "true", "yes", "on"].includes(raw)) return true;
  if (["0", "false", "no", "off"].includes(raw)) return false;
  return fallback;
}

function readIntFlag(flags, name, fallback, { min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number.parseInt(String(flags[name] ?? "").trim(), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function readNumberFlag(flags, name, fallback, { min = -Number.MAX_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER } = {}) {
  const raw = String(flags[name] ?? "").trim();
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function readStringFlag(flags, name, fallback = "") {
  const value = String(flags[name] ?? "").trim();
  return value || fallback;
}

function parseCsv(value) {
  return String(value ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function sleep(ms) {
  return new Promise((resolveSleep) => {
    setTimeout(resolveSleep, Math.max(0, ms));
  });
}

function extractFailureMessage(payload) {
  if (typeof payload?.message === "string" && payload.message.trim()) {
    return payload.message.trim();
  }
  if (typeof payload?.error?.message === "string" && payload.error.message.trim()) {
    return payload.error.message.trim();
  }
  if (typeof payload?.raw === "string" && payload.raw.trim()) {
    return payload.raw.trim();
  }
  return "";
}

function isRecoverableRequestFailure(status, payload) {
  if (status === 0 || status === 408 || status === 425 || status === 429) return true;
  if (status >= 500 && status <= 599) return true;
  const message = extractFailureMessage(payload);
  if (!message) return false;
  return /request-failed|fetch failed|network|econnreset|ecanceled|socket hang up|timeout|temporarily unavailable/i.test(message);
}

function isPressureDeferredFailure(status, payload) {
  if (status !== 503) return false;
  const message = extractFailureMessage(payload);
  return /deferred due current memory ingest pressure/i.test(message);
}

function computeBackoffDelayMs({
  attemptIndex,
  baseDelayMs,
  backoffFactor,
  maxDelayMs,
  jitterMs,
}) {
  const base = Math.max(0, baseDelayMs);
  const factor = Number.isFinite(backoffFactor) ? Math.max(1, backoffFactor) : 1;
  const exponent = Math.max(0, attemptIndex - 1);
  const withoutJitter = Math.min(Math.max(base, 1), Math.max(1, maxDelayMs)) * Math.pow(factor, exponent);
  const capped = Math.min(withoutJitter, Math.max(1, maxDelayMs));
  if (jitterMs <= 0) return Math.round(capped);
  return Math.round(capped + Math.random() * jitterMs);
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
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
    keysLoaded += 1;
  }
  return { attempted: true, loaded: keysLoaded > 0, keysLoaded, filePath };
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

async function requestJson(baseUrl, authHeader, adminToken, path, body, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${baseUrl}${path}`, {
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
    const reason = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      status: 0,
      payload: { message: `request-failed:${reason}` },
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

function normalizeBackfillResult(raw) {
  const result = raw && typeof raw === "object" && raw.result ? raw.result : raw;
  return result && typeof result === "object" ? result : {};
}

async function runPhase({
  phaseName,
  baseUrl,
  authState,
  adminToken,
  path,
  payloadFactory,
  maxWaves,
  noProgressLimit,
  timeoutMs,
  targetRemaining,
  stopAfterTimeoutErrors,
  limit,
  maxWrites,
  requestRetries,
  retryBaseDelayMs,
  retryBackoffFactor,
  retryMaxDelayMs,
  retryJitterMs,
  maxConsecutiveHttpErrors,
  cooldownAfterHttpErrorMs,
  adaptiveDownshiftOnHttpError,
  minWaveLimit,
  minWaveWrites,
  downshiftFactor,
}) {
  const waves = [];
  let noProgress = 0;
  let stopReason = "max-waves";
  let consecutiveHttpErrors = 0;
  let retriesUsedTotal = 0;
  let recoverableHttpErrors = 0;
  let fatalHttpErrors = 0;
  let downshiftCount = 0;
  let cooldownCount = 0;

  const boundedMinWaveLimit = Math.max(1, Math.min(minWaveLimit, limit));
  const boundedMinWaveWrites = Math.max(1, Math.min(minWaveWrites, maxWrites));
  const boundedDownshiftFactor = Math.max(0.1, Math.min(downshiftFactor, 0.99));
  const initialWaveLimit = Math.max(boundedMinWaveLimit, limit);
  const initialWaveWrites = Math.max(boundedMinWaveWrites, maxWrites);

  let currentWaveLimit = initialWaveLimit;
  let currentWaveWrites = initialWaveWrites;

  for (let wave = 1; wave <= maxWaves; wave += 1) {
    const payload = payloadFactory({
      wave,
      waveLimit: currentWaveLimit,
      waveMaxWrites: currentWaveWrites,
    });
    let response = null;
    let retryCount = 0;
    let recoverableHttpError = false;

    for (let attempt = 0; attempt <= requestRetries; attempt += 1) {
      response = await requestJson(baseUrl, authState.authHeader, adminToken, path, payload, timeoutMs);

      if (!response.ok && isExpiredIdTokenResponse(response.status, response.payload)) {
        const minted = await mintAuthHeader();
        if (minted.ok && minted.authHeader) {
          authState.authHeader = minted.authHeader;
          response = await requestJson(baseUrl, authState.authHeader, adminToken, path, payload, timeoutMs);
        }
      }

      if (response.ok) {
        recoverableHttpError = false;
        break;
      }

      recoverableHttpError = isRecoverableRequestFailure(response.status, response.payload);
      if (!recoverableHttpError || attempt >= requestRetries) {
        break;
      }

      retryCount += 1;
      retriesUsedTotal += 1;
      const delayMs = computeBackoffDelayMs({
        attemptIndex: retryCount,
        baseDelayMs: retryBaseDelayMs,
        backoffFactor: retryBackoffFactor,
        maxDelayMs: retryMaxDelayMs,
        jitterMs: retryJitterMs,
      });
      await sleep(delayMs);
    }

    if (!response) {
      response = {
        ok: false,
        status: 0,
        payload: { message: "request-failed:no-response" },
      };
    }

    const result = normalizeBackfillResult(response.payload);
    const row = {
      wave,
      ok: response.ok,
      httpStatus: response.status,
      scanned: Number(result.scanned ?? 0),
      eligible: Number(result.eligible ?? 0),
      updated: Number(result.updated ?? 0),
      skipped: Number(result.skipped ?? 0),
      failed: Number(result.failed ?? 0),
      writesAttempted: Number(result.writesAttempted ?? 0),
      timeoutErrors: Number(result.timeoutErrors ?? 0),
      alreadyIndexedSkipped: Number(result.alreadyIndexedSkipped ?? 0),
      relationshipProbes: Number(result.relationshipInference?.probes ?? 0),
      relationshipMemoriesAugmented: Number(result.relationshipInference?.memoriesAugmented ?? 0),
      relationshipEdgesAdded: Number(result.relationshipInference?.inferredEdgesAdded ?? 0),
      retryCount,
      requestAttempts: retryCount + 1,
      recoverableHttpError,
      pressureDeferred: isPressureDeferredFailure(response.status, response.payload),
      effectiveLimit: Number(payload.limit ?? currentWaveLimit),
      effectiveMaxWrites: Number(payload.maxWrites ?? currentWaveWrites),
      stopReason: result.stopReason ?? null,
      convergence: result.convergence ?? null,
      message: response.ok ? "" : String(response.payload?.message ?? `HTTP ${response.status}`),
    };
    waves.push(row);

    if (!response.ok) {
      consecutiveHttpErrors += 1;
      if (recoverableHttpError) {
        recoverableHttpErrors += 1;
      } else {
        fatalHttpErrors += 1;
      }

      if (adaptiveDownshiftOnHttpError && recoverableHttpError) {
        const nextWaveLimit = Math.max(boundedMinWaveLimit, Math.floor(currentWaveLimit * boundedDownshiftFactor));
        const nextWaveWrites = Math.max(boundedMinWaveWrites, Math.floor(currentWaveWrites * boundedDownshiftFactor));
        if (nextWaveLimit < currentWaveLimit || nextWaveWrites < currentWaveWrites) {
          downshiftCount += 1;
        }
        currentWaveLimit = nextWaveLimit;
        currentWaveWrites = nextWaveWrites;
      }

      if (!recoverableHttpError) {
        stopReason = `http-error:${response.status}`;
        break;
      }

      if (row.pressureDeferred) {
        stopReason = "pressure-deferred";
        break;
      }

      if (consecutiveHttpErrors >= maxConsecutiveHttpErrors) {
        stopReason = `http-error-threshold:${response.status}`;
        break;
      }

      if (cooldownAfterHttpErrorMs > 0) {
        cooldownCount += 1;
        await sleep(cooldownAfterHttpErrorMs);
      }
      continue;
    }

    consecutiveHttpErrors = 0;

    const remaining = Math.max(0, row.eligible - row.updated);
    if (remaining <= targetRemaining) {
      stopReason = "target-reached";
      break;
    }
    if (row.timeoutErrors >= stopAfterTimeoutErrors) {
      stopReason = "timeout-threshold";
      break;
    }
    if (row.updated <= 0) {
      noProgress += 1;
    } else {
      noProgress = 0;
    }
    if (noProgress >= noProgressLimit) {
      stopReason = "no-progress";
      break;
    }
    if (typeof row.stopReason === "string" && row.stopReason.length > 0 && row.stopReason !== "max-writes-reached") {
      stopReason = `phase-stop:${row.stopReason}`;
      break;
    }

    if (adaptiveDownshiftOnHttpError) {
      if (currentWaveLimit < initialWaveLimit) {
        const limitGap = initialWaveLimit - currentWaveLimit;
        const limitStep = Math.max(1, Math.floor(limitGap * 0.35));
        currentWaveLimit = Math.min(initialWaveLimit, currentWaveLimit + limitStep);
      }
      if (currentWaveWrites < initialWaveWrites) {
        const writesGap = initialWaveWrites - currentWaveWrites;
        const writesStep = Math.max(1, Math.floor(writesGap * 0.35));
        currentWaveWrites = Math.min(initialWaveWrites, currentWaveWrites + writesStep);
      }
    }
  }

  const last = waves[waves.length - 1] ?? null;
  return {
    phaseName,
    waves,
    stopReason,
    last,
    stats: {
      retriesUsedTotal,
      recoverableHttpErrors,
      fatalHttpErrors,
      downshiftCount,
      cooldownCount,
      finalWaveLimit: currentWaveLimit,
      finalWaveWrites: currentWaveWrites,
    },
  };
}

function usage() {
  process.stdout.write(
    [
      "Open Memory Backfill Converge",
      "",
      "Usage:",
      "  node ./scripts/open-memory-backfill-converge.mjs [--mode all] [--dry-run false] [--json true]",
      "",
      "Options:",
      "  --mode <all|email|mail-signal|global-signal>   Default: all",
      "  --tenant-id <id>                                Optional tenant id",
      "  --base-url <url>                                Studio Brain base URL override",
      "  --admin-token <token>                           Optional x-studio-brain-admin-token override",
      "  --limit <n>                                     Backfill scan limit per wave (default: 2000)",
      "  --max-waves <n>                                 Waves per phase (default: 20; dry-run forces 1)",
      "  --max-writes <n>                                Max writes per wave (default: 500)",
      "  --write-delay-ms <n>                            Delay between writes (default: 8)",
      "  --timeout-ms <n>                                HTTP request timeout (default: 300000)",
      "  --no-progress-limit <n>                         Stop phase after N zero-update waves (default: 2)",
      "  --target-remaining <n>                          Target remaining eligible rows per wave (default: 0)",
      "  --stop-after-timeout-errors <n>                 Timeout breaker threshold (default: 5)",
      "  --source-prefixes mail:,email                   Source prefix hints",
      "  --min-signals <n>                               Minimum signals for signal-index phase (default: 1)",
      "  --include-loop-state-updates true|false         Default: true",
      "  --skip-already-indexed true|false               Default: true",
      "  --infer-relationships true|false                Enable related-memory edge inference (default: true)",
      "  --relationship-probe-limit <n>                  Related rows inspected per inference stage (default: 24)",
      "  --max-inferred-edges-per-memory <n>             Added edge cap per memory (default: 16)",
      "  --min-related-signal-score <n>                  Context-overlap inference threshold (default: 0.12)",
      "  --request-retries <n>                            Retries for recoverable HTTP failures per wave (default: 3)",
      "  --retry-base-delay-ms <n>                        Base delay for wave retries (default: 2500)",
      "  --retry-backoff-factor <n>                       Retry backoff factor (default: 1.9)",
      "  --retry-max-delay-ms <n>                         Max retry delay (default: 45000)",
      "  --retry-jitter-ms <n>                            Added retry jitter (default: 750)",
      "  --max-consecutive-http-errors <n>                Stop phase after N consecutive recoverable HTTP errors (default: 4)",
      "  --cooldown-after-http-error-ms <n>               Wait before next wave after recoverable HTTP error (default: 12000)",
      "  --adaptive-downshift-on-http-error true|false    Reduce wave load after recoverable HTTP errors (default: true)",
      "  --min-wave-limit <n>                             Floor for adaptive limit downshift (default: 200)",
      "  --min-wave-writes <n>                            Floor for adaptive max-writes downshift (default: 50)",
      "  --downshift-factor <n>                           Multiplier applied on adaptive downshift (default: 0.6)",
      "  --dry-run true|false                            Default: false",
      "  --report <path>                                 Report output path",
      "  --json true|false                               Print report JSON",
      "  --help                                           Show help",
    ].join("\n")
  );
}

async function main() {
  const { flags } = parseArgs(process.argv.slice(2));
  if (readBoolFlag(flags, "help", false)) {
    usage();
    return;
  }

  const loadStudioEnv = readBoolFlag(flags, "load-env-file", true);
  const loadPortalEnv = readBoolFlag(flags, "load-portal-env-file", true);
  const studioEnvPath = readStringFlag(flags, "env-file", DEFAULT_STUDIO_ENV_PATH);
  const portalEnvPath = readStringFlag(flags, "portal-env-file", DEFAULT_PORTAL_ENV_PATH);
  if (loadStudioEnv) {
    loadEnvFile(studioEnvPath);
  }
  if (loadPortalEnv) {
    loadEnvFile(portalEnvPath);
  }

  const baseUrl = readStringFlag(
    flags,
    "base-url",
    String(process.env.STUDIO_BRAIN_BASE_URL || resolveStudioBrainBaseUrlFromEnv({ env: process.env }) || "").replace(/\/$/, "")
  );
  if (!baseUrl) {
    throw new Error("Missing Studio Brain base URL. Set --base-url or STUDIO_BRAIN_BASE_URL.");
  }
  process.env.STUDIO_BRAIN_BASE_URL = baseUrl;

  const authState = await ensureAuthHeader();
  if (!authState.ok || !authState.authHeader) {
    throw new Error(`Unable to resolve Studio Brain auth token (${authState.reason || "unknown"}).`);
  }

  const mode = readStringFlag(flags, "mode", "all").toLowerCase();
  const adminToken = readStringFlag(flags, "admin-token", String(process.env.STUDIO_BRAIN_ADMIN_TOKEN || "").trim());
  const dryRun = readBoolFlag(flags, "dry-run", false);
  const limit = readIntFlag(flags, "limit", 2000, { min: 1, max: 20000 });
  const maxWaves = dryRun ? 1 : readIntFlag(flags, "max-waves", 20, { min: 1, max: 200 });
  const maxWrites = readIntFlag(flags, "max-writes", 500, { min: 1, max: 20000 });
  const writeDelayMs = readIntFlag(flags, "write-delay-ms", 8, { min: 0, max: 60000 });
  const timeoutMs = readIntFlag(flags, "timeout-ms", 300000, { min: 5000, max: 1800000 });
  const noProgressLimit = readIntFlag(flags, "no-progress-limit", 2, { min: 1, max: 20 });
  const targetRemaining = readIntFlag(flags, "target-remaining", 0, { min: 0, max: 20000 });
  const stopAfterTimeoutErrors = readIntFlag(flags, "stop-after-timeout-errors", 5, { min: 1, max: 100 });
  const minSignals = readIntFlag(flags, "min-signals", 1, { min: 1, max: 512 });
  const includeLoopStateUpdates = readBoolFlag(flags, "include-loop-state-updates", true);
  const skipAlreadyIndexed = readBoolFlag(flags, "skip-already-indexed", true);
  const inferRelationships = readBoolFlag(flags, "infer-relationships", true);
  const relationshipProbeLimit = readIntFlag(flags, "relationship-probe-limit", 24, { min: 2, max: 128 });
  const maxInferredEdgesPerMemory = readIntFlag(flags, "max-inferred-edges-per-memory", 16, { min: 0, max: 128 });
  const minRelatedSignalScore = readNumberFlag(flags, "min-related-signal-score", 0.12, { min: 0, max: 2 });
  const requestRetries = readIntFlag(flags, "request-retries", 3, { min: 0, max: 25 });
  const retryBaseDelayMs = readIntFlag(flags, "retry-base-delay-ms", 2500, { min: 0, max: 300000 });
  const retryBackoffFactor = readNumberFlag(flags, "retry-backoff-factor", 1.9, { min: 1, max: 4 });
  const retryMaxDelayMs = readIntFlag(flags, "retry-max-delay-ms", 45000, { min: 1, max: 600000 });
  const retryJitterMs = readIntFlag(flags, "retry-jitter-ms", 750, { min: 0, max: 120000 });
  const maxConsecutiveHttpErrors = readIntFlag(flags, "max-consecutive-http-errors", 4, { min: 1, max: 100 });
  const cooldownAfterHttpErrorMs = readIntFlag(flags, "cooldown-after-http-error-ms", 12000, { min: 0, max: 900000 });
  const adaptiveDownshiftOnHttpError = readBoolFlag(flags, "adaptive-downshift-on-http-error", true);
  const minWaveLimit = readIntFlag(flags, "min-wave-limit", 200, { min: 1, max: 20000 });
  const minWaveWrites = readIntFlag(flags, "min-wave-writes", 50, { min: 1, max: 20000 });
  const downshiftFactor = readNumberFlag(flags, "downshift-factor", 0.6, { min: 0.1, max: 0.99 });
  const tenantId = readStringFlag(flags, "tenant-id", "");
  const sourcePrefixes = parseCsv(readStringFlag(flags, "source-prefixes", "mail:,email"));
  const reportPath = readStringFlag(flags, "report", DEFAULT_REPORT_PATH);

  const shouldRunEmailThreading = mode === "all" || mode === "email" || mode === "mail-signal";
  const shouldRunMailSignal = mode === "all" || mode === "mail-signal";
  const shouldRunGlobalSignal = mode === "all" || mode === "global-signal";

  const phaseResults = [];
  if (shouldRunEmailThreading) {
    phaseResults.push(
      await runPhase({
        phaseName: "email-threading",
        baseUrl,
        authState,
        adminToken,
        path: "/api/memory/backfill-email-threading",
        maxWaves,
        noProgressLimit,
        timeoutMs,
        targetRemaining,
        stopAfterTimeoutErrors,
        limit,
        maxWrites,
        requestRetries,
        retryBaseDelayMs,
        retryBackoffFactor,
        retryMaxDelayMs,
        retryJitterMs,
        maxConsecutiveHttpErrors,
        cooldownAfterHttpErrorMs,
        adaptiveDownshiftOnHttpError,
        minWaveLimit,
        minWaveWrites,
        downshiftFactor,
        payloadFactory: ({ waveLimit, waveMaxWrites }) => ({
          tenantId: tenantId || undefined,
          limit: waveLimit,
          dryRun,
          sourcePrefixes,
          includeNonMailLikeWithMessageSignals: false,
          maxWrites: waveMaxWrites,
          writeDelayMs,
          stopAfterTimeoutErrors,
        }),
      })
    );
  }

  if (shouldRunMailSignal) {
    phaseResults.push(
      await runPhase({
        phaseName: "signal-indexing-mail",
        baseUrl,
        authState,
        adminToken,
        path: "/api/memory/backfill-signal-indexing",
        maxWaves,
        noProgressLimit,
        timeoutMs,
        targetRemaining,
        stopAfterTimeoutErrors,
        limit,
        maxWrites,
        requestRetries,
        retryBaseDelayMs,
        retryBackoffFactor,
        retryMaxDelayMs,
        retryJitterMs,
        maxConsecutiveHttpErrors,
        cooldownAfterHttpErrorMs,
        adaptiveDownshiftOnHttpError,
        minWaveLimit,
        minWaveWrites,
        downshiftFactor,
        payloadFactory: ({ waveLimit, waveMaxWrites }) => ({
          tenantId: tenantId || undefined,
          limit: waveLimit,
          dryRun,
          sourcePrefixes,
          includeNonMailLike: false,
          minSignals,
          skipAlreadyIndexed,
          includeLoopStateUpdates,
          inferRelationships,
          relationshipProbeLimit,
          maxInferredEdgesPerMemory,
          minRelatedSignalScore,
          maxWrites: waveMaxWrites,
          writeDelayMs,
          stopAfterTimeoutErrors,
        }),
      })
    );
  }

  if (shouldRunGlobalSignal) {
    phaseResults.push(
      await runPhase({
        phaseName: "signal-indexing-global",
        baseUrl,
        authState,
        adminToken,
        path: "/api/memory/backfill-signal-indexing",
        maxWaves,
        noProgressLimit,
        timeoutMs,
        targetRemaining,
        stopAfterTimeoutErrors,
        limit,
        maxWrites,
        requestRetries,
        retryBaseDelayMs,
        retryBackoffFactor,
        retryMaxDelayMs,
        retryJitterMs,
        maxConsecutiveHttpErrors,
        cooldownAfterHttpErrorMs,
        adaptiveDownshiftOnHttpError,
        minWaveLimit,
        minWaveWrites,
        downshiftFactor,
        payloadFactory: ({ waveLimit, waveMaxWrites }) => ({
          tenantId: tenantId || undefined,
          limit: waveLimit,
          dryRun,
          sourcePrefixes,
          includeNonMailLike: true,
          minSignals,
          skipAlreadyIndexed,
          includeLoopStateUpdates,
          inferRelationships,
          relationshipProbeLimit,
          maxInferredEdgesPerMemory,
          minRelatedSignalScore,
          maxWrites: waveMaxWrites,
          writeDelayMs,
          stopAfterTimeoutErrors,
        }),
      })
    );
  }

  const totals = phaseResults.reduce(
    (acc, phase) => {
      for (const row of phase.waves) {
        acc.scanned += Number(row.scanned ?? 0);
        acc.eligible += Number(row.eligible ?? 0);
        acc.updated += Number(row.updated ?? 0);
        acc.failed += Number(row.failed ?? 0);
        acc.timeoutErrors += Number(row.timeoutErrors ?? 0);
        acc.alreadyIndexedSkipped += Number(row.alreadyIndexedSkipped ?? 0);
        acc.relationshipProbes += Number(row.relationshipProbes ?? 0);
        acc.relationshipMemoriesAugmented += Number(row.relationshipMemoriesAugmented ?? 0);
        acc.relationshipEdgesAdded += Number(row.relationshipEdgesAdded ?? 0);
        acc.requestRetries += Number(row.retryCount ?? 0);
      }
      acc.recoverableHttpErrors += Number(phase.stats?.recoverableHttpErrors ?? 0);
      acc.fatalHttpErrors += Number(phase.stats?.fatalHttpErrors ?? 0);
      acc.downshiftCount += Number(phase.stats?.downshiftCount ?? 0);
      acc.cooldownCount += Number(phase.stats?.cooldownCount ?? 0);
      return acc;
    },
    {
      scanned: 0,
      eligible: 0,
      updated: 0,
      failed: 0,
      timeoutErrors: 0,
      alreadyIndexedSkipped: 0,
      relationshipProbes: 0,
      relationshipMemoriesAugmented: 0,
      relationshipEdgesAdded: 0,
      requestRetries: 0,
      recoverableHttpErrors: 0,
      fatalHttpErrors: 0,
      downshiftCount: 0,
      cooldownCount: 0,
    }
  );

  const report = {
    ok: phaseResults.every((phase) => {
      if (typeof phase.stopReason === "string" && phase.stopReason.startsWith("http-error")) {
        return false;
      }
      const last = phase.last;
      return !last || last.ok !== false;
    }),
    generatedAt: new Date().toISOString(),
    config: {
      mode,
      dryRun,
      baseUrl,
      adminTokenConfigured: Boolean(adminToken),
      tenantId: tenantId || null,
      limit,
      maxWaves,
      maxWrites,
      writeDelayMs,
      timeoutMs,
      noProgressLimit,
      targetRemaining,
      stopAfterTimeoutErrors,
      sourcePrefixes,
      minSignals,
      includeLoopStateUpdates,
      skipAlreadyIndexed,
      inferRelationships,
      relationshipProbeLimit,
      maxInferredEdgesPerMemory,
      minRelatedSignalScore,
      requestRetries,
      retryBaseDelayMs,
      retryBackoffFactor,
      retryMaxDelayMs,
      retryJitterMs,
      maxConsecutiveHttpErrors,
      cooldownAfterHttpErrorMs,
      adaptiveDownshiftOnHttpError,
      minWaveLimit,
      minWaveWrites,
      downshiftFactor,
    },
    auth: {
      source: authState.source,
    },
    totals,
    phases: phaseResults,
  };

  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  if (readBoolFlag(flags, "json", false)) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return;
  }
  process.stdout.write(
    `${JSON.stringify(
      {
        ok: report.ok,
        reportPath,
        mode,
        dryRun,
        totals,
        phases: phaseResults.map((phase) => ({
          phaseName: phase.phaseName,
          stopReason: phase.stopReason,
          waves: phase.waves.length,
          last: phase.last,
        })),
      },
      null,
      2
    )}\n`
  );
}

main().catch((error) => {
  process.stderr.write(`open-memory-backfill-converge failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
