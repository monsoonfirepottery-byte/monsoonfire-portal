export type LogLevel = "debug" | "info" | "warn" | "error";

export type Logger = {
  debug: (msg: string, meta?: Record<string, unknown>) => void;
  info: (msg: string, meta?: Record<string, unknown>) => void;
  warn: (msg: string, meta?: Record<string, unknown>) => void;
  error: (msg: string, meta?: Record<string, unknown>) => void;
};

const REDACT_KEYS = ["password", "secret", "token", "authorization", "apikey", "api_key"];

function levelWeight(level: LogLevel): number {
  switch (level) {
    case "debug":
      return 10;
    case "info":
      return 20;
    case "warn":
      return 30;
    case "error":
      return 40;
  }
}

function shouldRedactKey(key: string): boolean {
  const normalized = key.toLowerCase();
  return REDACT_KEYS.some((candidate) => normalized.includes(candidate));
}

function sanitize(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map((entry) => sanitize(entry));
  if (typeof value !== "object") return value;

  const output: Record<string, unknown> = {};
  for (const [key, innerValue] of Object.entries(value as Record<string, unknown>)) {
    output[key] = shouldRedactKey(key) ? "[redacted]" : sanitize(innerValue);
  }
  return output;
}

export function createLogger(level: LogLevel = "info"): Logger {
  const threshold = levelWeight(level);

  const write = (lvl: LogLevel, msg: string, meta?: Record<string, unknown>) => {
    if (levelWeight(lvl) < threshold) return;
    const payload = {
      at: new Date().toISOString(),
      level: lvl,
      msg,
      ...(meta ? { meta: sanitize(meta) } : {}),
    };
    // Keep it JSONL for easy local ingestion.
    process.stdout.write(`${JSON.stringify(payload)}\n`);
  };

  return {
    debug: (msg, meta) => write("debug", msg, meta),
    info: (msg, meta) => write("info", msg, meta),
    warn: (msg, meta) => write("warn", msg, meta),
    error: (msg, meta) => write("error", msg, meta),
  };
}
