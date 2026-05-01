import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { appendJsonl, stableHash } from "./pst-memory-utils.mjs";
import { rememberWithStudioBrain } from "./studio-brain-memory-write.mjs";

const DEFAULT_LIFECYCLE_MEMORY_PATH = resolve(".codex", "lifecycle-memory.ndjson");

function clean(value) {
  return String(value ?? "").trim();
}

function toRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function dedupeStrings(values, limit = 64) {
  const out = [];
  const seen = new Set();
  for (const value of values || []) {
    const normalized = clean(value);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
    if (out.length >= limit) break;
  }
  return out;
}

function resolveLifecycleMemoryPath(env = process.env, cwd = process.cwd()) {
  const override = clean(env.CODEX_LIFECYCLE_MEMORY_PATH || env.CODEX_SHELL_LIFECYCLE_MEMORY_PATH);
  return resolve(cwd, override || DEFAULT_LIFECYCLE_MEMORY_PATH);
}

function isEnabled(value, defaultValue = false) {
  const raw = clean(value).toLowerCase();
  if (!raw) return defaultValue;
  if (["0", "false", "no", "off"].includes(raw)) return false;
  if (["1", "true", "yes", "on"].includes(raw)) return true;
  return defaultValue;
}

export function normalizeCodexLifecycleEvent(payload = {}, { now = new Date() } = {}) {
  const record = toRecord(payload);
  const metadata = toRecord(record.metadata);
  const metrics = toRecord(record.metrics);
  const artifactPointers = toRecord(record.artifactPointers);
  const tsIso = clean(record.tsIso || record.occurredAt) || now.toISOString();
  const tool = clean(record.tool || "codex");
  const event = clean(record.event || "event");
  const runId = clean(record.runId || metadata.runId);
  const summary = clean(record.summary || metadata.summary);
  const row = {
    schema: "codex-lifecycle-memory.v1",
    tsIso,
    occurredAt: tsIso,
    id: stableHash(`${tool}|${event}|${runId}|${tsIso}|${summary}`, 24),
    tool,
    event,
    status: clean(record.status),
    runId,
    kind: clean(record.kind || "progress"),
    summary,
    nextAction: clean(record.nextAction),
    blockers: Array.isArray(record.blockers) ? record.blockers : [],
    metrics,
    touchedPaths: dedupeStrings(record.touchedPaths, 128),
    ownershipHints: Array.isArray(record.ownershipHints) ? record.ownershipHints : [],
    artifactPointers,
    metadata,
    cwd: clean(record.cwd || metadata.cwd),
  };

  return Object.fromEntries(
    Object.entries(row).filter(([, value]) => {
      if (Array.isArray(value)) return value.length > 0;
      if (value && typeof value === "object") return Object.keys(value).length > 0;
      return clean(value);
    })
  );
}

function buildRemoteMemoryPayload(row) {
  const status = clean(row.status);
  const summary = clean(row.summary) || `${row.tool} ${row.event}${status ? ` ${status}` : ""}`.trim();
  return {
    kind: clean(row.kind) || "progress",
    subjectKey: `codex-lifecycle:${row.tool}:${row.event}`,
    scopeClass: "work",
    content: summary,
    tags: dedupeStrings(["codex", "lifecycle", row.tool, row.event], 16),
    rememberForStartup: false,
    importance: 0.35,
    metadata: {
      ...toRecord(row.metadata),
      lifecycleMemory: true,
      startupEligible: false,
      event: row.event,
      tool: row.tool,
      status: row.status,
      runId: row.runId,
      metrics: row.metrics,
      artifactPointers: row.artifactPointers,
      touchedPaths: row.touchedPaths,
    },
  };
}

export async function rememberCodexLifecycleEvent(payload = {}, {
  env = process.env,
  cwd = process.cwd(),
  requestJson,
  remote = isEnabled(env.CODEX_LIFECYCLE_MEMORY_REMOTE, false),
} = {}) {
  const row = normalizeCodexLifecycleEvent(payload);
  const lifecycleMemoryPath = resolveLifecycleMemoryPath(env, cwd);
  mkdirSync(dirname(lifecycleMemoryPath), { recursive: true });
  appendJsonl(lifecycleMemoryPath, [row]);

  const result = {
    attempted: true,
    ok: true,
    local: {
      ok: true,
      path: lifecycleMemoryPath,
      id: row.id,
    },
    remote: {
      attempted: false,
      ok: false,
    },
  };

  if (!remote) {
    return result;
  }

  try {
    const remoteResult = await rememberWithStudioBrain(buildRemoteMemoryPayload(row), {
      env,
      cwd: clean(row.cwd || cwd),
      capturedFrom: "codex-lifecycle-memory",
      requestJson,
    });
    return {
      ...result,
      remote: {
        attempted: true,
        ok: remoteResult.verified === true,
        ...remoteResult,
      },
    };
  } catch (error) {
    return {
      ...result,
      remote: {
        attempted: true,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
    };
  }
}
