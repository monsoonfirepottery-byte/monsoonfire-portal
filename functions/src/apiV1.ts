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
  parseBody,
  enforceRateLimit,
  type AuthContext,
} from "./shared";
import { listIntegrationEvents } from "./integrationEvents";
import { getAgentServiceCatalogConfig } from "./agentCatalog";

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

    jsonError(res, requestId, 404, "NOT_FOUND", "Unknown route", { route });
  } catch (error: unknown) {
    const msg = safeErrorMessage(error);
    if (isMissingIndexError(error)) {
      jsonError(res, requestId, 412, "FAILED_PRECONDITION", "Missing Firestore composite index", {
        message: msg,
      });
      return;
    }

    jsonError(res, requestId, 500, "INTERNAL", "Request failed", { message: msg });
  }
}
