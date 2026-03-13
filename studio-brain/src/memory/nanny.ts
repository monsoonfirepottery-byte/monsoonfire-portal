import { createHash } from "node:crypto";
import type { MemoryCaptureRequest } from "./contracts";

type TenantResolution = {
  tenantId: string | null;
  requestedTenantId: string | null;
  fallbackApplied: boolean;
  reason: string | null;
};

export type MemoryNannyCaptureRoute = {
  tenantId: string | null;
  agentId: string;
  runId: string;
  memoryIdOverride: string | null;
  blockedReason: string | null;
  metadata: {
    requestedTenantId: string | null;
    resolvedTenantId: string | null;
    tenantFallbackApplied: boolean;
    tenantFallbackReason: string | null;
    requestedAgentId: string | null;
    resolvedAgentId: string;
    agentDerivedFromSource: boolean;
    requestedRunId: string | null;
    resolvedRunId: string;
    loopWindowSuppressed: boolean;
    writeBurstCount: number;
    writeBurstWindowMs: number;
    source: string;
  };
};

export type MemoryNanny = {
  resolveTenant: (requested: string | null | undefined) => TenantResolution;
  routeCapture: (
    input: MemoryCaptureRequest,
    options?: { bypassRunWriteBurstLimit?: boolean }
  ) => MemoryNannyCaptureRoute;
};

export type MemoryNannyOptions = {
  defaultTenantId: string | null;
  allowedTenantIds?: string[];
  defaultAgentId: string;
  defaultRunId: string;
  duplicateWindowMs?: number;
  runWriteWindowMs?: number;
  maxWritesPerRunWindow?: number;
};

type RunBurstState = {
  count: number;
  windowStartedAtMs: number;
};

const SPACE_SAFE_PATTERN = /[^a-zA-Z0-9:_-]+/g;

function normalizeContent(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function normalizeSpaceValue(value: string, fallback: string): string {
  const normalized = value
    .trim()
    .replace(SPACE_SAFE_PATTERN, "-")
    .replace(/-+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "");
  if (!normalized) return fallback;
  return normalized.slice(0, 128);
}

function deriveSourceAgentId(source: string, fallback: string): string {
  if (source.startsWith("discord")) return "agent:discord";
  if (source.startsWith("codex")) return "agent:codex";
  if (source.startsWith("mcp")) return "agent:mcp";
  if (source.startsWith("import")) return "agent:import";
  return fallback;
}

function createLoopId(tenantId: string | null, agentId: string, source: string, content: string): string {
  const digest = createHash("sha256")
    .update(`${tenantId ?? "none"}|${agentId}|${source}|${normalizeContent(content)}`)
    .digest("hex")
    .slice(0, 24);
  return `mem_loop_${digest}`;
}

export function createMemoryNanny(options: MemoryNannyOptions): MemoryNanny {
  const allowedTenantIds = new Set(
    (options.allowedTenantIds ?? []).map((value) => value.trim()).filter(Boolean)
  );
  const duplicateWindowMs =
    Number.isFinite(options.duplicateWindowMs) && Number(options.duplicateWindowMs) > 0
      ? Number(options.duplicateWindowMs)
      : 10 * 60 * 1000;
  const runWriteWindowMs =
    Number.isFinite(options.runWriteWindowMs) && Number(options.runWriteWindowMs) > 0
      ? Number(options.runWriteWindowMs)
      : 60 * 60 * 1000;
  const maxWritesPerRunWindow =
    Number.isFinite(options.maxWritesPerRunWindow) && Number(options.maxWritesPerRunWindow) > 0
      ? Math.floor(Number(options.maxWritesPerRunWindow))
      : 250;

  const recentContentBySpace = new Map<string, number>();
  const runBurstBySpace = new Map<string, RunBurstState>();

  const prune = (nowMs: number): void => {
    for (const [key, seenAt] of recentContentBySpace.entries()) {
      if (nowMs - seenAt > duplicateWindowMs) {
        recentContentBySpace.delete(key);
      }
    }
    for (const [key, state] of runBurstBySpace.entries()) {
      if (nowMs - state.windowStartedAtMs > runWriteWindowMs) {
        runBurstBySpace.delete(key);
      }
    }
  };

  const resolveTenant = (requested: string | null | undefined): TenantResolution => {
    const requestedTenantId = requested === undefined ? null : requested;
    const resolved = requested === undefined ? options.defaultTenantId : requested;
    if (allowedTenantIds.size === 0 || resolved === null) {
      return {
        tenantId: resolved,
        requestedTenantId,
        fallbackApplied: false,
        reason: null,
      };
    }
    if (allowedTenantIds.has(resolved)) {
      return {
        tenantId: resolved,
        requestedTenantId,
        fallbackApplied: false,
        reason: null,
      };
    }
    return {
      tenantId: options.defaultTenantId,
      requestedTenantId,
      fallbackApplied: true,
      reason: "tenant_not_allowlisted",
    };
  };

  const routeCapture = (
    input: MemoryCaptureRequest,
    routeOptions?: { bypassRunWriteBurstLimit?: boolean }
  ): MemoryNannyCaptureRoute => {
    const nowMs = Date.now();
    prune(nowMs);
    const enforceRunWriteBurstLimit = !routeOptions?.bypassRunWriteBurstLimit;

    const source = input.source.trim().toLowerCase();
    const tenantResolution = resolveTenant(input.tenantId);
    const sourceAgent = deriveSourceAgentId(source, options.defaultAgentId);
    const requestedAgentId = input.agentId?.trim() ?? null;
    const requestedRunId = input.runId?.trim() ?? null;
    const resolvedAgentId = normalizeSpaceValue(requestedAgentId ?? sourceAgent, sourceAgent);
    const fallbackRunId = normalizeSpaceValue(`${resolvedAgentId}:main`, options.defaultRunId);
    const resolvedRunId = normalizeSpaceValue(requestedRunId ?? fallbackRunId, fallbackRunId);

    const burstKey = `${tenantResolution.tenantId ?? "none"}|${resolvedAgentId}|${resolvedRunId}`;
    const burstState = runBurstBySpace.get(burstKey);
    if (!burstState || nowMs - burstState.windowStartedAtMs >= runWriteWindowMs) {
      runBurstBySpace.set(burstKey, { count: 1, windowStartedAtMs: nowMs });
    } else {
      burstState.count += 1;
      runBurstBySpace.set(burstKey, burstState);
      if (enforceRunWriteBurstLimit && burstState.count > maxWritesPerRunWindow) {
        return {
          tenantId: tenantResolution.tenantId,
          agentId: resolvedAgentId,
          runId: resolvedRunId,
          memoryIdOverride: null,
          blockedReason: "run_write_burst_limit",
          metadata: {
            requestedTenantId: tenantResolution.requestedTenantId,
            resolvedTenantId: tenantResolution.tenantId,
            tenantFallbackApplied: tenantResolution.fallbackApplied,
            tenantFallbackReason: tenantResolution.reason,
            requestedAgentId,
            resolvedAgentId,
            agentDerivedFromSource: !requestedAgentId,
            requestedRunId,
            resolvedRunId,
            loopWindowSuppressed: false,
            writeBurstCount: burstState.count,
            writeBurstWindowMs: runWriteWindowMs,
            source,
          },
        };
      }
    }

    const loopFingerprint = createHash("sha256")
      .update(`${tenantResolution.tenantId ?? "none"}|${resolvedAgentId}|${source}|${normalizeContent(input.content)}`)
      .digest("hex");
    const loopKey = `dup|${loopFingerprint}`;
    const previousSeenAt = recentContentBySpace.get(loopKey);
    const loopWindowSuppressed =
      previousSeenAt !== undefined &&
      nowMs - previousSeenAt < duplicateWindowMs &&
      !input.id &&
      !input.clientRequestId;
    recentContentBySpace.set(loopKey, nowMs);

    const burstCount = runBurstBySpace.get(burstKey)?.count ?? 1;
    return {
      tenantId: tenantResolution.tenantId,
      agentId: resolvedAgentId,
      runId: resolvedRunId,
      memoryIdOverride: loopWindowSuppressed
        ? createLoopId(tenantResolution.tenantId, resolvedAgentId, source, input.content)
        : null,
      blockedReason: null,
      metadata: {
        requestedTenantId: tenantResolution.requestedTenantId,
        resolvedTenantId: tenantResolution.tenantId,
        tenantFallbackApplied: tenantResolution.fallbackApplied,
        tenantFallbackReason: tenantResolution.reason,
        requestedAgentId,
        resolvedAgentId,
        agentDerivedFromSource: !requestedAgentId,
        requestedRunId,
        resolvedRunId,
        loopWindowSuppressed,
        writeBurstCount: burstCount,
        writeBurstWindowMs: runWriteWindowMs,
        source,
      },
    };
  };

  return {
    resolveTenant,
    routeCapture,
  };
}
