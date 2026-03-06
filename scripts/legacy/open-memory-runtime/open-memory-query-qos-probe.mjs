#!/usr/bin/env node

import { mintStaffIdTokenFromPortalEnv, normalizeBearer } from "./lib/firebase-auth-token.mjs";
import { resolveStudioBrainBaseUrlFromEnv } from "./studio-brain-url-resolution.mjs";

function parseArgs(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = String(argv[i] ?? "");
    if (!token.startsWith("--")) continue;
    const key = token.slice(2).trim().toLowerCase();
    if (key.includes("=")) {
      const [rawKey, ...rest] = key.split("=");
      flags[rawKey.trim().toLowerCase()] = rest.join("=");
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

function percentileFromSorted(values, percentile) {
  if (!Array.isArray(values) || values.length === 0) return 0;
  const bounded = Math.max(0, Math.min(1, Number(percentile) || 0));
  const index = Math.min(values.length - 1, Math.max(0, Math.ceil(values.length * bounded) - 1));
  return Number(values[index] ?? 0);
}

function summarizeLatency(samples) {
  const cleaned = (Array.isArray(samples) ? samples : [])
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value >= 0)
    .sort((a, b) => a - b);
  if (cleaned.length === 0) {
    return {
      count: 0,
      minMs: 0,
      p50Ms: 0,
      p95Ms: 0,
      p99Ms: 0,
      maxMs: 0,
      avgMs: 0,
    };
  }
  const sum = cleaned.reduce((total, value) => total + value, 0);
  return {
    count: cleaned.length,
    minMs: Number(cleaned[0].toFixed(2)),
    p50Ms: Number(percentileFromSorted(cleaned, 0.5).toFixed(2)),
    p95Ms: Number(percentileFromSorted(cleaned, 0.95).toFixed(2)),
    p99Ms: Number(percentileFromSorted(cleaned, 0.99).toFixed(2)),
    maxMs: Number(cleaned[cleaned.length - 1].toFixed(2)),
    avgMs: Number((sum / cleaned.length).toFixed(2)),
  };
}

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, Math.max(0, ms)));
}

function isDegraded(payload) {
  if (!payload || typeof payload !== "object") return false;
  if (payload.degradation && typeof payload.degradation === "object") {
    return payload.degradation.applied === true;
  }
  const diagnostics = payload.context?.diagnostics;
  if (diagnostics && typeof diagnostics === "object" && diagnostics.queryDegradation && typeof diagnostics.queryDegradation === "object") {
    return diagnostics.queryDegradation.applied === true;
  }
  return false;
}

function isDeferred(status, payload) {
  if (status === 503) return true;
  if (!payload || typeof payload !== "object") return false;
  return payload.degradation?.shed === true || String(payload.reason ?? "").toLowerCase() === "query-shed";
}

function summarizeFailure(result) {
  const payload = result?.payload;
  const message =
    typeof payload?.message === "string"
      ? payload.message
      : typeof payload?.raw === "string"
        ? payload.raw.slice(0, 300)
        : "";
  return {
    endpoint: result?.endpoint ?? "unknown",
    lane: result?.lane ?? "unknown",
    status: Number(result?.status ?? 0),
    message: message || "unknown-error",
  };
}

function countReturnedItems(result) {
  if (!result || typeof result !== "object") return 0;
  const payload = result.payload;
  if (Array.isArray(payload?.rows)) return payload.rows.length;
  if (Array.isArray(payload?.results)) return payload.results.length;
  if (Array.isArray(payload?.items)) return payload.items.length;
  if (Array.isArray(payload?.context?.items)) return payload.context.items.length;
  return 0;
}

function collectMatchedBy(payload, maxItems = 40) {
  const rows = Array.isArray(payload?.rows)
    ? payload.rows
    : Array.isArray(payload?.results)
      ? payload.results
      : Array.isArray(payload?.items)
        ? payload.items
        : Array.isArray(payload?.context?.items)
          ? payload.context.items
          : [];
  const out = [];
  for (const row of rows.slice(0, maxItems)) {
    if (!Array.isArray(row?.matchedBy)) continue;
    for (const key of row.matchedBy) {
      const normalized = String(key ?? "").trim().toLowerCase();
      if (!normalized) continue;
      out.push(normalized);
    }
  }
  return Array.from(new Set(out));
}

function extractContextDiagnostics(payload) {
  if (!payload || typeof payload !== "object") return null;
  if (payload.context && typeof payload.context === "object" && payload.context.diagnostics && typeof payload.context.diagnostics === "object") {
    return payload.context.diagnostics;
  }
  if (payload.diagnostics && typeof payload.diagnostics === "object") {
    return payload.diagnostics;
  }
  if (payload.payload && typeof payload.payload === "object" && payload.payload.diagnostics && typeof payload.payload.diagnostics === "object") {
    return payload.payload.diagnostics;
  }
  return null;
}

async function requestJson({ baseUrl, path, method, headers, body, timeoutMs }) {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await response.text();
    let payload = {};
    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      payload = { raw: text };
    }
    return {
      ok: response.ok,
      status: response.status,
      payload,
      latencyMs: Math.max(0, Date.now() - startedAt),
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      payload: {
        ok: false,
        message: error instanceof Error ? error.message : String(error),
      },
      latencyMs: Math.max(0, Date.now() - startedAt),
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  if (readBool(flags, "help", false)) {
    process.stdout.write(
      [
        "Open Memory Query QoS Probe",
        "",
        "Usage:",
        "  node ./scripts/open-memory-query-qos-probe.mjs --rounds 3 --burst 4 --query \"email escalation\"",
        "",
        "Options:",
        "  --base-url <url>                   Studio Brain base URL (default: env resolution)",
        "  --query <text>                       Search/context probe query",
        "  --tenant-id <id>                    Optional tenant id",
        "  --rounds <n>                        Probe rounds (default: 3)",
        "  --burst <n>                         Requests per lane per round (default: 4)",
        "  --between-round-ms <n>              Delay between rounds (default: 800)",
        "  --timeout-ms <n>                    Request timeout ms (default: 20000)",
        "  --search-limit <n>                  Search limit (default: 16)",
        "  --context-max-items <n>             Context maxItems (default: 16)",
        "  --context-scan-limit <n>            Context scanLimit (default: 220)",
        "  --include-context true|false        Include context probes (default: true)",
        "  --json true|false                   JSON output only (default: true)",
      ].join("\n") + "\n"
    );
    return;
  }

  const baseUrl = readString(flags, "base-url", resolveStudioBrainBaseUrlFromEnv({ env: process.env }));
  const query = readString(flags, "query", "email ownership escalation status");
  const tenantId = readString(flags, "tenant-id", "");
  const rounds = readInt(flags, "rounds", 3, { min: 1, max: 40 });
  const burst = readInt(flags, "burst", 4, { min: 1, max: 80 });
  const betweenRoundMs = readInt(flags, "between-round-ms", 800, { min: 0, max: 60_000 });
  const timeoutMs = readInt(flags, "timeout-ms", 20_000, { min: 500, max: 120_000 });
  const searchLimit = readInt(flags, "search-limit", 16, { min: 1, max: 100 });
  const contextMaxItems = readInt(flags, "context-max-items", 16, { min: 1, max: 100 });
  const contextScanLimit = readInt(flags, "context-scan-limit", 220, { min: 1, max: 500 });
  const includeContext = readBool(flags, "include-context", true);

  const minted = await mintStaffIdTokenFromPortalEnv({
    env: process.env,
    defaultCredentialsPath: "./secrets/portal/portal-agent-staff.json",
    preferRefreshToken: true,
  });
  if (!minted.ok || !minted.token) {
    throw new Error(`token-mint-failed:${minted.reason || "unknown"}`);
  }

  const headers = {
    "content-type": "application/json",
    authorization: normalizeBearer(minted.token),
  };
  const adminToken = String(process.env.STUDIO_BRAIN_ADMIN_TOKEN ?? "").trim();
  if (adminToken) {
    headers["x-studio-brain-admin-token"] = adminToken;
  }

  const pressureBefore = await requestJson({
    baseUrl,
    path: "/api/memory/pressure",
    method: "GET",
    headers,
    timeoutMs,
  });

  const roundSummaries = [];
  const aggregate = {
    totalRequests: 0,
    ok: 0,
    failed: 0,
    deferred: 0,
    degraded: 0,
    emptyResults: 0,
    degradedEmpty: 0,
    byStatus: {},
    byLane: {
      interactive: { total: 0, ok: 0, deferred: 0, degraded: 0, returnedItems: 0, emptyResults: 0, degradedEmpty: 0 },
      bulk: { total: 0, ok: 0, deferred: 0, degraded: 0, returnedItems: 0, emptyResults: 0, degradedEmpty: 0 },
    },
    byEndpoint: {
      search: { total: 0, ok: 0, deferred: 0, degraded: 0, returnedItems: 0, emptyResults: 0, degradedEmpty: 0 },
      context: { total: 0, ok: 0, deferred: 0, degraded: 0, returnedItems: 0, emptyResults: 0, degradedEmpty: 0 },
    },
    errorSamples: [],
    responseSamples: [],
    returnedItems: 0,
    matchedByCounts: {},
  };
  const aggregateLatencies = [];
  const aggregateLaneLatencies = { interactive: [], bulk: [] };
  const aggregateEndpointLatencies = { search: [], context: [] };

  for (let round = 1; round <= rounds; round += 1) {
    const requests = [];
    const pushProbe = (path, endpoint, lane, body) => {
      requests.push(
        requestJson({ baseUrl, path, method: "POST", headers, body, timeoutMs }).then((result) => ({
          endpoint,
          lane,
          ...result,
        }))
      );
    };

    for (let i = 0; i < burst; i += 1) {
      pushProbe("/api/memory/search", "search", "interactive", {
        query,
        tenantId: tenantId || undefined,
        retrievalMode: "hybrid",
        queryLane: "interactive",
        limit: searchLimit,
      });
      pushProbe("/api/memory/search", "search", "bulk", {
        query,
        tenantId: tenantId || undefined,
        retrievalMode: "lexical",
        queryLane: "bulk",
        bulk: true,
        limit: searchLimit,
      });
      if (includeContext) {
        pushProbe("/api/memory/context", "context", "interactive", {
          query,
          tenantId: tenantId || undefined,
          retrievalMode: "hybrid",
          queryLane: "interactive",
          maxItems: contextMaxItems,
          maxChars: 9000,
          scanLimit: contextScanLimit,
          includeTenantFallback: true,
          expandRelationships: true,
          maxHops: 2,
        });
        pushProbe("/api/memory/context", "context", "bulk", {
          query,
          tenantId: tenantId || undefined,
          retrievalMode: "lexical",
          queryLane: "bulk",
          bulk: true,
          maxItems: contextMaxItems,
          maxChars: 9000,
          scanLimit: contextScanLimit,
          includeTenantFallback: true,
          expandRelationships: true,
          maxHops: 2,
        });
      }
    }

    const results = await Promise.all(requests);
    const roundSummary = {
      round,
      totalRequests: results.length,
      ok: 0,
      failed: 0,
      deferred: 0,
      degraded: 0,
      emptyResults: 0,
      degradedEmpty: 0,
      byStatus: {},
      byLane: {
        interactive: { total: 0, ok: 0, deferred: 0, degraded: 0, returnedItems: 0, emptyResults: 0, degradedEmpty: 0 },
        bulk: { total: 0, ok: 0, deferred: 0, degraded: 0, returnedItems: 0, emptyResults: 0, degradedEmpty: 0 },
      },
      byEndpoint: {
        search: { total: 0, ok: 0, deferred: 0, degraded: 0, returnedItems: 0, emptyResults: 0, degradedEmpty: 0 },
        context: { total: 0, ok: 0, deferred: 0, degraded: 0, returnedItems: 0, emptyResults: 0, degradedEmpty: 0 },
      },
      errorSamples: [],
      responseSamples: [],
      returnedItems: 0,
      matchedByCounts: {},
    };
    const roundLatencies = [];
    const roundLaneLatencies = { interactive: [], bulk: [] };
    const roundEndpointLatencies = { search: [], context: [] };

    for (const result of results) {
      const statusKey = String(result.status ?? 0);
      const ok = result.ok === true;
      const deferred = isDeferred(result.status, result.payload);
      const degraded = isDegraded(result.payload);
      const returnedItems = countReturnedItems(result);
      const matchedBy = collectMatchedBy(result.payload);
      const latencyMs = Number(result.latencyMs ?? 0);
      const hasLatency = Number.isFinite(latencyMs) && latencyMs >= 0;
      roundSummary.byStatus[statusKey] = Number(roundSummary.byStatus[statusKey] ?? 0) + 1;
      aggregate.byStatus[statusKey] = Number(aggregate.byStatus[statusKey] ?? 0) + 1;
      for (const key of matchedBy) {
        roundSummary.matchedByCounts[key] = Number(roundSummary.matchedByCounts[key] ?? 0) + 1;
        aggregate.matchedByCounts[key] = Number(aggregate.matchedByCounts[key] ?? 0) + 1;
      }

      roundSummary.totalRequests += 0;
      aggregate.totalRequests += 1;
      roundSummary.byLane[result.lane].total += 1;
      aggregate.byLane[result.lane].total += 1;
      roundSummary.byEndpoint[result.endpoint].total += 1;
      aggregate.byEndpoint[result.endpoint].total += 1;
      roundSummary.returnedItems += returnedItems;
      aggregate.returnedItems += returnedItems;
      roundSummary.byLane[result.lane].returnedItems += returnedItems;
      aggregate.byLane[result.lane].returnedItems += returnedItems;
      roundSummary.byEndpoint[result.endpoint].returnedItems += returnedItems;
      aggregate.byEndpoint[result.endpoint].returnedItems += returnedItems;
      if (hasLatency) {
        roundLatencies.push(latencyMs);
        roundLaneLatencies[result.lane].push(latencyMs);
        roundEndpointLatencies[result.endpoint].push(latencyMs);
        aggregateLatencies.push(latencyMs);
        aggregateLaneLatencies[result.lane].push(latencyMs);
        aggregateEndpointLatencies[result.endpoint].push(latencyMs);
      }
      if (returnedItems === 0) {
        roundSummary.emptyResults += 1;
        aggregate.emptyResults += 1;
        roundSummary.byLane[result.lane].emptyResults += 1;
        aggregate.byLane[result.lane].emptyResults += 1;
        roundSummary.byEndpoint[result.endpoint].emptyResults += 1;
        aggregate.byEndpoint[result.endpoint].emptyResults += 1;
      }

      if (ok) {
        roundSummary.ok += 1;
        aggregate.ok += 1;
        roundSummary.byLane[result.lane].ok += 1;
        aggregate.byLane[result.lane].ok += 1;
        roundSummary.byEndpoint[result.endpoint].ok += 1;
        aggregate.byEndpoint[result.endpoint].ok += 1;
      } else {
        roundSummary.failed += 1;
        aggregate.failed += 1;
        if (roundSummary.errorSamples.length < 8) {
          roundSummary.errorSamples.push(summarizeFailure(result));
        }
        if (aggregate.errorSamples.length < 16) {
          aggregate.errorSamples.push(summarizeFailure(result));
        }
      }
      const degradationPayload =
        result.payload?.degradation
        || result.payload?.context?.diagnostics?.queryDegradation
        || null;
      const contextDiagnostics = extractContextDiagnostics(result.payload);
      if (roundSummary.responseSamples.length < 8) {
        roundSummary.responseSamples.push({
          endpoint: result.endpoint,
          lane: result.lane,
          status: Number(result.status ?? 0),
          latencyMs: hasLatency ? Number(latencyMs.toFixed(2)) : null,
          returnedItems,
          degraded,
          deferred,
          reasons: Array.isArray(degradationPayload?.reasons) ? degradationPayload.reasons.slice(0, 6) : [],
          warning:
            typeof degradationPayload?.warning === "string"
              ? degradationPayload.warning
              : typeof result.payload?.message === "string"
                ? result.payload.message
                : null,
          tenantRowsTimedOut: contextDiagnostics?.tenantRowsTimedOut === true,
          degradedComputeMode: contextDiagnostics?.degradedComputeMode === true,
        });
      }
      if (aggregate.responseSamples.length < 20) {
        aggregate.responseSamples.push({
          endpoint: result.endpoint,
          lane: result.lane,
          status: Number(result.status ?? 0),
          latencyMs: hasLatency ? Number(latencyMs.toFixed(2)) : null,
          returnedItems,
          degraded,
          deferred,
          reasons: Array.isArray(degradationPayload?.reasons) ? degradationPayload.reasons.slice(0, 6) : [],
          warning:
            typeof degradationPayload?.warning === "string"
              ? degradationPayload.warning
              : typeof result.payload?.message === "string"
                ? result.payload.message
                : null,
          tenantRowsTimedOut: contextDiagnostics?.tenantRowsTimedOut === true,
          degradedComputeMode: contextDiagnostics?.degradedComputeMode === true,
        });
      }
      if (deferred) {
        roundSummary.deferred += 1;
        aggregate.deferred += 1;
        roundSummary.byLane[result.lane].deferred += 1;
        aggregate.byLane[result.lane].deferred += 1;
        roundSummary.byEndpoint[result.endpoint].deferred += 1;
        aggregate.byEndpoint[result.endpoint].deferred += 1;
      }
      if (degraded) {
        roundSummary.degraded += 1;
        aggregate.degraded += 1;
        roundSummary.byLane[result.lane].degraded += 1;
        aggregate.byLane[result.lane].degraded += 1;
        roundSummary.byEndpoint[result.endpoint].degraded += 1;
        aggregate.byEndpoint[result.endpoint].degraded += 1;
        if (returnedItems === 0) {
          roundSummary.degradedEmpty += 1;
          aggregate.degradedEmpty += 1;
          roundSummary.byLane[result.lane].degradedEmpty += 1;
          aggregate.byLane[result.lane].degradedEmpty += 1;
          roundSummary.byEndpoint[result.endpoint].degradedEmpty += 1;
          aggregate.byEndpoint[result.endpoint].degradedEmpty += 1;
        }
      }
    }
    roundSummary.latency = {
      overall: summarizeLatency(roundLatencies),
      byLane: {
        interactive: summarizeLatency(roundLaneLatencies.interactive),
        bulk: summarizeLatency(roundLaneLatencies.bulk),
      },
      byEndpoint: {
        search: summarizeLatency(roundEndpointLatencies.search),
        context: summarizeLatency(roundEndpointLatencies.context),
      },
    };
    roundSummaries.push(roundSummary);
    if (round < rounds && betweenRoundMs > 0) {
      await sleep(betweenRoundMs);
    }
  }

  const pressureAfter = await requestJson({
    baseUrl,
    path: "/api/memory/pressure",
    method: "GET",
    headers,
    timeoutMs,
  });

  const report = {
    ok: true,
    generatedAt: new Date().toISOString(),
    baseUrl,
    config: {
      query,
      tenantId: tenantId || null,
      rounds,
      burst,
      includeContext,
      timeoutMs,
      searchLimit,
      contextMaxItems,
      contextScanLimit,
    },
    pressureBefore: pressureBefore.payload?.pressure ?? null,
    pressureAfter: pressureAfter.payload?.pressure ?? null,
    aggregate: {
      ...aggregate,
      latency: {
        overall: summarizeLatency(aggregateLatencies),
        byLane: {
          interactive: summarizeLatency(aggregateLaneLatencies.interactive),
          bulk: summarizeLatency(aggregateLaneLatencies.bulk),
        },
        byEndpoint: {
          search: summarizeLatency(aggregateEndpointLatencies.search),
          context: summarizeLatency(aggregateEndpointLatencies.context),
        },
      },
      okRate: Number((aggregate.ok / Math.max(1, aggregate.totalRequests)).toFixed(4)),
      deferredRate: Number((aggregate.deferred / Math.max(1, aggregate.totalRequests)).toFixed(4)),
      degradedRate: Number((aggregate.degraded / Math.max(1, aggregate.totalRequests)).toFixed(4)),
      emptyRate: Number((aggregate.emptyResults / Math.max(1, aggregate.totalRequests)).toFixed(4)),
      degradedEmptyRate: Number((aggregate.degradedEmpty / Math.max(1, aggregate.totalRequests)).toFixed(4)),
      deferredBulkRate: Number(
        (aggregate.byLane.bulk.deferred / Math.max(1, aggregate.byLane.bulk.total)).toFixed(4)
      ),
      deferredInteractiveRate: Number(
        (aggregate.byLane.interactive.deferred / Math.max(1, aggregate.byLane.interactive.total)).toFixed(4)
      ),
      degradedBulkRate: Number(
        (aggregate.byLane.bulk.degraded / Math.max(1, aggregate.byLane.bulk.total)).toFixed(4)
      ),
      degradedInteractiveRate: Number(
        (aggregate.byLane.interactive.degraded / Math.max(1, aggregate.byLane.interactive.total)).toFixed(4)
      ),
      avgItemsPerRequest: Number((aggregate.returnedItems / Math.max(1, aggregate.totalRequests)).toFixed(4)),
      staleCacheFallbackRate: Number(
        (Number(aggregate.matchedByCounts["stale-cache-fallback"] ?? 0) / Math.max(1, aggregate.totalRequests)).toFixed(4)
      ),
      contextStaleCacheFallbackRate: Number(
        (Number(aggregate.matchedByCounts["context-stale-cache-fallback"] ?? 0) / Math.max(1, aggregate.totalRequests)).toFixed(4)
      ),
      lexicalTimeoutFallbackRate: Number(
        (Number(aggregate.matchedByCounts["lexical-timeout-fallback"] ?? 0) / Math.max(1, aggregate.totalRequests)).toFixed(4)
      ),
      recentFallbackRate: Number(
        (Number(aggregate.matchedByCounts["recent-fallback"] ?? 0) / Math.max(1, aggregate.totalRequests)).toFixed(4)
      ),
      contextRecentFallbackRate: Number(
        (Number(aggregate.matchedByCounts["context-recent-fallback"] ?? 0) / Math.max(1, aggregate.totalRequests)).toFixed(4)
      ),
    },
    rounds: roundSummaries,
  };

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`open-memory-query-qos-probe failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
