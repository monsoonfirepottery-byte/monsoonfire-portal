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

    if (isMissingIndexError(error)) {
      jsonError(res, requestId, 412, "FAILED_PRECONDITION", "Missing Firestore composite index", {
        message: msg,
      });
      return;
    }

    jsonError(res, requestId, 500, "INTERNAL", "Request failed", { message: msg });
  }
}
