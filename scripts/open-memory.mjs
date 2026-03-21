#!/usr/bin/env node

import crypto from "node:crypto";
import { resolve } from "node:path";
import { resolveStudioBrainBaseUrlFromEnv } from "./studio-brain-url-resolution.mjs";
import { buildImportCommandPayload } from "./lib/open-memory-import-utils.mjs";

function parseArgs(argv) {
  const positionals = [];
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = String(argv[i] ?? "");
    if (!arg.startsWith("--")) {
      positionals.push(arg);
      continue;
    }
    const valueFromEquals = arg.includes("=") ? arg.slice(arg.indexOf("=") + 1) : null;
    const key = arg
      .slice(2, arg.includes("=") ? arg.indexOf("=") : undefined)
      .trim()
      .toLowerCase();
    if (!key) continue;
    if (valueFromEquals !== null) {
      flags[key] = valueFromEquals;
      continue;
    }
    const next = argv[i + 1];
    if (next && !String(next).startsWith("--")) {
      flags[key] = String(next);
      i += 1;
    } else {
      flags[key] = "true";
    }
  }
  return { positionals, flags };
}

function intFlag(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
}

function numberFlag(value, fallback) {
  const raw = String(value ?? "").trim();
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseCsv(value) {
  return String(value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function boolFlag(value, fallback = false) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) return fallback;
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

function normalizeBearer(value) {
  if (!value) return null;
  const token = String(value).trim();
  if (!token) return null;
  return /^bearer\s+/i.test(token) ? token : `Bearer ${token}`;
}

async function readStdinText() {
  if (process.stdin.isTTY) return "";
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8").trim();
}

function extractSearchRows(payload) {
  if (!payload || typeof payload !== "object") return [];
  if (Array.isArray(payload.rows)) return payload.rows;
  if (Array.isArray(payload.results)) return payload.results;
  if (Array.isArray(payload.items)) return payload.items;
  return [];
}

function extractRowId(row) {
  if (!row || typeof row !== "object") return "";
  const id = row.id ?? row.memoryId ?? row.memory_id ?? row._id;
  return String(id ?? "").trim();
}

function summaryFromRow(row, maxChars = 180) {
  if (!row || typeof row !== "object") return "";
  const text = String(row.summary ?? row.content ?? row.text ?? "").replace(/\s+/g, " ").trim();
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}

function normalizeRelatedEntry(entry) {
  if (!entry) return null;
  if (typeof entry === "string") {
    const id = String(entry).trim();
    return id ? { id } : null;
  }
  if (typeof entry !== "object") return null;
  const id = extractRowId(entry);
  const summary = summaryFromRow(entry, 180);
  const scoreRaw = Number(entry.score ?? entry.relevanceScore ?? entry.relevance ?? NaN);
  const score = Number.isFinite(scoreRaw) ? scoreRaw : undefined;
  if (!id && !summary) return null;
  return {
    ...(id ? { id } : {}),
    ...(summary ? { summary } : {}),
    ...(score !== undefined ? { score } : {}),
  };
}

function dedupeRelatedEntries(entries, { excludeId = "" } = {}) {
  const seen = new Set();
  const out = [];
  const skip = String(excludeId || "").trim();
  for (const entry of entries) {
    const normalized = normalizeRelatedEntry(entry);
    if (!normalized) continue;
    const key = String(normalized.id || normalized.summary || "").trim();
    if (!key) continue;
    if (skip && normalized.id === skip) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(normalized);
  }
  return out;
}

function buildContextRelationshipPreview(payload, seedId) {
  const relatedFromPayload = Array.isArray(payload?.related) ? payload.related : [];
  const rows = extractSearchRows(payload).filter((row) => extractRowId(row) !== seedId);
  const related = dedupeRelatedEntries([...relatedFromPayload, ...rows], { excludeId: seedId });
  const edgeSummary =
    payload?.edgeSummary && typeof payload.edgeSummary === "object"
      ? payload.edgeSummary
      : {
          relatedCount: related.length,
          sampleCount: rows.length,
        };
  return {
    related,
    edgeSummary,
  };
}

function buildEdgeSummaryFromPreviewRows(previewRows) {
  const okRows = previewRows.filter((row) => row && !row.error);
  const relatedCount = okRows.reduce((sum, row) => sum + Number(row.related?.length || 0), 0);
  return {
    previewRows: previewRows.length,
    previewRowsOk: okRows.length,
    previewRowsErrored: previewRows.length - okRows.length,
    relatedCount,
  };
}

function mapToSortedObject(map) {
  return Object.fromEntries(
    Array.from(map.entries()).sort((left, right) => {
      const countDelta = Number(right[1] || 0) - Number(left[1] || 0);
      if (countDelta !== 0) return countDelta;
      return String(left[0]).localeCompare(String(right[0]));
    })
  );
}

async function main() {
  const { positionals, flags } = parseArgs(process.argv.slice(2));
  const command = String(positionals[0] ?? "").toLowerCase();

  if (!command || ["-h", "--help", "help"].includes(command)) {
    process.stdout.write(
      [
        "Open Memory CLI",
        "",
        "Usage:",
        "  node ./scripts/open-memory.mjs capture --text \"...\" [--source manual] [--tenant-id ...] [--agent-id ...] [--run-id ...] [--tags a,b]",
        "  node ./scripts/open-memory.mjs context [--tenant-id ...] [--agent-id ...] [--run-id ...] [--query \"...\"] [--max-items 12] [--max-chars 8000]",
        "  node ./scripts/open-memory.mjs neighborhood --memory-id <id> [--tenant-id ...] [--agent-id ...] [--run-id ...] [--query \"...\"] [--max-hops 2] [--max-items 24]",
        "  node ./scripts/open-memory.mjs search --query \"...\" [--limit 10] [--tenant-id ...] [--agent-id ...] [--run-id ...] [--expand-relationships true] [--max-hops 2]",
        "  node ./scripts/open-memory.mjs relationship-diagnostics --memory-id <id> [--tenant-id ...] [--agent-id ...] [--run-id ...] [--max-hops 2]",
        "  node ./scripts/open-memory.mjs recent [--limit 20] [--tenant-id ...]",
        "  node ./scripts/open-memory.mjs stats [--tenant-id ...]",
        "  node ./scripts/open-memory.mjs loops [--tenant-id ...] [--states open-loop,reopened] [--lanes critical,high] [--limit 30] [--query \"...\"] [--sort-by attention|volatility|anomaly|centrality|escalation|blastRadius] [--min-attention 0.9] [--min-volatility 0.35] [--min-anomaly 0.4] [--min-centrality 0.45] [--min-escalation 1.0] [--min-blast-radius 0.45] [--include-incidents true]",
        "  node ./scripts/open-memory.mjs incidents [--tenant-id ...] [--query \"...\"] [--limit 12] [--incident-min-escalation 0.95] [--incident-min-blast-radius 0.4]",
        "  node ./scripts/open-memory.mjs incident-action --loop-key <key> --action ack|assign|snooze|resolve|false-positive|escalate [--incident-id ...] [--memory-id ...] [--idempotency-key ...] [--actor-id ...] [--note \"...\"] [--tenant-id ...]",
        "  node ./scripts/open-memory.mjs incident-action-batch --input ./path/actions.json [--tenant-id ...] [--actor-id ...] [--idempotency-prefix ...] [--continue-on-error true]",
        "  node ./scripts/open-memory.mjs feedback-stats [--tenant-id ...] [--window-days 180] [--limit 120] [--loop-keys k1,k2]",
        "  node ./scripts/open-memory.mjs owner-queues [--tenant-id ...] [--query \"...\"] [--limit 50] [--incident-limit 20]",
        "  node ./scripts/open-memory.mjs action-plan [--tenant-id ...] [--query \"...\"] [--max-actions 40] [--include-batch-payload true]",
        "  node ./scripts/open-memory.mjs automation-tick [--tenant-id ...] [--query \"...\"] [--limit 12] [--max-actions 30] [--apply-actions true] [--dispatch true] [--webhook-url https://...] [--idempotency-key ...] [--apply-priorities p0,p1] [--allowed-actions escalate,assign,ack]",
        "  node ./scripts/open-memory.mjs digest [--tenant-id ...] [--query \"...\"] [--limit 12] [--dispatch true] [--webhook-url https://...]",
        "  node ./scripts/open-memory.mjs import --input ./path/file.jsonl [--source import] [--continue-on-error true]",
        "  node ./scripts/open-memory.mjs import --input ./path/file.jsonl [--post-import-briefing true] [--briefing-query \"...\"] [--briefing-limit 12] [--briefing-states open-loop,reopened] [--briefing-lanes critical,high]",
        "  node ./scripts/open-memory.mjs import --input ./path/file.jsonl [--disable-run-burst-limit true] [--dispatch true] [--webhook-url https://...]",
        "  node ./scripts/open-memory.mjs backfill-email-threading [--tenant-id ...] [--limit 2000] [--dry-run true] [--source-prefixes mail:,email]",
        "  node ./scripts/open-memory.mjs backfill-email-intelligence [--tenant-id ...] [--limit 2000] [--dry-run true] [--source-prefixes mail:,email]",
        "  node ./scripts/open-memory.mjs backfill-signal-indexing [--tenant-id ...] [--limit 2000] [--dry-run true] [--source-prefixes mail:,email] [--min-signals 2]",
        "  node ./scripts/open-memory.mjs scrub-thread-metadata [--tenant-id ...] [--limit 2000] [--dry-run true] [--source-prefixes import,replay:,repo-markdown]",
        "  node ./scripts/open-memory.mjs ingest --text \"...\" --source discord --client-request-id msg-123 [--discord-guild-id ...] [--discord-channel-id ...]",
        "",
        "Optional flags:",
        "  --base-url         Studio Brain base URL (default: STUDIO_BRAIN_BASE_URL or studio network profile resolution)",
        "  --auth             Firebase ID token or Bearer token (or STUDIO_BRAIN_AUTH_TOKEN / STUDIO_BRAIN_ID_TOKEN)",
        "  --admin-token      Optional x-studio-brain-admin-token (or STUDIO_BRAIN_ADMIN_TOKEN)",
        "  --memory-id        Seed memory id for neighborhood/relationship diagnostics.",
        "  --seed-memory-id   Optional memory id to force a seed row for relationship expansion.",
        "  --expand-relationships true|false  Enable graph expansion for context/search previews (default: false).",
        "  --max-hops         Relationship expansion depth (default: 2).",
        "  --relationship-preview-limit <n>     Search mode: top hits to relationship-enrich (default: 3).",
        "  --relationship-preview-max-items <n> Search mode: related rows budget per seed (default: 16).",
        "  --relationship-preview-max-chars <n> Search mode: context payload chars per seed (default: 10000).",
        "  --disable-run-burst-limit true|false  Disable run-write burst limiter for this import batch (default: false).",
        "  --post-import-briefing true|false  Generate loop/action briefing after import (default: auto for mail-like sources).",
        "  --dry-run true|false  For backfill-email-threading/backfill-signal-indexing/scrub-thread-metadata, preview changes without writing.",
        "  --max-writes <n>  For backfill-email-threading/backfill-signal-indexing/scrub-thread-metadata, cap write operations per run (default: 500).",
        "  --write-delay-ms <n>  Delay between backfill writes to reduce load (default: 20).",
        "  --stop-after-timeout-errors <n>  Stop backfill after consecutive timeout errors (default: 5).",
        "  --include-non-mail-like true|false  Include non-mail sources in backfill-signal-indexing (default: false).",
        "  --include-mail-like true|false  Include mail-like rows in scrub-thread-metadata (default: false).",
        "  --min-signals <n>  For backfill-signal-indexing, minimum derived signal items per memory (default: 1).",
        "  --skip-already-indexed true|false  For backfill-signal-indexing, skip rows whose signal index already appears populated (default: true).",
        "  --infer-relationships true|false  For backfill-signal-indexing, infer high-signal edges using related-memory probes (default: true).",
        "  --relationship-probe-limit <n>  For backfill-signal-indexing, max related rows inspected per inference stage (default: 24).",
        "  --max-inferred-edges-per-memory <n>  For backfill-signal-indexing, cap inferred edges added per memory (default: 16).",
        "  --min-related-signal-score <n>  For backfill-signal-indexing, threshold for context-overlap edge inference (default: 0.12).",
        "  --signal-min-signals <n>  For backfill-email-intelligence, min signal threshold for signal-indexing phase (default: --min-signals or 1).",
        "  --signal-max-writes <n>  For backfill-email-intelligence, max writes for signal-indexing phase (default: --max-writes).",
        "  --signal-write-delay-ms <n>  For backfill-email-intelligence, delay between signal-indexing writes (default: --write-delay-ms).",
        "  --signal-stop-after-timeout-errors <n>  For backfill-email-intelligence, timeout breaker for signal-indexing phase (default: --stop-after-timeout-errors).",
        "  --signal-infer-relationships true|false  For backfill-email-intelligence signal phase (fallback: --infer-relationships).",
        "  --signal-relationship-probe-limit <n>  For backfill-email-intelligence signal phase (fallback: --relationship-probe-limit).",
        "  --signal-max-inferred-edges-per-memory <n>  For backfill-email-intelligence signal phase (fallback: --max-inferred-edges-per-memory).",
        "  --signal-min-related-signal-score <n>  For backfill-email-intelligence signal phase (fallback: --min-related-signal-score).",
        "  --include-loop-state-updates true|false  For backfill-signal-indexing, apply loop-state pointers from patterns (default: true).",
        "  --dispatch true|false  Dispatch import briefing/digest payloads to webhook (default: false).",
        "  --webhook-url      Webhook URL for dispatch-enabled commands (fallback: STUDIO_BRAIN_LOOP_DIGEST_WEBHOOK).",
        "  --ingest-secret    HMAC secret for /api/memory/ingest (or STUDIO_BRAIN_MEMORY_INGEST_HMAC_SECRET)",
      ].join("\n")
    );
    return;
  }

  const baseUrl = String(flags["base-url"] ?? resolveStudioBrainBaseUrlFromEnv({ env: process.env })).replace(/\/$/, "");
  const authorization = normalizeBearer(
    flags.auth ?? process.env.STUDIO_BRAIN_AUTH_TOKEN ?? process.env.STUDIO_BRAIN_ID_TOKEN ?? ""
  );
  const adminToken = String(flags["admin-token"] ?? process.env.STUDIO_BRAIN_ADMIN_TOKEN ?? "").trim();
  const requestTimeoutMs = intFlag(flags["timeout-ms"], intFlag(process.env.OPEN_MEMORY_HTTP_TIMEOUT_MS, 30000));
  const requestRetryMax = intFlag(flags["retry-max"], intFlag(process.env.OPEN_MEMORY_HTTP_RETRIES, 2));
  const requestRetryBaseMs = intFlag(
    flags["retry-base-ms"],
    intFlag(process.env.OPEN_MEMORY_HTTP_RETRY_BASE_MS, 400)
  );
  const maxAttempts = Math.max(1, requestRetryMax + 1);

  const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, Math.max(0, ms)));
  const isRetryableStatus = (status) => [408, 425, 429, 500, 502, 503, 504].includes(Number(status));
  const parseRetryAfterMs = (headerValue) => {
    const value = String(headerValue ?? "").trim();
    if (!value) return 0;
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric >= 0) return Math.round(numeric * 1000);
    const epochMs = Date.parse(value);
    if (Number.isFinite(epochMs)) return Math.max(0, epochMs - Date.now());
    return 0;
  };
  const computeRetryDelayMs = (attempt, retryAfterHeader = "", status = 503) => {
    const retryAfterMs = parseRetryAfterMs(retryAfterHeader);
    if (retryAfterMs > 0) {
      return Math.min(retryAfterMs, 120_000);
    }
    const base = Number(status) === 429 ? 1200 : Math.max(100, requestRetryBaseMs);
    const exp = Math.min(120_000, Math.round(base * 2 ** Math.max(0, attempt - 1)));
    const jitter = Math.floor(Math.random() * 350);
    return exp + jitter;
  };
  const isRetryableTransportError = (reason, timedOut) =>
    Boolean(timedOut) || /\bECONNRESET\b|\bECONNREFUSED\b|\bETIMEDOUT\b|socket hang up|network/i.test(reason);

  const request = async (path, method = "GET", body = undefined) => {
    let attempt = 0;
    while (attempt < maxAttempts) {
      attempt += 1;
      const headers = { "content-type": "application/json" };
      if (authorization) headers.authorization = authorization;
      if (adminToken) headers["x-studio-brain-admin-token"] = adminToken;
      const controller = requestTimeoutMs > 0 ? new AbortController() : null;
      const timeoutHandle =
        controller && requestTimeoutMs > 0
          ? setTimeout(() => {
              controller.abort();
            }, requestTimeoutMs)
          : null;

      let response;
      try {
        response = await fetch(`${baseUrl}${path}`, {
          method,
          headers,
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: controller?.signal,
        });
      } catch (error) {
        if (timeoutHandle) clearTimeout(timeoutHandle);
        const timedOut = error instanceof Error && error.name === "AbortError";
        const reason = error instanceof Error ? error.message : String(error);
        const retryable = isRetryableTransportError(reason, timedOut);
        if (retryable && attempt < maxAttempts) {
          const delayMs = computeRetryDelayMs(attempt, "", 503);
          await sleep(delayMs);
          continue;
        }
        if (timedOut) {
          throw new Error(
            `Request timed out after ${requestTimeoutMs}ms reaching Studio Brain memory API at ${baseUrl}${path}.`
          );
        }
        throw new Error(`Failed to reach Studio Brain memory API at ${baseUrl}${path}: ${reason}`);
      }
      if (timeoutHandle) clearTimeout(timeoutHandle);

      const raw = await response.text();
      let parsed;
      try {
        parsed = raw ? JSON.parse(raw) : {};
      } catch {
        parsed = { raw };
      }

      if (!response.ok) {
        if (isRetryableStatus(response.status) && attempt < maxAttempts) {
          const delayMs = computeRetryDelayMs(attempt, response.headers.get("retry-after"), response.status);
          await sleep(delayMs);
          continue;
        }
        const message = typeof parsed?.message === "string" ? parsed.message : `HTTP ${response.status}`;
        const hint =
          response.status === 404
            ? " Memory routes are not available on this Studio Brain instance."
            : "";
        throw new Error(`${message} (${response.status}) from ${baseUrl}${path}.${hint}`);
      }
      return parsed;
    }
    throw new Error(`Request failed after ${maxAttempts} attempts at ${baseUrl}${path}.`);
  };

  if (command === "capture") {
    const stdinText = await readStdinText();
    const content = String(flags.text ?? flags.content ?? stdinText ?? "").trim();
    if (!content) {
      throw new Error("capture requires --text (or stdin text).");
    }
    const payload = {
      content,
      source: String(flags.source ?? "manual"),
      tags: parseCsv(flags.tags),
      tenantId: flags["tenant-id"] ? String(flags["tenant-id"]).trim() : undefined,
      agentId: flags["agent-id"] ? String(flags["agent-id"]).trim() : undefined,
      runId: flags["run-id"] ? String(flags["run-id"]).trim() : undefined,
    };
    const result = await request("/api/memory/capture", "POST", payload);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  if (command === "context") {
    const payload = {
      tenantId: flags["tenant-id"] ? String(flags["tenant-id"]).trim() : undefined,
      agentId: flags["agent-id"] ? String(flags["agent-id"]).trim() : undefined,
      runId: flags["run-id"] ? String(flags["run-id"]).trim() : undefined,
      seedMemoryId: flags["seed-memory-id"] ? String(flags["seed-memory-id"]).trim() : undefined,
      query: flags.query ? String(flags.query).trim() : undefined,
      maxItems: intFlag(flags["max-items"], 12),
      maxChars: intFlag(flags["max-chars"], 8000),
      scanLimit: intFlag(flags["scan-limit"], 200),
      includeTenantFallback:
        String(flags["include-tenant-fallback"] ?? "true").trim().toLowerCase() !== "false",
      expandRelationships: String(flags["expand-relationships"] ?? "").trim().toLowerCase() === "true",
      maxHops: intFlag(flags["max-hops"], 2),
    };
    const result = await request("/api/memory/context", "POST", payload);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  if (command === "neighborhood" || command === "relationship-diagnostics") {
    const memoryId = String(flags["memory-id"] ?? flags["seed-memory-id"] ?? "").trim();
    if (!memoryId) {
      throw new Error(`${command} requires --memory-id (or --seed-memory-id).`);
    }

    const maxHops = Math.max(1, intFlag(flags["max-hops"], 2));
    const maxItems = Math.max(1, intFlag(flags["max-items"], 24));
    const maxChars = Math.max(256, intFlag(flags["max-chars"], 12_000));
    const scanLimit = Math.max(1, intFlag(flags["scan-limit"], 320));
    const payload = {
      tenantId: flags["tenant-id"] ? String(flags["tenant-id"]).trim() : undefined,
      agentId: flags["agent-id"] ? String(flags["agent-id"]).trim() : undefined,
      runId: flags["run-id"] ? String(flags["run-id"]).trim() : undefined,
      seedMemoryId: memoryId,
      query: flags.query ? String(flags.query).trim() : undefined,
      maxItems,
      maxChars,
      scanLimit,
      includeTenantFallback:
        String(flags["include-tenant-fallback"] ?? "false").trim().toLowerCase() === "true",
      expandRelationships: true,
      maxHops,
    };
    const contextResult = await request("/api/memory/context", "POST", payload);
    const rows = extractSearchRows(contextResult);
    const preview = buildContextRelationshipPreview(contextResult, memoryId);
    const related = dedupeRelatedEntries([...preview.related, ...rows], { excludeId: memoryId }).map((entry, index) => ({
      rank: index + 1,
      ...entry,
    }));
    const neighborhood = {
      seedMemoryId: memoryId,
      maxHops,
      nodeLimit: maxItems,
      related,
      edgeSummary: {
        ...(preview.edgeSummary && typeof preview.edgeSummary === "object" ? preview.edgeSummary : {}),
        relatedCount: related.length,
        maxHops,
      },
    };

    if (command === "neighborhood") {
      process.stdout.write(
        `${JSON.stringify(
          {
            status: "ok",
            neighborhood,
          },
          null,
          2
        )}\n`
      );
      return;
    }

    const relationshipTypeCounts = new Map();
    let rowsWithRelationships = 0;
    let conflictEdgeCount = 0;
    for (const row of rows) {
      const metadata = row?.metadata && typeof row.metadata === "object" ? row.metadata : {};
      const relationships = Array.isArray(metadata.relationships)
        ? metadata.relationships.filter((entry) => entry && typeof entry === "object")
        : [];
      const relationTypes = Array.isArray(metadata.relationTypes)
        ? metadata.relationTypes.map((entry) => String(entry || "").trim()).filter(Boolean)
        : [];
      if (relationships.length > 0) {
        rowsWithRelationships += 1;
        for (const relationship of relationships) {
          const relationType = String(relationship.type || relationship.relationType || "unknown").trim() || "unknown";
          relationshipTypeCounts.set(relationType, Number(relationshipTypeCounts.get(relationType) || 0) + 1);
          const normalizedType = relationType.toLowerCase();
          if (normalizedType.includes("conflict") || normalizedType.includes("contradiction")) {
            conflictEdgeCount += 1;
          }
        }
      } else {
        for (const relationType of relationTypes) {
          relationshipTypeCounts.set(relationType, Number(relationshipTypeCounts.get(relationType) || 0) + 1);
          const normalizedType = relationType.toLowerCase();
          if (normalizedType.includes("conflict") || normalizedType.includes("contradiction")) {
            conflictEdgeCount += 1;
          }
        }
      }
    }

    process.stdout.write(
      `${JSON.stringify(
        {
          status: "ok",
          diagnostics: {
            seedMemoryId: memoryId,
            maxHops,
            rowsScanned: rows.length,
            rowsWithRelationships,
            relationshipTypeCounts: mapToSortedObject(relationshipTypeCounts),
            unresolvedConflictEdges: conflictEdgeCount,
            relatedCount: related.length,
          },
          neighborhood,
        },
        null,
        2
      )}\n`
    );
    return;
  }

  if (command === "ingest") {
    const stdinText = await readStdinText();
    const content = String(flags.text ?? flags.content ?? stdinText ?? "").trim();
    if (!content) {
      throw new Error("ingest requires --text (or stdin text).");
    }
    const ingestSecret = String(
      flags["ingest-secret"] ?? process.env.STUDIO_BRAIN_MEMORY_INGEST_HMAC_SECRET ?? ""
    ).trim();
    if (!ingestSecret) {
      throw new Error("ingest requires --ingest-secret or STUDIO_BRAIN_MEMORY_INGEST_HMAC_SECRET.");
    }

    const metadata = {};
    const metadataJson = String(flags["metadata-json"] ?? "").trim();
    if (metadataJson) {
      const parsed = JSON.parse(metadataJson);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        Object.assign(metadata, parsed);
      } else {
        throw new Error("--metadata-json must be a JSON object.");
      }
    }
    if (flags["discord-guild-id"]) metadata.discordGuildId = String(flags["discord-guild-id"]).trim();
    if (flags["discord-channel-id"]) metadata.discordChannelId = String(flags["discord-channel-id"]).trim();
    if (flags["discord-author-id"]) metadata.discordAuthorId = String(flags["discord-author-id"]).trim();

    const timestamp = intFlag(flags.timestamp, Math.trunc(Date.now() / 1000));
    const payload = {
      content,
      source: String(flags.source ?? "discord").trim() || "discord",
      tenantId: flags["tenant-id"] ? String(flags["tenant-id"]).trim() : undefined,
      clientRequestId: String(
        flags["client-request-id"] ??
          flags["request-id"] ??
          `${String(flags.source ?? "discord").trim() || "discord"}-${timestamp}`
      ).trim(),
      tags: parseCsv(flags.tags),
      metadata,
      occurredAt: flags["occurred-at"] ? String(flags["occurred-at"]).trim() : undefined,
    };
    const rawBody = JSON.stringify(payload);
    const signature = crypto.createHmac("sha256", ingestSecret).update(`${timestamp}.${rawBody}`).digest("hex");
    let response;
    try {
      response = await fetch(`${baseUrl}/api/memory/ingest`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-memory-ingest-timestamp": `${timestamp}`,
          "x-memory-ingest-signature": `v1=${signature}`,
        },
        body: rawBody,
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to reach Studio Brain memory ingest API at ${baseUrl}/api/memory/ingest: ${reason}`);
    }
    const raw = await response.text();
    let parsed;
    try {
      parsed = raw ? JSON.parse(raw) : {};
    } catch {
      parsed = { raw };
    }
    if (!response.ok) {
      const message = typeof parsed?.message === "string" ? parsed.message : `HTTP ${response.status}`;
      const hint =
        response.status === 404
          ? " Memory ingest route is not available on this Studio Brain instance."
          : "";
      throw new Error(`${message} (${response.status}) from ${baseUrl}/api/memory/ingest.${hint}`);
    }
    process.stdout.write(`${JSON.stringify(parsed, null, 2)}\n`);
    return;
  }

  if (command === "search") {
    const query = String(flags.query ?? "").trim();
    if (!query) {
      throw new Error("search requires --query.");
    }
    const minScoreRaw = Number(flags["min-score"]);
    const minScore = Number.isFinite(minScoreRaw) ? minScoreRaw : undefined;
    const retrievalMode = String(flags["retrieval-mode"] ?? "").trim();
    const payload = {
      query,
      limit: intFlag(flags.limit, 10),
      tenantId: flags["tenant-id"] ? String(flags["tenant-id"]).trim() : undefined,
      agentId: flags["agent-id"] ? String(flags["agent-id"]).trim() : undefined,
      runId: flags["run-id"] ? String(flags["run-id"]).trim() : undefined,
      sourceAllowlist: parseCsv(flags["source-allowlist"]),
      sourceDenylist: parseCsv(flags["source-denylist"]),
      retrievalMode: retrievalMode || undefined,
      minScore,
      explain: boolFlag(flags.explain, false),
    };
    const result = await request("/api/memory/search", "POST", payload);

    const expandRelationships = boolFlag(flags["expand-relationships"], false);
    const relationshipPreviewLimit = intFlag(flags["relationship-preview-limit"], 3);
    const relationshipPreviewMaxItems = intFlag(flags["relationship-preview-max-items"], 16);
    const relationshipPreviewMaxChars = intFlag(flags["relationship-preview-max-chars"], 10_000);
    const relationshipPreviewScanLimit = intFlag(flags["relationship-preview-scan-limit"], 220);
    const maxHops = intFlag(flags["max-hops"], 2);

    if (expandRelationships && relationshipPreviewLimit > 0) {
      const searchRows = extractSearchRows(result);
      const seedRows = searchRows
        .map((row) => ({ id: extractRowId(row), row }))
        .filter((entry) => Boolean(entry.id))
        .slice(0, Math.max(0, relationshipPreviewLimit));

      const previewRows = [];
      for (const entry of seedRows) {
        try {
          const contextPayload = await request("/api/memory/context", "POST", {
            tenantId: payload.tenantId,
            agentId: payload.agentId,
            runId: payload.runId,
            seedMemoryId: entry.id,
            query: payload.query,
            sourceAllowlist: payload.sourceAllowlist ?? [],
            sourceDenylist: payload.sourceDenylist ?? [],
            retrievalMode: payload.retrievalMode ?? "hybrid",
            explain: payload.explain ?? false,
            maxItems: Math.max(1, relationshipPreviewMaxItems),
            maxChars: Math.max(256, relationshipPreviewMaxChars),
            scanLimit: Math.max(1, relationshipPreviewScanLimit),
            includeTenantFallback: false,
            expandRelationships: true,
            maxHops: Math.max(1, maxHops),
          });
          const preview = buildContextRelationshipPreview(contextPayload, entry.id);
          previewRows.push({
            memoryId: entry.id,
            score: Number(entry.row?.score ?? entry.row?.relevanceScore ?? NaN),
            summary: summaryFromRow(entry.row, 180),
            related: preview.related,
            edgeSummary: preview.edgeSummary,
          });
        } catch (error) {
          previewRows.push({
            memoryId: entry.id,
            score: Number(entry.row?.score ?? entry.row?.relevanceScore ?? NaN),
            summary: summaryFromRow(entry.row, 180),
            related: [],
            edgeSummary: { relatedCount: 0 },
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      const aggregateRelated = dedupeRelatedEntries(
        previewRows.flatMap((row) => (Array.isArray(row.related) ? row.related : []))
      );
      result.relationshipPreview = {
        enabled: true,
        maxHops: Math.max(1, maxHops),
        rows: previewRows,
      };
      result.related = aggregateRelated;
      result.edgeSummary = {
        ...buildEdgeSummaryFromPreviewRows(previewRows),
        maxHops: Math.max(1, maxHops),
      };
    }

    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  if (command === "recent") {
    const query = new URLSearchParams();
    query.set("limit", String(intFlag(flags.limit, 20)));
    if (flags["tenant-id"]) query.set("tenantId", String(flags["tenant-id"]).trim());
    const result = await request(`/api/memory/recent?${query.toString()}`, "GET");
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  if (command === "stats") {
    const query = new URLSearchParams();
    if (flags["tenant-id"]) query.set("tenantId", String(flags["tenant-id"]).trim());
    const suffix = query.toString();
    const result = await request(`/api/memory/stats${suffix ? `?${suffix}` : ""}`, "GET");
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  if (command === "loops") {
    const query = new URLSearchParams();
    if (flags["tenant-id"]) query.set("tenantId", String(flags["tenant-id"]).trim());
    query.set("limit", String(intFlag(flags.limit, 30)));
    if (flags.states) query.set("states", parseCsv(flags.states).join(","));
    if (flags.lanes) query.set("lanes", parseCsv(flags.lanes).join(","));
    if (flags["loop-keys"]) query.set("loopKeys", parseCsv(flags["loop-keys"]).join(","));
    if (flags.query) query.set("query", String(flags.query).trim());
    if (flags["sort-by"]) query.set("sortBy", String(flags["sort-by"]).trim());
    if (flags["min-attention"]) query.set("minAttention", String(flags["min-attention"]).trim());
    if (flags["min-volatility"]) query.set("minVolatility", String(flags["min-volatility"]).trim());
    if (flags["min-anomaly"]) query.set("minAnomaly", String(flags["min-anomaly"]).trim());
    if (flags["min-centrality"]) query.set("minCentrality", String(flags["min-centrality"]).trim());
    if (flags["min-escalation"]) query.set("minEscalation", String(flags["min-escalation"]).trim());
    if (flags["min-blast-radius"]) query.set("minBlastRadius", String(flags["min-blast-radius"]).trim());
    if (flags["incident-limit"]) query.set("incidentLimit", String(flags["incident-limit"]).trim());
    if (flags["incident-min-escalation"]) {
      query.set("incidentMinEscalation", String(flags["incident-min-escalation"]).trim());
    }
    if (flags["incident-min-blast-radius"]) {
      query.set("incidentMinBlastRadius", String(flags["incident-min-blast-radius"]).trim());
    }
    if (flags["include-memory"]) query.set("includeMemory", String(flags["include-memory"]).trim());
    if (flags["include-incidents"]) query.set("includeIncidents", String(flags["include-incidents"]).trim());
    const result = await request(`/api/memory/loops?${query.toString()}`, "GET");
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  if (command === "incidents") {
    const query = new URLSearchParams();
    if (flags["tenant-id"]) query.set("tenantId", String(flags["tenant-id"]).trim());
    query.set("limit", String(intFlag(flags.limit, 12)));
    if (flags.query) query.set("query", String(flags.query).trim());
    if (flags.states) query.set("states", parseCsv(flags.states).join(","));
    if (flags.lanes) query.set("lanes", parseCsv(flags.lanes).join(","));
    if (flags["loop-keys"]) query.set("loopKeys", parseCsv(flags["loop-keys"]).join(","));
    if (flags["incident-min-escalation"]) {
      query.set("incidentMinEscalation", String(flags["incident-min-escalation"]).trim());
    }
    if (flags["incident-min-blast-radius"]) {
      query.set("incidentMinBlastRadius", String(flags["incident-min-blast-radius"]).trim());
    }
    const result = await request(`/api/memory/loops/incidents?${query.toString()}`, "GET");
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  if (command === "incident-action") {
    const loopKey = String(flags["loop-key"] ?? flags.loopKey ?? "").trim();
    const action = String(flags.action ?? "").trim();
    if (!loopKey) {
      throw new Error("incident-action requires --loop-key.");
    }
    if (!action) {
      throw new Error("incident-action requires --action.");
    }
    const payload = {
      tenantId: flags["tenant-id"] ? String(flags["tenant-id"]).trim() : undefined,
      loopKey,
      action,
      incidentId: flags["incident-id"] ? String(flags["incident-id"]).trim() : undefined,
      memoryId: flags["memory-id"] ? String(flags["memory-id"]).trim() : undefined,
      idempotencyKey: flags["idempotency-key"] ? String(flags["idempotency-key"]).trim() : undefined,
      actorId: flags["actor-id"] ? String(flags["actor-id"]).trim() : undefined,
      note: flags.note ? String(flags.note).trim() : undefined,
      occurredAt: flags["occurred-at"] ? String(flags["occurred-at"]).trim() : undefined,
    };
    const result = await request("/api/memory/loops/incident-action", "POST", payload);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  if (command === "incident-action-batch") {
    const inputPath = String(flags.input ?? "").trim();
    if (!inputPath) {
      throw new Error("incident-action-batch requires --input <path>.");
    }
    const raw = readFileSync(resolve(process.cwd(), inputPath), "utf8");
    const parsed = JSON.parse(raw);
    const actions = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.actions) ? parsed.actions : [];
    if (!Array.isArray(actions) || actions.length === 0) {
      throw new Error("incident-action-batch input must be a non-empty array or an object with actions[].");
    }
    const payload = {
      tenantId: flags["tenant-id"] ? String(flags["tenant-id"]).trim() : undefined,
      actorId: flags["actor-id"] ? String(flags["actor-id"]).trim() : undefined,
      idempotencyPrefix: flags["idempotency-prefix"] ? String(flags["idempotency-prefix"]).trim() : undefined,
      continueOnError: String(flags["continue-on-error"] ?? "true").trim().toLowerCase() !== "false",
      actions,
    };
    const result = await request("/api/memory/loops/incident-action/batch", "POST", payload);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  if (command === "feedback-stats") {
    const query = new URLSearchParams();
    if (flags["tenant-id"]) query.set("tenantId", String(flags["tenant-id"]).trim());
    query.set("limit", String(intFlag(flags.limit, 120)));
    query.set("windowDays", String(intFlag(flags["window-days"], 180)));
    if (flags["loop-keys"]) query.set("loopKeys", parseCsv(flags["loop-keys"]).join(","));
    const result = await request(`/api/memory/loops/feedback-stats?${query.toString()}`, "GET");
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  if (command === "owner-queues") {
    const query = new URLSearchParams();
    if (flags["tenant-id"]) query.set("tenantId", String(flags["tenant-id"]).trim());
    query.set("limit", String(intFlag(flags.limit, 50)));
    query.set("incidentLimit", String(intFlag(flags["incident-limit"], 20)));
    if (flags.query) query.set("query", String(flags.query).trim());
    if (flags.states) query.set("states", parseCsv(flags.states).join(","));
    if (flags.lanes) query.set("lanes", parseCsv(flags.lanes).join(","));
    if (flags["loop-keys"]) query.set("loopKeys", parseCsv(flags["loop-keys"]).join(","));
    if (flags["incident-min-escalation"]) {
      query.set("incidentMinEscalation", String(flags["incident-min-escalation"]).trim());
    }
    if (flags["incident-min-blast-radius"]) {
      query.set("incidentMinBlastRadius", String(flags["incident-min-blast-radius"]).trim());
    }
    const result = await request(`/api/memory/loops/owner-queues?${query.toString()}`, "GET");
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  if (command === "action-plan") {
    const query = new URLSearchParams();
    if (flags["tenant-id"]) query.set("tenantId", String(flags["tenant-id"]).trim());
    query.set("limit", String(intFlag(flags.limit, 50)));
    query.set("incidentLimit", String(intFlag(flags["incident-limit"], 30)));
    query.set("maxActions", String(intFlag(flags["max-actions"], 40)));
    if (flags.query) query.set("query", String(flags.query).trim());
    if (flags.states) query.set("states", parseCsv(flags.states).join(","));
    if (flags.lanes) query.set("lanes", parseCsv(flags.lanes).join(","));
    if (flags["loop-keys"]) query.set("loopKeys", parseCsv(flags["loop-keys"]).join(","));
    if (flags["incident-min-escalation"]) {
      query.set("incidentMinEscalation", String(flags["incident-min-escalation"]).trim());
    }
    if (flags["incident-min-blast-radius"]) {
      query.set("incidentMinBlastRadius", String(flags["incident-min-blast-radius"]).trim());
    }
    if (flags["include-batch-payload"]) {
      query.set("includeBatchPayload", String(flags["include-batch-payload"]).trim());
    }
    const result = await request(`/api/memory/loops/action-plan?${query.toString()}`, "GET");
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  if (command === "automation-tick") {
    const payload = {
      tenantId: flags["tenant-id"] ? String(flags["tenant-id"]).trim() : undefined,
      query: flags.query ? String(flags.query).trim() : undefined,
      states: flags.states ? parseCsv(flags.states) : [],
      lanes: flags.lanes ? parseCsv(flags.lanes) : [],
      loopKeys: flags["loop-keys"] ? parseCsv(flags["loop-keys"]) : [],
      limit: intFlag(flags["plan-limit"] ?? flags.limit, 50),
      incidentLimit: intFlag(flags["incident-limit"], 30),
      maxActions: intFlag(flags["max-actions"], 30),
      incidentMinEscalation: flags["incident-min-escalation"]
        ? Number(String(flags["incident-min-escalation"]).trim())
        : undefined,
      incidentMinBlastRadius: flags["incident-min-blast-radius"]
        ? Number(String(flags["incident-min-blast-radius"]).trim())
        : undefined,
      applyActions: String(flags["apply-actions"] ?? "").trim().toLowerCase() === "true",
      actorId: flags["actor-id"] ? String(flags["actor-id"]).trim() : undefined,
      idempotencyKey: flags["idempotency-key"] ? String(flags["idempotency-key"]).trim() : undefined,
      applyPriorities: flags["apply-priorities"] ? parseCsv(flags["apply-priorities"]) : undefined,
      allowedActions: flags["allowed-actions"] ? parseCsv(flags["allowed-actions"]) : undefined,
      includeBatchPayload: true,
      dispatch: String(flags.dispatch ?? "").trim().toLowerCase() === "true",
      webhookUrl: flags["webhook-url"] ? String(flags["webhook-url"]).trim() : undefined,
    };
    const result = await request("/api/memory/loops/automation-tick", "POST", payload);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  if (command === "digest") {
    const query = new URLSearchParams();
    if (flags["tenant-id"]) query.set("tenantId", String(flags["tenant-id"]).trim());
    query.set("limit", String(intFlag(flags.limit, 12)));
    if (flags.query) query.set("query", String(flags.query).trim());
    if (flags.states) query.set("states", parseCsv(flags.states).join(","));
    if (flags.lanes) query.set("lanes", parseCsv(flags.lanes).join(","));
    if (flags["loop-keys"]) query.set("loopKeys", parseCsv(flags["loop-keys"]).join(","));
    if (flags["incident-min-escalation"]) {
      query.set("incidentMinEscalation", String(flags["incident-min-escalation"]).trim());
    }
    if (flags["incident-min-blast-radius"]) {
      query.set("incidentMinBlastRadius", String(flags["incident-min-blast-radius"]).trim());
    }
    if (flags.dispatch) query.set("dispatch", String(flags.dispatch).trim());
    if (flags["webhook-url"]) query.set("webhookUrl", String(flags["webhook-url"]).trim());
    const result = await request(`/api/memory/loops/digest?${query.toString()}`, "GET");
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  if (command === "import") {
    const inputPath = String(flags.input ?? "").trim();
    if (!inputPath) {
      throw new Error("import requires --input <path>.");
    }
    const payload = buildImportCommandPayload({
      inputPath,
      flags,
      intFlag,
      parseCsv,
    });
    const result = await request("/api/memory/import", "POST", payload);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  if (command === "backfill-email-threading") {
    const payload = {
      tenantId: flags["tenant-id"] ? String(flags["tenant-id"]).trim() : undefined,
      limit: intFlag(flags.limit, 2000),
      dryRun: boolFlag(flags["dry-run"], false),
      sourcePrefixes: flags["source-prefixes"] ? parseCsv(flags["source-prefixes"]) : undefined,
      includeNonMailLikeWithMessageSignals: boolFlag(flags["include-non-mail-like"], false),
      maxWrites: intFlag(flags["max-writes"], 500),
      writeDelayMs: intFlag(flags["write-delay-ms"], 20),
      stopAfterTimeoutErrors: intFlag(flags["stop-after-timeout-errors"], 5),
    };
    const result = await request("/api/memory/backfill-email-threading", "POST", payload);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  if (command === "backfill-signal-indexing") {
    const payload = {
      tenantId: flags["tenant-id"] ? String(flags["tenant-id"]).trim() : undefined,
      limit: intFlag(flags.limit, 2000),
      dryRun: boolFlag(flags["dry-run"], false),
      sourcePrefixes: flags["source-prefixes"] ? parseCsv(flags["source-prefixes"]) : undefined,
      includeNonMailLike: boolFlag(flags["include-non-mail-like"], false),
      minSignals: intFlag(flags["min-signals"], 1),
      skipAlreadyIndexed: boolFlag(flags["skip-already-indexed"], true),
      includeLoopStateUpdates: boolFlag(flags["include-loop-state-updates"], true),
      inferRelationships: boolFlag(flags["infer-relationships"], true),
      relationshipProbeLimit: intFlag(flags["relationship-probe-limit"], 24),
      maxInferredEdgesPerMemory: intFlag(flags["max-inferred-edges-per-memory"], 16),
      minRelatedSignalScore: numberFlag(flags["min-related-signal-score"], 0.12),
      maxWrites: intFlag(flags["max-writes"], 500),
      writeDelayMs: intFlag(flags["write-delay-ms"], 20),
      stopAfterTimeoutErrors: intFlag(flags["stop-after-timeout-errors"], 5),
    };
    const result = await request("/api/memory/backfill-signal-indexing", "POST", payload);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  if (command === "scrub-thread-metadata") {
    const payload = {
      tenantId: flags["tenant-id"] ? String(flags["tenant-id"]).trim() : undefined,
      limit: intFlag(flags.limit, 2000),
      dryRun: boolFlag(flags["dry-run"], false),
      sourcePrefixes: flags["source-prefixes"] ? parseCsv(flags["source-prefixes"]) : undefined,
      includeMailLike: boolFlag(flags["include-mail-like"], false),
      maxWrites: intFlag(flags["max-writes"], 500),
      writeDelayMs: intFlag(flags["write-delay-ms"], 20),
      stopAfterTimeoutErrors: intFlag(flags["stop-after-timeout-errors"], 5),
    };
    const result = await request("/api/memory/scrub-thread-metadata", "POST", payload);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  if (command === "backfill-email-intelligence") {
    const tenantId = flags["tenant-id"] ? String(flags["tenant-id"]).trim() : undefined;
    const limit = intFlag(flags.limit, 2000);
    const dryRun = boolFlag(flags["dry-run"], false);
    const sourcePrefixes = flags["source-prefixes"] ? parseCsv(flags["source-prefixes"]) : undefined;
    const includeNonMailLike = boolFlag(flags["include-non-mail-like"], false);
    const maxWrites = intFlag(flags["max-writes"], 500);
    const writeDelayMs = intFlag(flags["write-delay-ms"], 20);
    const stopAfterTimeoutErrors = intFlag(flags["stop-after-timeout-errors"], 5);
    const signalMinSignals = intFlag(flags["signal-min-signals"], intFlag(flags["min-signals"], 1));
    const signalMaxWrites = intFlag(flags["signal-max-writes"], maxWrites);
    const signalWriteDelayMs = intFlag(flags["signal-write-delay-ms"], writeDelayMs);
    const signalStopAfterTimeoutErrors = intFlag(flags["signal-stop-after-timeout-errors"], stopAfterTimeoutErrors);
    const signalSkipAlreadyIndexed = boolFlag(flags["skip-already-indexed"], true);
    const includeLoopStateUpdates = boolFlag(flags["include-loop-state-updates"], true);
    const signalInferRelationships = boolFlag(
      flags["signal-infer-relationships"],
      boolFlag(flags["infer-relationships"], true)
    );
    const signalRelationshipProbeLimit = intFlag(
      flags["signal-relationship-probe-limit"],
      intFlag(flags["relationship-probe-limit"], 24)
    );
    const signalMaxInferredEdgesPerMemory = intFlag(
      flags["signal-max-inferred-edges-per-memory"],
      intFlag(flags["max-inferred-edges-per-memory"], 16)
    );
    const signalMinRelatedSignalScore = numberFlag(
      flags["signal-min-related-signal-score"],
      numberFlag(flags["min-related-signal-score"], 0.12)
    );

    const threadingPayload = {
      tenantId,
      limit,
      dryRun,
      sourcePrefixes,
      includeNonMailLikeWithMessageSignals: includeNonMailLike,
      maxWrites,
      writeDelayMs,
      stopAfterTimeoutErrors,
    };
    const signalPayload = {
      tenantId,
      limit,
      dryRun,
      sourcePrefixes,
      includeNonMailLike,
      minSignals: signalMinSignals,
      skipAlreadyIndexed: signalSkipAlreadyIndexed,
      includeLoopStateUpdates,
      inferRelationships: signalInferRelationships,
      relationshipProbeLimit: signalRelationshipProbeLimit,
      maxInferredEdgesPerMemory: signalMaxInferredEdgesPerMemory,
      minRelatedSignalScore: signalMinRelatedSignalScore,
      maxWrites: signalMaxWrites,
      writeDelayMs: signalWriteDelayMs,
      stopAfterTimeoutErrors: signalStopAfterTimeoutErrors,
    };

    const threadingResponse = await request("/api/memory/backfill-email-threading", "POST", threadingPayload);
    const threadingResult =
      threadingResponse && typeof threadingResponse === "object" && threadingResponse.result ? threadingResponse.result : threadingResponse;
    const signalResponse = await request("/api/memory/backfill-signal-indexing", "POST", signalPayload);
    const signalResult = signalResponse && typeof signalResponse === "object" && signalResponse.result ? signalResponse.result : signalResponse;

    const summary = {
      dryRun,
      tenantId: signalResult?.tenantId ?? threadingResult?.tenantId ?? tenantId ?? null,
      phaseOrder: ["email-threading", "signal-indexing"],
      scanned: Number(threadingResult?.scanned ?? 0) + Number(signalResult?.scanned ?? 0),
      eligible: Number(threadingResult?.eligible ?? 0) + Number(signalResult?.eligible ?? 0),
      updated: Number(threadingResult?.updated ?? 0) + Number(signalResult?.updated ?? 0),
      failed: Number(threadingResult?.failed ?? 0) + Number(signalResult?.failed ?? 0),
      timeoutErrors: Number(threadingResult?.timeoutErrors ?? 0) + Number(signalResult?.timeoutErrors ?? 0),
      stoppedEarly:
        Boolean(threadingResult?.stoppedEarly) ||
        Boolean(signalResult?.stoppedEarly),
      stopReasons: [threadingResult?.stopReason, signalResult?.stopReason].filter((value) => value !== null && value !== undefined),
      convergence: {
        remainingEligible:
          Number(threadingResult?.convergence?.windowRemainingEligible ?? Math.max(0, Number(threadingResult?.eligible ?? 0) - Number(threadingResult?.updated ?? 0))) +
          Number(signalResult?.convergence?.windowRemainingEligible ?? Math.max(0, Number(signalResult?.eligible ?? 0) - Number(signalResult?.updated ?? 0))),
        exhaustedWithinWindow:
          Boolean(threadingResult?.convergence?.exhaustedWithinWindow ?? Math.max(0, Number(threadingResult?.eligible ?? 0) - Number(threadingResult?.updated ?? 0)) === 0) &&
          Boolean(signalResult?.convergence?.exhaustedWithinWindow ?? Math.max(0, Number(signalResult?.eligible ?? 0) - Number(signalResult?.updated ?? 0)) === 0),
        signalIndexedSkipRatio: Number(signalResult?.convergence?.indexedSkipRatio ?? 0),
      },
      relationshipInference: {
        enabled: Boolean(signalResult?.relationshipInference?.enabled ?? signalInferRelationships),
        probes: Number(signalResult?.relationshipInference?.probes ?? 0),
        memoriesAugmented: Number(signalResult?.relationshipInference?.memoriesAugmented ?? 0),
        inferredEdgesAdded: Number(signalResult?.relationshipInference?.inferredEdgesAdded ?? 0),
      },
    };

    process.stdout.write(
      `${JSON.stringify(
        {
          ok: true,
          summary,
          phases: {
            emailThreading: threadingResponse,
            signalIndexing: signalResponse,
          },
        },
        null,
        2
      )}\n`
    );
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

main().catch((error) => {
  process.stderr.write(`open-memory failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
