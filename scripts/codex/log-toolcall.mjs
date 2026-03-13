#!/usr/bin/env node

/* eslint-disable no-console */

import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const repoRoot = resolve(dirname(__filename), "..", "..");
const codexDir = resolve(repoRoot, ".codex");
const toolcallPath = resolve(codexDir, "toolcalls.ndjson");

const REQUIRED_KEYS = [
  "tsIso",
  "actor",
  "tool",
  "action",
  "ok",
  "durationMs",
  "errorType",
  "errorMessage",
  "context",
];

const ACTOR_VALUES = new Set(["codex", "github-action", "user"]);
const SECRET_KEY_PATTERN = /(token|secret|password|authorization|api[_-]?key|cookie|session|private[_-]?key)/i;
const SECRET_VALUE_PATTERNS = [
  /bearer\s+[a-z0-9._~-]+/gi,
  /AIza[0-9A-Za-z_-]{20,}/g,
  /(gh[opsu]_[A-Za-z0-9_]{20,})/g,
  /(sk-[A-Za-z0-9]{20,})/g,
];

const USAGE_ESTIMATE_DEFAULTS = {
  enabled: true,
  tokensPerSecond: 45,
  minTotalTokens: 32,
  inputRatio: 0.32,
  outputRatio: 0.5,
  reasoningRatio: 0.18,
};

const RETRY_GOVERNOR_DEFAULTS = {
  enabled: true,
  windowMinutes: 15,
  burstThreshold: 2,
  recentEntryLimit: 250,
};

function printUsage() {
  process.stdout.write(
    [
      "Usage:",
      "  node ./scripts/codex/log-toolcall.mjs \\",
      "    --actor codex|github-action|user \\",
      "    --tool <name> \\",
      "    --action <name> \\",
      "    --ok true|false \\",
      "    [--duration-ms <number>] \\",
      "    [--error-type <string>] \\",
      "    [--error-message <string>] \\",
      "    [--context-json <json-string>] \\",
      "    [--context-file <path>] \\",
      "    [--input-tokens <number>] \\",
      "    [--output-tokens <number>] \\",
      "    [--reasoning-tokens <number>] \\",
      "    [--cache-read-tokens <number>] \\",
      "    [--cache-write-tokens <number>] \\",
      "    [--total-tokens <number>] \\",
      "    [--ts-iso <iso>] \\",
      "    [--json]",
      "",
    ].join("\n")
  );
}

function parseBoolean(value, name) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "true" || normalized === "1" || normalized === "yes") return true;
  if (normalized === "false" || normalized === "0" || normalized === "no") return false;
  throw new Error(`Invalid boolean for ${name}: ${value}`);
}

function parseDuration(value) {
  if (value == null || String(value).trim() === "") return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) {
    throw new Error(`Invalid --duration-ms value: ${value}`);
  }
  return Math.round(numeric);
}

function parseTokenCount(value, name) {
  if (value == null || String(value).trim() === "") return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) {
    throw new Error(`Invalid ${name} value: ${value}`);
  }
  return Math.round(numeric);
}

function coerceNullableString(value) {
  if (value == null) return null;
  const trimmed = String(value).trim();
  return trimmed.length > 0 ? trimmed : null;
}

function sanitizeString(value) {
  if (typeof value !== "string") return value;
  let out = value;
  for (const pattern of SECRET_VALUE_PATTERNS) {
    out = out.replace(pattern, "[REDACTED]");
  }
  return out;
}

function sanitizeValue(value, keyHint = "") {
  if (value == null) return value;

  if (SECRET_KEY_PATTERN.test(keyHint)) {
    return "[REDACTED]";
  }

  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeValue(entry, keyHint));
  }

  if (typeof value === "object") {
    const output = {};
    for (const [key, nested] of Object.entries(value)) {
      output[key] = sanitizeValue(nested, key);
    }
    return output;
  }

  if (typeof value === "string") {
    return sanitizeString(value);
  }

  return value;
}

function parseArgs(argv) {
  const options = {
    actor: "",
    tool: "",
    action: "",
    ok: null,
    durationMs: null,
    errorType: null,
    errorMessage: null,
    contextJson: "",
    contextFile: "",
    inputTokens: null,
    outputTokens: null,
    reasoningTokens: null,
    cacheReadTokens: null,
    cacheWriteTokens: null,
    totalTokens: null,
    tsIso: "",
    asJson: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg) continue;

    if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    }

    if (arg === "--json") {
      options.asJson = true;
      continue;
    }

    const next = argv[index + 1];
    if (!arg.startsWith("--")) continue;
    if (!next || next.startsWith("--")) {
      throw new Error(`Missing value for ${arg}`);
    }

    if (arg === "--actor") {
      options.actor = String(next).trim();
      index += 1;
      continue;
    }

    if (arg === "--tool") {
      options.tool = String(next).trim();
      index += 1;
      continue;
    }

    if (arg === "--action") {
      options.action = String(next).trim();
      index += 1;
      continue;
    }

    if (arg === "--ok") {
      options.ok = parseBoolean(next, "--ok");
      index += 1;
      continue;
    }

    if (arg === "--duration-ms") {
      options.durationMs = parseDuration(next);
      index += 1;
      continue;
    }

    if (arg === "--error-type") {
      options.errorType = coerceNullableString(next);
      index += 1;
      continue;
    }

    if (arg === "--error-message") {
      options.errorMessage = coerceNullableString(next);
      index += 1;
      continue;
    }

    if (arg === "--context-json") {
      options.contextJson = String(next);
      index += 1;
      continue;
    }

    if (arg === "--context-file") {
      options.contextFile = resolve(process.cwd(), String(next));
      index += 1;
      continue;
    }

    if (arg === "--input-tokens") {
      options.inputTokens = parseTokenCount(next, "--input-tokens");
      index += 1;
      continue;
    }

    if (arg === "--output-tokens") {
      options.outputTokens = parseTokenCount(next, "--output-tokens");
      index += 1;
      continue;
    }

    if (arg === "--reasoning-tokens") {
      options.reasoningTokens = parseTokenCount(next, "--reasoning-tokens");
      index += 1;
      continue;
    }

    if (arg === "--cache-read-tokens") {
      options.cacheReadTokens = parseTokenCount(next, "--cache-read-tokens");
      index += 1;
      continue;
    }

    if (arg === "--cache-write-tokens") {
      options.cacheWriteTokens = parseTokenCount(next, "--cache-write-tokens");
      index += 1;
      continue;
    }

    if (arg === "--total-tokens") {
      options.totalTokens = parseTokenCount(next, "--total-tokens");
      index += 1;
      continue;
    }

    if (arg === "--ts-iso") {
      options.tsIso = String(next).trim();
      index += 1;
      continue;
    }
  }

  if (!ACTOR_VALUES.has(options.actor)) {
    throw new Error(`--actor must be one of: ${Array.from(ACTOR_VALUES).join(", ")}`);
  }
  if (!options.tool) throw new Error("--tool is required");
  if (!options.action) throw new Error("--action is required");
  if (typeof options.ok !== "boolean") throw new Error("--ok is required");

  return options;
}

function buildUsagePayload(options) {
  const usage = {
    inputTokens: options.inputTokens,
    outputTokens: options.outputTokens,
    reasoningTokens: options.reasoningTokens,
    cacheReadTokens: options.cacheReadTokens,
    cacheWriteTokens: options.cacheWriteTokens,
    totalTokens: options.totalTokens,
  };

  const hasAny = Object.values(usage).some((value) => typeof value === "number");
  if (!hasAny) return null;

  if (usage.totalTokens == null) {
    usage.totalTokens =
      Number(usage.inputTokens || 0) +
      Number(usage.outputTokens || 0) +
      Number(usage.reasoningTokens || 0) +
      Number(usage.cacheWriteTokens || 0);
  }

  return usage;
}

function toNonNegativeInteger(value) {
  if (value == null || value === "") return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return null;
  return Math.round(numeric);
}

function firstNumberFromObject(obj, keys) {
  if (!obj || typeof obj !== "object") return null;
  for (const key of keys) {
    if (!(key in obj)) continue;
    const parsed = toNonNegativeInteger(obj[key]);
    if (parsed != null) return parsed;
  }
  return null;
}

function extractUsageFromContext(rawContext) {
  if (!rawContext || typeof rawContext !== "object") return null;

  const candidates = [
    rawContext?.usage,
    rawContext?.tokenUsage,
    rawContext?.runtimeUsage,
    rawContext?.context?.usage,
    rawContext?.context?.tokenUsage,
  ].filter((value) => value && typeof value === "object");

  const inputKeys = ["inputTokens", "promptTokens", "prompt_tokens", "tokensIn", "input_tokens"];
  const outputKeys = ["outputTokens", "completionTokens", "completion_tokens", "tokensOut", "output_tokens"];
  const reasoningKeys = ["reasoningTokens", "reasoning_tokens", "tokensReasoning", "reasoning"];
  const cacheReadKeys = ["cacheReadTokens", "cache_read_tokens", "cachedTokensRead", "cacheRead"];
  const cacheWriteKeys = ["cacheWriteTokens", "cache_write_tokens", "cachedTokensWrite", "cacheWrite"];
  const totalKeys = ["totalTokens", "total_tokens", "tokensTotal", "total"];

  let inputTokens = null;
  let outputTokens = null;
  let reasoningTokens = null;
  let cacheReadTokens = null;
  let cacheWriteTokens = null;
  let totalTokens = null;

  for (const candidate of candidates) {
    inputTokens = inputTokens ?? firstNumberFromObject(candidate, inputKeys);
    outputTokens = outputTokens ?? firstNumberFromObject(candidate, outputKeys);
    reasoningTokens = reasoningTokens ?? firstNumberFromObject(candidate, reasoningKeys);
    cacheReadTokens = cacheReadTokens ?? firstNumberFromObject(candidate, cacheReadKeys);
    cacheWriteTokens = cacheWriteTokens ?? firstNumberFromObject(candidate, cacheWriteKeys);
    totalTokens = totalTokens ?? firstNumberFromObject(candidate, totalKeys);
  }

  if (totalTokens == null) {
    const sum = [inputTokens, outputTokens, reasoningTokens, cacheWriteTokens]
      .filter((value) => value != null)
      .reduce((acc, value) => acc + Number(value || 0), 0);
    totalTokens = sum > 0 ? sum : null;
  }

  const hasAny =
    inputTokens != null ||
    outputTokens != null ||
    reasoningTokens != null ||
    cacheReadTokens != null ||
    cacheWriteTokens != null ||
    totalTokens != null;

  if (!hasAny) return null;

  return {
    inputTokens,
    outputTokens,
    reasoningTokens,
    cacheReadTokens,
    cacheWriteTokens,
    totalTokens,
    estimated: false,
    source: "context-usage-v1",
  };
}

function parseNdjsonLines(raw) {
  const rows = [];
  for (const line of String(raw || "").split("\n")) {
    if (!line.trim()) continue;
    try {
      rows.push(JSON.parse(line));
    } catch {
      // ignore corrupt line
    }
  }
  return rows;
}

async function readRecentEntries(limit = RETRY_GOVERNOR_DEFAULTS.recentEntryLimit) {
  try {
    const raw = await readFile(toolcallPath, "utf8");
    const rows = parseNdjsonLines(raw);
    if (!Number.isFinite(limit) || limit <= 0) return rows;
    return rows.slice(-Math.round(limit));
  } catch {
    return [];
  }
}

function estimateUsageFromDuration(options) {
  const enabled = String(process.env.CODEX_TOOLCALL_ESTIMATE_USAGE ?? "true").trim().toLowerCase();
  if (["0", "false", "no", "off"].includes(enabled)) return null;
  const durationMs = Number(options.durationMs);
  if (!Number.isFinite(durationMs) || durationMs <= 0) return null;

  const perSecondRaw = Number(process.env.CODEX_TOOLCALL_ESTIMATE_TOKENS_PER_SECOND);
  const minTotalRaw = Number(process.env.CODEX_TOOLCALL_ESTIMATE_MIN_TOTAL_TOKENS);
  const perSecond = Number.isFinite(perSecondRaw) && perSecondRaw > 0 ? perSecondRaw : USAGE_ESTIMATE_DEFAULTS.tokensPerSecond;
  const minimum = Number.isFinite(minTotalRaw) && minTotalRaw >= 0 ? minTotalRaw : USAGE_ESTIMATE_DEFAULTS.minTotalTokens;

  const estimatedTotal = Math.max(Math.round((durationMs / 1000) * perSecond), Math.round(minimum));
  if (!Number.isFinite(estimatedTotal) || estimatedTotal <= 0) return null;

  const outputTokens = Math.max(1, Math.round(estimatedTotal * USAGE_ESTIMATE_DEFAULTS.outputRatio));
  const inputTokens = Math.max(1, Math.round(estimatedTotal * USAGE_ESTIMATE_DEFAULTS.inputRatio));
  const reasoningTokens = Math.max(
    0,
    Math.max(estimatedTotal - outputTokens - inputTokens, Math.round(estimatedTotal * USAGE_ESTIMATE_DEFAULTS.reasoningRatio))
  );
  const totalTokens = inputTokens + outputTokens + reasoningTokens;

  return {
    inputTokens,
    outputTokens,
    reasoningTokens,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens,
    estimated: true,
    estimationMethod: "duration-rate-v1",
    estimatedTokensPerSecond: perSecond,
    estimatedFromDurationMs: Math.round(durationMs),
  };
}

function applyRetryGovernor(payload, recentEntries) {
  const enabled = String(process.env.CODEX_TOOLCALL_RETRY_GOVERNOR ?? "true").trim().toLowerCase();
  if (["0", "false", "no", "off"].includes(enabled)) return payload;
  if (payload.ok) return payload;

  const windowRaw = Number(process.env.CODEX_TOOLCALL_RETRY_GOVERNOR_WINDOW_MINUTES);
  const thresholdRaw = Number(process.env.CODEX_TOOLCALL_RETRY_GOVERNOR_BURST_THRESHOLD);
  const windowMinutes =
    Number.isFinite(windowRaw) && windowRaw > 0 ? Math.round(windowRaw) : RETRY_GOVERNOR_DEFAULTS.windowMinutes;
  const burstThreshold =
    Number.isFinite(thresholdRaw) && thresholdRaw > 0
      ? Math.round(thresholdRaw)
      : RETRY_GOVERNOR_DEFAULTS.burstThreshold;

  const nowMs = Date.parse(payload.tsIso);
  const windowMs = Math.max(1, windowMinutes) * 60 * 1000;
  const signature = `${payload.tool}::${payload.action}::${payload.errorType || "none"}`;

  const burstCount = recentEntries.filter((entry) => {
    if (!entry || entry.ok !== false) return false;
    if (String(entry.tool || "") !== payload.tool) return false;
    if (String(entry.action || "") !== payload.action) return false;
    if (String(entry.errorType || "none") !== String(payload.errorType || "none")) return false;
    const tsMs = Date.parse(String(entry.tsIso || ""));
    if (!Number.isFinite(tsMs) || !Number.isFinite(nowMs)) return false;
    return nowMs - tsMs <= windowMs;
  }).length;

  const governor = {
    enabled: true,
    signature,
    burstCount,
    burstThreshold,
    windowMinutes,
    triggered: burstCount >= burstThreshold,
    action: burstCount >= burstThreshold ? "pause-and-diagnose" : "none",
  };

  const baseContext = payload.context && typeof payload.context === "object" ? payload.context : {};
  return {
    ...payload,
    context: {
      ...baseContext,
      retryGovernor: governor,
    },
  };
}

async function readContext(options) {
  if (options.contextJson) {
    return JSON.parse(options.contextJson);
  }
  if (options.contextFile) {
    const raw = await readFile(options.contextFile, "utf8");
    return JSON.parse(raw);
  }
  return null;
}

async function ensureLogFile() {
  await mkdir(codexDir, { recursive: true });
}

function assertContractShape(payload) {
  for (const key of REQUIRED_KEYS) {
    if (!(key in payload)) {
      throw new Error(`Missing required key in payload: ${key}`);
    }
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const rawContext = await readContext(options);
  const tsIso = options.tsIso || new Date().toISOString();
  const usage = buildUsagePayload(options) || extractUsageFromContext(rawContext) || estimateUsageFromDuration(options);

  let payload = {
    tsIso,
    actor: options.actor,
    tool: options.tool,
    action: options.action,
    ok: options.ok,
    durationMs: options.durationMs,
    errorType: options.errorType,
    errorMessage: options.errorMessage ? sanitizeString(options.errorMessage) : null,
    context: rawContext == null ? null : sanitizeValue(rawContext),
    usage,
  };
  const recentEntries = await readRecentEntries();
  payload = applyRetryGovernor(payload, recentEntries);
  assertContractShape(payload);

  await ensureLogFile();
  await appendFile(toolcallPath, `${JSON.stringify(payload)}\n`, "utf8");

  if (options.asJson) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  } else {
    process.stdout.write(
      [
        "logged toolcall:",
        `- actor: ${payload.actor}`,
        `- tool: ${payload.tool}`,
        `- action: ${payload.action}`,
        `- ok: ${payload.ok}`,
        `- usage.totalTokens: ${payload.usage?.totalTokens ?? "n/a"}`,
        "",
      ].join("\n")
    );
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`log-toolcall failed: ${message}`);
  process.exit(1);
});
