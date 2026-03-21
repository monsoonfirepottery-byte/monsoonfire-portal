import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";

export function parseCliArgs(argv) {
  const positionals = [];
  const flags = {};

  for (let index = 0; index < argv.length; index += 1) {
    const token = String(argv[index] ?? "").trim();
    if (!token) continue;
    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }
    const hasEquals = token.includes("=");
    const key = token
      .slice(2, hasEquals ? token.indexOf("=") : undefined)
      .trim()
      .toLowerCase();
    if (!key) continue;
    if (hasEquals) {
      flags[key] = token.slice(token.indexOf("=") + 1);
      continue;
    }
    const next = argv[index + 1];
    if (next && !String(next).startsWith("--")) {
      flags[key] = String(next);
      index += 1;
    } else {
      flags[key] = "true";
    }
  }

  return { positionals, flags };
}

export function readBoolFlag(flags, key, fallback = false) {
  if (!Object.prototype.hasOwnProperty.call(flags, key)) return fallback;
  const normalized = String(flags[key] ?? "")
    .trim()
    .toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

export function readNumberFlag(flags, key, fallback, { min = undefined, max = undefined } = {}) {
  const parsed = Number(flags[key]);
  if (!Number.isFinite(parsed)) return fallback;
  let value = Math.trunc(parsed);
  if (Number.isFinite(min)) value = Math.max(value, Number(min));
  if (Number.isFinite(max)) value = Math.min(value, Number(max));
  return value;
}

export function readStringFlag(flags, key, fallback = "") {
  if (!Object.prototype.hasOwnProperty.call(flags, key)) return fallback;
  const value = String(flags[key] ?? "").trim();
  return value || fallback;
}

export function ensureParentDir(path) {
  mkdirSync(dirname(path), { recursive: true });
}

export function resolveFromRepo(repoRoot, pathValue) {
  return resolve(repoRoot, pathValue);
}

export function fileHasContent(path) {
  if (!existsSync(path)) return false;
  try {
    return readFileSync(path).length > 0;
  } catch {
    return false;
  }
}

export function readJson(path, fallback = null) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

export function writeJson(path, value) {
  ensureParentDir(path);
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export function readJsonl(path) {
  const raw = readFileSync(path, "utf8");
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter((entry) => Boolean(entry));
}

export function readJsonlWithRaw(path) {
  const raw = readFileSync(path, "utf8");
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return { ok: true, value: JSON.parse(line), raw: line };
      } catch {
        return { ok: false, value: null, raw: line };
      }
    });
}

export async function* streamJsonlWithRaw(path) {
  const rows = readJsonlWithRaw(path);
  for (let index = 0; index < rows.length; index += 1) {
    yield {
      ...rows[index],
      lineNumber: index + 1,
    };
  }
}

export function writeJsonl(path, rows) {
  ensureParentDir(path);
  const body = rows.map((row) => JSON.stringify(row)).join("\n");
  writeFileSync(path, body.length > 0 ? `${body}\n` : "", "utf8");
}

export function appendJsonl(path, rows) {
  const current = fileHasContent(path) ? readFileSync(path, "utf8") : "";
  const appendBody = rows.map((row) => JSON.stringify(row)).join("\n");
  if (!appendBody) return;
  ensureParentDir(path);
  const separator = current && !current.endsWith("\n") ? "\n" : "";
  writeFileSync(path, `${current}${separator}${appendBody}\n`, "utf8");
}

export async function countJsonlRows(path) {
  if (!fileHasContent(path)) return 0;
  const raw = readFileSync(path, "utf8");
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean).length;
}

export function createJsonlWriter(path, { append = false } = {}) {
  ensureParentDir(path);
  if (!append) {
    writeFileSync(path, "", "utf8");
  }
  return {
    async writeRow(row) {
      appendFileSync(path, `${JSON.stringify(row)}\n`, "utf8");
    },
    async close() {
      return undefined;
    },
  };
}

export function stableHash(value, len = 24) {
  return createHash("sha256").update(String(value ?? "")).digest("hex").slice(0, len);
}

export function normalizeWhitespace(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

export function clipText(value, maxChars) {
  const normalized = normalizeWhitespace(value);
  if (!Number.isFinite(maxChars) || maxChars <= 0) return normalized;
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, Math.max(1, maxChars - 1)).trimEnd()}…`;
}

export function isoNow() {
  return new Date().toISOString();
}

export function runCommand(
  command,
  args,
  { cwd, env, allowFailure = false, maxBuffer = 1024 * 1024 * 64, timeoutMs = 0, killSignal = "SIGKILL" } = {}
) {
  const result = spawnSync(command, args, {
    cwd,
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer,
    timeout: Number.isFinite(timeoutMs) && timeoutMs > 0 ? Math.trunc(timeoutMs) : undefined,
    killSignal,
  });
  const stdout = String(result.stdout ?? "");
  const stderr = String(result.stderr ?? "");
  const ok = result.status === 0;
  const signal = typeof result.signal === "string" ? result.signal : null;
  const error = result.error ? String(result.error.message || result.error) : "";
  const timedOut =
    Boolean(result.error) &&
    (String(result.error.code || "").toUpperCase() === "ETIMEDOUT" || /timed out/i.test(String(error)));
  if (!ok && !allowFailure) {
    throw new Error(
      `${command} ${args.join(" ")} failed with status ${String(result.status ?? "unknown")}\n` +
        `${stderr.trim() || stdout.trim() || error.trim()}` +
        (timedOut && Number.isFinite(timeoutMs) && timeoutMs > 0 ? `\nCommand timed out after ${timeoutMs}ms` : "")
    );
  }
  return {
    ok,
    status: typeof result.status === "number" ? result.status : null,
    stdout,
    stderr,
    signal,
    error,
    timedOut,
  };
}
