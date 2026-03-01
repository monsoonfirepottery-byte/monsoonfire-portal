export type RequestTelemetrySource = "functions-client" | "portal-api";

export type RequestTelemetry = {
  atIso: string;
  requestId: string;
  source: RequestTelemetrySource;
  endpoint: string;
  method: string;
  payload: unknown;
  authFailureReason?: string;
  status?: number;
  ok?: boolean;
  durationMs?: number;
  responseSnippet?: string;
  error?: string;
  curl?: string;
};

type Listener = (entry: RequestTelemetry | null) => void;

const MAX_SNIPPET_LENGTH = 640;
const REDACTED = "<redacted>";
const SECRET_KEY_PATTERN =
  /(authorization|token|secret|password|cookie|api[-_]?key|private|session|email|uid|photo|notes)/i;

let latestRequest: RequestTelemetry | null = null;
const recentRequests: RequestTelemetry[] = [];
const listeners = new Set<Listener>();
const MAX_RECENT_REQUESTS = 400;

function stringify(value: unknown): string {
  try {
    if (typeof value === "string") return value;
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function stringifyResponseSnippet(value: unknown, max = MAX_SNIPPET_LENGTH): string {
  const raw = stringify(value);
  if (raw.length <= max) return raw;
  return `${raw.slice(0, max)}…`;
}

export function redactTelemetryPayload(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => redactTelemetryPayload(entry));
  }

  if (value && typeof value === "object") {
    const next: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (SECRET_KEY_PATTERN.test(key)) {
        next[key] = REDACTED;
        continue;
      }
      next[key] = redactTelemetryPayload(entry);
    }
    return next;
  }

  return value;
}

export function getLatestRequestTelemetry(): RequestTelemetry | null {
  return latestRequest;
}

export function getRecentRequestTelemetry(limit = MAX_RECENT_REQUESTS): RequestTelemetry[] {
  const capped = Math.max(1, Math.min(MAX_RECENT_REQUESTS, Math.round(limit || MAX_RECENT_REQUESTS)));
  if (recentRequests.length <= capped) {
    return [...recentRequests];
  }
  return recentRequests.slice(recentRequests.length - capped);
}

export function publishRequestTelemetry(entry: RequestTelemetry): void {
  latestRequest = entry;
  recentRequests.push(entry);
  if (recentRequests.length > MAX_RECENT_REQUESTS) {
    recentRequests.splice(0, recentRequests.length - MAX_RECENT_REQUESTS);
  }
  listeners.forEach((listener) => {
    listener(latestRequest);
  });
}

export function subscribeRequestTelemetry(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
