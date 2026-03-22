const DEFAULT_TOKEN_EXPIRY_SKEW_MS = 60_000;
const DEFAULT_STARTUP_BUDGET_TARGET_MS = 1_500;
const DEFAULT_STARTUP_BUDGET_HARD_MS = 3_000;

export const STARTUP_REASON_CODES = Object.freeze({
  OK: "ok",
  MISSING_TOKEN: "missing_token",
  EXPIRED_TOKEN: "expired_token",
  TRANSPORT_UNREACHABLE: "transport_unreachable",
  TIMEOUT: "timeout",
  EMPTY_CONTEXT: "empty_context",
  STARTUP_UNAVAILABLE: "startup_unavailable",
});

export function clean(value) {
  return String(value ?? "").trim();
}

function normalizeJwtSegment(segment) {
  const raw = clean(segment).replace(/-/g, "+").replace(/_/g, "/");
  if (!raw) return "";
  const padded = raw + "=".repeat((4 - (raw.length % 4 || 4)) % 4);
  return padded;
}

export function decodeJwtPayload(token) {
  const raw = clean(token).replace(/^bearer\s+/i, "");
  if (!raw) return null;
  const parts = raw.split(".");
  if (parts.length < 2) return null;
  try {
    const decoded = Buffer.from(normalizeJwtSegment(parts[1]), "base64").toString("utf8");
    const parsed = JSON.parse(decoded);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

export function inspectTokenFreshness(token, { nowMs = Date.now(), skewMs = DEFAULT_TOKEN_EXPIRY_SKEW_MS } = {}) {
  const raw = clean(token).replace(/^bearer\s+/i, "");
  if (!raw) {
    return {
      state: "missing",
      expiresAt: null,
      expiresInMs: null,
      stale: true,
    };
  }

  const payload = decodeJwtPayload(raw);
  const expSeconds = Number(payload?.exp);
  if (!Number.isFinite(expSeconds) || expSeconds <= 0) {
    return {
      state: "unknown",
      expiresAt: null,
      expiresInMs: null,
      stale: false,
    };
  }

  const expiresAtMs = expSeconds * 1000;
  const expiresInMs = expiresAtMs - nowMs;
  if (expiresInMs <= 0) {
    return {
      state: "expired",
      expiresAt: new Date(expiresAtMs).toISOString(),
      expiresInMs,
      stale: true,
    };
  }

  if (expiresInMs <= skewMs) {
    return {
      state: "expiring",
      expiresAt: new Date(expiresAtMs).toISOString(),
      expiresInMs,
      stale: false,
    };
  }

  return {
    state: "fresh",
    expiresAt: new Date(expiresAtMs).toISOString(),
    expiresInMs,
    stale: false,
  };
}

function matchesAny(text, patterns) {
  return patterns.some((pattern) => pattern.test(text));
}

export function classifyStartupReason({
  attempted = false,
  reason = "",
  error = "",
  status = 0,
  itemCount = null,
  tokenFreshness = null,
  diagnostics = {},
} = {}) {
  const reasonText = clean(reason).toLowerCase();
  const errorText = clean(error || diagnostics?.continuityReason || diagnostics?.continuityReasonCode).toLowerCase();
  const combined = `${reasonText}\n${errorText}`.trim();
  const tokenState = clean(tokenFreshness?.state).toLowerCase();

  if (tokenState === "missing" || matchesAny(combined, [/missing[_-\s]?auth/, /missing[_-\s]?token/, /missing authorization/i])) {
    return STARTUP_REASON_CODES.MISSING_TOKEN;
  }
  if (
    tokenState === "expired" ||
    matchesAny(combined, [/expired[_-\s]?token/, /id-token-expired/, /auth\/id-token-expired/, /token.*expired/])
  ) {
    return STARTUP_REASON_CODES.EXPIRED_TOKEN;
  }
  if (
    matchesAny(combined, [
      /\btimeout\b/,
      /\betimedout\b/,
      /\baborterror\b/,
      /the operation was aborted/i,
      /signal timed out/i,
    ])
  ) {
    return STARTUP_REASON_CODES.TIMEOUT;
  }
  if (
    status === 0 &&
    matchesAny(combined, [
      /\bfetch failed\b/,
      /\beconnrefused\b/,
      /\benotfound\b/,
      /\behostunreach\b/,
      /\bunreachable\b/,
      /\bnetworkerror\b/,
      /\btransport\b/,
      /\bconnect\b/,
    ])
  ) {
    return STARTUP_REASON_CODES.TRANSPORT_UNREACHABLE;
  }
  if (
    matchesAny(combined, [/empty[_-\s]?context/, /missing[_-\s]?trusted[_-\s]?continuity/, /no trusted startup scaffold/]) ||
    (attempted && (itemCount === 0 || diagnostics?.continuityState === "missing"))
  ) {
    return STARTUP_REASON_CODES.EMPTY_CONTEXT;
  }
  if (!attempted && tokenState === "unknown" && !combined) {
    return STARTUP_REASON_CODES.STARTUP_UNAVAILABLE;
  }
  if (!combined && attempted === false) {
    return STARTUP_REASON_CODES.STARTUP_UNAVAILABLE;
  }
  return STARTUP_REASON_CODES.STARTUP_UNAVAILABLE;
}

export function startupRecoveryStep(reasonCode) {
  switch (reasonCode) {
    case STARTUP_REASON_CODES.MISSING_TOKEN:
      return "Provide or mint a fresh Studio Brain staff bearer token, then retry the same query/runId once.";
    case STARTUP_REASON_CODES.EXPIRED_TOKEN:
      return "Refresh the Studio Brain staff bearer token, then retry the same query/runId once.";
    case STARTUP_REASON_CODES.TRANSPORT_UNREACHABLE:
      return "Restore Studio Brain reachability or MCP launch connectivity, then retry the same query/runId once.";
    case STARTUP_REASON_CODES.TIMEOUT:
      return "Reduce startup load or restore service responsiveness, then retry the same query/runId once.";
    case STARTUP_REASON_CODES.EMPTY_CONTEXT:
      return "Proceed repo-first or create a trusted handoff/checkpoint, then retry the same query/runId once if continuity is still required.";
    default:
      return "Capture the exact startup failure, take one unblock step, then retry the same query/runId once.";
  }
}

export function evaluateStartupLatency(latencyMs, { targetMs = DEFAULT_STARTUP_BUDGET_TARGET_MS, hardMs = DEFAULT_STARTUP_BUDGET_HARD_MS } = {}) {
  const numericLatency = Number(latencyMs);
  if (!Number.isFinite(numericLatency) || numericLatency < 0) {
    return {
      state: "unknown",
      latencyMs: null,
      budgetTargetMs: targetMs,
      budgetHardMs: hardMs,
    };
  }
  if (numericLatency > hardMs) {
    return {
      state: "over_budget",
      latencyMs: numericLatency,
      budgetTargetMs: targetMs,
      budgetHardMs: hardMs,
    };
  }
  if (numericLatency > targetMs) {
    return {
      state: "at_risk",
      latencyMs: numericLatency,
      budgetTargetMs: targetMs,
      budgetHardMs: hardMs,
    };
  }
  return {
    state: "healthy",
    latencyMs: numericLatency,
    budgetTargetMs: targetMs,
    budgetHardMs: hardMs,
  };
}

export function buildStartupFailureLine(reasonCode, { error = "", latency = null, tokenFreshness = null } = {}) {
  const parts = [`reasonCode=${clean(reasonCode) || STARTUP_REASON_CODES.STARTUP_UNAVAILABLE}`];
  if (clean(tokenFreshness?.state)) {
    parts.push(`token=${clean(tokenFreshness.state)}`);
  }
  if (latency && Number.isFinite(Number(latency.latencyMs))) {
    parts.push(`latencyMs=${Number(latency.latencyMs)}`);
    parts.push(`latencyState=${clean(latency.state)}`);
  }
  if (clean(error)) {
    parts.push(`detail=${clean(error).slice(0, 180)}`);
  }
  return parts.join(" ");
}
