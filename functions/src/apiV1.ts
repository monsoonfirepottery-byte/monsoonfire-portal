/* eslint-disable @typescript-eslint/no-explicit-any */

import { randomBytes } from "crypto";
import { z } from "zod";
import {
  applyCors,
  requireAuthContext,
  isStaffFromDecoded,
  db,
  nowTs,
  Timestamp,
  makeIdempotencyId,
  parseBody,
  enforceRateLimit,
  type AuthContext,
} from "./shared";
import { listIntegrationEvents } from "./integrationEvents";
import { getAgentServiceCatalogConfig } from "./agentCatalog";
import { getAgentOpsConfig } from "./agentCommerce";

function readHeaderFirst(req: any, name: string): string {
  const key = name.toLowerCase();
  const raw = req.headers?.[key] ?? req.headers?.[name];
  if (typeof raw === "string") return raw.trim();
  if (Array.isArray(raw) && raw[0]) return String(raw[0]).trim();
  return "";
}

function getRequestId(req: any): string {
  const provided = readHeaderFirst(req, "x-request-id");
  if (provided) return provided.slice(0, 128);
  return `req_${randomBytes(12).toString("base64url")}`;
}

function jsonOk(res: any, requestId: string, data: unknown) {
  res.set("x-request-id", requestId);
  res.status(200).json({ ok: true, requestId, data });
}

function jsonError(
  res: any,
  requestId: string,
  httpStatus: number,
  code: string,
  message: string,
  details?: unknown
) {
  res.set("x-request-id", requestId);
  res.status(httpStatus).json({ ok: false, requestId, code, message, details: details ?? null });
}

function requireScopes(ctx: AuthContext, required: string[]): { ok: true } | { ok: false; message: string } {
  if (ctx.mode === "firebase") return { ok: true };
  const scopes = ctx.scopes ?? [];
  const missing = required.filter((s) => !scopes.includes(s));
  if (missing.length) return { ok: false, message: `Missing scope(s): ${missing.join(", ")}` };
  return { ok: true };
}

function safeErrorMessage(error: unknown): string {
  if (!error) return "Request failed";
  if (error instanceof Error) return error.message || "Request failed";
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return "Request failed";
  }
}

type DelegatedRiskPolicy = {
  agentClientId: string;
  trustTier: "low" | "medium" | "high";
  orderMaxCents: number;
  maxOrdersPerHour: number;
};

const DENIAL_ACTIONS = new Set<string>([
  "agent_quote_denied_risk_limit",
  "agent_pay_denied_risk_limit",
  "agent_pay_denied_velocity",
]);

function defaultPolicyForTrustTier(tier: string): {
  trustTier: "low" | "medium" | "high";
  orderMaxCents: number;
  maxOrdersPerHour: number;
} {
  if (tier === "high") {
    return { trustTier: "high", orderMaxCents: 200_000, maxOrdersPerHour: 80 };
  }
  if (tier === "medium") {
    return { trustTier: "medium", orderMaxCents: 75_000, maxOrdersPerHour: 30 };
  }
  return { trustTier: "low", orderMaxCents: 25_000, maxOrdersPerHour: 10 };
}

async function loadDelegatedRiskPolicy(ctx: AuthContext): Promise<DelegatedRiskPolicy | null> {
  if (ctx.mode !== "delegated") return null;
  const clientId = ctx.delegated.agentClientId;
  const snap = await db.collection("agentClients").doc(clientId).get();
  if (!snap.exists) {
    throw new Error("DELEGATED_CLIENT_NOT_FOUND");
  }
  const row = snap.data() as Record<string, unknown>;
  const cooldownSeconds =
    typeof (row.cooldownUntil as { seconds?: unknown } | undefined)?.seconds === "number"
      ? Number((row.cooldownUntil as { seconds?: unknown }).seconds)
      : 0;
  const nowSeconds = Date.now() / 1000;
  if (cooldownSeconds > nowSeconds) {
    throw new Error("DELEGATED_CLIENT_COOLDOWN");
  }
  let status = typeof row.status === "string" ? row.status : "active";
  if (status === "suspended" && cooldownSeconds > 0 && cooldownSeconds <= nowSeconds) {
    await db.collection("agentClients").doc(clientId).set(
      {
        status: "active",
        cooldownUntil: null,
        cooldownReason: null,
        updatedAt: nowTs(),
        updatedByUid: "system:auto",
      },
      { merge: true }
    );
    status = "active";
  }
  if (status !== "active") {
    throw new Error("DELEGATED_CLIENT_INACTIVE");
  }
  const trustTier = typeof row.trustTier === "string" ? row.trustTier : "low";
  const defaults = defaultPolicyForTrustTier(trustTier);
  const spendingLimits =
    row.spendingLimits && typeof row.spendingLimits === "object"
      ? (row.spendingLimits as Record<string, unknown>)
      : null;
  const orderMaxCents =
    typeof spendingLimits?.orderMaxCents === "number"
      ? Math.max(100, Math.trunc(spendingLimits.orderMaxCents))
      : defaults.orderMaxCents;
  const maxOrdersPerHour =
    typeof spendingLimits?.maxOrdersPerHour === "number"
      ? Math.max(1, Math.trunc(spendingLimits.maxOrdersPerHour))
      : defaults.maxOrdersPerHour;

  return {
    agentClientId: clientId,
    trustTier: defaults.trustTier,
    orderMaxCents,
    maxOrdersPerHour,
  };
}

async function countRecentOrdersForClient(agentClientId: string): Promise<number> {
  const snap = await db
    .collection("agentOrders")
    .where("agentClientId", "==", agentClientId)
    .limit(300)
    .get();
  const cutoffMs = Date.now() - 60 * 60 * 1000;
  let count = 0;
  for (const docSnap of snap.docs) {
    const row = docSnap.data() as Record<string, unknown>;
    const seconds =
      typeof (row.createdAt as { seconds?: unknown } | undefined)?.seconds === "number"
        ? Number((row.createdAt as { seconds?: unknown }).seconds)
        : 0;
    if (seconds > 0 && seconds * 1000 >= cutoffMs) {
      count += 1;
    }
  }
  return count;
}

async function countRecentDenialsForClient(agentClientId: string): Promise<number> {
  const snap = await db
    .collection("agentAuditLogs")
    .where("agentClientId", "==", agentClientId)
    .limit(400)
    .get();
  const cutoffMs = Date.now() - 24 * 60 * 60 * 1000;
  let count = 0;
  for (const docSnap of snap.docs) {
    const row = docSnap.data() as Record<string, unknown>;
    const action = typeof row.action === "string" ? row.action : "";
    if (!DENIAL_ACTIONS.has(action)) continue;
    const seconds =
      typeof (row.createdAt as { seconds?: unknown } | undefined)?.seconds === "number"
        ? Number((row.createdAt as { seconds?: unknown }).seconds)
        : 0;
    if (seconds > 0 && seconds * 1000 >= cutoffMs) {
      count += 1;
    }
  }
  return count;
}

async function enforceDelegatedCooldownIfNeeded(params: {
  agentClientId: string;
  actorUid: string;
  actorMode: string;
  requestId: string;
}) {
  const { agentClientId, actorUid, actorMode, requestId } = params;
  const denials24h = await countRecentDenialsForClient(agentClientId);
  const threshold = 6;
  if (denials24h < threshold) return;

  const clientRef = db.collection("agentClients").doc(agentClientId);
  const snap = await clientRef.get();
  if (!snap.exists) return;
  const row = snap.data() as Record<string, unknown>;
  const existingStatus = typeof row.status === "string" ? row.status : "active";
  const cooldownSeconds =
    typeof (row.cooldownUntil as { seconds?: unknown } | undefined)?.seconds === "number"
      ? Number((row.cooldownUntil as { seconds?: unknown }).seconds)
      : 0;
  if (existingStatus === "suspended" && cooldownSeconds * 1000 > Date.now()) return;

  const cooldownUntil = Timestamp.fromMillis(Date.now() + 30 * 60 * 1000);
  const now = nowTs();
  await clientRef.set(
    {
      status: "suspended",
      cooldownUntil,
      cooldownReason: `auto_cooldown_denials_${threshold}_in_24h`,
      updatedAt: now,
      updatedByUid: "system:auto",
    },
    { merge: true }
  );
  await db.collection("agentAuditLogs").add({
    actorUid,
    actorMode,
    action: "agent_client_auto_suspended_cooldown",
    requestId,
    agentClientId,
    denials24h,
    threshold,
    cooldownUntil,
    createdAt: now,
  });
}

function isMissingIndexError(error: unknown): boolean {
  const msg = safeErrorMessage(error).toLowerCase();
  return msg.includes("requires an index") || (msg.includes("failed_precondition") && msg.includes("index"));
}

function canReadBatchDoc(params: { uid: string; isStaff: boolean; batch: any }): boolean {
  const { uid, isStaff, batch } = params;
  if (isStaff) return true;
  if (batch?.ownerUid === uid) return true;
  return false;
}

function canReadBatchTimeline(params: { uid: string; isStaff: boolean; batch: any }): boolean {
  const { uid, isStaff, batch } = params;
  if (isStaff) return true;
  if (batch?.ownerUid === uid) return true;
  const editors = Array.isArray(batch?.editors) ? batch.editors : [];
  return editors.includes(uid);
}

function toBatchSummary(id: string, data: any) {
  return {
    id,
    ownerUid: typeof data?.ownerUid === "string" ? data.ownerUid : null,
    ownerDisplayName: typeof data?.ownerDisplayName === "string" ? data.ownerDisplayName : null,
    title: typeof data?.title === "string" ? data.title : null,
    intakeMode: typeof data?.intakeMode === "string" ? data.intakeMode : null,
    estimatedCostCents: typeof data?.estimatedCostCents === "number" ? data.estimatedCostCents : null,
    kilnName: typeof data?.kilnName === "string" ? data.kilnName : data?.kilnName === null ? null : null,
    estimateNotes:
      typeof data?.estimateNotes === "string"
        ? data.estimateNotes
        : data?.estimateNotes === null
          ? null
          : null,
    state: typeof data?.state === "string" ? data.state : null,
    isClosed: typeof data?.isClosed === "boolean" ? data.isClosed : null,
    createdAt: data?.createdAt ?? null,
    updatedAt: data?.updatedAt ?? null,
    closedAt: data?.closedAt ?? null,
    journeyRootBatchId: typeof data?.journeyRootBatchId === "string" ? data.journeyRootBatchId : null,
    journeyParentBatchId:
      typeof data?.journeyParentBatchId === "string"
        ? data.journeyParentBatchId
        : data?.journeyParentBatchId === null
          ? null
          : null,
  };
}

const batchesListSchema = z.object({
  ownerUid: z.string().min(1).optional().nullable(),
  limit: z.number().int().min(1).max(200).optional(),
  includeClosed: z.boolean().optional(),
});

const batchesGetSchema = z.object({
  batchId: z.string().min(1),
});

const timelineListSchema = z.object({
  batchId: z.string().min(1),
  limit: z.number().int().min(1).max(500).optional(),
});

const firingsListUpcomingSchema = z.object({
  limit: z.number().int().min(1).max(500).optional(),
});

const eventsFeedSchema = z.object({
  uid: z.string().min(1).optional().nullable(),
  cursor: z.number().int().min(0).optional(),
  limit: z.number().int().min(1).max(500).optional(),
});

const agentCatalogSchema = z.object({
  includeDisabled: z.boolean().optional(),
});

const agentQuoteSchema = z.object({
  serviceId: z.string().min(1),
  quantity: z.number().int().min(1).max(10_000).optional(),
  currency: z.string().min(3).max(8).optional().nullable(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const agentReserveSchema = z.object({
  quoteId: z.string().min(1),
  holdMinutes: z.number().int().min(5).max(1_440).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const agentStatusSchema = z.object({
  quoteId: z.string().min(1).optional(),
  reservationId: z.string().min(1).optional(),
  orderId: z.string().min(1).optional(),
});

const agentPaySchema = z.object({
  reservationId: z.string().min(1),
  idempotencyKey: z.string().min(1).max(120).optional(),
});

const agentOrderGetSchema = z.object({
  orderId: z.string().min(1),
});

const agentOrdersListSchema = z.object({
  uid: z.string().min(1).optional().nullable(),
  limit: z.number().int().min(1).max(200).optional(),
});

const agentRequestCreateSchema = z.object({
  kind: z.enum(["firing", "pickup", "delivery", "shipping", "commission", "other"]),
  title: z.string().min(1).max(160),
  summary: z.string().max(500).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
  logisticsMode: z.enum(["dropoff", "pickup", "ship_in", "ship_out", "local_delivery"]).optional().nullable(),
  rightsAttested: z.boolean().optional(),
  intendedUse: z.string().max(500).optional().nullable(),
  constraints: z.record(z.string(), z.unknown()).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const agentRequestListMineSchema = z.object({
  limit: z.number().int().min(1).max(200).optional(),
  includeClosed: z.boolean().optional(),
});

const agentRequestListStaffSchema = z.object({
  status: z
    .enum(["all", "new", "triaged", "accepted", "in_progress", "ready", "fulfilled", "rejected", "cancelled"])
    .optional(),
  kind: z.enum(["all", "firing", "pickup", "delivery", "shipping", "commission", "other"]).optional(),
  limit: z.number().int().min(1).max(500).optional(),
});

const agentRequestUpdateStatusSchema = z.object({
  requestId: z.string().min(1),
  status: z.enum(["new", "triaged", "accepted", "in_progress", "ready", "fulfilled", "rejected", "cancelled"]),
  reason: z.string().max(500).optional().nullable(),
  reasonCode: z.string().max(120).optional().nullable(),
});

const agentRequestLinkBatchSchema = z.object({
  requestId: z.string().min(1),
  batchId: z.string().min(1),
});

const AGENT_REQUESTS_COL = "agentRequests";

const CLOSED_AGENT_REQUEST_STATUSES = new Set<string>(["fulfilled", "rejected", "cancelled"]);
const COMMISSION_POLICY_VERSION = "2026-02-12.v1";
const COMMISSION_REQUIRED_REASON_CODES = new Set<string>([
  "rights_verified",
  "licensed_use_verified",
  "staff_discretion_low_risk",
  "prohibited_content",
  "copyright_risk_unresolved",
  "illegal_request",
  "insufficient_rights_attestation",
]);
const PROHIBITED_COMMISSION_PATTERNS: Array<{ code: string; pattern: RegExp }> = [
  { code: "weapons_instruction", pattern: /\b(weapon|explosive|ghost gun|silencer)\b/i },
  { code: "counterfeit_or_fraud", pattern: /\b(counterfeit|fake id|forgery|money laundering)\b/i },
  { code: "copyright_bypass", pattern: /\b(copyright bypass|pirated|stolen design|ripoff)\b/i },
  { code: "hate_or_harassment", pattern: /\b(hate symbol|harassment|targeted abuse)\b/i },
];

function trimOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const next = value.trim();
  return next.length ? next : null;
}

function readTimestampSeconds(value: unknown): number {
  return typeof (value as { seconds?: unknown } | undefined)?.seconds === "number"
    ? Number((value as { seconds: number }).seconds)
    : 0;
}

function evaluateCommissionPolicy(payload: {
  title: string;
  summary: string | null;
  notes: string | null;
  intendedUse: string | null;
}): { disposition: "allow" | "review" | "reject"; reasonCodes: string[] } {
  const text = [payload.title, payload.summary ?? "", payload.notes ?? "", payload.intendedUse ?? ""]
    .join(" ")
    .trim();
  const reasonCodes = PROHIBITED_COMMISSION_PATTERNS.filter((row) => row.pattern.test(text)).map((row) => row.code);
  if (reasonCodes.length > 0) {
    return { disposition: "reject", reasonCodes };
  }
  return { disposition: "review", reasonCodes: ["manual_ip_review_required"] };
}

export async function handleApiV1(req: any, res: any) {
  if (applyCors(req, res)) return;

  const requestId = getRequestId(req);

  if (req.method !== "POST") {
    jsonError(res, requestId, 405, "INVALID_ARGUMENT", "Use POST");
    return;
  }

  const ctxResult = await requireAuthContext(req);
  if (!ctxResult.ok) {
    jsonError(res, requestId, 401, "UNAUTHENTICATED", ctxResult.message);
    return;
  }

  const ctx = ctxResult.ctx;
  const isStaff = ctx.mode === "firebase" && isStaffFromDecoded(ctx.decoded);

  const path = typeof req.path === "string" ? req.path : "/";
  const route = path.startsWith("/") ? path : `/${path}`;

  const rateLimit =
    route === "/v1/events.feed"
      ? { max: 600, windowMs: 60_000 }
      : route.startsWith("/v1/batches.")
        ? { max: 300, windowMs: 60_000 }
        : route.startsWith("/v1/firings.")
          ? { max: 300, windowMs: 60_000 }
          : { max: 120, windowMs: 60_000 };

  const rate = await enforceRateLimit({
    req,
    key: `apiV1:${route}`,
    max: rateLimit.max,
    windowMs: rateLimit.windowMs,
  });
  if (!rate.ok) {
    res.set("Retry-After", String(Math.ceil(rate.retryAfterMs / 1000)));
    jsonError(res, requestId, 429, "RATE_LIMITED", "Too many requests", {
      retryAfterMs: rate.retryAfterMs,
    });
    return;
  }

  if (route.startsWith("/v1/agent.")) {
    const actorKey =
      ctx.mode === "delegated"
        ? `agent:${ctx.delegated.agentClientId}:${ctx.uid}`
        : `actor:${ctx.uid}`;
    const agentRate = await enforceRateLimit({
      req,
      key: `apiV1:${route}:${actorKey}`,
      max: 90,
      windowMs: 60_000,
    });
    if (!agentRate.ok) {
      res.set("Retry-After", String(Math.ceil(agentRate.retryAfterMs / 1000)));
      jsonError(res, requestId, 429, "RATE_LIMITED", "Agent route rate limit exceeded", {
        retryAfterMs: agentRate.retryAfterMs,
      });
      return;
    }

    const opsConfig = await getAgentOpsConfig();
    if (!opsConfig.enabled) {
      jsonError(res, requestId, 503, "UNAVAILABLE", "Agent API is temporarily disabled by staff");
      return;
    }
  }

  try {
    if (route === "/v1/hello") {
      jsonOk(res, requestId, {
        uid: ctx.uid,
        mode: ctx.mode,
        scopes: ctx.mode === "pat" ? ctx.scopes : null,
        isStaff,
      });
      return;
    }

    if (route === "/v1/batches.list") {
      const scopeCheck = requireScopes(ctx, ["batches:read"]);
      if (!scopeCheck.ok) {
        jsonError(res, requestId, 403, "UNAUTHORIZED", scopeCheck.message);
        return;
      }

      const parsed = parseBody(batchesListSchema, req.body);
      if (!parsed.ok) {
        jsonError(res, requestId, 400, "INVALID_ARGUMENT", parsed.message);
        return;
      }

      const ownerUid = parsed.data.ownerUid ? String(parsed.data.ownerUid) : ctx.uid;
      if (ownerUid !== ctx.uid && !isStaff) {
        jsonError(res, requestId, 403, "UNAUTHORIZED", "Forbidden");
        return;
      }

      const limit = parsed.data.limit ?? 50;
      const includeClosed = parsed.data.includeClosed ?? false;

      const activeSnap = await db
        .collection("batches")
        .where("ownerUid", "==", ownerUid)
        .where("isClosed", "==", false)
        .orderBy("updatedAt", "desc")
        .limit(limit)
        .get();

      const active = activeSnap.docs.map((d) => toBatchSummary(d.id, d.data()));

      let closed: any[] | undefined;
      if (includeClosed) {
        const closedSnap = await db
          .collection("batches")
          .where("ownerUid", "==", ownerUid)
          .where("isClosed", "==", true)
          .orderBy("closedAt", "desc")
          .limit(limit)
          .get();
        closed = closedSnap.docs.map((d) => toBatchSummary(d.id, d.data()));
      }

      jsonOk(res, requestId, { ownerUid, active, closed: includeClosed ? closed ?? [] : null });
      return;
    }

    if (route === "/v1/batches.get") {
      const scopeCheck = requireScopes(ctx, ["batches:read"]);
      if (!scopeCheck.ok) {
        jsonError(res, requestId, 403, "UNAUTHORIZED", scopeCheck.message);
        return;
      }

      const parsed = parseBody(batchesGetSchema, req.body);
      if (!parsed.ok) {
        jsonError(res, requestId, 400, "INVALID_ARGUMENT", parsed.message);
        return;
      }

      const batchId = String(parsed.data.batchId);
      const ref = db.collection("batches").doc(batchId);
      const snap = await ref.get();
      if (!snap.exists) {
        jsonError(res, requestId, 404, "NOT_FOUND", "Batch not found");
        return;
      }

      const data = snap.data() as any;
      if (!canReadBatchDoc({ uid: ctx.uid, isStaff, batch: data })) {
        jsonError(res, requestId, 403, "UNAUTHORIZED", "Forbidden");
        return;
      }

      jsonOk(res, requestId, { batch: { id: snap.id, ...data } });
      return;
    }

    if (route === "/v1/batches.timeline.list") {
      const scopeCheck = requireScopes(ctx, ["timeline:read"]);
      if (!scopeCheck.ok) {
        jsonError(res, requestId, 403, "UNAUTHORIZED", scopeCheck.message);
        return;
      }

      const parsed = parseBody(timelineListSchema, req.body);
      if (!parsed.ok) {
        jsonError(res, requestId, 400, "INVALID_ARGUMENT", parsed.message);
        return;
      }

      const batchId = String(parsed.data.batchId);
      const limit = parsed.data.limit ?? 200;

      const batchSnap = await db.collection("batches").doc(batchId).get();
      if (!batchSnap.exists) {
        jsonError(res, requestId, 404, "NOT_FOUND", "Batch not found");
        return;
      }
      const batch = batchSnap.data() as any;
      if (!canReadBatchTimeline({ uid: ctx.uid, isStaff, batch })) {
        jsonError(res, requestId, 403, "UNAUTHORIZED", "Forbidden");
        return;
      }

      const eventsSnap = await db
        .collection("batches")
        .doc(batchId)
        .collection("timeline")
        .orderBy("at", "desc")
        .limit(limit)
        .get();

      const events = eventsSnap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
      jsonOk(res, requestId, { batchId, events });
      return;
    }

    if (route === "/v1/firings.listUpcoming") {
      const scopeCheck = requireScopes(ctx, ["firings:read"]);
      if (!scopeCheck.ok) {
        jsonError(res, requestId, 403, "UNAUTHORIZED", scopeCheck.message);
        return;
      }

      const parsed = parseBody(firingsListUpcomingSchema, req.body);
      if (!parsed.ok) {
        jsonError(res, requestId, 400, "INVALID_ARGUMENT", parsed.message);
        return;
      }

      const limit = parsed.data.limit ?? 200;
      const now = nowTs();

      const snap = await db
        .collection("kilnFirings")
        .where("startAt", ">=", now)
        .orderBy("startAt", "asc")
        .limit(limit)
        .get();

      const firings = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
      jsonOk(res, requestId, { firings, now });
      return;
    }

    if (route === "/v1/events.feed") {
      const scopeCheck = requireScopes(ctx, ["events:read"]);
      if (!scopeCheck.ok) {
        jsonError(res, requestId, 403, "UNAUTHORIZED", scopeCheck.message);
        return;
      }

      const parsed = parseBody(eventsFeedSchema, req.body);
      if (!parsed.ok) {
        jsonError(res, requestId, 400, "INVALID_ARGUMENT", parsed.message);
        return;
      }

      const targetUid = parsed.data.uid ? String(parsed.data.uid) : ctx.uid;
      if (targetUid !== ctx.uid && !isStaff) {
        jsonError(res, requestId, 403, "UNAUTHORIZED", "Forbidden");
        return;
      }

      const out = await listIntegrationEvents({
        uid: targetUid,
        cursor: parsed.data.cursor ?? 0,
        limit: parsed.data.limit ?? 100,
      });
      if (!out.ok) {
        jsonError(res, requestId, 500, "INTERNAL", out.message);
        return;
      }

      jsonOk(res, requestId, { uid: targetUid, events: out.events, nextCursor: out.nextCursor });
      return;
    }

    if (route === "/v1/agent.catalog") {
      const scopeCheck = requireScopes(ctx, ["catalog:read"]);
      if (!scopeCheck.ok) {
        jsonError(res, requestId, 403, "UNAUTHORIZED", scopeCheck.message);
        return;
      }

      const parsed = parseBody(agentCatalogSchema, req.body);
      if (!parsed.ok) {
        jsonError(res, requestId, 400, "INVALID_ARGUMENT", parsed.message);
        return;
      }

      const includeDisabled = parsed.data.includeDisabled === true;
      const config = await getAgentServiceCatalogConfig();
      const services = includeDisabled
        ? config.services
        : config.services.filter((entry) => entry.enabled);

      jsonOk(res, requestId, {
        pricingMode: config.pricingMode,
        defaultCurrency: config.defaultCurrency,
        featureFlags: config.featureFlags,
        services,
        updatedAt: config.updatedAt,
      });
      return;
    }

    if (route === "/v1/agent.quote") {
      const scopeCheck = requireScopes(ctx, ["quote:write"]);
      if (!scopeCheck.ok) {
        jsonError(res, requestId, 403, "UNAUTHORIZED", scopeCheck.message);
        return;
      }

      const parsed = parseBody(agentQuoteSchema, req.body);
      if (!parsed.ok) {
        jsonError(res, requestId, 400, "INVALID_ARGUMENT", parsed.message);
        return;
      }

      const config = await getAgentServiceCatalogConfig();
      if (!config.featureFlags.quoteEnabled) {
        jsonError(res, requestId, 503, "UNAVAILABLE", "Agent quote capability is disabled");
        return;
      }
      const delegatedPolicy = await loadDelegatedRiskPolicy(ctx);

      const serviceId = String(parsed.data.serviceId).trim();
      const service = config.services.find((entry) => entry.id === serviceId && entry.enabled);
      if (!service) {
        jsonError(res, requestId, 404, "NOT_FOUND", "Service not found or not enabled");
        return;
      }

      const quantity = parsed.data.quantity ?? 1;
      if (quantity > service.maxQuantity) {
        jsonError(
          res,
          requestId,
          400,
          "INVALID_ARGUMENT",
          `Quantity exceeds max for service (${service.maxQuantity})`
        );
        return;
      }

      const currency = (parsed.data.currency ?? service.currency ?? config.defaultCurrency).toUpperCase();
      const unitPriceCents = Math.max(0, Math.trunc(service.basePriceCents));
      const subtotalCents = unitPriceCents * quantity;
      if (delegatedPolicy && subtotalCents > delegatedPolicy.orderMaxCents) {
        await db.collection("agentAuditLogs").add({
          actorUid: ctx.uid,
          actorMode: ctx.mode,
          action: "agent_quote_denied_risk_limit",
          requestId,
          agentClientId: delegatedPolicy.agentClientId,
          trustTier: delegatedPolicy.trustTier,
          subtotalCents,
          limitCents: delegatedPolicy.orderMaxCents,
          createdAt: nowTs(),
        });
        await enforceDelegatedCooldownIfNeeded({
          agentClientId: delegatedPolicy.agentClientId,
          actorUid: ctx.uid,
          actorMode: ctx.mode,
          requestId,
        });
        jsonError(
          res,
          requestId,
          403,
          "FAILED_PRECONDITION",
          `Quote exceeds trust-tier max (${delegatedPolicy.orderMaxCents} cents)`
        );
        return;
      }
      const quoteExpiresAt = Timestamp.fromMillis(Date.now() + 15 * 60 * 1000);
      const metadata = parsed.data.metadata ?? {};

      const quoteRef = db.collection("agentQuotes").doc();
      const quoteRow = {
        quoteId: quoteRef.id,
        serviceId: service.id,
        serviceTitle: service.title,
        category: service.category,
        uid: ctx.uid,
        authMode: ctx.mode,
        scopes: ctx.mode === "firebase" ? null : ctx.scopes,
        agentClientId: ctx.mode === "delegated" ? ctx.delegated.agentClientId : null,
        delegatedTokenId: ctx.mode === "delegated" ? ctx.tokenId : null,
        quantity,
        unitPriceCents,
        subtotalCents,
        currency,
        riskLevel: service.riskLevel,
        requiresManualReview: service.requiresManualReview,
        priceId: service.priceId ?? null,
        productId: service.productId ?? null,
        leadTimeDays: service.leadTimeDays,
        status: "quoted",
        mode: config.pricingMode,
        metadata,
        createdAt: nowTs(),
        expiresAt: quoteExpiresAt,
      };

      await quoteRef.set(quoteRow);
      await db.collection("agentAuditLogs").add({
        actorUid: ctx.uid,
        actorMode: ctx.mode,
        action: "agent_quote_created",
        requestId,
        quoteId: quoteRef.id,
        serviceId: service.id,
        quantity,
        subtotalCents,
        currency,
        createdAt: nowTs(),
      });

      jsonOk(res, requestId, {
        quoteId: quoteRef.id,
        status: "quoted",
        pricingMode: config.pricingMode,
        service: {
          id: service.id,
          title: service.title,
          category: service.category,
          riskLevel: service.riskLevel,
          requiresManualReview: service.requiresManualReview,
          leadTimeDays: service.leadTimeDays,
        },
        pricing: {
          unitPriceCents,
          quantity,
          subtotalCents,
          currency,
        },
        expiresAt: quoteExpiresAt,
      });
      return;
    }

    if (route === "/v1/agent.reserve") {
      const scopeCheck = requireScopes(ctx, ["reserve:write"]);
      if (!scopeCheck.ok) {
        jsonError(res, requestId, 403, "UNAUTHORIZED", scopeCheck.message);
        return;
      }

      const parsed = parseBody(agentReserveSchema, req.body);
      if (!parsed.ok) {
        jsonError(res, requestId, 400, "INVALID_ARGUMENT", parsed.message);
        return;
      }

      const config = await getAgentServiceCatalogConfig();
      if (!config.featureFlags.reserveEnabled) {
        jsonError(res, requestId, 503, "UNAVAILABLE", "Agent reservation capability is disabled");
        return;
      }

      const quoteId = String(parsed.data.quoteId).trim();
      const quoteRef = db.collection("agentQuotes").doc(quoteId);
      const reservationId = makeIdempotencyId("agent-reservation", ctx.uid, quoteId);
      const reservationRef = db.collection("agentReservations").doc(reservationId);

      const holdMinutes = parsed.data.holdMinutes ?? 60;
      const holdExpiresAt = Timestamp.fromMillis(Date.now() + holdMinutes * 60_000);
      const reservationMetadata = parsed.data.metadata ?? {};

      const txResult = await db.runTransaction(async (tx) => {
        const [quoteSnap, existingReservationSnap] = await Promise.all([
          tx.get(quoteRef),
          tx.get(reservationRef),
        ]);

        if (!quoteSnap.exists) {
          throw new Error("QUOTE_NOT_FOUND");
        }
        const quote = quoteSnap.data() as Record<string, unknown>;

        const quoteOwnerUid = typeof quote.uid === "string" ? quote.uid : "";
        if (quoteOwnerUid !== ctx.uid && !isStaff) {
          throw new Error("FORBIDDEN");
        }

        const quoteStatus = typeof quote.status === "string" ? quote.status : "quoted";
        if (quoteStatus !== "quoted" && quoteStatus !== "reserved") {
          throw new Error("QUOTE_NOT_RESERVABLE");
        }

        const expiresAtSeconds =
          typeof (quote.expiresAt as { seconds?: unknown } | undefined)?.seconds === "number"
            ? Number((quote.expiresAt as { seconds?: unknown }).seconds)
            : 0;
        if (!expiresAtSeconds || Date.now() > expiresAtSeconds * 1000) {
          throw new Error("QUOTE_EXPIRED");
        }

        if (existingReservationSnap.exists) {
          const existing = existingReservationSnap.data() as Record<string, unknown>;
          return {
            reservationId: existingReservationSnap.id,
            reservation: existing,
            idempotentReplay: true,
          };
        }

        const requiresManualReview = quote.requiresManualReview === true;
        const reservationStatus = requiresManualReview ? "pending_review" : "reserved";
        const now = nowTs();

        const reservation = {
          reservationId,
          quoteId,
          uid: ctx.uid,
          authMode: ctx.mode,
          scopes: ctx.mode === "firebase" ? null : ctx.scopes,
          agentClientId: ctx.mode === "delegated" ? ctx.delegated.agentClientId : null,
          delegatedTokenId: ctx.mode === "delegated" ? ctx.tokenId : null,
          serviceId: typeof quote.serviceId === "string" ? quote.serviceId : null,
          serviceTitle: typeof quote.serviceTitle === "string" ? quote.serviceTitle : null,
          category: typeof quote.category === "string" ? quote.category : null,
          quantity: typeof quote.quantity === "number" ? quote.quantity : 1,
          unitPriceCents: typeof quote.unitPriceCents === "number" ? quote.unitPriceCents : 0,
          subtotalCents: typeof quote.subtotalCents === "number" ? quote.subtotalCents : 0,
          currency: typeof quote.currency === "string" ? quote.currency : config.defaultCurrency,
          riskLevel: typeof quote.riskLevel === "string" ? quote.riskLevel : "medium",
          requiresManualReview,
          priceId: typeof quote.priceId === "string" ? quote.priceId : null,
          productId: typeof quote.productId === "string" ? quote.productId : null,
          status: reservationStatus,
          mode: typeof quote.mode === "string" ? quote.mode : config.pricingMode,
          quoteExpiresAt: quote.expiresAt ?? null,
          holdExpiresAt,
          metadata: reservationMetadata,
          createdAt: now,
          updatedAt: now,
        };

        tx.set(reservationRef, reservation);
        tx.set(
          quoteRef,
          {
            status: "reserved",
            reservationId,
            reservedAt: now,
            updatedAt: now,
          },
          { merge: true }
        );

        const auditRef = db.collection("agentAuditLogs").doc();
        tx.set(auditRef, {
          actorUid: ctx.uid,
          actorMode: ctx.mode,
          action: "agent_reservation_created",
          requestId,
          quoteId,
          reservationId,
          reservationStatus,
          requiresManualReview,
          createdAt: now,
        });

        return { reservationId, reservation, idempotentReplay: false };
      });

      jsonOk(res, requestId, {
        reservationId: txResult.reservationId,
        status: txResult.reservation.status ?? "reserved",
        idempotentReplay: txResult.idempotentReplay,
        reservation: {
          quoteId: txResult.reservation.quoteId ?? quoteId,
          holdExpiresAt: txResult.reservation.holdExpiresAt ?? null,
          requiresManualReview: txResult.reservation.requiresManualReview === true,
          subtotalCents:
            typeof txResult.reservation.subtotalCents === "number"
              ? txResult.reservation.subtotalCents
              : 0,
          currency:
            typeof txResult.reservation.currency === "string"
              ? txResult.reservation.currency
              : config.defaultCurrency,
        },
      });
      return;
    }

    if (route === "/v1/agent.pay") {
      const scopeCheck = requireScopes(ctx, ["pay:write"]);
      if (!scopeCheck.ok) {
        jsonError(res, requestId, 403, "UNAUTHORIZED", scopeCheck.message);
        return;
      }

      const parsed = parseBody(agentPaySchema, req.body);
      if (!parsed.ok) {
        jsonError(res, requestId, 400, "INVALID_ARGUMENT", parsed.message);
        return;
      }

      const catalogConfig = await getAgentServiceCatalogConfig();
      if (!catalogConfig.featureFlags.payEnabled) {
        jsonError(res, requestId, 503, "UNAVAILABLE", "Agent payment capability is disabled");
        return;
      }

      const reservationId = String(parsed.data.reservationId).trim();
      const reservationRef = db.collection("agentReservations").doc(reservationId);
      const reservationSnap = await reservationRef.get();
      if (!reservationSnap.exists) {
        jsonError(res, requestId, 404, "NOT_FOUND", "Reservation not found");
        return;
      }

      const reservation = reservationSnap.data() as Record<string, unknown>;
      const reservationUid = typeof reservation.uid === "string" ? reservation.uid : "";
      if (!reservationUid) {
        jsonError(res, requestId, 500, "INTERNAL", "Reservation missing owner");
        return;
      }
      if (reservationUid !== ctx.uid && !isStaff) {
        jsonError(res, requestId, 403, "UNAUTHORIZED", "Forbidden");
        return;
      }

      const reservationStatus = typeof reservation.status === "string" ? reservation.status : "reserved";
      if (reservationStatus === "cancelled" || reservationStatus === "expired") {
        jsonError(res, requestId, 409, "FAILED_PRECONDITION", "Reservation is no longer payable");
        return;
      }

      const orderId = parsed.data.idempotencyKey
        ? makeIdempotencyId("agent-order", reservationUid, String(parsed.data.idempotencyKey))
        : makeIdempotencyId("agent-order", reservationUid, reservationId);
      const orderRef = db.collection("agentOrders").doc(orderId);
      const now = nowTs();
      const delegatedPolicy = await loadDelegatedRiskPolicy(ctx);
      const reservationSubtotal =
        typeof reservation.subtotalCents === "number" ? reservation.subtotalCents : 0;
      if (delegatedPolicy) {
        if (reservationSubtotal > delegatedPolicy.orderMaxCents) {
          await db.collection("agentAuditLogs").add({
            actorUid: ctx.uid,
            actorMode: ctx.mode,
            action: "agent_pay_denied_risk_limit",
            requestId,
            reservationId,
            agentClientId: delegatedPolicy.agentClientId,
            trustTier: delegatedPolicy.trustTier,
            subtotalCents: reservationSubtotal,
            limitCents: delegatedPolicy.orderMaxCents,
            createdAt: now,
          });
          await enforceDelegatedCooldownIfNeeded({
            agentClientId: delegatedPolicy.agentClientId,
            actorUid: ctx.uid,
            actorMode: ctx.mode,
            requestId,
          });
          jsonError(
            res,
            requestId,
            403,
            "FAILED_PRECONDITION",
            `Order exceeds trust-tier max (${delegatedPolicy.orderMaxCents} cents)`
          );
          return;
        }
        const recentCount = await countRecentOrdersForClient(delegatedPolicy.agentClientId);
        if (recentCount >= delegatedPolicy.maxOrdersPerHour) {
          await db.collection("agentAuditLogs").add({
            actorUid: ctx.uid,
            actorMode: ctx.mode,
            action: "agent_pay_denied_velocity",
            requestId,
            reservationId,
            agentClientId: delegatedPolicy.agentClientId,
            trustTier: delegatedPolicy.trustTier,
            recentOrders: recentCount,
            maxOrdersPerHour: delegatedPolicy.maxOrdersPerHour,
            createdAt: now,
          });
          await enforceDelegatedCooldownIfNeeded({
            agentClientId: delegatedPolicy.agentClientId,
            actorUid: ctx.uid,
            actorMode: ctx.mode,
            requestId,
          });
          jsonError(
            res,
            requestId,
            429,
            "RATE_LIMITED",
            `Agent velocity limit reached (${delegatedPolicy.maxOrdersPerHour}/hour)`
          );
          return;
        }
      }

      const checkoutPriceId =
        typeof reservation.priceId === "string" && reservation.priceId.trim()
          ? reservation.priceId.trim()
          : null;
      const quantity = typeof reservation.quantity === "number" ? Math.max(1, Math.trunc(reservation.quantity)) : 1;

      const orderResult = await db.runTransaction(async (tx) => {
        const existingSnap = await tx.get(orderRef);
        if (existingSnap.exists) {
          const existing = existingSnap.data() as Record<string, unknown>;
          return {
            idempotentReplay: true,
            order: existing,
          };
        }

        const order = {
          orderId,
          uid: reservationUid,
          reservationId,
          quoteId: typeof reservation.quoteId === "string" ? reservation.quoteId : null,
          agentClientId:
            ctx.mode === "delegated"
              ? ctx.delegated.agentClientId
              : (typeof reservation.agentClientId === "string" ? reservation.agentClientId : null),
          status: "payment_required",
          paymentStatus: "checkout_pending",
          fulfillmentStatus: "queued",
          paymentProvider: "stripe",
          stripeCheckoutSessionId: null,
          stripePaymentIntentId: null,
          amountCents: typeof reservation.subtotalCents === "number" ? reservation.subtotalCents : 0,
          currency:
            typeof reservation.currency === "string"
              ? reservation.currency
              : catalogConfig.defaultCurrency,
          quantity,
          priceId: checkoutPriceId,
          mode: typeof reservation.mode === "string" ? reservation.mode : catalogConfig.pricingMode,
          createdAt: now,
          updatedAt: now,
        };

        tx.set(orderRef, order);
        tx.set(
          reservationRef,
          {
            status: "payment_required",
            orderId,
            updatedAt: now,
          },
          { merge: true }
        );
        const auditRef = db.collection("agentAuditLogs").doc();
        tx.set(auditRef, {
          actorUid: ctx.uid,
          actorMode: ctx.mode,
          action: "agent_pay_requested",
          requestId,
          reservationId,
          orderId,
          createdAt: now,
        });
        return { idempotentReplay: false, order };
      });

      const order = orderResult.order;
      const priceConfigured = typeof order.priceId === "string" && order.priceId.trim().length > 0;
      jsonOk(res, requestId, {
        orderId,
        idempotentReplay: orderResult.idempotentReplay,
        status: typeof order.status === "string" ? order.status : "payment_required",
        paymentStatus:
          typeof order.paymentStatus === "string" ? order.paymentStatus : "checkout_pending",
        fulfillmentStatus:
          typeof order.fulfillmentStatus === "string" ? order.fulfillmentStatus : "queued",
        checkout: {
          provider: "stripe",
          ready: priceConfigured,
          requiresUserFirebaseAuth: true,
          checkoutEndpoint: "createAgentCheckoutSession",
          payloadHint: priceConfigured
            ? {
                orderId,
              }
            : null,
          message: priceConfigured
            ? "Call createAgentCheckoutSession to complete payment."
            : "No Stripe priceId is configured for this service. Staff must update Agent service catalog.",
        },
      });
      return;
    }

    if (route === "/v1/agent.status") {
      const scopeCheck = requireScopes(ctx, ["status:read"]);
      if (!scopeCheck.ok) {
        jsonError(res, requestId, 403, "UNAUTHORIZED", scopeCheck.message);
        return;
      }

      const parsed = parseBody(agentStatusSchema, req.body);
      if (!parsed.ok) {
        jsonError(res, requestId, 400, "INVALID_ARGUMENT", parsed.message);
        return;
      }

      const quoteId = parsed.data.quoteId ? String(parsed.data.quoteId).trim() : "";
      const reservationId = parsed.data.reservationId ? String(parsed.data.reservationId).trim() : "";
      const orderId = parsed.data.orderId ? String(parsed.data.orderId).trim() : "";

      if (!quoteId && !reservationId && !orderId) {
        jsonError(res, requestId, 400, "INVALID_ARGUMENT", "Provide quoteId, reservationId, or orderId");
        return;
      }

      const quoteRef = quoteId ? db.collection("agentQuotes").doc(quoteId) : null;
      const reservationRef = reservationId ? db.collection("agentReservations").doc(reservationId) : null;
      const orderRef = orderId ? db.collection("agentOrders").doc(orderId) : null;

      const [quoteSnap, reservationSnap, orderSnap] = await Promise.all([
        quoteRef ? quoteRef.get() : Promise.resolve(null),
        reservationRef ? reservationRef.get() : Promise.resolve(null),
        orderRef ? orderRef.get() : Promise.resolve(null),
      ]);

      const quote = quoteSnap?.exists ? (quoteSnap.data() as Record<string, unknown>) : null;
      const reservation = reservationSnap?.exists
        ? (reservationSnap.data() as Record<string, unknown>)
        : null;
      let order = orderSnap?.exists ? (orderSnap.data() as Record<string, unknown>) : null;
      let resolvedOrderId = orderId || null;
      if (!order && reservation) {
        const inferredOrderId =
          typeof reservation.orderId === "string" ? reservation.orderId.trim() : "";
        if (inferredOrderId) {
          const inferredOrderSnap = await db.collection("agentOrders").doc(inferredOrderId).get();
          if (inferredOrderSnap.exists) {
            order = inferredOrderSnap.data() as Record<string, unknown>;
            resolvedOrderId = inferredOrderId;
          }
        }
      }

      const ownerUid =
        (typeof quote?.uid === "string" ? quote.uid : "") ||
        (typeof reservation?.uid === "string" ? reservation.uid : "") ||
        (typeof order?.uid === "string" ? order.uid : "");
      if (!ownerUid) {
        jsonError(res, requestId, 404, "NOT_FOUND", "No matching status resource found");
        return;
      }
      if (ownerUid !== ctx.uid && !isStaff) {
        jsonError(res, requestId, 403, "UNAUTHORIZED", "Forbidden");
        return;
      }

      const responseQuoteId =
        quoteId ||
        (typeof reservation?.quoteId === "string" ? reservation.quoteId : "") ||
        (typeof order?.quoteId === "string" ? order.quoteId : "") ||
        null;
      const responseReservationId =
        reservationId ||
        (typeof quote?.reservationId === "string" ? quote.reservationId : "") ||
        (typeof order?.reservationId === "string" ? order.reservationId : "") ||
        null;

      const paymentStatus =
        (typeof order?.paymentStatus === "string" ? order.paymentStatus : "") ||
        (typeof order?.status === "string" ? order.status : "") ||
        "unpaid";
      const fulfillmentStatus =
        (typeof order?.fulfillmentStatus === "string" ? order.fulfillmentStatus : "") ||
        "queued";
      const lifecycleStatus =
        (typeof order?.status === "string" ? order.status : "") ||
        (typeof reservation?.status === "string" ? reservation.status : "") ||
        (typeof quote?.status === "string" ? quote.status : "") ||
        "unknown";

      await db.collection("agentAuditLogs").add({
        actorUid: ctx.uid,
        actorMode: ctx.mode,
        action: "agent_status_read",
        requestId,
        quoteId: responseQuoteId,
        reservationId: responseReservationId,
        orderId: resolvedOrderId,
        createdAt: nowTs(),
      });

      jsonOk(res, requestId, {
        uid: ownerUid,
        quoteId: responseQuoteId,
        reservationId: responseReservationId,
        orderId: resolvedOrderId,
        lifecycleStatus,
        paymentStatus,
        fulfillmentStatus,
        quote: quote
          ? {
              status: typeof quote.status === "string" ? quote.status : "unknown",
              subtotalCents: typeof quote.subtotalCents === "number" ? quote.subtotalCents : 0,
              currency: typeof quote.currency === "string" ? quote.currency : "USD",
              expiresAt: quote.expiresAt ?? null,
            }
          : null,
        reservation: reservation
          ? {
              status: typeof reservation.status === "string" ? reservation.status : "unknown",
              holdExpiresAt: reservation.holdExpiresAt ?? null,
              requiresManualReview: reservation.requiresManualReview === true,
            }
          : null,
        order: order
          ? {
              status: typeof order.status === "string" ? order.status : "unknown",
              paymentStatus,
              fulfillmentStatus,
              updatedAt: order.updatedAt ?? null,
            }
          : null,
      });
      return;
    }

    if (route === "/v1/agent.order.get") {
      const scopeCheck = requireScopes(ctx, ["status:read"]);
      if (!scopeCheck.ok) {
        jsonError(res, requestId, 403, "UNAUTHORIZED", scopeCheck.message);
        return;
      }

      const parsed = parseBody(agentOrderGetSchema, req.body);
      if (!parsed.ok) {
        jsonError(res, requestId, 400, "INVALID_ARGUMENT", parsed.message);
        return;
      }

      const orderId = String(parsed.data.orderId).trim();
      const orderSnap = await db.collection("agentOrders").doc(orderId).get();
      if (!orderSnap.exists) {
        jsonError(res, requestId, 404, "NOT_FOUND", "Order not found");
        return;
      }

      const order = orderSnap.data() as Record<string, unknown>;
      const ownerUid = typeof order.uid === "string" ? order.uid : "";
      if (!ownerUid) {
        jsonError(res, requestId, 500, "INTERNAL", "Order missing owner");
        return;
      }
      if (ownerUid !== ctx.uid && !isStaff) {
        jsonError(res, requestId, 403, "UNAUTHORIZED", "Forbidden");
        return;
      }

      await db.collection("agentAuditLogs").add({
        actorUid: ctx.uid,
        actorMode: ctx.mode,
        action: "agent_order_read",
        requestId,
        orderId,
        createdAt: nowTs(),
      });

      jsonOk(res, requestId, {
        order: {
          id: orderSnap.id,
          uid: ownerUid,
          quoteId: typeof order.quoteId === "string" ? order.quoteId : null,
          reservationId:
            typeof order.reservationId === "string" ? order.reservationId : null,
          status: typeof order.status === "string" ? order.status : "unknown",
          paymentStatus:
            typeof order.paymentStatus === "string" ? order.paymentStatus : "unknown",
          fulfillmentStatus:
            typeof order.fulfillmentStatus === "string"
              ? order.fulfillmentStatus
              : "queued",
          amountCents: typeof order.amountCents === "number" ? order.amountCents : 0,
          currency: typeof order.currency === "string" ? order.currency : "USD",
          stripeCheckoutSessionId:
            typeof order.stripeCheckoutSessionId === "string"
              ? order.stripeCheckoutSessionId
              : null,
          stripePaymentIntentId:
            typeof order.stripePaymentIntentId === "string"
              ? order.stripePaymentIntentId
              : null,
          createdAt: order.createdAt ?? null,
          updatedAt: order.updatedAt ?? null,
        },
      });
      return;
    }

    if (route === "/v1/agent.orders.list") {
      const scopeCheck = requireScopes(ctx, ["status:read"]);
      if (!scopeCheck.ok) {
        jsonError(res, requestId, 403, "UNAUTHORIZED", scopeCheck.message);
        return;
      }

      const parsed = parseBody(agentOrdersListSchema, req.body);
      if (!parsed.ok) {
        jsonError(res, requestId, 400, "INVALID_ARGUMENT", parsed.message);
        return;
      }

      const targetUid = parsed.data.uid ? String(parsed.data.uid) : ctx.uid;
      if (targetUid !== ctx.uid && !isStaff) {
        jsonError(res, requestId, 403, "UNAUTHORIZED", "Forbidden");
        return;
      }

      const limit = parsed.data.limit ?? 50;
      const snap = await db.collection("agentOrders").where("uid", "==", targetUid).limit(200).get();
      const rows = snap.docs
        .map((docSnap) => {
          const row = docSnap.data() as Record<string, unknown>;
          return {
            id: docSnap.id,
            uid: targetUid,
            quoteId: typeof row.quoteId === "string" ? row.quoteId : null,
            reservationId:
              typeof row.reservationId === "string" ? row.reservationId : null,
            status: typeof row.status === "string" ? row.status : "unknown",
            paymentStatus:
              typeof row.paymentStatus === "string" ? row.paymentStatus : "unknown",
            fulfillmentStatus:
              typeof row.fulfillmentStatus === "string"
                ? row.fulfillmentStatus
                : "queued",
            amountCents: typeof row.amountCents === "number" ? row.amountCents : 0,
            currency: typeof row.currency === "string" ? row.currency : "USD",
            updatedAt: row.updatedAt ?? null,
            createdAt: row.createdAt ?? null,
          };
        })
        .sort((a, b) => {
          const aMs = Number(((a.updatedAt as { seconds?: unknown } | undefined)?.seconds ?? 0));
          const bMs = Number(((b.updatedAt as { seconds?: unknown } | undefined)?.seconds ?? 0));
          return bMs - aMs;
        })
        .slice(0, limit);

      await db.collection("agentAuditLogs").add({
        actorUid: ctx.uid,
        actorMode: ctx.mode,
        action: "agent_orders_list_read",
        requestId,
        uid: targetUid,
        returned: rows.length,
        createdAt: nowTs(),
      });

      jsonOk(res, requestId, { uid: targetUid, orders: rows });
      return;
    }

    if (route === "/v1/agent.requests.create") {
      const scopeCheck = requireScopes(ctx, ["requests:write"]);
      if (!scopeCheck.ok) {
        jsonError(res, requestId, 403, "UNAUTHORIZED", scopeCheck.message);
        return;
      }

      const parsed = parseBody(agentRequestCreateSchema, req.body);
      if (!parsed.ok) {
        jsonError(res, requestId, 400, "INVALID_ARGUMENT", parsed.message);
        return;
      }

      const nowValue = nowTs();
      const idempotencyKey = readHeaderFirst(req, "x-idempotency-key");
      const requestRef = idempotencyKey
        ? db.collection(AGENT_REQUESTS_COL).doc(makeIdempotencyId("agent-request", ctx.uid, idempotencyKey))
        : db.collection(AGENT_REQUESTS_COL).doc();
      const requesterMode = ctx.mode === "pat" || ctx.mode === "delegated" ? "pat" : "firebase";
      const requesterTokenId = ctx.mode === "pat" ? ctx.tokenId : null;
      const isCommission = parsed.data.kind === "commission";
      const rightsAttested = parsed.data.rightsAttested === true;
      const intendedUse = trimOrNull(parsed.data.intendedUse);
      if (isCommission && !rightsAttested) {
        jsonError(
          res,
          requestId,
          400,
          "FAILED_PRECONDITION",
          "Commission requests require rights attestation (rightsAttested=true).",
          { policyVersion: COMMISSION_POLICY_VERSION, reasonCode: "insufficient_rights_attestation" }
        );
        return;
      }
      const commissionPolicy = isCommission
        ? evaluateCommissionPolicy({
            title: parsed.data.title,
            summary: trimOrNull(parsed.data.summary),
            notes: trimOrNull(parsed.data.notes),
            intendedUse,
          })
        : null;
      if (commissionPolicy?.disposition === "reject") {
        jsonError(
          res,
          requestId,
          400,
          "FAILED_PRECONDITION",
          "Commission request violated prohibited content policy.",
          { policyVersion: COMMISSION_POLICY_VERSION, reasonCodes: commissionPolicy.reasonCodes }
        );
        return;
      }
      const initialStatus = commissionPolicy?.disposition === "review" ? "triaged" : "new";

      const payload = {
        createdAt: nowValue,
        updatedAt: nowValue,
        createdByUid: ctx.uid,
        createdByMode: requesterMode,
        createdByTokenId: requesterTokenId,
        status: initialStatus,
        kind: parsed.data.kind,
        title: parsed.data.title.trim(),
        summary: trimOrNull(parsed.data.summary),
        notes: trimOrNull(parsed.data.notes),
        constraints: parsed.data.constraints ?? {},
        logistics: {
          mode: trimOrNull(parsed.data.logisticsMode),
        },
        metadata: {
          ...(parsed.data.metadata ?? {}),
          commissionPolicyVersion: isCommission ? COMMISSION_POLICY_VERSION : null,
        },
        policy:
          commissionPolicy && isCommission
            ? {
                version: COMMISSION_POLICY_VERSION,
                rightsAttested,
                intendedUse,
                disposition: commissionPolicy.disposition,
                reasonCodes: commissionPolicy.reasonCodes,
                reviewDecision: null,
                reviewReasonCode: null,
                reviewedAt: null,
                reviewedByUid: null,
              }
            : null,
        linkedBatchId: null,
        staff: {
          assignedToUid: null,
          triagedAt: null,
          internalNotes: null,
        },
      };
      await requestRef.set(payload, { merge: Boolean(idempotencyKey) });
      await requestRef.collection("audit").add({
        at: nowValue,
        type: "created",
        actorUid: ctx.uid,
        actorMode: ctx.mode,
        details: {
          requestId: requestRef.id,
          kind: parsed.data.kind,
          policyVersion: commissionPolicy ? COMMISSION_POLICY_VERSION : null,
          policyDisposition: commissionPolicy?.disposition ?? null,
          policyReasonCodes: commissionPolicy?.reasonCodes ?? [],
          idempotencyKey: idempotencyKey || null,
        },
      });
      await db.collection("agentAuditLogs").add({
        actorUid: ctx.uid,
        actorMode: ctx.mode,
        action: "agent_request_created",
        requestId,
        agentRequestId: requestRef.id,
        kind: parsed.data.kind,
        policyVersion: commissionPolicy ? COMMISSION_POLICY_VERSION : null,
        policyDisposition: commissionPolicy?.disposition ?? null,
        policyReasonCodes: commissionPolicy?.reasonCodes ?? [],
        createdAt: nowValue,
      });

      jsonOk(res, requestId, {
        agentRequestId: requestRef.id,
        status: initialStatus,
        idempotencyReplay: false,
      });
      return;
    }

    if (route === "/v1/agent.requests.listMine") {
      const scopeCheck = requireScopes(ctx, ["requests:read"]);
      if (!scopeCheck.ok) {
        jsonError(res, requestId, 403, "UNAUTHORIZED", scopeCheck.message);
        return;
      }
      const parsed = parseBody(agentRequestListMineSchema, req.body);
      if (!parsed.ok) {
        jsonError(res, requestId, 400, "INVALID_ARGUMENT", parsed.message);
        return;
      }
      const limit = parsed.data.limit ?? 50;
      const includeClosed = parsed.data.includeClosed ?? true;
      const snap = await db.collection(AGENT_REQUESTS_COL).where("createdByUid", "==", ctx.uid).limit(300).get();
      const rows = snap.docs
        .map((docSnap) => {
          const data = docSnap.data() as Record<string, unknown>;
          return { id: docSnap.id, ...data } as Record<string, unknown> & { id: string };
        })
        .filter((row) => includeClosed || !CLOSED_AGENT_REQUEST_STATUSES.has(String(row.status ?? "")))
        .sort((a, b) => readTimestampSeconds(b.updatedAt) - readTimestampSeconds(a.updatedAt))
        .slice(0, limit);

      await db.collection("agentAuditLogs").add({
        actorUid: ctx.uid,
        actorMode: ctx.mode,
        action: "agent_requests_list_mine",
        requestId,
        returned: rows.length,
        createdAt: nowTs(),
      });

      jsonOk(res, requestId, { requests: rows });
      return;
    }

    if (route === "/v1/agent.requests.listStaff") {
      const scopeCheck = requireScopes(ctx, ["requests:read"]);
      if (!scopeCheck.ok) {
        jsonError(res, requestId, 403, "UNAUTHORIZED", scopeCheck.message);
        return;
      }
      if (!isStaff) {
        jsonError(res, requestId, 403, "UNAUTHORIZED", "Forbidden");
        return;
      }
      const parsed = parseBody(agentRequestListStaffSchema, req.body);
      if (!parsed.ok) {
        jsonError(res, requestId, 400, "INVALID_ARGUMENT", parsed.message);
        return;
      }
      const statusFilter = parsed.data.status ?? "all";
      const kindFilter = parsed.data.kind ?? "all";
      const limit = parsed.data.limit ?? 120;
      const snap = await db.collection(AGENT_REQUESTS_COL).limit(500).get();
      const rows = snap.docs
        .map((docSnap) => {
          const data = docSnap.data() as Record<string, unknown>;
          return { id: docSnap.id, ...data } as Record<string, unknown> & { id: string };
        })
        .filter((row) => (statusFilter === "all" ? true : String(row.status ?? "") === statusFilter))
        .filter((row) => (kindFilter === "all" ? true : String(row.kind ?? "") === kindFilter))
        .sort((a, b) => readTimestampSeconds(b.updatedAt) - readTimestampSeconds(a.updatedAt))
        .slice(0, limit);

      await db.collection("agentAuditLogs").add({
        actorUid: ctx.uid,
        actorMode: ctx.mode,
        action: "agent_requests_list_staff",
        requestId,
        statusFilter,
        kindFilter,
        returned: rows.length,
        createdAt: nowTs(),
      });

      jsonOk(res, requestId, { requests: rows });
      return;
    }

    if (route === "/v1/agent.requests.updateStatus") {
      const scopeCheck = requireScopes(ctx, ["requests:write"]);
      if (!scopeCheck.ok) {
        jsonError(res, requestId, 403, "UNAUTHORIZED", scopeCheck.message);
        return;
      }
      const parsed = parseBody(agentRequestUpdateStatusSchema, req.body);
      if (!parsed.ok) {
        jsonError(res, requestId, 400, "INVALID_ARGUMENT", parsed.message);
        return;
      }
      const ref = db.collection(AGENT_REQUESTS_COL).doc(parsed.data.requestId);
      const snap = await ref.get();
      if (!snap.exists) {
        jsonError(res, requestId, 404, "NOT_FOUND", "Request not found");
        return;
      }
      const row = snap.data() as Record<string, unknown>;
      const ownerUid = typeof row.createdByUid === "string" ? row.createdByUid : "";
      const toStatus = parsed.data.status;
      const reason = trimOrNull(parsed.data.reason);
      const reasonCode = trimOrNull(parsed.data.reasonCode);
      const isCommission = String(row.kind ?? "") === "commission";
      const requiresPolicyReasonCode =
        isCommission && isStaff && (toStatus === "accepted" || toStatus === "rejected");
      if (requiresPolicyReasonCode && !reasonCode) {
        jsonError(
          res,
          requestId,
          400,
          "FAILED_PRECONDITION",
          "Commission status updates to accepted/rejected require reasonCode.",
          { policyVersion: COMMISSION_POLICY_VERSION }
        );
        return;
      }
      if (requiresPolicyReasonCode && reasonCode && !COMMISSION_REQUIRED_REASON_CODES.has(reasonCode)) {
        jsonError(
          res,
          requestId,
          400,
          "INVALID_ARGUMENT",
          "Unsupported reasonCode for commission review decision.",
          { allowed: Array.from(COMMISSION_REQUIRED_REASON_CODES.values()) }
        );
        return;
      }

      const ownerCanCancel = ownerUid === ctx.uid && toStatus === "cancelled";
      if (!isStaff && !ownerCanCancel) {
        jsonError(res, requestId, 403, "UNAUTHORIZED", "Forbidden");
        return;
      }

      const patch: Record<string, unknown> = {
        status: toStatus,
        updatedAt: nowTs(),
      };
      if (isStaff) {
        patch.staff = {
          assignedToUid: ctx.uid,
          triagedAt: nowTs(),
          internalNotes: reason,
        };
        if (isCommission) {
          const previousPolicy =
            row.policy && typeof row.policy === "object" ? (row.policy as Record<string, unknown>) : {};
          const previousVersion =
            typeof previousPolicy.version === "string" && previousPolicy.version.trim()
              ? previousPolicy.version
              : COMMISSION_POLICY_VERSION;
          patch.policy = {
            ...previousPolicy,
            version: previousVersion,
            reviewDecision: toStatus === "accepted" ? "approved" : toStatus === "rejected" ? "rejected" : previousPolicy.reviewDecision ?? null,
            reviewReasonCode: reasonCode ?? previousPolicy.reviewReasonCode ?? null,
            reviewedAt: toStatus === "accepted" || toStatus === "rejected" ? nowTs() : previousPolicy.reviewedAt ?? null,
            reviewedByUid: toStatus === "accepted" || toStatus === "rejected" ? ctx.uid : previousPolicy.reviewedByUid ?? null,
          };
        }
      }
      await ref.set(patch, { merge: true });
      await ref.collection("audit").add({
        at: nowTs(),
        type: "status_changed",
        actorUid: ctx.uid,
        actorMode: ctx.mode,
        details: {
          from: typeof row.status === "string" ? row.status : "new",
          to: toStatus,
          reason,
          reasonCode,
          policyVersion: isCommission ? COMMISSION_POLICY_VERSION : null,
        },
      });
      await db.collection("agentAuditLogs").add({
        actorUid: ctx.uid,
        actorMode: ctx.mode,
        action: "agent_request_status_updated",
        requestId,
        agentRequestId: ref.id,
        status: toStatus,
        reason,
        reasonCode,
        policyVersion: isCommission ? COMMISSION_POLICY_VERSION : null,
        createdAt: nowTs(),
      });
      jsonOk(res, requestId, { agentRequestId: ref.id, status: toStatus });
      return;
    }

    if (route === "/v1/agent.requests.linkBatch") {
      const scopeCheck = requireScopes(ctx, ["requests:write"]);
      if (!scopeCheck.ok) {
        jsonError(res, requestId, 403, "UNAUTHORIZED", scopeCheck.message);
        return;
      }
      if (!isStaff) {
        jsonError(res, requestId, 403, "UNAUTHORIZED", "Forbidden");
        return;
      }
      const parsed = parseBody(agentRequestLinkBatchSchema, req.body);
      if (!parsed.ok) {
        jsonError(res, requestId, 400, "INVALID_ARGUMENT", parsed.message);
        return;
      }
      const ref = db.collection(AGENT_REQUESTS_COL).doc(parsed.data.requestId);
      const snap = await ref.get();
      if (!snap.exists) {
        jsonError(res, requestId, 404, "NOT_FOUND", "Request not found");
        return;
      }

      await ref.set(
        {
          linkedBatchId: parsed.data.batchId,
          updatedAt: nowTs(),
          staff: {
            assignedToUid: ctx.uid,
            triagedAt: nowTs(),
          },
        },
        { merge: true }
      );
      await ref.collection("audit").add({
        at: nowTs(),
        type: "batch_linked",
        actorUid: ctx.uid,
        actorMode: ctx.mode,
        details: {
          batchId: parsed.data.batchId,
        },
      });
      await db.collection("agentAuditLogs").add({
        actorUid: ctx.uid,
        actorMode: ctx.mode,
        action: "agent_request_batch_linked",
        requestId,
        agentRequestId: ref.id,
        batchId: parsed.data.batchId,
        createdAt: nowTs(),
      });
      jsonOk(res, requestId, { agentRequestId: ref.id, linkedBatchId: parsed.data.batchId });
      return;
    }

    jsonError(res, requestId, 404, "NOT_FOUND", "Unknown route", { route });
  } catch (error: unknown) {
    const msg = safeErrorMessage(error);
    if (msg === "QUOTE_NOT_FOUND") {
      jsonError(res, requestId, 404, "NOT_FOUND", "Quote not found");
      return;
    }
    if (msg === "FORBIDDEN") {
      jsonError(res, requestId, 403, "UNAUTHORIZED", "Forbidden");
      return;
    }
    if (msg === "QUOTE_NOT_RESERVABLE") {
      jsonError(res, requestId, 409, "FAILED_PRECONDITION", "Quote is not in a reservable state");
      return;
    }
    if (msg === "QUOTE_EXPIRED") {
      jsonError(res, requestId, 410, "FAILED_PRECONDITION", "Quote has expired");
      return;
    }
    if (msg === "DELEGATED_CLIENT_NOT_FOUND") {
      jsonError(res, requestId, 403, "UNAUTHORIZED", "Delegated client not found");
      return;
    }
    if (msg === "DELEGATED_CLIENT_INACTIVE") {
      jsonError(res, requestId, 403, "UNAUTHORIZED", "Delegated client is not active");
      return;
    }
    if (msg === "DELEGATED_CLIENT_COOLDOWN") {
      jsonError(res, requestId, 429, "RATE_LIMITED", "Delegated client is in cooldown");
      return;
    }

    if (isMissingIndexError(error)) {
      jsonError(res, requestId, 412, "FAILED_PRECONDITION", "Missing Firestore composite index", {
        message: msg,
      });
      return;
    }

    jsonError(res, requestId, 500, "INTERNAL", "Request failed", { message: msg });
  }
}
