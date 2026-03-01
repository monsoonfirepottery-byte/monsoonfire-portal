import { randomBytes } from "crypto";
import { z } from "zod";
import * as logger from "firebase-functions/logger";
import {
  applyCors,
  requireAuthContext,
  requireAdmin,
  isStaffFromDecoded,
  db,
  nowTs,
  Timestamp,
  makeIdempotencyId,
  parseBody,
  enforceRateLimit,
  type AuthContext,
  safeString,
  type RequestLike,
  type ResponseLike,
} from "./shared";
import {
  assertActorAuthorized,
  enforceAppCheckIfEnabled,
  logAuditEvent,
  readAuthFeatureFlags,
} from "./authz";
import { listIntegrationEvents } from "./integrationEvents";
import { getAgentServiceCatalogConfig } from "./agentCatalog";
import { getAgentOpsConfig } from "./agentCommerce";
import {
  getStationCapacity,
  isKnownStationId,
  normalizeStationId as normalizeKnownStationId,
  type ReservationStationId,
} from "./reservationStationConfig";
import {
  normalizeIntakeMode,
  type IntakeMode,
} from "./intakeMode";
import {
  importLibraryIsbnBatch,
  lookupLibraryExternalSources,
  getLibraryExternalLookupProviderConfig,
  setLibraryExternalLookupProviderConfig,
  getLibraryRolloutConfig,
  setLibraryRolloutConfig,
  LIBRARY_ROLLOUT_PHASES,
  resolveLibraryIsbn,
  findExistingLibraryItemIdByIsbn,
  type LibraryRolloutPhase,
} from "./library";

function boolEnv(name: string, fallback = false): boolean {
  const raw = process.env[name];
  if (typeof raw !== "string") return fallback;
  const normalized = raw.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

const AUTO_COOLDOWN_ON_RATE_LIMIT = boolEnv("AUTO_COOLDOWN_ON_RATE_LIMIT", false);
const AUTO_COOLDOWN_MINUTES = Math.max(1, Number(process.env.AUTO_COOLDOWN_MINUTES ?? 5) || 5);
const LIBRARY_LOAN_IDEMPOTENCY_COL = "libraryLoanIdempotency";

function readHeaderFirst(req: RequestLike, name: string): string {
  const key = name.toLowerCase();
  const raw = req.headers?.[key] ?? req.headers?.[name];
  if (typeof raw === "string") return raw.trim();
  if (Array.isArray(raw)) {
    const first = raw[0];
    if (typeof first === "string" || typeof first === "number") return String(first).trim();
  }
  return "";
}

function getRequestId(req: RequestLike): string {
  const provided = readHeaderFirst(req, "x-request-id");
  if (provided) return provided.slice(0, 128);
  return `req_${randomBytes(12).toString("base64url")}`;
}

type LibraryLoanWriteOperation = "checkout" | "checkIn" | "markLost" | "assessReplacementFee";

function readIdempotencyKey(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed;
}

function resolveIdempotencyKey(
  req: RequestLike,
  bodyIdempotencyKey: unknown,
): { ok: true; key: string | null } | { ok: false; message: string } {
  const fromBody = readIdempotencyKey(bodyIdempotencyKey);
  const fromHeader = readIdempotencyKey(readHeaderFirst(req, "x-idempotency-key"));
  if (fromBody && fromHeader && fromBody !== fromHeader) {
    return {
      ok: false,
      message: "Body idempotencyKey must match x-idempotency-key when both are provided.",
    };
  }
  const key = fromBody ?? fromHeader ?? null;
  if (key && key.length > 120) {
    return { ok: false, message: "Idempotency key must be 120 characters or fewer." };
  }
  return { ok: true, key };
}

function libraryLoanIdempotencyRef(
  actorUid: string,
  operation: LibraryLoanWriteOperation,
  key: string,
) {
  return db
    .collection(LIBRARY_LOAN_IDEMPOTENCY_COL)
    .doc(makeIdempotencyId(`library-loan-${operation}`, actorUid, key));
}

function libraryLoanIdempotencyFingerprint(
  operation: LibraryLoanWriteOperation,
  payload: Record<string, unknown>,
): string {
  return JSON.stringify({
    operation,
    payload,
  });
}

function withLibraryLoanReplayFlag(
  operation: LibraryLoanWriteOperation,
  responseData: Record<string, unknown>,
): Record<string, unknown> {
  if (operation === "assessReplacementFee") {
    const feeRaw = responseData.fee;
    const fee =
      feeRaw && typeof feeRaw === "object" && !Array.isArray(feeRaw)
        ? { ...(feeRaw as Record<string, unknown>) }
        : {};
    fee.idempotentReplay = true;
    return { ...responseData, fee };
  }
  const loanRaw = responseData.loan;
  const loan =
    loanRaw && typeof loanRaw === "object" && !Array.isArray(loanRaw)
      ? { ...(loanRaw as Record<string, unknown>) }
      : {};
  loan.idempotentReplay = true;
  return { ...responseData, loan };
}

async function readLibraryLoanIdempotencyReplay(params: {
  actorUid: string;
  operation: LibraryLoanWriteOperation;
  key: string;
  fingerprint: string;
}): Promise<
  | { kind: "none" }
  | { kind: "conflict" }
  | { kind: "replay"; responseData: Record<string, unknown> }
> {
  const snap = await libraryLoanIdempotencyRef(params.actorUid, params.operation, params.key).get();
  if (!snap.exists) {
    return { kind: "none" };
  }

  const row = (snap.data() ?? {}) as Record<string, unknown>;
  const storedFingerprint = safeString(row.requestFingerprint).trim();
  if (storedFingerprint && storedFingerprint !== params.fingerprint) {
    return { kind: "conflict" };
  }

  const responseData = row.responseData;
  if (!responseData || typeof responseData !== "object" || Array.isArray(responseData)) {
    return { kind: "conflict" };
  }

  return {
    kind: "replay",
    responseData: withLibraryLoanReplayFlag(
      params.operation,
      responseData as Record<string, unknown>,
    ),
  };
}

async function persistLibraryLoanIdempotencyRecord(params: {
  actorUid: string;
  operation: LibraryLoanWriteOperation;
  key: string;
  fingerprint: string;
  responseData: Record<string, unknown>;
  requestId: string;
}) {
  const now = nowTs();
  try {
    await libraryLoanIdempotencyRef(params.actorUid, params.operation, params.key).set(
      {
        actorUid: params.actorUid,
        operation: params.operation,
        requestFingerprint: params.fingerprint,
        responseData: params.responseData,
        responseVersion: 1,
        requestId: params.requestId,
        createdAt: now,
        updatedAt: now,
      },
      { merge: true },
    );
  } catch (error: unknown) {
    logger.warn("library loan idempotency persist failed", {
      requestId: params.requestId,
      operation: params.operation,
      actorUid: params.actorUid,
      message: safeErrorMessage(error),
    });
  }
}

const ROUTE_FAMILY_V1 = "v1";
const ROUTE_FAMILY_LEGACY = "legacy";
type RouteFamily = typeof ROUTE_FAMILY_V1 | typeof ROUTE_FAMILY_LEGACY;

function getRouteFamily(req: RequestLike): RouteFamily {
  const marker = (req as { __routeFamily?: string | undefined }).__routeFamily;
  return marker === ROUTE_FAMILY_LEGACY ? ROUTE_FAMILY_LEGACY : ROUTE_FAMILY_V1;
}

function includeRouteFamilyMetadata(
  req: RequestLike,
  metadata?: Record<string, unknown> | null
): Record<string, unknown> {
  return {
    ...(metadata ?? {}),
    routeFamily: getRouteFamily(req),
  };
}

async function logReservationAuditEvent(
  params: Parameters<typeof logAuditEvent>[0] & {
    req: RequestLike;
    requestId: string;
    action: string;
    resourceType: string;
    ownerUid?: string | null;
    result: "allow" | "deny" | "error";
    resourceId?: string | null;
    reasonCode?: string | null;
    ctx?: AuthContext | null;
    metadata?: Record<string, unknown> | null;
  }
) {
  await logAuditEvent({
    ...params,
    metadata: includeRouteFamilyMetadata(params.req, params.metadata),
  });
}

async function logLibraryAuditEvent(
  params: Parameters<typeof logAuditEvent>[0] & {
    req: RequestLike;
    requestId: string;
    action: string;
    resourceType: string;
    ownerUid?: string | null;
    result: "allow" | "deny" | "error";
    resourceId?: string | null;
    reasonCode?: string | null;
    ctx?: AuthContext | null;
    metadata?: Record<string, unknown> | null;
  }
) {
  await logAuditEvent({
    ...params,
    metadata: includeRouteFamilyMetadata(params.req, params.metadata),
  });
}

function jsonOk(res: ResponseLike, requestId: string, data: unknown) {
  res.set("x-request-id", requestId);
  res.status(200).json({ ok: true, requestId, data });
}

function jsonError(
  res: ResponseLike,
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

type BatchDoc = Record<string, unknown>;

type BatchSummary = {
  id: string;
  ownerUid: string | null;
  ownerDisplayName: string | null;
  title: string | null;
  intakeMode: string;
  estimatedCostCents: number | null;
  kilnName: string | null;
  estimateNotes: string | null;
  state: string | null;
  isClosed: boolean | null;
  createdAt: unknown;
  updatedAt: unknown;
  closedAt: unknown;
  journeyRootBatchId: string | null;
  journeyParentBatchId: string | null;
};

function isMissingIndexError(error: unknown): boolean {
  const msg = safeErrorMessage(error).toLowerCase();
  return msg.includes("requires an index") || (msg.includes("failed_precondition") && msg.includes("index"));
}

function canReadBatchDoc(params: { uid: string; isStaff: boolean; batch: BatchDoc }): boolean {
  const { uid, isStaff, batch } = params;
  if (isStaff) return true;
  const ownerUid = typeof batch.ownerUid === "string" ? batch.ownerUid : "";
  if (ownerUid === uid) return true;
  return false;
}

function canReadBatchTimeline(params: { uid: string; isStaff: boolean; batch: BatchDoc }): boolean {
  const { uid, isStaff, batch } = params;
  if (isStaff) return true;
  const ownerUid = typeof batch.ownerUid === "string" ? batch.ownerUid : "";
  if (ownerUid === uid) return true;
  const editors = Array.isArray(batch.editors)
    ? batch.editors.filter((entry): entry is string => typeof entry === "string")
    : [];
  return editors.includes(uid);
}

function toBatchSummary(id: string, data: BatchDoc): BatchSummary {
  return {
    id,
    ownerUid: typeof data?.ownerUid === "string" ? data.ownerUid : null,
    ownerDisplayName: typeof data?.ownerDisplayName === "string" ? data.ownerDisplayName : null,
    title: typeof data?.title === "string" ? data.title : null,
    intakeMode: normalizeIntakeMode(data?.intakeMode),
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

const libraryItemsListSchema = z.object({
  q: z.string().max(200).optional().nullable(),
  mediaType: z.array(z.string().min(1).max(80)).max(20).optional(),
  genre: z.string().max(120).optional().nullable(),
  studioCategory: z.array(z.string().min(1).max(120)).max(20).optional(),
  availability: z
    .enum(["available", "checked_out", "overdue", "lost", "unavailable", "archived"])
    .optional()
    .nullable(),
  ratingMin: z.number().min(0).max(5).optional(),
  ratingMax: z.number().min(0).max(5).optional(),
  sort: z
    .enum(["highest_rated", "most_borrowed", "recently_added", "recently_reviewed", "staff_picks"])
    .optional(),
  page: z.number().int().min(1).max(500).optional(),
  pageSize: z.number().int().min(1).max(100).optional(),
});

const libraryItemGetSchema = z.object({
  itemId: z.string().min(1).max(200).trim(),
});

const libraryDiscoverySchema = z.object({
  limit: z.number().int().min(1).max(30).optional(),
});

const libraryExternalLookupSchema = z.object({
  q: z.string().min(1).max(240),
  limit: z.number().int().min(1).max(12).optional(),
});

const libraryRolloutGetSchema = z.object({});

const libraryRolloutSetSchema = z.object({
  phase: z.enum(LIBRARY_ROLLOUT_PHASES),
  note: z.string().max(300).optional().nullable(),
});

const libraryExternalLookupProviderConfigSetSchema = z
  .object({
    openlibraryEnabled: z.boolean().optional(),
    googlebooksEnabled: z.boolean().optional(),
    note: z.string().max(300).optional().nullable(),
  })
  .superRefine((value, ctx) => {
    if (typeof value.openlibraryEnabled !== "boolean" && typeof value.googlebooksEnabled !== "boolean") {
      ctx.addIssue({
        code: "custom",
        path: [],
        message: "Provide at least one provider toggle.",
      });
    }
  });

const libraryItemsImportIsbnsSchema = z.object({
  isbns: z.array(z.string().min(1)).min(1).max(200),
  source: z.string().max(80).optional().nullable(),
});

const libraryItemLifecycleStatusSchema = z.enum([
  "available",
  "checked_out",
  "overdue",
  "lost",
  "unavailable",
  "archived",
]);

const libraryItemResolveIsbnSchema = z.object({
  isbn: z.string().min(1).max(80).trim(),
  allowRemoteLookup: z.boolean().optional(),
});

const libraryItemCreateSchema = z
  .object({
    itemId: z.string().min(1).max(200).trim().optional().nullable(),
    isbn: z.string().max(80).optional().nullable(),
    title: z.string().max(240).optional().nullable(),
    subtitle: z.string().max(240).optional().nullable(),
    authors: z.array(z.string().min(1).max(240)).max(20).optional(),
    description: z.string().max(4000).optional().nullable(),
    publisher: z.string().max(240).optional().nullable(),
    publishedDate: z.string().max(40).optional().nullable(),
    pageCount: z.number().int().min(1).max(10000).optional().nullable(),
    subjects: z.array(z.string().min(1).max(120)).max(40).optional(),
    coverUrl: z.string().max(2000).optional().nullable(),
    format: z.string().max(80).optional().nullable(),
    mediaType: z.string().max(80).optional().nullable(),
    totalCopies: z.number().int().min(1).max(500).optional(),
    availableCopies: z.number().int().min(0).max(500).optional(),
    status: libraryItemLifecycleStatusSchema.optional(),
    replacementValueCents: z.number().int().min(0).max(5_000_000).optional().nullable(),
    tags: z.array(z.string().min(1).max(80)).max(60).optional(),
    source: z.string().max(120).optional().nullable(),
    allowRemoteLookup: z.boolean().optional(),
  })
  .superRefine((value, ctx) => {
    const hasTitle = safeString(value.title).trim().length > 0;
    const hasIsbn = safeString(value.isbn).trim().length > 0;
    if (!hasTitle && !hasIsbn) {
      ctx.addIssue({
        code: "custom",
        path: [],
        message: "Provide at least a title or ISBN when creating a library item.",
      });
    }
  });

const libraryItemUpdateSchema = z
  .object({
    itemId: z.string().min(1).max(200).trim(),
    isbn: z.string().max(80).optional().nullable(),
    title: z.string().max(240).optional().nullable(),
    subtitle: z.string().max(240).optional().nullable(),
    authors: z.array(z.string().min(1).max(240)).max(20).optional(),
    description: z.string().max(4000).optional().nullable(),
    publisher: z.string().max(240).optional().nullable(),
    publishedDate: z.string().max(40).optional().nullable(),
    pageCount: z.number().int().min(1).max(10000).optional().nullable(),
    subjects: z.array(z.string().min(1).max(120)).max(40).optional(),
    coverUrl: z.string().max(2000).optional().nullable(),
    format: z.string().max(80).optional().nullable(),
    mediaType: z.string().max(80).optional().nullable(),
    totalCopies: z.number().int().min(1).max(500).optional(),
    availableCopies: z.number().int().min(0).max(500).optional(),
    status: libraryItemLifecycleStatusSchema.optional(),
    replacementValueCents: z.number().int().min(0).max(5_000_000).optional().nullable(),
    tags: z.array(z.string().min(1).max(80)).max(60).optional(),
    source: z.string().max(120).optional().nullable(),
    allowRemoteLookup: z.boolean().optional(),
  })
  .superRefine((value, ctx) => {
    const hasPatchField = [
      "isbn",
      "title",
      "subtitle",
      "authors",
      "description",
      "publisher",
      "publishedDate",
      "pageCount",
      "subjects",
      "coverUrl",
      "format",
      "mediaType",
      "totalCopies",
      "availableCopies",
      "status",
      "replacementValueCents",
      "tags",
      "source",
      "allowRemoteLookup",
    ].some((field) => Object.prototype.hasOwnProperty.call(value, field));

    if (!hasPatchField) {
      ctx.addIssue({
        code: "custom",
        path: [],
        message: "Provide at least one library item field to update.",
      });
    }
  });

const libraryItemDeleteSchema = z.object({
  itemId: z.string().min(1).max(200).trim(),
  note: z.string().max(400).optional().nullable(),
});

const libraryRecommendationModerationStatusSchema = z.enum(["pending_review", "approved", "rejected", "hidden"]);

const libraryRecommendationsListSchema = z.object({
  itemId: z.string().min(1).max(200).trim().optional().nullable(),
  status: libraryRecommendationModerationStatusSchema.optional().nullable(),
  sort: z.enum(["newest", "helpful"]).optional(),
  limit: z.number().int().min(1).max(100).optional(),
});

const libraryRecommendationsCreateSchema = z
  .object({
    itemId: z.string().min(1).max(200).trim().optional().nullable(),
    title: z.string().max(240).optional().nullable(),
    author: z.string().max(240).optional().nullable(),
    isbn: z.string().max(40).optional().nullable(),
    rationale: z.string().max(1200).optional().nullable(),
    tags: z.array(z.string().min(1).max(60)).max(20).optional(),
  })
  .superRefine((value, ctx) => {
    const hasAnchor =
      safeString(value.itemId).trim().length > 0 ||
      safeString(value.title).trim().length > 0 ||
      safeString(value.isbn).trim().length > 0;
    if (!hasAnchor) {
      ctx.addIssue({
        code: "custom",
        path: [],
        message: "Provide at least one recommendation target: itemId, title, or isbn.",
      });
    }
    if (safeString(value.rationale).trim().length < 8) {
      ctx.addIssue({
        code: "custom",
        path: ["rationale"],
        message: "Recommendation rationale must be at least 8 characters.",
      });
    }
  });

const libraryRecommendationsFeedbackSubmitSchema = z
  .object({
    recommendationId: z.string().min(1).max(240).trim(),
    helpful: z.boolean().optional(),
    comment: z.string().max(500).optional().nullable(),
  })
  .superRefine((value, ctx) => {
    const hasHelpfulVote = typeof value.helpful === "boolean";
    const hasComment = safeString(value.comment).trim().length > 0;
    if (!hasHelpfulVote && !hasComment) {
      ctx.addIssue({
        code: "custom",
        path: [],
        message: "Provide helpful vote or comment feedback.",
      });
    }
  });

const libraryRecommendationsModerateSchema = z.object({
  recommendationId: z.string().min(1).max(240).trim(),
  action: z.enum(["approve", "hide", "restore", "reject"]),
  note: z.string().max(500).optional().nullable(),
});

const libraryRecommendationsFeedbackModerateSchema = z.object({
  feedbackId: z.string().min(1).max(260).trim(),
  action: z.enum(["approve", "hide", "restore", "reject"]),
  note: z.string().max(500).optional().nullable(),
});

const libraryRatingUpsertSchema = z.object({
  itemId: z.string().min(1).max(200).trim(),
  stars: z.number().int().min(1).max(5),
});

const libraryReviewCreateSchema = z
  .object({
    itemId: z.string().min(1).max(200).trim(),
    body: z.string().max(1000).optional().nullable(),
    practicality: z.number().int().min(1).max(5).optional(),
    difficulty: z.enum(["beginner", "intermediate", "advanced", "all-levels"]).optional(),
    bestFor: z.string().max(120).optional().nullable(),
    reflection: z.string().max(1000).optional().nullable(),
  })
  .superRefine((value, ctx) => {
    const hasBody = safeString(value.body).trim().length > 0;
    const hasStructured =
      typeof value.practicality === "number" ||
      typeof value.difficulty === "string" ||
      safeString(value.bestFor).trim().length > 0 ||
      safeString(value.reflection).trim().length > 0;
    if (!hasBody && !hasStructured) {
      ctx.addIssue({
        code: "custom",
        path: [],
        message: "Provide body or at least one structured review field.",
      });
    }
  });

const libraryReviewUpdateSchema = z
  .object({
    reviewId: z.string().min(1).max(240).trim(),
    body: z.string().max(1000).optional().nullable(),
    practicality: z.number().int().min(1).max(5).optional().nullable(),
    difficulty: z.enum(["beginner", "intermediate", "advanced", "all-levels"]).optional().nullable(),
    bestFor: z.string().max(120).optional().nullable(),
    reflection: z.string().max(1000).optional().nullable(),
  })
  .superRefine((value, ctx) => {
    const hasPatchField =
      Object.prototype.hasOwnProperty.call(value, "body") ||
      Object.prototype.hasOwnProperty.call(value, "practicality") ||
      Object.prototype.hasOwnProperty.call(value, "difficulty") ||
      Object.prototype.hasOwnProperty.call(value, "bestFor") ||
      Object.prototype.hasOwnProperty.call(value, "reflection");
    if (!hasPatchField) {
      ctx.addIssue({
        code: "custom",
        path: [],
        message: "Provide at least one review field to update.",
      });
    }
  });

const libraryReadingStatusUpsertSchema = z.object({
  itemId: z.string().min(1).max(200).trim(),
  status: z.enum(["have", "borrowed", "want_to_read", "recommended"]),
});

const libraryTagSubmissionCreateSchema = z.object({
  itemId: z.string().min(1).max(200).trim(),
  tag: z.string().min(1).max(80).trim(),
});

const libraryTagSubmissionApproveSchema = z.object({
  submissionId: z.string().min(1).max(240).trim(),
  canonicalTagId: z.string().min(1).max(240).trim().optional().nullable(),
  canonicalTagName: z.string().max(80).trim().optional().nullable(),
});

const libraryTagMergeSchema = z.object({
  sourceTagId: z.string().min(1).max(240).trim(),
  targetTagId: z.string().min(1).max(240).trim(),
  note: z.string().max(300).optional().nullable(),
});

const libraryLoanCheckoutSchema = z.object({
  itemId: z.string().min(1).max(200).trim(),
  suggestedDonationCents: z.number().int().min(0).max(500000).optional(),
  idempotencyKey: z.string().min(1).max(120).trim().optional(),
});

const libraryLoanCheckInSchema = z.object({
  loanId: z.string().min(1).max(240).trim(),
  idempotencyKey: z.string().min(1).max(120).trim().optional(),
});

const libraryLoansListMineSchema = z.object({
  limit: z.number().int().min(1).max(200).optional(),
});

const libraryLoanMarkLostSchema = z.object({
  loanId: z.string().min(1).max(240).trim(),
  note: z.string().max(400).optional().nullable(),
  idempotencyKey: z.string().min(1).max(120).trim().optional(),
});

const libraryLoanAssessReplacementFeeSchema = z.object({
  loanId: z.string().min(1).max(240).trim(),
  amountCents: z.number().int().min(0).max(5_000_000).optional().nullable(),
  note: z.string().max(400).optional().nullable(),
  confirm: z.boolean(),
  idempotencyKey: z.string().min(1).max(120).trim().optional(),
});

const libraryItemOverrideStatusSchema = z.object({
  itemId: z.string().min(1).max(200).trim(),
  status: z.enum(["available", "checked_out", "overdue", "lost", "unavailable", "archived"]),
  note: z.string().max(400).optional().nullable(),
});

const reservationCreateSchema = z.object({
  intakeMode: z.string().optional(),
  firingType: z
    .enum(["bisque", "glaze", "other"])
    .optional()
    .default("other"),
  shelfEquivalent: z
    .number()
    .positive()
    .min(0.25)
    .max(999)
    .default(1),
  footprintHalfShelves: z.number().optional(),
  heightInches: z.number().optional(),
  tiers: z.number().optional(),
  estimatedHalfShelves: z.number().optional(),
  estimatedCost: z.number().optional(),
  preferredWindow: z
    .object({
      earliestDate: z.any().optional().nullable(),
      latestDate: z.any().optional().nullable(),
    })
    .optional(),
  linkedBatchId: z.string().optional().nullable(),
  clientRequestId: z.string().optional().nullable(),
  ownerUid: z.string().optional().nullable(),
  wareType: z
    .enum(["stoneware", "earthenware", "porcelain", "mixed", "other"])
    .optional()
    .nullable(),
  kilnId: z.string().optional().nullable(),
  kilnLabel: z.string().optional().nullable(),
  quantityTier: z
    .enum(["few", "small", "medium", "large"])
    .optional()
    .nullable(),
  quantityLabel: z.string().optional().nullable(),
  photoUrl: z.string().optional().nullable(),
  photoPath: z.string().optional().nullable(),
  notes: z
    .object({
      general: z.string().optional().nullable(),
      clayBody: z.string().optional().nullable(),
      glazeNotes: z.string().optional().nullable(),
    })
    .optional()
    .nullable(),
  dropOffProfile: z
    .object({
      id: z.string().optional().nullable(),
      label: z.string().optional().nullable(),
      pieceCount: z.string().optional().nullable(),
      hasTall: z.boolean().optional().nullable(),
      stackable: z.boolean().optional().nullable(),
      bisqueOnly: z.boolean().optional().nullable(),
      specialHandling: z.boolean().optional().nullable(),
    })
    .optional()
    .nullable(),
  dropOffQuantity: z
    .object({
      id: z.string().optional().nullable(),
      label: z.string().optional().nullable(),
      pieceRange: z.string().optional().nullable(),
    })
    .optional()
    .nullable(),
  pieces: z
    .array(
      z.object({
        pieceId: z.string().max(120).optional().nullable(),
        pieceLabel: z.string().max(200).optional().nullable(),
        pieceCount: z.number().int().min(1).max(500).optional().nullable(),
        piecePhotoUrl: z.string().max(2000).optional().nullable(),
        pieceStatus: z
          .enum(["awaiting_placement", "loaded", "fired", "ready", "picked_up"])
          .optional()
          .nullable(),
      })
    )
    .max(250)
    .optional()
    .nullable(),
  addOns: z
    .object({
      rushRequested: z.boolean().optional().nullable(),
      wholeKilnRequested: z.boolean().optional().nullable(),
      communityShelfFillInAllowed: z.boolean().optional().nullable(),
      pickupDeliveryRequested: z.boolean().optional().nullable(),
      returnDeliveryRequested: z.boolean().optional().nullable(),
      useStudioGlazes: z.boolean().optional().nullable(),
      glazeAccessCost: z.number().optional().nullable(),
      waxResistAssistRequested: z.boolean().optional().nullable(),
      glazeSanityCheckRequested: z.boolean().optional().nullable(),
      deliveryAddress: z.string().optional().nullable(),
      deliveryInstructions: z.string().optional().nullable(),
    })
    .optional()
    .nullable(),
});

const reservationsGetSchema = z.object({
  reservationId: z.string().min(1),
});

const reservationsListSchema = z.object({
  ownerUid: z.string().min(1).optional().nullable(),
  limit: z.number().int().min(1).max(250).optional(),
  status: z.string().optional().nullable(),
  includeCancelled: z.boolean().optional(),
});

const notificationsMarkReadSchema = z.object({
  notificationId: z.string().min(1).max(240).trim(),
  ownerUid: z.string().min(1).optional().nullable(),
});

const reservationsLookupArrivalSchema = z.object({
  arrivalToken: z.string().min(4).max(120).trim(),
});

const reservationsRotateArrivalTokenSchema = z.object({
  reservationId: z.string().min(1).max(160).trim(),
  reason: z.string().max(240).optional().nullable(),
});

const reservationsCheckInSchema = z
  .object({
    reservationId: z.string().min(1).max(160).trim().optional(),
    arrivalToken: z.string().min(4).max(120).trim().optional(),
    note: z.string().max(500).optional().nullable(),
    photoUrl: z.string().max(2000).optional().nullable(),
    photoPath: z.string().max(500).optional().nullable(),
  })
  .superRefine((value, ctx) => {
    if (!value.reservationId && !value.arrivalToken) {
      ctx.addIssue({
        code: "custom",
        path: [],
        message: "Provide reservationId or arrivalToken.",
      });
    }
  });

const ALLOWED_RESERVATION_STATUSES = new Set<string>([
  "REQUESTED",
  "CONFIRMED",
  "WAITLISTED",
  "CANCELLED",
  "CONFIRMED_ARRIVED",
  "LOADED",
]);

const ALLOWED_RESERVATION_PIECE_STATUSES = new Set<string>([
  "awaiting_placement",
  "loaded",
  "fired",
  "ready",
  "picked_up",
]);

const ALLOWED_STATUS_TRANSITIONS: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ["REQUESTED", new Set(["REQUESTED", "CONFIRMED", "WAITLISTED", "CANCELLED"])],
  ["CONFIRMED", new Set(["CONFIRMED", "WAITLISTED", "CANCELLED", "LOADED"])],
  ["WAITLISTED", new Set(["WAITLISTED", "CONFIRMED", "CANCELLED"])],
  ["CANCELLED", new Set(["CANCELLED"])],
  ["LOADED", new Set(["LOADED", "CANCELLED"])],
  ["CONFIRMED_ARRIVED", new Set(["CONFIRMED_ARRIVED", "CANCELLED"])],
]);

const reservationUpdateSchema = z
  .object({
    reservationId: z.string().min(1).max(160).trim(),
    status: z
      .enum(["REQUESTED", "CONFIRMED", "WAITLISTED", "CANCELLED"])
      .optional(),
    loadStatus: z.enum(["queued", "loading", "loaded"]).optional(),
    staffNotes: z.string().max(1500).optional().nullable(),
    force: z.boolean().optional(),
  })
  .superRefine((value, ctx) => {
    if (!value.status && !value.loadStatus && value.staffNotes == null) {
      ctx.addIssue({
        code: "custom",
        path: [],
        message: "Provide status, loadStatus, or staffNotes.",
      });
    }
  });

const reservationsPickupWindowSchema = z
  .object({
    reservationId: z.string().min(1).max(160).trim(),
    action: z.enum([
      "staff_set_open_window",
      "member_confirm_window",
      "member_request_reschedule",
      "staff_mark_missed",
      "staff_mark_completed",
    ]),
    confirmedStart: z.union([z.string(), z.number(), z.date()]).optional().nullable(),
    confirmedEnd: z.union([z.string(), z.number(), z.date()]).optional().nullable(),
    requestedStart: z.union([z.string(), z.number(), z.date()]).optional().nullable(),
    requestedEnd: z.union([z.string(), z.number(), z.date()]).optional().nullable(),
    note: z.string().max(500).optional().nullable(),
    force: z.boolean().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.action === "staff_set_open_window") {
      if (!value.confirmedStart || !value.confirmedEnd) {
        ctx.addIssue({
          code: "custom",
          path: [],
          message: "Provide confirmedStart and confirmedEnd for staff_set_open_window.",
        });
      }
    }
    if (value.action === "member_request_reschedule") {
      if (!value.requestedStart || !value.requestedEnd) {
        ctx.addIssue({
          code: "custom",
          path: [],
          message: "Provide requestedStart and requestedEnd for member_request_reschedule.",
        });
      }
    }
  });

const reservationsQueueFairnessSchema = z
  .object({
    reservationId: z.string().min(1).max(160).trim(),
    action: z.enum([
      "record_no_show",
      "record_late_arrival",
      "set_override_boost",
      "clear_override",
    ]),
    reason: z.string().max(500).optional().nullable(),
    boostPoints: z.number().int().min(0).max(20).optional().nullable(),
    overrideUntil: z.union([z.string(), z.number(), z.date()]).optional().nullable(),
  })
  .superRefine((value, ctx) => {
    const reason = safeString(value.reason).trim();
    if (!reason) {
      ctx.addIssue({
        code: "custom",
        path: ["reason"],
        message: "Reason is required for fairness actions.",
      });
    }
    if (value.action === "set_override_boost") {
      if (typeof value.boostPoints !== "number") {
        ctx.addIssue({
          code: "custom",
          path: ["boostPoints"],
          message: "boostPoints is required for set_override_boost.",
        });
      }
    }
  });

const reservationsAssignStationSchema = z.object({
  reservationId: z.string().min(1).max(160).trim(),
  assignedStationId: z.string().min(1).max(120).trim(),
  queueClass: z.string().max(120).optional().nullable(),
  requiredResources: z
    .object({
      kilnProfile: z.string().max(120).optional().nullable(),
      rackCount: z.number().int().min(1).max(20).optional().nullable(),
      specialHandling: z.array(z.string().max(120)).max(20).optional(),
    })
    .partial()
    .optional()
    .nullable(),
});

const reservationsExportContinuitySchema = z.object({
  ownerUid: z.string().min(1).max(160).trim().optional().nullable(),
  includeCsv: z.boolean().optional(),
  limit: z.number().int().min(1).max(1000).optional(),
});

type ReservationStatus = "REQUESTED" | "CONFIRMED" | "WAITLISTED" | "CANCELLED" | string;
type ReservationLoadStatus = "queued" | "loading" | "loaded" | null;
type ReservationPieceStatus = "awaiting_placement" | "loaded" | "fired" | "ready" | "picked_up";
type ReservationStorageStatus = "active" | "reminder_pending" | "hold_pending" | "stored_by_policy";
type ReservationPickupWindowStatus = "open" | "confirmed" | "missed" | "expired" | "completed";

type ReservationPieceEntry = {
  pieceId: string;
  pieceLabel: string | null;
  pieceCount: number;
  piecePhotoUrl: string | null;
  pieceStatus: ReservationPieceStatus;
};

type ReservationStageHistoryEntry = {
  fromStatus: string | null;
  toStatus: string | null;
  fromLoadStatus: ReservationLoadStatus;
  toLoadStatus: ReservationLoadStatus;
  fromStage: string;
  toStage: string;
  at: unknown;
  actorUid: string;
  actorRole: "staff" | "dev" | "client";
  reason: string;
  notes: string | null;
};

type ReservationStorageNoticeEntry = {
  at: unknown;
  kind: string;
  detail: string | null;
  status: ReservationStorageStatus | null;
  reminderOrdinal: number | null;
  reminderCount: number | null;
  failureCode: string | null;
};

type ReservationPickupWindowEntry = {
  requestedStart: Date | null;
  requestedEnd: Date | null;
  confirmedStart: Date | null;
  confirmedEnd: Date | null;
  status: ReservationPickupWindowStatus | null;
  confirmedAt: Date | null;
  completedAt: Date | null;
  missedCount: number;
  rescheduleCount: number;
  lastMissedAt: Date | null;
  lastRescheduleRequestedAt: Date | null;
};

type ReservationQueueFairnessEntry = {
  noShowCount: number;
  lateArrivalCount: number;
  overrideBoost: number;
  overrideReason: string | null;
  overrideUntil: Date | null;
  updatedAt: Date | null;
  updatedByUid: string | null;
  updatedByRole: "staff" | "dev" | "system" | null;
  lastPolicyNote: string | null;
  lastEvidenceId: string | null;
};

type ReservationQueueFairnessPolicyEntry = {
  noShowCount: number;
  lateArrivalCount: number;
  penaltyPoints: number;
  effectivePenaltyPoints: number;
  overrideBoostApplied: number;
  reasonCodes: string[];
  policyVersion: string;
  computedAt: Timestamp;
};

const RESERVATION_QUEUE_FAIRNESS_POLICY_VERSION = "2026-02-24.v1";
const RESERVATION_QUEUE_FAIRNESS_NO_SHOW_PENALTY = 2;
const RESERVATION_QUEUE_FAIRNESS_LATE_PENALTY = 1;
const RESERVATION_CONTINUITY_EXPORT_SCHEMA_VERSION = "2026-02-24.v1";

const RESERVATION_STORAGE_STATUS_VALUES: ReadonlySet<ReservationStorageStatus> = new Set([
  "active",
  "reminder_pending",
  "hold_pending",
  "stored_by_policy",
]);

const RESERVATION_PICKUP_WINDOW_STATUS_VALUES: ReadonlySet<ReservationPickupWindowStatus> = new Set([
  "open",
  "confirmed",
  "missed",
  "expired",
  "completed",
]);

function normalizeReservationStatus(value: unknown): ReservationStatus | null {
  if (typeof value !== "string") return null;
  const up = value.trim().toUpperCase();
  if (up === "CANCELED") return "CANCELLED";
  return ALLOWED_RESERVATION_STATUSES.has(up) ? up : null;
}

function makeLoadStatusReason(before: ReservationLoadStatus, after: ReservationLoadStatus): string {
  if (before === after) return "load_status_refresh";
  if (after === "loaded") return "reservation_loaded";
  if (before === null && after === "loading") return "reservation_loading_start";
  return "reservation_load_status_change";
}

function normalizeLoadStatus(value: unknown): ReservationLoadStatus {
  if (value === "loading" || value === "loaded") return value;
  if (value === "queued" || value === null) return value;
  return null;
}

function normalizeQueueClass(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const next = value.trim().toLowerCase();
  return next.length ? next : null;
}

function normalizeReservationPieceStatus(value: unknown): ReservationPieceStatus {
  const normalized = safeString(value).trim().toLowerCase();
  if (ALLOWED_RESERVATION_PIECE_STATUSES.has(normalized)) {
    return normalized as ReservationPieceStatus;
  }
  return "awaiting_placement";
}

function normalizePieceCodeInput(value: unknown): string | null {
  const trimmed = safeString(value).trim().toUpperCase();
  if (!trimmed) return null;
  const cleaned = trimmed.replace(/[^A-Z0-9_-]/g, "");
  if (!cleaned) return null;
  return cleaned.slice(0, 120);
}

function reservationPieceCode(reservationId: string, sourceIndex: number, labelHint?: string | null): string {
  const normalizedReservationId = safeString(reservationId).trim();
  const baseId = normalizedReservationId
    .replace(/[^A-Za-z0-9]/g, "")
    .toUpperCase()
    .slice(0, 6)
    .padEnd(6, "X");
  const label = (labelHint ?? "").toLowerCase();
  const suffix = makeIdempotencyId("piece", normalizedReservationId || "reservation", `${sourceIndex}:${label}`)
    .replace("piece-", "")
    .slice(0, 6)
    .toUpperCase();
  const ordinal = String(sourceIndex + 1).padStart(2, "0");
  return `MF-RES-${baseId}-${ordinal}${suffix}`;
}

function normalizeReservationPiecesInput(value: unknown, reservationId: string): ReservationPieceEntry[] {
  if (!Array.isArray(value)) return [];
  const out: ReservationPieceEntry[] = [];
  const seen = new Set<string>();
  value.forEach((row, index) => {
    if (!row || typeof row !== "object") return;
    const source = row as Record<string, unknown>;
    const pieceLabel = trimOrNull(source.pieceLabel);
    const piecePhotoUrl = trimOrNull(source.piecePhotoUrl);
    const rawCount = normalizeNumber(source.pieceCount, 1);
    const pieceCount = typeof rawCount === "number" ? clampNumber(Math.round(rawCount), 1, 500) : 1;
    const explicitPieceId = normalizePieceCodeInput(source.pieceId);

    if (!explicitPieceId && !pieceLabel && !piecePhotoUrl) {
      return;
    }

    let pieceId = explicitPieceId ?? reservationPieceCode(reservationId, index, pieceLabel);
    let duplicateBump = 0;
    while (seen.has(pieceId)) {
      duplicateBump += 1;
      pieceId = reservationPieceCode(reservationId, index + duplicateBump, pieceLabel);
    }
    seen.add(pieceId);

    out.push({
      pieceId,
      pieceLabel: pieceLabel ?? null,
      pieceCount,
      piecePhotoUrl: piecePhotoUrl ?? null,
      pieceStatus: normalizeReservationPieceStatus(source.pieceStatus),
    });
  });
  return out.slice(0, 250);
}

function parseReservationIsoDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  if (typeof value === "object") {
    const maybe = value as { toDate?: () => Date };
    if (typeof maybe.toDate === "function") {
      try {
        return maybe.toDate();
      } catch {
        return null;
      }
    }
  }
  return null;
}

function normalizeNumber(value: unknown, fallback: number | null = null) {
  const raw = Number(value);
  if (!Number.isFinite(raw)) return fallback;
  return raw;
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalizeStationId(value: unknown): string | null {
  const next = normalizeKnownStationId(value);
  return next.length ? next : null;
}

function isValidStation(value: string | null): value is ReservationStationId {
  if (!value) return false;
  return isKnownStationId(value);
}

function stageForCurrentState(status: ReservationStatus | null, loadStatus: ReservationLoadStatus): string {
  if (status === "CANCELLED") return "canceled";
  if (loadStatus === "loaded") return "loaded";
  if (loadStatus === "loading") return "queued";
  return status === "CONFIRMED" || status === "WAITLISTED" || status === "REQUESTED"
    ? "intake"
    : "intake";
}

function normalizeReservationStageHistory(raw: unknown): ReservationStageHistoryEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: ReservationStageHistoryEntry[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const source = row as Record<string, unknown>;
    const toStage = safeString(source.toStage, "");
    const fromStage = safeString(source.fromStage, "");
    out.push({
      fromStatus: normalizeReservationStatus(source.fromStatus),
      toStatus: normalizeReservationStatus(source.toStatus),
      fromLoadStatus: normalizeLoadStatus(source.fromLoadStatus),
      toLoadStatus: normalizeLoadStatus(source.toLoadStatus),
      fromStage: fromStage.length ? fromStage : "queued",
      toStage: toStage.length ? toStage : "queued",
      at: source.at ?? nowTs(),
      actorUid: safeString(source.actorUid),
      actorRole: source.actorRole === "client" ? "client" : source.actorRole === "dev" ? "dev" : "staff",
      reason: safeString(source.reason, "").trim() || "reservation_update",
      notes: typeof source.notes === "string" ? source.notes.trim() : null,
    });
  }
  return out.slice(-120);
}

function normalizeReservationStorageStatus(value: unknown): ReservationStorageStatus | null {
  const normalized = safeString(value).trim().toLowerCase();
  if (RESERVATION_STORAGE_STATUS_VALUES.has(normalized as ReservationStorageStatus)) {
    return normalized as ReservationStorageStatus;
  }
  return null;
}

function normalizeReservationPickupWindowStatus(value: unknown): ReservationPickupWindowStatus | null {
  const normalized = safeString(value).trim().toLowerCase();
  if (RESERVATION_PICKUP_WINDOW_STATUS_VALUES.has(normalized as ReservationPickupWindowStatus)) {
    return normalized as ReservationPickupWindowStatus;
  }
  return null;
}

function normalizeReservationPickupWindow(value: unknown): ReservationPickupWindowEntry {
  const source = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const missedCountRaw = normalizeNumber(source.missedCount);
  const rescheduleCountRaw = normalizeNumber(source.rescheduleCount);
  return {
    requestedStart: parseReservationIsoDate(source.requestedStart),
    requestedEnd: parseReservationIsoDate(source.requestedEnd),
    confirmedStart: parseReservationIsoDate(source.confirmedStart),
    confirmedEnd: parseReservationIsoDate(source.confirmedEnd),
    status: normalizeReservationPickupWindowStatus(source.status),
    confirmedAt: parseReservationIsoDate(source.confirmedAt),
    completedAt: parseReservationIsoDate(source.completedAt),
    missedCount:
      typeof missedCountRaw === "number" && missedCountRaw >= 0
        ? Math.max(0, Math.round(missedCountRaw))
        : 0,
    rescheduleCount:
      typeof rescheduleCountRaw === "number" && rescheduleCountRaw >= 0
        ? Math.max(0, Math.round(rescheduleCountRaw))
        : 0,
    lastMissedAt: parseReservationIsoDate(source.lastMissedAt),
    lastRescheduleRequestedAt: parseReservationIsoDate(source.lastRescheduleRequestedAt),
  };
}

function toPickupWindowWrite(window: ReservationPickupWindowEntry): Record<string, unknown> {
  return {
    requestedStart: window.requestedStart ? Timestamp.fromDate(window.requestedStart) : null,
    requestedEnd: window.requestedEnd ? Timestamp.fromDate(window.requestedEnd) : null,
    confirmedStart: window.confirmedStart ? Timestamp.fromDate(window.confirmedStart) : null,
    confirmedEnd: window.confirmedEnd ? Timestamp.fromDate(window.confirmedEnd) : null,
    status: window.status ?? "open",
    confirmedAt: window.confirmedAt ? Timestamp.fromDate(window.confirmedAt) : null,
    completedAt: window.completedAt ? Timestamp.fromDate(window.completedAt) : null,
    missedCount: Math.max(0, Math.round(window.missedCount)),
    rescheduleCount: Math.max(0, Math.round(window.rescheduleCount)),
    lastMissedAt: window.lastMissedAt ? Timestamp.fromDate(window.lastMissedAt) : null,
    lastRescheduleRequestedAt: window.lastRescheduleRequestedAt
      ? Timestamp.fromDate(window.lastRescheduleRequestedAt)
      : null,
  };
}

function pushReservationStorageNotice(
  history: ReservationStorageNoticeEntry[],
  notice: Omit<ReservationStorageNoticeEntry, "at"> & { at?: unknown }
): ReservationStorageNoticeEntry[] {
  const next = [...history];
  next.push({
    at: notice.at ?? nowTs(),
    kind: notice.kind,
    detail: notice.detail ?? null,
    status: notice.status ?? null,
    reminderOrdinal: notice.reminderOrdinal ?? null,
    reminderCount: notice.reminderCount ?? null,
    failureCode: notice.failureCode ?? null,
  });
  return next.slice(-80);
}

function normalizeReservationStorageNoticeHistory(raw: unknown): ReservationStorageNoticeEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: ReservationStorageNoticeEntry[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const source = row as Record<string, unknown>;
    const kind = safeString(source.kind).trim();
    if (!kind) continue;
    const reminderOrdinalRaw = normalizeNumber(source.reminderOrdinal);
    const reminderCountRaw = normalizeNumber(source.reminderCount);
    out.push({
      at: source.at ?? nowTs(),
      kind,
      detail: safeString(source.detail).trim() || null,
      status: normalizeReservationStorageStatus(source.status),
      reminderOrdinal:
        typeof reminderOrdinalRaw === "number" && reminderOrdinalRaw > 0
          ? Math.max(1, Math.round(reminderOrdinalRaw))
          : null,
      reminderCount:
        typeof reminderCountRaw === "number" && reminderCountRaw >= 0
          ? Math.max(0, Math.round(reminderCountRaw))
          : null,
      failureCode: safeString(source.failureCode).trim() || null,
    });
  }
  return out.slice(-80);
}

function normalizeReservationWindow(value: unknown): { earliestDate: Date | null; latestDate: Date | null } {
  const raw = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    earliestDate: parseReservationIsoDate(raw.earliestDate),
    latestDate: parseReservationIsoDate(raw.latestDate),
  };
}

function normalizeReservationQueueFairness(value: unknown): ReservationQueueFairnessEntry {
  const raw = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const noShowCountRaw = normalizeNumber(raw.noShowCount);
  const lateArrivalCountRaw = normalizeNumber(raw.lateArrivalCount);
  const overrideBoostRaw = normalizeNumber(raw.overrideBoost);
  const updatedByRoleRaw = safeString(raw.updatedByRole).trim().toLowerCase();
  const updatedByRole: "staff" | "dev" | "system" | null =
    updatedByRoleRaw === "staff" || updatedByRoleRaw === "dev" || updatedByRoleRaw === "system"
      ? updatedByRoleRaw
      : null;
  return {
    noShowCount:
      typeof noShowCountRaw === "number" ? Math.max(0, Math.round(noShowCountRaw)) : 0,
    lateArrivalCount:
      typeof lateArrivalCountRaw === "number" ? Math.max(0, Math.round(lateArrivalCountRaw)) : 0,
    overrideBoost:
      typeof overrideBoostRaw === "number" ? Math.max(0, Math.round(overrideBoostRaw)) : 0,
    overrideReason: trimOrNull(raw.overrideReason),
    overrideUntil: parseReservationIsoDate(raw.overrideUntil),
    updatedAt: parseReservationIsoDate(raw.updatedAt),
    updatedByUid: trimOrNull(raw.updatedByUid),
    updatedByRole,
    lastPolicyNote: trimOrNull(raw.lastPolicyNote),
    lastEvidenceId: trimOrNull(raw.lastEvidenceId),
  };
}

function toReservationQueueFairnessWrite(
  entry: ReservationQueueFairnessEntry
): Record<string, unknown> {
  return {
    noShowCount: Math.max(0, Math.round(entry.noShowCount)),
    lateArrivalCount: Math.max(0, Math.round(entry.lateArrivalCount)),
    overrideBoost: Math.max(0, Math.round(entry.overrideBoost)),
    overrideReason: entry.overrideReason ?? null,
    overrideUntil: entry.overrideUntil ? Timestamp.fromDate(entry.overrideUntil) : null,
    updatedAt: entry.updatedAt ? Timestamp.fromDate(entry.updatedAt) : nowTs(),
    updatedByUid: entry.updatedByUid ?? null,
    updatedByRole: entry.updatedByRole ?? null,
    lastPolicyNote: entry.lastPolicyNote ?? null,
    lastEvidenceId: entry.lastEvidenceId ?? null,
  };
}

function activeQueueFairnessOverrideBoost(
  fairness: ReservationQueueFairnessEntry,
  nowMs: number
): number {
  if (fairness.overrideBoost <= 0) return 0;
  if (!fairness.overrideUntil) return fairness.overrideBoost;
  return fairness.overrideUntil.getTime() >= nowMs ? fairness.overrideBoost : 0;
}

function buildReservationQueueFairnessPolicy(
  row: Record<string, unknown>,
  nowMs: number
): ReservationQueueFairnessPolicyEntry {
  const fairness = normalizeReservationQueueFairness(row.queueFairness);
  const reasonCodes: string[] = [];
  const noShowCount = fairness.noShowCount;
  const lateArrivalCount = fairness.lateArrivalCount;
  if (noShowCount > 0) {
    reasonCodes.push(noShowCount >= 2 ? "repeat_no_show" : "no_show");
  }
  if (lateArrivalCount > 0) {
    reasonCodes.push("late_arrival");
  }
  const penaltyPoints =
    noShowCount * RESERVATION_QUEUE_FAIRNESS_NO_SHOW_PENALTY +
    lateArrivalCount * RESERVATION_QUEUE_FAIRNESS_LATE_PENALTY;
  const overrideBoostApplied = activeQueueFairnessOverrideBoost(fairness, nowMs);
  if (overrideBoostApplied > 0) {
    reasonCodes.push("staff_override_boost");
  }
  const effectivePenaltyPoints = Math.max(0, penaltyPoints - overrideBoostApplied);
  return {
    noShowCount,
    lateArrivalCount,
    penaltyPoints,
    effectivePenaltyPoints,
    overrideBoostApplied,
    reasonCodes,
    policyVersion: RESERVATION_QUEUE_FAIRNESS_POLICY_VERSION,
    computedAt: Timestamp.fromDate(new Date(nowMs)),
  };
}

function estimateHalfShelves(data: Record<string, unknown>): number {
  const estimatedHalfShelves = normalizeNumber(data.estimatedHalfShelves);
  if (typeof estimatedHalfShelves === "number") return Math.max(1, Math.ceil(estimatedHalfShelves));

  const shelfEquivalent = normalizeNumber(data.shelfEquivalent);
  if (typeof shelfEquivalent === "number") {
    return Math.max(1, Math.round(shelfEquivalent * 2));
  }

  const footprint = normalizeNumber(data.footprintHalfShelves);
  const tiers = normalizeNumber(data.tiers);
  if (typeof footprint === "number" && typeof tiers === "number") {
    return Math.max(1, Math.ceil(footprint * Math.max(1, Math.round(tiers))));
  }

  return 1;
}

function normalizeRequiredResources(value: unknown) {
  if (!value || typeof value !== "object") {
    return {
      kilnProfile: null,
      rackCount: null,
      specialHandling: [] as string[],
    };
  }

  const source = value as Record<string, unknown>;
  const rawSpecial = Array.isArray(source.specialHandling) ? source.specialHandling : [];
  const specialHandling = rawSpecial
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter((entry) => entry.length > 0)
    .slice(0, 20);

  const rawRack = Number(source.rackCount);
  const rackCount = Number.isFinite(rawRack) && rawRack >= 1 && rawRack <= 20 ? Math.round(rawRack) : null;
  const kilnProfile = safeString(source.kilnProfile, "").trim();

  return {
    kilnProfile: kilnProfile.length ? kilnProfile : null,
    rackCount,
    specialHandling,
  };
}

function isSameRequiredResources(
  a: ReturnType<typeof normalizeRequiredResources>,
  b: ReturnType<typeof normalizeRequiredResources>
) {
  if (a.kilnProfile !== b.kilnProfile) return false;
  if (a.rackCount !== b.rackCount) return false;
  if (a.specialHandling.length !== b.specialHandling.length) return false;
  for (let i = 0; i < a.specialHandling.length; i += 1) {
    if (a.specialHandling[i] !== b.specialHandling[i]) return false;
  }
  return true;
}

function isCapacityRelevantLoadStatus(value: unknown): boolean {
  const normalized = normalizeLoadStatus(value);
  if (normalized === null) return true;
  return normalized === "queued" || normalized === "loading" || normalized === "loaded";
}

function normalizeReservationIntakeMode(row: Record<string, unknown>): IntakeMode {
  const intakeMode = normalizeIntakeMode(row.intakeMode);
  if (intakeMode === "WHOLE_KILN" || intakeMode === "COMMUNITY_SHELF") {
    return intakeMode;
  }
  const addOns = row.addOns && typeof row.addOns === "object" ? (row.addOns as Record<string, unknown>) : {};
  if (addOns.wholeKilnRequested === true) return "WHOLE_KILN";
  return "SHELF_PURCHASE";
}

function isCommunityShelfReservationRow(row: Record<string, unknown>): boolean {
  return normalizeReservationIntakeMode(row) === "COMMUNITY_SHELF";
}

function reservationQueuePriority(row: Record<string, unknown>) {
  const intakeMode = normalizeReservationIntakeMode(row);
  const communityPriority = intakeMode === "COMMUNITY_SHELF" ? 1 : 0;
  const status = normalizeReservationStatus(row.status) ?? "REQUESTED";
  const statusPriority =
    status === "CONFIRMED" ? 0 : status === "REQUESTED" ? 1 : status === "WAITLISTED" ? 2 : 3;
  const addOns = row.addOns && typeof row.addOns === "object" ? (row.addOns as Record<string, unknown>) : {};
  const rushPriority = addOns.rushRequested === true ? 0 : 1;
  const wholeKilnPriority = intakeMode === "WHOLE_KILN" ? 0 : 1;
  const queueFairnessPolicy = buildReservationQueueFairnessPolicy(row, Date.now());
  const fairnessPenalty = queueFairnessPolicy.effectivePenaltyPoints;
  const sizePenalty = estimateHalfShelves(row);
  const createdAtMs = parseReservationIsoDate(row.createdAt)?.getTime() ?? 0;
  const idTie = safeString(row.id, "");
  return {
    communityPriority,
    statusPriority,
    rushPriority,
    wholeKilnPriority,
    fairnessPenalty,
    sizePenalty,
    createdAtMs,
    idTie,
  };
}

function queueWindowFromPosition(position: number): {
  start: Timestamp;
  end: Timestamp;
  confidence: "high" | "medium" | "low";
  slaState: "on_track" | "at_risk" | "delayed";
} {
  const slotIndex = Math.max(0, Math.floor((position - 1) / 2));
  const startMs = Date.now() + slotIndex * 2 * 24 * 60 * 60 * 1000;
  const endMs = startMs + 2 * 24 * 60 * 60 * 1000;
  const confidence = position <= 2 ? "high" : position <= 5 ? "medium" : "low";
  const slaState = confidence === "high" ? "on_track" : confidence === "medium" ? "at_risk" : "delayed";
  return {
    start: Timestamp.fromDate(new Date(startMs)),
    end: Timestamp.fromDate(new Date(endMs)),
    confidence,
    slaState,
  };
}

async function recomputeQueueHintsForStation(stationId: string | null): Promise<void> {
  if (!stationId) return;
  const snap = await db.collection("reservations").where("assignedStationId", "==", stationId).get();
  const rows = snap.docs.map((docSnap) => ({
    id: docSnap.id,
    data: docSnap.data() as Record<string, unknown>,
  }));
  if (rows.length === 0) return;

  const active = rows
    .filter((row) => (normalizeReservationStatus(row.data.status) ?? "REQUESTED") !== "CANCELLED")
    .sort((a, b) => {
      const left = reservationQueuePriority({ ...a.data, id: a.id });
      const right = reservationQueuePriority({ ...b.data, id: b.id });
      if (left.communityPriority !== right.communityPriority) {
        return left.communityPriority - right.communityPriority;
      }
      if (left.statusPriority !== right.statusPriority) return left.statusPriority - right.statusPriority;
      if (left.rushPriority !== right.rushPriority) return left.rushPriority - right.rushPriority;
      if (left.wholeKilnPriority !== right.wholeKilnPriority) return left.wholeKilnPriority - right.wholeKilnPriority;
      if (left.fairnessPenalty !== right.fairnessPenalty) return left.fairnessPenalty - right.fairnessPenalty;
      if (left.sizePenalty !== right.sizePenalty) return left.sizePenalty - right.sizePenalty;
      if (left.createdAtMs !== right.createdAtMs) return left.createdAtMs - right.createdAtMs;
      return left.idTie.localeCompare(right.idTie);
    });

  const now = nowTs();
  const activeIdToPosition = new Map<string, number>();
  active.forEach((row, index) => {
    activeIdToPosition.set(row.id, index + 1);
  });

  await Promise.all(
    rows.map(async (row) => {
      const position = activeIdToPosition.get(row.id) ?? null;
      const reservationRef = db.collection("reservations").doc(row.id);
      const fairnessPolicy = buildReservationQueueFairnessPolicy(row.data, Date.now());
      if (position === null) {
        await reservationRef.set(
          {
            queuePositionHint: null,
            queueFairnessPolicy: {
              ...fairnessPolicy,
              computedAt: now,
            },
            estimatedWindow: {
              currentStart: null,
              currentEnd: null,
              updatedAt: now,
              slaState: "unknown",
              confidence: null,
            },
          },
          { merge: true }
        );
        return;
      }

      const window = queueWindowFromPosition(position);
      await reservationRef.set(
        {
          queuePositionHint: position,
          queueFairnessPolicy: {
            ...fairnessPolicy,
            computedAt: now,
          },
          estimatedWindow: {
            currentStart: window.start,
            currentEnd: window.end,
            updatedAt: now,
            slaState: window.slaState,
            confidence: window.confidence,
          },
        },
        { merge: true }
      );
    })
  );
}

async function recomputeQueueHintsForStationSafe(stationId: string | null, context: string): Promise<void> {
  try {
    await recomputeQueueHintsForStation(stationId);
  } catch (error: unknown) {
    logger.warn("reservation_queue_hint_recompute_failed", {
      context,
      stationId: stationId ?? null,
      error: safeErrorMessage(error),
    });
  }
}

function toReservationRow(id: string, row: Record<string, unknown>) {
  const loadStatus = normalizeLoadStatus(row.loadStatus);
  const stageStatusRaw = row.stageStatus && typeof row.stageStatus === "object" ? row.stageStatus : null;
  const stageStatus = stageStatusRaw ? (stageStatusRaw as Record<string, unknown>) : null;
  const stageHistory = normalizeReservationStageHistory(row.stageHistory);
  const storageNoticeHistory = normalizeReservationStorageNoticeHistory(row.storageNoticeHistory);
  const preferredWindow = normalizeReservationWindow(row.preferredWindow);
  const estimatedWindow = row.estimatedWindow && typeof row.estimatedWindow === "object" ? (row.estimatedWindow as Record<string, unknown>) : {};
  const pickupWindow = row.pickupWindow && typeof row.pickupWindow === "object" ? (row.pickupWindow as Record<string, unknown>) : {};
  const requiredResources = row.requiredResources && typeof row.requiredResources === "object" ? row.requiredResources : null;
  const queueFairness = normalizeReservationQueueFairness(row.queueFairness);
  const queueFairnessPolicyRaw =
    row.queueFairnessPolicy && typeof row.queueFairnessPolicy === "object"
      ? (row.queueFairnessPolicy as Record<string, unknown>)
      : {};
  const pieces = normalizeReservationPiecesInput(row.pieces, id);

  return {
    id,
    ownerUid: safeString(row.ownerUid),
    status: safeString(row.status, "REQUESTED"),
    intakeMode: normalizeReservationIntakeMode(row),
    firingType: safeString(row.firingType, "other"),
    shelfEquivalent: normalizeNumber(row.shelfEquivalent, 1) as number,
    footprintHalfShelves: normalizeNumber(row.footprintHalfShelves),
    heightInches: normalizeNumber(row.heightInches),
    tiers: normalizeNumber(row.tiers),
    estimatedHalfShelves: normalizeNumber(row.estimatedHalfShelves),
    estimatedCost: normalizeNumber(row.estimatedCost),
    preferredWindow: {
      earliestDate: preferredWindow.earliestDate ?? null,
      latestDate: preferredWindow.latestDate ?? null,
    },
    linkedBatchId: safeString(row.linkedBatchId) || null,
    wareType: safeString(row.wareType) || null,
    kilnId: safeString(row.kilnId) || null,
    kilnLabel: safeString(row.kilnLabel) || null,
    quantityTier: safeString(row.quantityTier) || null,
    quantityLabel: safeString(row.quantityLabel) || null,
    dropOffQuantity: row.dropOffQuantity ? (row.dropOffQuantity as Record<string, unknown>) : null,
    dropOffProfile: row.dropOffProfile ? (row.dropOffProfile as Record<string, unknown>) : null,
    photoUrl: safeString(row.photoUrl) || null,
    photoPath: safeString(row.photoPath) || null,
    notes: row.notes ? (row.notes as Record<string, unknown>) : null,
    pieces,
    notesHistory: Array.isArray(row.notesHistory) ? row.notesHistory : null,
    addOns: row.addOns ? (row.addOns as Record<string, unknown>) : null,
    loadStatus,
    queuePositionHint: normalizeNumber(row.queuePositionHint),
    queueFairness: {
      noShowCount: queueFairness.noShowCount,
      lateArrivalCount: queueFairness.lateArrivalCount,
      overrideBoost: queueFairness.overrideBoost,
      overrideReason: queueFairness.overrideReason,
      overrideUntil: queueFairness.overrideUntil,
      updatedAt: queueFairness.updatedAt,
      updatedByUid: queueFairness.updatedByUid,
      updatedByRole: queueFairness.updatedByRole,
      lastPolicyNote: queueFairness.lastPolicyNote,
      lastEvidenceId: queueFairness.lastEvidenceId,
    },
    queueFairnessPolicy: {
      noShowCount: normalizeNumber(queueFairnessPolicyRaw.noShowCount),
      lateArrivalCount: normalizeNumber(queueFairnessPolicyRaw.lateArrivalCount),
      penaltyPoints: normalizeNumber(queueFairnessPolicyRaw.penaltyPoints),
      effectivePenaltyPoints: normalizeNumber(queueFairnessPolicyRaw.effectivePenaltyPoints),
      overrideBoostApplied: normalizeNumber(queueFairnessPolicyRaw.overrideBoostApplied),
      reasonCodes: Array.isArray(queueFairnessPolicyRaw.reasonCodes)
        ? queueFairnessPolicyRaw.reasonCodes
            .map((value) => safeString(value).trim())
            .filter((value) => value.length > 0)
        : [],
      policyVersion: safeString(queueFairnessPolicyRaw.policyVersion) || null,
      computedAt: parseReservationIsoDate(queueFairnessPolicyRaw.computedAt),
    },
    queueClass: safeString(row.queueClass) || null,
    queueLaneHint: safeString(row.queueLaneHint) || null,
    assignedStationId: safeString(row.assignedStationId) || null,
    requiredResources: requiredResources ? normalizeRequiredResources(requiredResources) : null,
    stageStatus: stageStatus ?
      {
        stage: safeString(stageStatus.stage, "intake"),
        at: stageStatus.at ?? null,
        source: safeString(stageStatus.source, "client"),
        reason: safeString(stageStatus.reason) || null,
        notes: safeString(stageStatus.notes) || null,
        actorUid: safeString(stageStatus.actorUid) || null,
        actorRole: safeString(stageStatus.actorRole, "client"),
      }
      : null,
    stageHistory,
    estimatedWindow: {
      currentStart: parseReservationIsoDate(estimatedWindow.currentStart),
      currentEnd: parseReservationIsoDate(estimatedWindow.currentEnd),
      updatedAt: parseReservationIsoDate(estimatedWindow.updatedAt),
      slaState: safeString(estimatedWindow.slaState) || null,
      confidence: safeString(estimatedWindow.confidence) || null,
    },
    pickupWindow: {
      requestedStart: parseReservationIsoDate(pickupWindow.requestedStart),
      requestedEnd: parseReservationIsoDate(pickupWindow.requestedEnd),
      confirmedStart: parseReservationIsoDate(pickupWindow.confirmedStart),
      confirmedEnd: parseReservationIsoDate(pickupWindow.confirmedEnd),
      status: normalizeReservationPickupWindowStatus(pickupWindow.status),
      confirmedAt: parseReservationIsoDate(pickupWindow.confirmedAt),
      completedAt: parseReservationIsoDate(pickupWindow.completedAt),
      missedCount: normalizeNumber(pickupWindow.missedCount),
      rescheduleCount: normalizeNumber(pickupWindow.rescheduleCount),
      lastMissedAt: parseReservationIsoDate(pickupWindow.lastMissedAt),
      lastRescheduleRequestedAt: parseReservationIsoDate(pickupWindow.lastRescheduleRequestedAt),
    },
    storageStatus: normalizeReservationStorageStatus(row.storageStatus),
    readyForPickupAt: parseReservationIsoDate(row.readyForPickupAt),
    pickupReminderCount: normalizeNumber(row.pickupReminderCount),
    lastReminderAt: parseReservationIsoDate(row.lastReminderAt),
    pickupReminderFailureCount: normalizeNumber(row.pickupReminderFailureCount),
    lastReminderFailureAt: parseReservationIsoDate(row.lastReminderFailureAt),
    storageNoticeHistory,
    arrivalStatus: safeString(row.arrivalStatus) || null,
    arrivedAt: parseReservationIsoDate(row.arrivedAt),
    arrivalToken: safeString(row.arrivalToken) || null,
    arrivalTokenIssuedAt: parseReservationIsoDate(row.arrivalTokenIssuedAt),
    arrivalTokenExpiresAt: parseReservationIsoDate(row.arrivalTokenExpiresAt),
    arrivalTokenVersion: normalizeNumber(row.arrivalTokenVersion),
    staffNotes: safeString(row.staffNotes) || null,
    createdByUid: safeString(row.createdByUid) || null,
    createdByRole: safeString(row.createdByRole) || null,
    createdAt: row.createdAt ?? null,
    updatedAt: row.updatedAt ?? null,
  };
}

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

const agentRevenueSummarySchema = z.object({
  uid: z.string().min(1).optional().nullable(),
  limit: z.number().int().min(1).max(500).optional(),
});

const agentRequestCreateSchema = z.object({
  kind: z.enum(["firing", "pickup", "delivery", "shipping", "commission", "x1c_print", "other"]),
  title: z.string().min(1).max(160),
  summary: z.string().max(500).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
  logisticsMode: z.enum(["dropoff", "pickup", "ship_in", "ship_out", "local_delivery"]).optional().nullable(),
  rightsAttested: z.boolean().optional(),
  intendedUse: z.string().max(500).optional().nullable(),
  x1cFileType: z.enum(["3mf", "stl", "step"]).optional().nullable(),
  x1cMaterialProfile: z.enum(["pla", "petg", "abs", "asa", "pa_cf", "tpu"]).optional().nullable(),
  x1cDimensionsMm: z
    .object({
      x: z.number().positive().max(256),
      y: z.number().positive().max(256),
      z: z.number().positive().max(256),
    })
    .optional()
    .nullable(),
  x1cQuantity: z.number().int().min(1).max(20).optional().nullable(),
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
  kind: z.enum(["all", "firing", "pickup", "delivery", "shipping", "commission", "x1c_print", "other"]).optional(),
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
const agentRequestCreateCommissionOrderSchema = z.object({
  requestId: z.string().min(1),
  priceId: z.string().min(1).max(120).optional().nullable(),
  quantity: z.number().int().min(1).max(100).optional(),
});
const agentTermsAcceptSchema = z.object({
  version: z.string().min(1).max(120).optional().nullable(),
  source: z.string().max(120).optional().nullable(),
});
const agentAccountGetSchema = z.object({
  agentClientId: z.string().min(1).max(120).optional().nullable(),
});
const agentAccountUpdateSchema = z.object({
  agentClientId: z.string().min(1).max(120),
  status: z.enum(["active", "on_hold"]).optional(),
  independentEnabled: z.boolean().optional(),
  prepayRequired: z.boolean().optional(),
  prepaidBalanceDeltaCents: z.number().int().min(-5_000_000).max(5_000_000).optional(),
  dailySpendCapCents: z.number().int().min(0).max(10_000_000).optional(),
  categoryCapsCents: z.record(z.string(), z.number().int().min(0).max(10_000_000)).optional(),
  reason: z.string().max(400).optional().nullable(),
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
const AGENT_TERMS_DEFAULT_VERSION = "2026-02-12.v1";
const AGENT_TERMS_EXEMPT_ROUTES = new Set<string>([
  "/v1/hello",
  "/v1/agent.terms.get",
  "/v1/agent.terms.accept",
]);
const LIBRARY_ROUTE_ROLLOUT_GET = "/v1/library.rollout.get";
const LIBRARY_ROUTE_ROLLOUT_SET = "/v1/library.rollout.set";
const ROUTE_SCOPE_HINTS: Record<string, string | null> = {
  "/v1/agent.catalog": "catalog:read",
  "/v1/agent.quote": "quote:write",
  "/v1/agent.reserve": "reserve:write",
  "/v1/agent.pay": "pay:write",
  "/v1/agent.status": "status:read",
  "/v1/agent.order.get": "status:read",
  "/v1/agent.orders.list": "status:read",
  "/v1/agent.revenue.summary": "status:read",
  "/v1/agent.requests.create": "requests:write",
  "/v1/agent.requests.listMine": "requests:read",
  "/v1/agent.requests.listStaff": "requests:read",
  "/v1/agent.requests.updateStatus": "requests:write",
  "/v1/agent.requests.linkBatch": "requests:write",
  "/v1/agent.requests.createCommissionOrder": "requests:write",
  "/v1/reservations.create": "reservations:write",
  "/v1/reservations.checkIn": "reservations:write",
  "/v1/reservations.rotateArrivalToken": "reservations:write",
  "/v1/reservations.pickupWindow": "reservations:write",
  "/v1/reservations.queueFairness": "reservations:write",
  "/v1/reservations.update": "reservations:write",
  "/v1/reservations.assignStation": "reservations:write",
  "/v1/reservations.lookupArrival": "reservations:read",
  "/v1/reservations.get": "reservations:read",
  "/v1/reservations.list": "reservations:read",
  "/v1/reservations.exportContinuity": "reservations:read",
  "/v1/library.items.list": null,
  "/v1/library.items.get": null,
  "/v1/library.discovery.get": null,
  "/v1/library.externalLookup": null,
  [LIBRARY_ROUTE_ROLLOUT_GET]: null,
  [LIBRARY_ROUTE_ROLLOUT_SET]: null,
  "/v1/library.externalLookup.providerConfig.get": null,
  "/v1/library.externalLookup.providerConfig.set": null,
  "/v1/library.items.resolveIsbn": null,
  "/v1/library.items.create": null,
  "/v1/library.items.update": null,
  "/v1/library.items.delete": null,
  "/v1/library.items.importIsbns": null,
  "/v1/library.recommendations.list": null,
  "/v1/library.recommendations.create": null,
  "/v1/library.recommendations.feedback.submit": null,
  "/v1/library.recommendations.moderate": null,
  "/v1/library.recommendations.feedback.moderate": null,
  "/v1/library.ratings.upsert": null,
  "/v1/library.reviews.create": null,
  "/v1/library.reviews.update": null,
  "/v1/library.tags.submissions.create": null,
  "/v1/library.tags.submissions.approve": null,
  "/v1/library.tags.merge": null,
  "/v1/library.readingStatus.upsert": null,
  "/v1/library.loans.checkout": null,
  "/v1/library.loans.checkIn": null,
  "/v1/library.loans.listMine": null,
  "/v1/library.loans.markLost": null,
  "/v1/library.loans.assessReplacementFee": null,
  "/v1/library.items.overrideStatus": null,
  "/v1/notifications.markRead": null,
};
const ALLOWED_API_V1_ROUTES = new Set<string>([
  "/v1/hello",
  "/v1/agent.account.get",
  "/v1/agent.account.update",
  "/v1/agent.catalog",
  "/v1/agent.order.get",
  "/v1/agent.orders.list",
  "/v1/agent.revenue.summary",
  "/v1/agent.pay",
  "/v1/agent.quote",
  "/v1/agent.requests.create",
  "/v1/agent.requests.createCommissionOrder",
  "/v1/agent.requests.linkBatch",
  "/v1/agent.requests.listMine",
  "/v1/agent.requests.listStaff",
  "/v1/agent.requests.updateStatus",
  "/v1/agent.reserve",
  "/v1/agent.status",
  "/v1/agent.terms.accept",
  "/v1/agent.terms.get",
  "/v1/batches.get",
  "/v1/batches.list",
  "/v1/batches.timeline.list",
  "/v1/reservations.assignStation",
  "/v1/reservations.checkIn",
  "/v1/reservations.create",
  "/v1/reservations.get",
  "/v1/reservations.list",
  "/v1/reservations.exportContinuity",
  "/v1/notifications.markRead",
  "/v1/reservations.lookupArrival",
  "/v1/reservations.rotateArrivalToken",
  "/v1/reservations.pickupWindow",
  "/v1/reservations.queueFairness",
  "/v1/reservations.update",
  "/v1/events.feed",
  "/v1/firings.listUpcoming",
  "/v1/library.items.list",
  "/v1/library.items.get",
  "/v1/library.discovery.get",
  "/v1/library.externalLookup",
  LIBRARY_ROUTE_ROLLOUT_GET,
  LIBRARY_ROUTE_ROLLOUT_SET,
  "/v1/library.externalLookup.providerConfig.get",
  "/v1/library.externalLookup.providerConfig.set",
  "/v1/library.items.resolveIsbn",
  "/v1/library.items.create",
  "/v1/library.items.update",
  "/v1/library.items.delete",
  "/v1/library.items.importIsbns",
  "/v1/library.recommendations.list",
  "/v1/library.recommendations.create",
  "/v1/library.recommendations.feedback.submit",
  "/v1/library.recommendations.moderate",
  "/v1/library.recommendations.feedback.moderate",
  "/v1/library.ratings.upsert",
  "/v1/library.reviews.create",
  "/v1/library.reviews.update",
  "/v1/library.tags.submissions.create",
  "/v1/library.tags.submissions.approve",
  "/v1/library.tags.merge",
  "/v1/library.readingStatus.upsert",
  "/v1/library.loans.checkout",
  "/v1/library.loans.checkIn",
  "/v1/library.loans.listMine",
  "/v1/library.loans.markLost",
  "/v1/library.loans.assessReplacementFee",
  "/v1/library.items.overrideStatus",
]);

const LIBRARY_V1_READ_ROUTES = new Set<string>([
  "/v1/library.items.list",
  "/v1/library.items.get",
  "/v1/library.discovery.get",
  "/v1/library.externalLookup",
  LIBRARY_ROUTE_ROLLOUT_GET,
  "/v1/library.recommendations.list",
]);
const LIBRARY_V1_MEMBER_WRITE_ROUTES = new Set<string>([
  "/v1/library.recommendations.create",
  "/v1/library.recommendations.feedback.submit",
  "/v1/library.ratings.upsert",
  "/v1/library.reviews.create",
  "/v1/library.reviews.update",
  "/v1/library.tags.submissions.create",
  "/v1/library.readingStatus.upsert",
  "/v1/library.loans.checkout",
  "/v1/library.loans.checkIn",
  "/v1/library.loans.listMine",
]);
const LIBRARY_V1_ADMIN_ROUTES = new Set<string>([
  LIBRARY_ROUTE_ROLLOUT_SET,
  "/v1/library.items.importIsbns",
  "/v1/library.items.resolveIsbn",
  "/v1/library.items.create",
  "/v1/library.items.update",
  "/v1/library.items.delete",
  "/v1/library.externalLookup.providerConfig.get",
  "/v1/library.externalLookup.providerConfig.set",
  "/v1/library.recommendations.moderate",
  "/v1/library.recommendations.feedback.moderate",
  "/v1/library.tags.submissions.approve",
  "/v1/library.tags.merge",
  "/v1/library.loans.markLost",
  "/v1/library.loans.assessReplacementFee",
  "/v1/library.items.overrideStatus",
]);
const LIBRARY_V1_ROLLOUT_CONTROL_ROUTES = new Set<string>([
  LIBRARY_ROUTE_ROLLOUT_SET,
]);
const LIBRARY_V1_PHASE_1_ALLOWED_ROUTES = new Set<string>([
  ...LIBRARY_V1_READ_ROUTES,
  ...LIBRARY_V1_ROLLOUT_CONTROL_ROUTES,
]);
const LIBRARY_V1_PHASE_2_ALLOWED_ROUTES = new Set<string>([
  ...LIBRARY_V1_PHASE_1_ALLOWED_ROUTES,
  ...LIBRARY_V1_MEMBER_WRITE_ROUTES,
]);
const LIBRARY_V1_PHASE_3_ALLOWED_ROUTES = new Set<string>([
  ...LIBRARY_V1_PHASE_2_ALLOWED_ROUTES,
  ...LIBRARY_V1_ADMIN_ROUTES,
]);
const LIBRARY_V1_ALLOWED_BY_ROLLOUT_PHASE: Record<LibraryRolloutPhase, ReadonlySet<string>> = {
  phase_1_read_only: LIBRARY_V1_PHASE_1_ALLOWED_ROUTES,
  phase_2_member_writes: LIBRARY_V1_PHASE_2_ALLOWED_ROUTES,
  phase_3_admin_full: LIBRARY_V1_PHASE_3_ALLOWED_ROUTES,
};

function requiredLibraryRolloutPhaseForRoute(route: string): LibraryRolloutPhase | null {
  if (LIBRARY_V1_MEMBER_WRITE_ROUTES.has(route)) return "phase_2_member_writes";
  if (LIBRARY_V1_ADMIN_ROUTES.has(route) && !LIBRARY_V1_ROLLOUT_CONTROL_ROUTES.has(route)) {
    return "phase_3_admin_full";
  }
  return null;
}

function libraryRolloutBlockedMessage(phase: LibraryRolloutPhase, route: string): string {
  if (phase === "phase_1_read_only" && LIBRARY_V1_MEMBER_WRITE_ROUTES.has(route)) {
    return "Library rollout phase phase_1_read_only allows read routes only.";
  }
  if (phase !== "phase_3_admin_full" && LIBRARY_V1_ADMIN_ROUTES.has(route)) {
    return `Library rollout phase ${phase} does not allow admin routes yet.`;
  }
  return `Library rollout phase ${phase} does not allow this route yet.`;
}

const API_V1_ROUTE_AUTHZ_EVENTS: Record<string, { action: string; resourceType: string }> = {
  "/v1/agent.order.get": {
    action: "agent_order_authz",
    resourceType: "agent_order",
  },
  "/v1/agent.orders.list": {
    action: "agent_orders_list_authz",
    resourceType: "agent_orders",
  },
  "/v1/agent.revenue.summary": {
    action: "agent_revenue_summary_authz",
    resourceType: "agent_revenue",
  },
  "/v1/agent.requests.updateStatus": {
    action: "agent_request_status_update_authz",
    resourceType: "agent_request",
  },
  "/v1/agent.status": {
    action: "agent_status_authz",
    resourceType: "agent_status",
  },
  "/v1/reservations.create": {
    action: "reservations_create",
    resourceType: "reservation",
  },
  "/v1/reservations.checkIn": {
    action: "reservations_checkin",
    resourceType: "reservation",
  },
  "/v1/reservations.get": {
    action: "reservations_get",
    resourceType: "reservation",
  },
  "/v1/reservations.list": {
    action: "reservations_list",
    resourceType: "reservation",
  },
  "/v1/reservations.exportContinuity": {
    action: "reservations_export_continuity",
    resourceType: "reservation",
  },
  "/v1/reservations.lookupArrival": {
    action: "reservations_lookup_arrival",
    resourceType: "reservation",
  },
  "/v1/reservations.rotateArrivalToken": {
    action: "reservations_rotate_arrival_token",
    resourceType: "reservation",
  },
  "/v1/reservations.pickupWindow": {
    action: "reservations_pickup_window",
    resourceType: "reservation",
  },
  "/v1/reservations.queueFairness": {
    action: "reservations_queue_fairness",
    resourceType: "reservation",
  },
  "/v1/reservations.update": {
    action: "reservations_update",
    resourceType: "reservation",
  },
  "/v1/reservations.assignStation": {
    action: "reservations_assign_station",
    resourceType: "reservation",
  },
};
const X1C_VALIDATION_VERSION = "2026-02-12.v1";
const AGENT_ACCOUNT_DEFAULT_DAILY_SPEND_CAP_CENTS = 200_000;
const AGENT_ACCOUNT_DEFAULTS = {
  status: "active" as const,
  independentEnabled: false,
  prepayRequired: true,
  prepaidBalanceCents: 0,
  dailySpendCapCents: AGENT_ACCOUNT_DEFAULT_DAILY_SPEND_CAP_CENTS,
  spendDayKey: "",
  spentTodayCents: 0,
  spentByCategoryCents: {} as Record<string, number>,
};

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

function readTimestampMs(value: unknown): number {
  const parsed = parseReservationIsoDate(value);
  return parsed ? parsed.getTime() : 0;
}

function readStringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function readObjectOrEmpty(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const entry of value) {
    if (typeof entry === "string") {
      out.push(entry);
    }
  }
  return out;
}

function toIsoString(value: unknown): string | null {
  const parsed = parseReservationIsoDate(value);
  return parsed ? parsed.toISOString() : null;
}

function csvCell(value: unknown): string {
  if (value == null) return "";
  const scalar =
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
      ? String(value)
      : JSON.stringify(value);
  const escaped = scalar.replace(/"/g, "\"\"");
  return `"${escaped}"`;
}

function buildCsv(columns: readonly string[], rows: Array<Record<string, unknown>>): string {
  const header = columns.map((column) => csvCell(column)).join(",");
  const lines = rows.map((row) =>
    columns.map((column) => csvCell(row[column] ?? null)).join(",")
  );
  return `${[header, ...lines].join("\n")}\n`;
}

const ARRIVAL_TOKEN_PREFIX = "MF-ARR";
const ARRIVAL_TOKEN_DEFAULT_WINDOW_MS = 36 * 60 * 60 * 1000;

function fnv1a32(input: string): number {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function normalizeArrivalTokenLookup(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function formatArrivalTokenFromLookup(lookup: string): string {
  const normalized = normalizeArrivalTokenLookup(lookup);
  if (!normalized.startsWith("MFARR")) return "";
  const body = normalized.slice("MFARR".length);
  if (!body.length) return "";
  if (body.length <= 4) return `${ARRIVAL_TOKEN_PREFIX}-${body}`;
  return `${ARRIVAL_TOKEN_PREFIX}-${body.slice(0, 4)}-${body.slice(4, 8)}`;
}

function makeDeterministicArrivalToken(reservationId: string, version: number): string {
  const compactId = reservationId
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(-4)
    .padStart(4, "0");
  const seed = `${reservationId}:${Math.max(1, Math.trunc(version))}`;
  const hashChunk = fnv1a32(seed).toString(36).toUpperCase().slice(0, 4).padStart(4, "0");
  return `${ARRIVAL_TOKEN_PREFIX}-${compactId}-${hashChunk}`;
}

function resolveArrivalTokenExpiryDate(row: Record<string, unknown>, nowDate: Date): Date {
  const preferredWindow =
    row.preferredWindow && typeof row.preferredWindow === "object"
      ? (row.preferredWindow as Record<string, unknown>)
      : {};
  const preferredLatest = parseReservationIsoDate(preferredWindow.latestDate);
  if (preferredLatest && preferredLatest.getTime() > nowDate.getTime()) {
    return preferredLatest;
  }
  return new Date(nowDate.getTime() + ARRIVAL_TOKEN_DEFAULT_WINDOW_MS);
}

async function findReservationByArrivalToken(tokenInput: string): Promise<{
  reservationId: string;
  row: Record<string, unknown>;
} | null> {
  const tokenLookup = normalizeArrivalTokenLookup(tokenInput);
  if (!tokenLookup.startsWith("MFARR") || tokenLookup.length < 8) return null;

  const byLookupSnap = await db
    .collection("reservations")
    .where("arrivalTokenLookup", "==", tokenLookup)
    .limit(2)
    .get();

  let docSnap = byLookupSnap.docs[0] ?? null;
  if (!docSnap) {
    const fallbackToken = formatArrivalTokenFromLookup(tokenLookup);
    if (!fallbackToken) return null;
    const byTokenSnap = await db
      .collection("reservations")
      .where("arrivalToken", "==", fallbackToken)
      .limit(2)
      .get();
    docSnap = byTokenSnap.docs[0] ?? null;
  }

  if (!docSnap) return null;
  const reservationId = docSnap.id;
  const row = docSnap.data() as Record<string, unknown>;
  return {
    reservationId,
    row,
  };
}

type TimelineEventRow = {
  id: string;
  type: string | null;
  at: unknown;
  actorUid: string | null;
  actorName: string | null;
  notes: string | null;
  kilnId: string | null;
  kilnName: string | null;
  photos: string[];
  pieceState: unknown;
};

type FiringRow = {
  id: string;
  kilnId: string | null;
  title: string | null;
  cycleType: string | null;
  startAt: unknown;
  endAt: unknown;
  status: string | null;
  confidence: string | null;
  notes: string | null;
  unloadedAt: unknown;
  unloadedByUid: string | null;
  unloadNote: string | null;
  batchIds: string[];
  pieceIds: string[];
  kilnName: string | null;
};

type AgentRequestRow = {
  id: string;
  createdByUid: string | null;
  createdByMode: string | null;
  createdByTokenId: string | null;
  title: string | null;
  summary: string | null;
  notes: string | null;
  kind: string | null;
  status: string | null;
  linkedBatchId: string | null;
  logisticsMode: string | null;
  createdAt: unknown;
  updatedAt: unknown;
  staffAssignedToUid: string | null;
  staffTriagedAt: unknown;
  staffInternalNotes: string | null;
  constraints: Record<string, unknown>;
  metadata: Record<string, unknown>;
  commissionOrderId: string | null;
  commissionPaymentStatus: string | null;
};

export function toTimelineEventRow(id: string, row: Record<string, unknown>): TimelineEventRow {
  return {
    id,
    type: readStringOrNull(row.type),
    at: (row.at ?? null),
    actorUid: readStringOrNull(row.actorUid),
    actorName: readStringOrNull(row.actorName),
    notes: readStringOrNull(row.notes),
    kilnId: readStringOrNull(row.kilnId),
    kilnName: readStringOrNull(row.kilnName),
    photos: readStringArray(row.photos),
    pieceState: row.pieceState ?? null,
  };
}

export function toFiringRow(id: string, row: Record<string, unknown>): FiringRow {
  return {
    id,
    kilnId: readStringOrNull(row.kilnId),
    title: readStringOrNull(row.title),
    cycleType: readStringOrNull(row.cycleType),
    startAt: row.startAt ?? null,
    endAt: row.endAt ?? null,
    status: readStringOrNull(row.status),
    confidence: readStringOrNull(row.confidence),
    notes: readStringOrNull(row.notes),
    unloadedAt: row.unloadedAt ?? null,
    unloadedByUid: readStringOrNull(row.unloadedByUid),
    unloadNote: readStringOrNull(row.unloadNote),
    batchIds: readStringArray(row.batchIds),
    pieceIds: readStringArray(row.pieceIds),
    kilnName: readStringOrNull(row.kilnName),
  };
}

export function toBatchDetailRow(id: string, row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = Object.create(null);
  out.id = id;
  if (!row || typeof row !== "object") {
    return out;
  }
  for (const [key, value] of Object.entries(row)) {
    if (key === "__proto__" || key === "constructor" || key === "prototype") {
      continue;
    }
    if (value !== undefined) {
      out[key] = value;
    }
  }
  return out;
}

export function toAgentRequestRow(id: string, row: Record<string, unknown>): AgentRequestRow {
  const logistics = readObjectOrEmpty(row.logistics);
  const staff = readObjectOrEmpty(row.staff);
  return {
    id,
    createdByUid: readStringOrNull(row.createdByUid),
    createdByMode: readStringOrNull(row.createdByMode),
    createdByTokenId: readStringOrNull(row.createdByTokenId),
    title: readStringOrNull(row.title),
    summary: readStringOrNull(row.summary),
    notes: readStringOrNull(row.notes),
    kind: readStringOrNull(row.kind),
    status: readStringOrNull(row.status),
    linkedBatchId: readStringOrNull(row.linkedBatchId),
    logisticsMode: readStringOrNull(logistics.mode),
    createdAt: row.createdAt ?? null,
    updatedAt: row.updatedAt ?? null,
    staffAssignedToUid: readStringOrNull(staff.assignedToUid),
    staffTriagedAt: staff.triagedAt ?? null,
    staffInternalNotes: readStringOrNull(staff.internalNotes),
    constraints: readObjectOrEmpty(row.constraints),
    metadata: readObjectOrEmpty(row.metadata),
    commissionOrderId: readStringOrNull(row.commissionOrderId),
    commissionPaymentStatus: readStringOrNull(row.commissionPaymentStatus),
  };
}

type LibraryListSort =
  | "highest_rated"
  | "most_borrowed"
  | "recently_added"
  | "recently_reviewed"
  | "staff_picks";

type LibraryReviewSignals = {
  averageByItem: Map<string, number>;
  countByItem: Map<string, number>;
  latestMsByItem: Map<string, number>;
  searchableTextByItem: Map<string, string>;
};

function readFiniteNumberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeToken(value: unknown): string {
  return safeString(value).trim().toLowerCase();
}

function readTimestampLikeMs(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const tsSeconds = readTimestampSeconds(value);
  if (tsSeconds > 0) return tsSeconds * 1000;
  const iso = toIsoString(value);
  if (!iso) return 0;
  const parsed = Date.parse(iso);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeLibraryStatus(row: Record<string, unknown>): string {
  const raw = normalizeToken(row.status || row.current_lending_status || row.currentLendingStatus);
  if (raw === "checked_out" || raw === "checkedout" || raw === "checked-out") return "checked_out";
  if (raw === "overdue") return "overdue";
  if (raw === "lost") return "lost";
  if (raw === "archived") return "archived";
  if (raw === "unavailable") return "unavailable";
  return "available";
}

function normalizeLibraryLoanStatus(value: unknown): string {
  const raw = normalizeToken(value);
  if (raw === "checked_out" || raw === "checkedout" || raw === "checked-out") return "checked_out";
  if (raw === "return_requested" || raw === "returnrequested" || raw === "return-requested") return "return_requested";
  if (raw === "overdue") return "overdue";
  if (raw === "lost") return "lost";
  if (raw === "returned") return "returned";
  return "unknown";
}

type LibraryRecommendationModerationStatus = "pending_review" | "approved" | "rejected" | "hidden";

function normalizeLibraryRecommendationModerationStatus(value: unknown): LibraryRecommendationModerationStatus {
  const raw = normalizeToken(value);
  if (raw === "approved" || raw === "published") return "approved";
  if (raw === "rejected" || raw === "denied") return "rejected";
  if (raw === "hidden" || raw === "removed") return "hidden";
  return "pending_review";
}

function recommendationModerationStatusFromAction(
  action: "approve" | "hide" | "restore" | "reject"
): LibraryRecommendationModerationStatus {
  if (action === "approve") return "approved";
  if (action === "hide") return "hidden";
  if (action === "reject") return "rejected";
  return "approved";
}

function normalizeLibraryRecommendationTags(value: unknown): string[] {
  const tags = readStringArray(value)
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0);
  return Array.from(new Set(tags)).slice(0, 20);
}

function normalizeLibraryTagLabel(value: unknown): string | null {
  const cleaned = safeString(value)
    .trim()
    .toLowerCase()
    .replace(/[_]+/g, " ")
    .replace(/[^a-z0-9+\-/&.\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return cleaned.length > 0 ? cleaned : null;
}

function normalizeLibraryTagToken(value: unknown): string | null {
  const label = normalizeLibraryTagLabel(value);
  if (!label) return null;
  const token = label
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return token.length > 0 ? token : null;
}

function readRecommendationRationale(value: unknown): string | null {
  const direct = trimOrNull(value);
  if (direct) return direct;
  return null;
}

function toLibraryRecommendationRow(id: string, row: Record<string, unknown>): Record<string, unknown> {
  return {
    id,
    itemId: trimOrNull(row.itemId),
    title: trimOrNull(row.title),
    author: trimOrNull(row.author),
    isbn: trimOrNull(row.isbn),
    rationale: readRecommendationRationale(row.rationale),
    tags: normalizeLibraryRecommendationTags(row.tags),
    helpfulCount: Math.max(0, Math.trunc(readFiniteNumberOrNull(row.helpfulCount) ?? 0)),
    feedbackCount: Math.max(0, Math.trunc(readFiniteNumberOrNull(row.feedbackCount) ?? 0)),
    moderationStatus: normalizeLibraryRecommendationModerationStatus(row.moderationStatus),
    recommenderUid: trimOrNull(row.recommenderUid),
    createdAt: row.createdAt ?? null,
    updatedAt: row.updatedAt ?? null,
  };
}

function toLibraryRecommendationFeedbackRow(id: string, row: Record<string, unknown>): Record<string, unknown> {
  return {
    id,
    recommendationId: trimOrNull(row.recommendationId),
    helpful: row.helpful === true,
    comment: trimOrNull(row.comment),
    moderationStatus: normalizeLibraryRecommendationModerationStatus(row.moderationStatus),
    reviewerUid: trimOrNull(row.reviewerUid),
    createdAt: row.createdAt ?? null,
    updatedAt: row.updatedAt ?? null,
  };
}

function isLibraryRowSoftDeleted(row: Record<string, unknown>): boolean {
  return row.deletedAt != null || row.deleted_at != null || row.deletedAtIso != null;
}

function normalizeLibraryItemStringArray(value: unknown, maxItems: number): string[] {
  const out = readStringArray(value)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  return Array.from(new Set(out)).slice(0, maxItems);
}

function computeLibraryItemCopyCounts(input: {
  totalCopies?: number;
  availableCopies?: number;
}): { totalCopies: number; availableCopies: number } {
  const totalCopies = Math.max(1, Math.trunc(input.totalCopies ?? 1));
  const rawAvailable = input.availableCopies ?? totalCopies;
  const availableCopies = Math.max(0, Math.min(totalCopies, Math.trunc(rawAvailable)));
  return {
    totalCopies,
    availableCopies,
  };
}

function libraryStatusFromCopies(inputStatus: string | undefined, availableCopies: number): string {
  if (inputStatus) return inputStatus;
  return availableCopies > 0 ? "available" : "checked_out";
}

function toLibraryLifecycleSummary(id: string, row: Record<string, unknown>): Record<string, unknown> {
  return {
    id,
    title: trimOrNull(row.title),
    status: normalizeLibraryStatus(row),
    isbn: trimOrNull(row.isbn),
    isbn10: trimOrNull(row.isbn10),
    isbn13: trimOrNull(row.isbn13),
    source: trimOrNull(row.source),
    deleted: isLibraryRowSoftDeleted(row),
  };
}

function readLibraryCreatedMs(row: Record<string, unknown>): number {
  return Math.max(
    readTimestampLikeMs(row.dateAdded),
    readTimestampLikeMs(row.date_added),
    readTimestampLikeMs(row.createdAt),
    readTimestampLikeMs(row.created_at),
    readTimestampLikeMs(row.updatedAt),
    readTimestampLikeMs(row.updated_at),
  );
}

function readLibraryUpdatedMs(row: Record<string, unknown>): number {
  return Math.max(
    readTimestampLikeMs(row.updatedAt),
    readTimestampLikeMs(row.updated_at),
    readTimestampLikeMs(row.createdAt),
    readTimestampLikeMs(row.created_at),
  );
}

function readLibraryLastReviewedMs(
  row: Record<string, unknown>,
  itemId: string,
  reviewSignals: LibraryReviewSignals,
): number {
  const fromSignals = reviewSignals.latestMsByItem.get(itemId) ?? 0;
  const reviewSummary = readObjectOrEmpty(row.reviewSummary);
  const fromSummary = Math.max(
    readTimestampLikeMs(reviewSummary.lastReviewedAt),
    readTimestampLikeMs(reviewSummary.last_reviewed_at),
    readTimestampLikeMs(reviewSummary.updatedAt),
    readTimestampLikeMs(reviewSummary.updated_at),
  );
  return Math.max(fromSignals, fromSummary);
}

function readLibraryRating(
  row: Record<string, unknown>,
  itemId: string,
  reviewSignals: LibraryReviewSignals,
): number | null {
  const reviewSummary = readObjectOrEmpty(row.reviewSummary);
  const explicit =
    readFiniteNumberOrNull(reviewSummary.averagePracticality) ??
    readFiniteNumberOrNull(reviewSummary.avgRating) ??
    readFiniteNumberOrNull(row.aggregateRating) ??
    readFiniteNumberOrNull(row.averageRating) ??
    readFiniteNumberOrNull(row.avgRating);
  if (explicit !== null) return Math.max(0, Math.min(5, explicit));
  const fromSignals = reviewSignals.averageByItem.get(itemId);
  if (typeof fromSignals === "number" && Number.isFinite(fromSignals)) {
    return Math.max(0, Math.min(5, fromSignals));
  }
  return null;
}

function readLibraryRatingCount(
  row: Record<string, unknown>,
  itemId: string,
  reviewSignals: LibraryReviewSignals,
): number {
  const reviewSummary = readObjectOrEmpty(row.reviewSummary);
  const explicit = Math.max(
    0,
    Math.trunc(
      readFiniteNumberOrNull(row.aggregateRatingCount) ??
      readFiniteNumberOrNull(row.ratingCount) ??
      readFiniteNumberOrNull(reviewSummary.ratingCount) ??
      readFiniteNumberOrNull(reviewSummary.reviewCount) ??
      0
    )
  );
  if (explicit > 0) return explicit;
  return Math.max(0, reviewSignals.countByItem.get(itemId) ?? 0);
}

function readLibraryBorrowCount(row: Record<string, unknown>, itemId: string, borrowCounts: Map<string, number>): number {
  const fromSignals = borrowCounts.get(itemId);
  if (typeof fromSignals === "number") return Math.max(0, Math.trunc(fromSignals));
  return Math.max(
    0,
    Math.trunc(
      readFiniteNumberOrNull(row.borrowCount) ??
      readFiniteNumberOrNull(row.borrow_count) ??
      readFiniteNumberOrNull(row.totalBorrows) ??
      0
    )
  );
}

function readLibraryReplacementValueCents(row: Record<string, unknown>): number {
  const directCents =
    readFiniteNumberOrNull(row.replacementValueCents) ??
    readFiniteNumberOrNull(row.replacement_value_cents);
  if (directCents !== null) {
    return Math.max(0, Math.trunc(directCents));
  }

  const directValue =
    readFiniteNumberOrNull(row.replacementValue) ??
    readFiniteNumberOrNull(row.replacement_value);
  if (directValue === null) return 0;

  if (directValue > 0 && directValue <= 999 && !Number.isInteger(directValue)) {
    return Math.max(0, Math.round(directValue * 100));
  }
  return Math.max(0, Math.trunc(directValue));
}

function readLibraryMediaType(row: Record<string, unknown>): string {
  return normalizeToken(row.mediaType || row.media_type || row.type || "book");
}

function isLibraryItemLendingEligible(row: Record<string, unknown>): boolean {
  if (typeof row.lendingEligible === "boolean") return row.lendingEligible;
  if (typeof row.lending_eligible === "boolean") return row.lending_eligible;
  const mediaType = readLibraryMediaType(row);
  return (
    mediaType === "book" ||
    mediaType === "physical_book" ||
    mediaType === "physical-book" ||
    mediaType === "print"
  );
}

function readLibraryGenre(row: Record<string, unknown>): string {
  return normalizeToken(row.primaryGenre || row.genre || row.primary_genre);
}

function readLibraryStudioCategory(row: Record<string, unknown>): string {
  return normalizeToken(
    row.studioCategory ||
    row.studioRelevanceCategory ||
    row.studio_relevance_category ||
    row.studio_relevance
  );
}

function readLibraryStaffPick(row: Record<string, unknown>): boolean {
  const curation = readObjectOrEmpty(row.curation);
  return row.staffPick === true || curation.staffPick === true;
}

function readLibraryShelfRank(row: Record<string, unknown>): number {
  const curation = readObjectOrEmpty(row.curation);
  const rank = readFiniteNumberOrNull(curation.shelfRank);
  return rank === null ? Number.POSITIVE_INFINITY : rank;
}

function collectLibrarySearchText(id: string, row: Record<string, unknown>, reviewSignals: LibraryReviewSignals): string {
  const identifiers = readObjectOrEmpty(row.identifiers);
  const authors = readStringArray(row.authors);
  const subjects = readStringArray(row.subjects);
  const techniques = readStringArray(row.techniques);
  const tags = readStringArray((row.tags ?? row.secondaryTags) as unknown);
  const reviewText = reviewSignals.searchableTextByItem.get(id) ?? "";

  return [
    safeString(row.title),
    safeString(row.subtitle),
    safeString(row.author),
    authors.join(" "),
    safeString(row.description),
    safeString(row.publisher),
    safeString(row.primaryGenre),
    subjects.join(" "),
    techniques.join(" "),
    tags.join(" "),
    safeString(row.isbn),
    safeString(row.isbn10),
    safeString(row.isbn13),
    safeString(row.isbn_normalized),
    safeString(identifiers.isbn10),
    safeString(identifiers.isbn13),
    reviewText,
  ]
    .filter((entry) => typeof entry === "string" && entry.trim().length > 0)
    .join(" ")
    .toLowerCase();
}

function toLibraryApiItemRow(
  id: string,
  row: Record<string, unknown>,
  reviewSignals: LibraryReviewSignals,
  borrowCounts: Map<string, number>,
): Record<string, unknown> {
  const out = toBatchDetailRow(id, row);
  const status = normalizeLibraryStatus(row);
  const rating = readLibraryRating(row, id, reviewSignals);
  const ratingCount = readLibraryRatingCount(row, id, reviewSignals);
  const borrowCount = readLibraryBorrowCount(row, id, borrowCounts);
  const lastReviewedMs = readLibraryLastReviewedMs(row, id, reviewSignals);

  out.status = status;
  if (rating !== null) out.aggregateRating = Math.round(rating * 100) / 100;
  if (ratingCount > 0) out.aggregateRatingCount = ratingCount;
  if (borrowCount > 0) out.borrowCount = borrowCount;
  if (lastReviewedMs > 0) out.lastReviewedAtIso = new Date(lastReviewedMs).toISOString();
  return out;
}

function emptyLibraryReviewSignals(): LibraryReviewSignals {
  return {
    averageByItem: new Map<string, number>(),
    countByItem: new Map<string, number>(),
    latestMsByItem: new Map<string, number>(),
    searchableTextByItem: new Map<string, string>(),
  };
}

async function loadLibraryReviewSignals(limit: number): Promise<LibraryReviewSignals> {
  const signals = emptyLibraryReviewSignals();
  const totalPracticality = new Map<string, number>();
  const counts = new Map<string, number>();
  const latest = new Map<string, number>();
  const search = new Map<string, string[]>();

  const snap = await db.collection("libraryReviews").limit(limit).get();
  for (const docSnap of snap.docs) {
    const row = docSnap.data() as Record<string, unknown>;
    const itemId = safeString(row.itemId).trim();
    if (!itemId) continue;

    const practicality = readFiniteNumberOrNull(row.practicality);
    if (practicality !== null) {
      totalPracticality.set(itemId, (totalPracticality.get(itemId) ?? 0) + practicality);
      counts.set(itemId, (counts.get(itemId) ?? 0) + 1);
    }

    const createdMs = readTimestampLikeMs(row.createdAt);
    if (createdMs > 0) {
      latest.set(itemId, Math.max(latest.get(itemId) ?? 0, createdMs));
    }

    const text = safeString(row.body).trim();
    if (text) {
      const existing = search.get(itemId) ?? [];
      if (existing.length < 10) {
        existing.push(text.toLowerCase());
        search.set(itemId, existing);
      }
    }
  }

  for (const [itemId, count] of counts.entries()) {
    if (count < 1) continue;
    const avg = (totalPracticality.get(itemId) ?? 0) / count;
    signals.averageByItem.set(itemId, avg);
    signals.countByItem.set(itemId, count);
  }
  for (const [itemId, timestamp] of latest.entries()) {
    signals.latestMsByItem.set(itemId, timestamp);
  }
  for (const [itemId, snippets] of search.entries()) {
    signals.searchableTextByItem.set(itemId, snippets.join(" "));
  }
  return signals;
}

async function loadLibraryBorrowCounts(limit: number): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  const snap = await db.collection("libraryLoans").limit(limit).get();
  for (const docSnap of snap.docs) {
    const row = docSnap.data() as Record<string, unknown>;
    const itemId = safeString(row.itemId).trim();
    if (!itemId) continue;
    counts.set(itemId, (counts.get(itemId) ?? 0) + 1);
  }
  return counts;
}

function normalizeLibraryDifficultyToken(value: unknown): "beginner" | "intermediate" | "advanced" | "all-levels" | null {
  const token = normalizeToken(value);
  if (token === "beginner" || token === "intermediate" || token === "advanced" || token === "all-levels") {
    return token;
  }
  return null;
}

function pickMostFrequentToken(
  counts: Map<string, number>,
  labelsByToken: Map<string, string>,
): string | null {
  let selectedToken: string | null = null;
  let selectedCount = 0;
  for (const [token, count] of counts.entries()) {
    if (count > selectedCount) {
      selectedToken = token;
      selectedCount = count;
      continue;
    }
    if (count === selectedCount && selectedToken !== null) {
      const selectedLabel = labelsByToken.get(selectedToken) ?? selectedToken;
      const contenderLabel = labelsByToken.get(token) ?? token;
      if (contenderLabel.localeCompare(selectedLabel) < 0) {
        selectedToken = token;
      }
    }
  }
  if (!selectedToken) return null;
  return labelsByToken.get(selectedToken) ?? selectedToken;
}

async function refreshLibraryItemCommunitySignals(itemIdRaw: string): Promise<void> {
  const itemId = safeString(itemIdRaw).trim();
  if (!itemId) return;

  const [ratingSnap, reviewSnap] = await Promise.all([
    db.collection("libraryRatings").where("itemId", "==", itemId).limit(1500).get(),
    db.collection("libraryReviews").where("itemId", "==", itemId).limit(1500).get(),
  ]);

  let ratingCount = 0;
  let ratingTotal = 0;
  for (const docSnap of ratingSnap.docs) {
    const row = (docSnap.data() ?? {}) as Record<string, unknown>;
    const rowItemId = safeString(row.itemId).trim();
    if (rowItemId !== itemId) continue;
    const stars = readFiniteNumberOrNull(row.stars);
    if (stars === null) continue;
    const normalizedStars = Math.max(1, Math.min(5, stars));
    ratingTotal += normalizedStars;
    ratingCount += 1;
  }

  let reviewCount = 0;
  let practicalityCount = 0;
  let practicalityTotal = 0;
  let reflectionsCount = 0;
  let latestReviewMs = 0;
  let latestReflectionMs = 0;
  let latestReflection: string | null = null;
  const difficultyCounts = new Map<string, number>();
  const difficultyLabels = new Map<string, string>();
  const bestForCounts = new Map<string, number>();
  const bestForLabels = new Map<string, string>();

  for (const docSnap of reviewSnap.docs) {
    const row = (docSnap.data() ?? {}) as Record<string, unknown>;
    const rowItemId = safeString(row.itemId).trim();
    if (rowItemId !== itemId) continue;
    reviewCount += 1;

    const practicality = readFiniteNumberOrNull(row.practicality);
    if (practicality !== null) {
      practicalityTotal += Math.max(1, Math.min(5, practicality));
      practicalityCount += 1;
    }

    const difficulty = normalizeLibraryDifficultyToken(row.difficulty);
    if (difficulty) {
      difficultyCounts.set(difficulty, (difficultyCounts.get(difficulty) ?? 0) + 1);
      difficultyLabels.set(difficulty, difficulty);
    }

    const bestForRaw = trimOrNull(row.bestFor);
    if (bestForRaw) {
      const bestForToken = normalizeToken(bestForRaw);
      if (bestForToken) {
        bestForCounts.set(bestForToken, (bestForCounts.get(bestForToken) ?? 0) + 1);
        if (!bestForLabels.has(bestForToken)) {
          bestForLabels.set(bestForToken, bestForRaw);
        }
      }
    }

    const rowUpdatedMs = Math.max(readTimestampLikeMs(row.updatedAt), readTimestampLikeMs(row.createdAt));
    if (rowUpdatedMs > 0) {
      latestReviewMs = Math.max(latestReviewMs, rowUpdatedMs);
    }

    const reflection = trimOrNull(row.reflection) ?? trimOrNull(row.body);
    if (reflection) {
      reflectionsCount += 1;
      const reflectionMs = rowUpdatedMs > 0 ? rowUpdatedMs : readTimestampLikeMs(row.createdAt);
      if (!latestReflection || reflectionMs >= latestReflectionMs) {
        latestReflectionMs = reflectionMs;
        latestReflection = reflection;
      }
    }
  }

  const averagePracticality =
    practicalityCount > 0 ? Math.round((practicalityTotal / practicalityCount) * 100) / 100 : null;
  const aggregateRatingRaw =
    ratingCount > 0
      ? ratingTotal / ratingCount
      : practicalityCount > 0
        ? practicalityTotal / practicalityCount
        : null;
  const aggregateRating = aggregateRatingRaw === null ? null : Math.round(aggregateRatingRaw * 100) / 100;
  const aggregateRatingCount = ratingCount > 0 ? ratingCount : practicalityCount;
  const topDifficulty = pickMostFrequentToken(difficultyCounts, difficultyLabels);
  const topBestFor = pickMostFrequentToken(bestForCounts, bestForLabels);
  const now = nowTs();

  const reviewSummary: Record<string, unknown> = {
    reviewCount,
    averagePracticality,
    topDifficulty,
    topBestFor,
    reflectionsCount,
    latestReflection,
    updatedAt: now,
    lastReviewedAt: latestReviewMs > 0 ? Timestamp.fromMillis(latestReviewMs) : null,
  };

  await db.collection("libraryItems").doc(itemId).set(
    {
      aggregateRating,
      aggregateRatingCount,
      reviewSummary,
      communitySignalsUpdatedAt: now,
      lastReviewedAt: latestReviewMs > 0 ? Timestamp.fromMillis(latestReviewMs) : null,
      updatedAt: now,
    },
    { merge: true }
  );
}

async function refreshLibraryItemCommunitySignalsSafely(itemId: string, requestId: string): Promise<void> {
  try {
    await refreshLibraryItemCommunitySignals(itemId);
  } catch (error: unknown) {
    logger.warn("library community signal refresh failed", {
      requestId,
      itemId,
      message: safeErrorMessage(error),
    });
  }
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

function evaluateX1cPolicy(payload: {
  fileType: string | null;
  materialProfile: string | null;
  dimensionsMm: { x: number; y: number; z: number } | null;
  quantity: number | null;
  title: string;
  summary: string | null;
  notes: string | null;
}): { ok: true; normalized: { fileType: string; materialProfile: string; dimensionsMm: { x: number; y: number; z: number }; quantity: number } } | { ok: false; reasonCodes: string[] } {
  const reasonCodes: string[] = [];
  if (!payload.fileType) reasonCodes.push("x1c_missing_file_type");
  if (!payload.materialProfile) reasonCodes.push("x1c_missing_material_profile");
  if (!payload.dimensionsMm) reasonCodes.push("x1c_missing_dimensions");
  if (!payload.quantity) reasonCodes.push("x1c_missing_quantity");

  const text = `${payload.title} ${payload.summary ?? ""} ${payload.notes ?? ""}`;
  if (/\b(weapon|ghost gun|silencer|explosive)\b/i.test(text)) {
    reasonCodes.push("x1c_prohibited_use");
  }

  if (reasonCodes.length > 0 || !payload.fileType || !payload.materialProfile || !payload.dimensionsMm || !payload.quantity) {
    return { ok: false, reasonCodes };
  }
  return {
    ok: true,
    normalized: {
      fileType: payload.fileType,
      materialProfile: payload.materialProfile,
      dimensionsMm: {
        x: Math.round(payload.dimensionsMm.x * 100) / 100,
        y: Math.round(payload.dimensionsMm.y * 100) / 100,
        z: Math.round(payload.dimensionsMm.z * 100) / 100,
      },
      quantity: Math.trunc(payload.quantity),
    },
  };
}

function acceptanceKeyPart(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80);
}

function utcDayKey(ms = Date.now()): string {
  return new Date(ms).toISOString().slice(0, 10);
}

type AgentAccountRow = {
  id: string;
  status: "active" | "on_hold";
  independentEnabled: boolean;
  prepayRequired: boolean;
  prepaidBalanceCents: number;
  dailySpendCapCents: number;
  spendDayKey: string;
  spentTodayCents: number;
  spentByCategoryCents: Record<string, number>;
  updatedAt: unknown;
};

function normalizeAgentAccountRow(agentClientId: string, row: Record<string, unknown> | null): AgentAccountRow {
  const source = row ?? {};
  const spentByCategoryRaw =
    source.spentByCategoryCents && typeof source.spentByCategoryCents === "object"
      ? (source.spentByCategoryCents as Record<string, unknown>)
      : {};
  const spentByCategoryCents: Record<string, number> = {};
  for (const [key, value] of Object.entries(spentByCategoryRaw)) {
    if (typeof value === "number" && Number.isFinite(value)) {
      spentByCategoryCents[key] = Math.max(0, Math.trunc(value));
    }
  }

  return {
    id: agentClientId,
    status: source.status === "on_hold" ? "on_hold" : "active",
    independentEnabled: source.independentEnabled === true,
    prepayRequired: source.prepayRequired !== false,
    prepaidBalanceCents:
      typeof source.prepaidBalanceCents === "number"
        ? Math.max(0, Math.trunc(source.prepaidBalanceCents))
        : AGENT_ACCOUNT_DEFAULTS.prepaidBalanceCents,
    dailySpendCapCents:
      typeof source.dailySpendCapCents === "number"
        ? Math.max(0, Math.trunc(source.dailySpendCapCents))
        : AGENT_ACCOUNT_DEFAULTS.dailySpendCapCents,
    spendDayKey: typeof source.spendDayKey === "string" ? source.spendDayKey : AGENT_ACCOUNT_DEFAULTS.spendDayKey,
    spentTodayCents:
      typeof source.spentTodayCents === "number"
        ? Math.max(0, Math.trunc(source.spentTodayCents))
        : AGENT_ACCOUNT_DEFAULTS.spentTodayCents,
    spentByCategoryCents,
    updatedAt: source.updatedAt ?? null,
  };
}

async function getOrInitAgentAccount(agentClientId: string): Promise<AgentAccountRow> {
  const ref = db.collection("agentAccounts").doc(agentClientId);
  const snap = await ref.get();
  if (snap.exists) {
    return normalizeAgentAccountRow(agentClientId, snap.data() as Record<string, unknown>);
  }

  const now = nowTs();
  await ref.set(
    {
      ...AGENT_ACCOUNT_DEFAULTS,
      createdAt: now,
      updatedAt: now,
      updatedByUid: "system:init",
    },
    { merge: false }
  );
  return normalizeAgentAccountRow(agentClientId, AGENT_ACCOUNT_DEFAULTS as unknown as Record<string, unknown>);
}

function withDailySpendWindow(account: AgentAccountRow): AgentAccountRow {
  const today = utcDayKey();
  if (account.spendDayKey === today) return account;
  return {
    ...account,
    spendDayKey: today,
    spentTodayCents: 0,
    spentByCategoryCents: {},
  };
}

function evaluateIndependentAccountLimits(params: {
  account: AgentAccountRow;
  subtotalCents: number;
  category: string;
}): { ok: true } | { ok: false; code: string; message: string } {
  const account = withDailySpendWindow(params.account);
  if (account.status !== "active") {
    return { ok: false, code: "ACCOUNT_ON_HOLD", message: "Independent agent account is on hold." };
  }
  const subtotal = Math.max(0, Math.trunc(params.subtotalCents));
  if (account.prepayRequired && account.prepaidBalanceCents < subtotal) {
    return { ok: false, code: "PREPAY_REQUIRED", message: "Prepaid balance is insufficient for this operation." };
  }
  if (account.dailySpendCapCents > 0 && account.spentTodayCents + subtotal > account.dailySpendCapCents) {
    return { ok: false, code: "DAILY_CAP_EXCEEDED", message: "Daily independent-agent spending cap exceeded." };
  }
  const categoryCap = account.spentByCategoryCents[`cap:${params.category}`];
  const categorySpent = account.spentByCategoryCents[params.category] ?? 0;
  if (typeof categoryCap === "number" && categoryCap > 0 && categorySpent + subtotal > categoryCap) {
    return { ok: false, code: "CATEGORY_CAP_EXCEEDED", message: "Category spending cap exceeded." };
  }
  return { ok: true };
}

async function getAgentTermsConfig(): Promise<{
  version: string;
  termsUrl: string | null;
  refundPolicyUrl: string | null;
  incidentPolicyUrl: string | null;
}> {
  const snap = await db.collection("config").doc("agentTerms").get();
  const row = snap.exists ? (snap.data() as Record<string, unknown>) : {};
  const versionRaw = typeof row.currentVersion === "string" ? row.currentVersion.trim() : "";
  return {
    version: versionRaw || AGENT_TERMS_DEFAULT_VERSION,
    termsUrl: typeof row.termsUrl === "string" ? row.termsUrl : null,
    refundPolicyUrl: typeof row.refundPolicyUrl === "string" ? row.refundPolicyUrl : null,
    incidentPolicyUrl: typeof row.incidentPolicyUrl === "string" ? row.incidentPolicyUrl : null,
  };
}

async function hasAcceptedAgentTerms(ctx: AuthContext, version: string): Promise<boolean> {
  if (ctx.mode !== "pat" && ctx.mode !== "delegated") return true;
  const queryBase = db.collection("agentTermsAcceptances");
  let q = queryBase.where("uid", "==", ctx.uid).where("version", "==", version).where("status", "==", "accepted");
  if (ctx.mode === "pat") {
    q = q.where("tokenId", "==", ctx.tokenId);
  } else {
    q = q.where("agentClientId", "==", ctx.delegated.agentClientId);
  }
  const snap = await q.limit(1).get();
  return !snap.empty;
}

export async function handleApiV1(req: RequestLike, res: ResponseLike) {
  if (applyCors(req, res)) return;

  const requestId = getRequestId(req);
  const flags = readAuthFeatureFlags();
  const routeFamily = getRouteFamily(req);

  if (req.method !== "POST") {
    jsonError(res, requestId, 405, "INVALID_ARGUMENT", "Use POST");
    return;
  }

  const appCheck = await enforceAppCheckIfEnabled(req);
  if (!appCheck.ok) {
    await logAuditEvent({
      req,
      requestId,
      action: "api_v1_request",
      resourceType: "api_v1",
      resourceId: typeof req.path === "string" ? req.path : "/",
      result: "deny",
      reasonCode: appCheck.code,
      metadata: {
        enforcedByFlag: flags.enforceAppCheck,
        routeFamily,
      },
    });
    jsonError(res, requestId, appCheck.httpStatus, appCheck.code, appCheck.message);
    return;
  }

  const ctxResult = await requireAuthContext(req);
  if (!ctxResult.ok) {
    await logAuditEvent({
      req,
      requestId,
      action: "api_v1_request",
      resourceType: "api_v1",
      resourceId: typeof req.path === "string" ? req.path : "/",
      result: "deny",
      reasonCode: ctxResult.code,
      metadata: { routeFamily },
    });
    jsonError(res, requestId, 401, "UNAUTHENTICATED", ctxResult.message);
    return;
  }

  const ctx = ctxResult.ctx;
  const isStaff = ctx.mode === "firebase" && isStaffFromDecoded(ctx.decoded);

  const path = typeof req.path === "string" ? req.path : "/";
  const route = path.endsWith("/") && path.length > 1 ? path.slice(0, -1) : path.startsWith("/") ? path : `/${path}`;
  if (!ALLOWED_API_V1_ROUTES.has(route)) {
    await logAuditEvent({
      req,
      requestId,
      action: "api_v1_route_reject",
      resourceType: "api_v1_route",
      resourceId: route,
      result: "deny",
      reasonCode: "ROUTE_NOT_FOUND",
      ctx,
      metadata: {
        resourceType: route.split(".")[0].replace("/v1/", ""),
        routeFamily,
      },
    });
    jsonError(res, requestId, 404, "NOT_FOUND", "Unknown route", { route });
    return;
  }

  if (route.startsWith("/v1/library.")) {
    const isLibraryReadRoute = LIBRARY_V1_READ_ROUTES.has(route);
    const isLibraryWriteRoute = LIBRARY_V1_MEMBER_WRITE_ROUTES.has(route);
    const isLibraryAdminRoute = LIBRARY_V1_ADMIN_ROUTES.has(route);
    const isKnownLibraryRoute = isLibraryReadRoute || isLibraryWriteRoute || isLibraryAdminRoute;
    if (isKnownLibraryRoute && ctx.mode !== "firebase") {
      jsonError(res, requestId, 403, "FORBIDDEN", "Library routes require a member or staff firebase session.");
      return;
    }
    if (isLibraryAdminRoute && !isStaff) {
      const admin = await requireAdmin(req);
      if (!admin.ok) {
        jsonError(res, requestId, 403, "FORBIDDEN", "Only staff can access this library route.");
        return;
      }
    }
    if (isKnownLibraryRoute) {
      const rollout = await getLibraryRolloutConfig();
      const allowedRoutes = LIBRARY_V1_ALLOWED_BY_ROLLOUT_PHASE[rollout.phase] ?? LIBRARY_V1_PHASE_3_ALLOWED_ROUTES;
      if (!allowedRoutes.has(route)) {
        jsonError(
          res,
          requestId,
          403,
          "LIBRARY_ROLLOUT_BLOCKED",
          libraryRolloutBlockedMessage(rollout.phase, route),
          {
            route,
            phase: rollout.phase,
            requiredPhase: requiredLibraryRolloutPhaseForRoute(route),
          }
        );
        return;
      }
    }
  }

  const rateLimit =
    route === "/v1/events.feed"
      ? { max: 600, windowMs: 60_000 }
      : route.startsWith("/v1/batches.")
        ? { max: 300, windowMs: 60_000 }
        : route.startsWith("/v1/firings.")
          ? { max: 300, windowMs: 60_000 }
          : { max: 120, windowMs: 60_000 };

  let rate: { ok: true } | { ok: false; retryAfterMs: number };
  try {
    rate = await enforceRateLimit({
      req,
      key: `apiV1:${route}`,
      max: rateLimit.max,
      windowMs: rateLimit.windowMs,
    });
  } catch (error: unknown) {
    await logAuditEvent({
      req,
      requestId,
      action: "api_v1_route_rate_limit_fallback",
      resourceType: "api_v1_route",
      resourceId: route,
      ownerUid: ctx.uid,
      result: "allow",
      reasonCode: "RATE_LIMIT_CHECK_ERROR",
      ctx,
      metadata: {
        scope: "route",
        route,
        mode: ctx.mode,
        actorMode: ctx.mode,
        error: safeErrorMessage(error),
      },
    });
    logger.error("apiV1 route rate limit check failed, continuing in degraded mode", {
      route,
      requestId,
      actorUid: ctx.uid,
      mode: ctx.mode,
      error: safeErrorMessage(error),
    });
    rate = { ok: true };
  }
  if (!rate.ok) {
    logger.warn("apiV1 route rate limited", {
      route,
      requestId,
      actorUid: ctx.uid,
      mode: ctx.mode,
      retryAfterMs: rate.retryAfterMs,
    });
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
    let agentRate: { ok: true } | { ok: false; retryAfterMs: number };
    try {
      agentRate = await enforceRateLimit({
        req,
        key: `apiV1:${route}:${actorKey}`,
        max: 90,
        windowMs: 60_000,
      });
    } catch (error: unknown) {
      await logAuditEvent({
        req,
        requestId,
        action: "api_v1_agent_rate_limit_fallback",
        resourceType: "api_v1_route",
        resourceId: route,
        ownerUid: ctx.uid,
        result: "allow",
        reasonCode: "RATE_LIMIT_CHECK_ERROR",
        ctx,
        metadata: {
          scope: "agent",
          route,
          actorMode: ctx.mode,
          actorKey,
          error: safeErrorMessage(error),
        },
      });
      logger.error("apiV1 agent actor rate limit check failed, continuing in degraded mode", {
        route,
        requestId,
        actorUid: ctx.uid,
        actorKey,
        mode: ctx.mode,
        error: safeErrorMessage(error),
      });
      agentRate = { ok: true };
    }
    if (!agentRate.ok) {
      logger.warn("apiV1 agent actor rate limited", {
        route,
        requestId,
        actorUid: ctx.uid,
        actorKey,
        mode: ctx.mode,
        retryAfterMs: agentRate.retryAfterMs,
      });
      if (ctx.mode === "delegated") {
        const cooldownUntil = Timestamp.fromMillis(Date.now() + AUTO_COOLDOWN_MINUTES * 60_000);
        const clientRef = db.collection("agentClients").doc(ctx.delegated.agentClientId);
        if (AUTO_COOLDOWN_ON_RATE_LIMIT) {
          await clientRef.set(
            {
              cooldownUntil,
              cooldownReason: "auto_rate_limit",
              updatedAt: nowTs(),
            },
            { merge: true }
          );
        }
        await db.collection("agentClientAuditLogs").add({
          actorUid: ctx.uid,
          action: AUTO_COOLDOWN_ON_RATE_LIMIT ? "auto_cooldown_rate_limit" : "rate_limit_observed",
          clientId: ctx.delegated.agentClientId,
          route,
          requestId,
          retryAfterMs: agentRate.retryAfterMs,
          cooldownApplied: AUTO_COOLDOWN_ON_RATE_LIMIT,
          cooldownUntil: AUTO_COOLDOWN_ON_RATE_LIMIT ? cooldownUntil : null,
          createdAt: nowTs(),
          metadata: {
            source: "security",
            outcome: "deny",
          },
        });
      }
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

    if (!AGENT_TERMS_EXEMPT_ROUTES.has(route) && (ctx.mode === "pat" || ctx.mode === "delegated")) {
      const termsConfig = await getAgentTermsConfig();
      const accepted = await hasAcceptedAgentTerms(ctx, termsConfig.version);
      if (!accepted) {
        await db.collection("agentAuditLogs").add({
          actorUid: ctx.uid,
          actorMode: ctx.mode,
          action: "agent_terms_required_block",
          requestId,
          route,
          requiredVersion: termsConfig.version,
          tokenId: ctx.mode === "pat" ? ctx.tokenId : null,
          agentClientId: ctx.mode === "delegated" ? ctx.delegated.agentClientId : null,
          createdAt: nowTs(),
        });
        jsonError(
          res,
          requestId,
          428,
          "FAILED_PRECONDITION",
          "Current agent terms must be accepted before using this endpoint.",
          {
            requiredVersion: termsConfig.version,
            acceptRoute: "/v1/agent.terms.accept",
          }
        );
        return;
      }
    }

    const hintedScope = ROUTE_SCOPE_HINTS[route] ?? null;
    if (hintedScope) {
      const routeAuthzEvent = API_V1_ROUTE_AUTHZ_EVENTS[route];
      const routeAuthz = await assertActorAuthorized({
        req,
        ctx,
        ownerUid: ctx.uid,
        scope: hintedScope,
        resource: `route:${route}`,
        allowStaff: true,
      });
      if (!routeAuthz.ok) {
        await logAuditEvent({
          req,
          requestId,
          action: routeAuthzEvent?.action ?? "api_v1_route_authz",
          resourceType: routeAuthzEvent?.resourceType ?? "api_v1_route",
          resourceId: route,
          ownerUid: ctx.uid,
          result: "deny",
          reasonCode: routeAuthz.code,
          ctx,
          metadata: {
            scope: hintedScope,
            strictDelegationChecks: flags.v2AgenticEnabled && flags.strictDelegationChecks,
          },
        });
        jsonError(res, requestId, routeAuthz.httpStatus, routeAuthz.code, routeAuthz.message);
        return;
      }
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

    if (route === "/v1/agent.terms.get") {
      const termsConfig = await getAgentTermsConfig();
      const accepted = await hasAcceptedAgentTerms(ctx, termsConfig.version);
      jsonOk(res, requestId, {
        version: termsConfig.version,
        accepted,
        termsUrl: termsConfig.termsUrl,
        refundPolicyUrl: termsConfig.refundPolicyUrl,
        incidentPolicyUrl: termsConfig.incidentPolicyUrl,
      });
      return;
    }

    if (route === "/v1/agent.terms.accept") {
      const parsed = parseBody(agentTermsAcceptSchema, req.body);
      if (!parsed.ok) {
        jsonError(res, requestId, 400, "INVALID_ARGUMENT", parsed.message);
        return;
      }
      const termsConfig = await getAgentTermsConfig();
      const requestedVersion = trimOrNull(parsed.data.version) ?? termsConfig.version;
      if (requestedVersion !== termsConfig.version) {
        jsonError(res, requestId, 400, "FAILED_PRECONDITION", "Requested terms version is not current.", {
          currentVersion: termsConfig.version,
        });
        return;
      }
      const modeKey = ctx.mode === "pat" || ctx.mode === "delegated" ? ctx.mode : "firebase";
      const actorKey =
        ctx.mode === "pat"
          ? acceptanceKeyPart(ctx.tokenId)
          : ctx.mode === "delegated"
            ? acceptanceKeyPart(ctx.delegated.agentClientId)
            : acceptanceKeyPart(ctx.uid);
      const acceptanceId = `${acceptanceKeyPart(ctx.uid)}_${modeKey}_${actorKey}_${acceptanceKeyPart(requestedVersion)}`;
      await db.collection("agentTermsAcceptances").doc(acceptanceId).set(
        {
          uid: ctx.uid,
          mode: modeKey,
          tokenId: ctx.mode === "pat" ? ctx.tokenId : null,
          agentClientId: ctx.mode === "delegated" ? ctx.delegated.agentClientId : null,
          version: requestedVersion,
          source: trimOrNull(parsed.data.source),
          status: "accepted",
          acceptedAt: nowTs(),
          updatedAt: nowTs(),
        },
        { merge: true }
      );
      await db.collection("agentAuditLogs").add({
        actorUid: ctx.uid,
        actorMode: ctx.mode,
        action: "agent_terms_accepted",
        requestId,
        version: requestedVersion,
        tokenId: ctx.mode === "pat" ? ctx.tokenId : null,
        agentClientId: ctx.mode === "delegated" ? ctx.delegated.agentClientId : null,
        createdAt: nowTs(),
      });
      jsonOk(res, requestId, { accepted: true, version: requestedVersion });
      return;
    }

    if (route === "/v1/agent.account.get") {
      const scopeCheck = requireScopes(ctx, ["status:read"]);
      if (!scopeCheck.ok) {
        jsonError(res, requestId, 403, "FORBIDDEN", scopeCheck.message);
        return;
      }
      const parsed = parseBody(agentAccountGetSchema, req.body);
      if (!parsed.ok) {
        jsonError(res, requestId, 400, "INVALID_ARGUMENT", parsed.message);
        return;
      }
      const requestedClientId = trimOrNull(parsed.data.agentClientId);
      const targetClientId =
        requestedClientId ??
        (ctx.mode === "delegated" ? ctx.delegated.agentClientId : null);
      if (!targetClientId) {
        jsonError(res, requestId, 400, "INVALID_ARGUMENT", "agentClientId is required for this caller.");
        return;
      }
      if (ctx.mode !== "firebase") {
        if (ctx.mode === "delegated" && targetClientId !== ctx.delegated.agentClientId) {
          jsonError(res, requestId, 403, "FORBIDDEN", "Forbidden");
          return;
        }
      } else if (!isStaff) {
        jsonError(res, requestId, 403, "FORBIDDEN", "Forbidden");
        return;
      }

      const account = withDailySpendWindow(await getOrInitAgentAccount(targetClientId));
      jsonOk(res, requestId, { account });
      return;
    }

    if (route === "/v1/agent.account.update") {
      if (!(ctx.mode === "firebase" && isStaff)) {
        jsonError(res, requestId, 403, "FORBIDDEN", "Forbidden");
        return;
      }
      const parsed = parseBody(agentAccountUpdateSchema, req.body);
      if (!parsed.ok) {
        jsonError(res, requestId, 400, "INVALID_ARGUMENT", parsed.message);
        return;
      }
      const agentClientId = parsed.data.agentClientId.trim();
      const accountRef = db.collection("agentAccounts").doc(agentClientId);
      const account = withDailySpendWindow(await getOrInitAgentAccount(agentClientId));
      const nextStatus = parsed.data.status ?? account.status;
      const nextIndependentEnabled =
        parsed.data.independentEnabled === undefined ? account.independentEnabled : parsed.data.independentEnabled;
      const nextPrepayRequired =
        parsed.data.prepayRequired === undefined ? account.prepayRequired : parsed.data.prepayRequired;
      const nextDailyCap =
        parsed.data.dailySpendCapCents === undefined ? account.dailySpendCapCents : parsed.data.dailySpendCapCents;
      const nextBalance =
        parsed.data.prepaidBalanceDeltaCents === undefined
          ? account.prepaidBalanceCents
          : Math.max(0, account.prepaidBalanceCents + parsed.data.prepaidBalanceDeltaCents);
      const reason = trimOrNull(parsed.data.reason);

      const patch: Record<string, unknown> = {
        status: nextStatus,
        independentEnabled: nextIndependentEnabled,
        prepayRequired: nextPrepayRequired,
        prepaidBalanceCents: nextBalance,
        dailySpendCapCents: nextDailyCap,
        updatedAt: nowTs(),
        updatedByUid: ctx.uid,
      };
      if (parsed.data.categoryCapsCents) {
        const nextCategoryMap: Record<string, number> = {};
        for (const [key, value] of Object.entries(parsed.data.categoryCapsCents)) {
          nextCategoryMap[`cap:${key}`] = Math.max(0, Math.trunc(value));
        }
        patch.spentByCategoryCents = {
          ...account.spentByCategoryCents,
          ...nextCategoryMap,
        };
      }
      await accountRef.set(patch, { merge: true });
      await db.collection("agentAuditLogs").add({
        actorUid: ctx.uid,
        actorMode: ctx.mode,
        action: "agent_account_updated",
        requestId,
        agentClientId,
        reason,
        status: nextStatus,
        independentEnabled: nextIndependentEnabled,
        prepayRequired: nextPrepayRequired,
        prepaidBalanceCents: nextBalance,
        dailySpendCapCents: nextDailyCap,
        balanceDeltaCents: parsed.data.prepaidBalanceDeltaCents ?? 0,
        createdAt: nowTs(),
      });
      const fresh = await accountRef.get();
      jsonOk(res, requestId, {
        account: normalizeAgentAccountRow(agentClientId, fresh.exists ? (fresh.data() as Record<string, unknown>) : null),
      });
      return;
    }

    if (route === "/v1/batches.list") {
      const scopeCheck = requireScopes(ctx, ["batches:read"]);
      if (!scopeCheck.ok) {
        jsonError(res, requestId, 403, "FORBIDDEN", scopeCheck.message);
        return;
      }

      const parsed = parseBody(batchesListSchema, req.body);
      if (!parsed.ok) {
        jsonError(res, requestId, 400, "INVALID_ARGUMENT", parsed.message);
        return;
      }

      const ownerUid = parsed.data.ownerUid ? String(parsed.data.ownerUid) : ctx.uid;
      const authz = await assertActorAuthorized({
        req,
        ctx,
        ownerUid,
        scope: "batches:read",
        resource: `owner:${ownerUid}`,
        allowStaff: true,
      });
      if (!authz.ok) {
        await logAuditEvent({
          req,
          requestId,
          action: "batches_list",
          resourceType: "batch",
          ownerUid,
          result: "deny",
          reasonCode: authz.code,
          ctx,
        });
        jsonError(res, requestId, authz.httpStatus, authz.code, authz.message);
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

      let closed: BatchSummary[] | null = null;
      if (includeClosed) {
        const closedSnap = await db
          .collection("batches")
          .where("ownerUid", "==", ownerUid)
          .where("isClosed", "==", true)
          .orderBy("closedAt", "desc")
          .limit(limit)
          .get();
        closed = closedSnap.docs.map((d) => toBatchSummary(d.id, d.data() as Record<string, unknown>));
      }

      jsonOk(res, requestId, { ownerUid, active, closed: includeClosed ? closed ?? [] : null });
      return;
    }

    if (route === "/v1/batches.get") {
      const scopeCheck = requireScopes(ctx, ["batches:read"]);
      if (!scopeCheck.ok) {
        jsonError(res, requestId, 403, "FORBIDDEN", scopeCheck.message);
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

      const data = snap.data() as BatchDoc;
      const ownerUid = typeof data?.ownerUid === "string" ? data.ownerUid : "";
      const authz = await assertActorAuthorized({
        req,
        ctx,
        ownerUid,
        scope: "batches:read",
        resource: `batch:${batchId}`,
        allowStaff: true,
      });
      if (!authz.ok || !canReadBatchDoc({ uid: ctx.uid, isStaff, batch: data })) {
        await logAuditEvent({
          req,
          requestId,
          action: "batches_get",
          resourceType: "batch",
          resourceId: batchId,
          ownerUid,
          result: "deny",
          reasonCode: authz.ok ? "FORBIDDEN" : authz.code,
          ctx,
        });
        jsonError(res, requestId, authz.ok ? 403 : authz.httpStatus, authz.ok ? "FORBIDDEN" : authz.code, authz.ok ? "Forbidden" : authz.message);
        return;
      }

      jsonOk(res, requestId, { batch: toBatchDetailRow(snap.id, data) });
      return;
    }

    if (route === "/v1/batches.timeline.list") {
      const scopeCheck = requireScopes(ctx, ["timeline:read"]);
      if (!scopeCheck.ok) {
        jsonError(res, requestId, 403, "FORBIDDEN", scopeCheck.message);
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
      const batch = batchSnap.data() as BatchDoc;
      const ownerUid = typeof batch?.ownerUid === "string" ? batch.ownerUid : "";
      const authz = await assertActorAuthorized({
        req,
        ctx,
        ownerUid,
        scope: "timeline:read",
        resource: `batch:${batchId}:timeline`,
        allowStaff: true,
      });
      if (!authz.ok || !canReadBatchTimeline({ uid: ctx.uid, isStaff, batch })) {
        await logAuditEvent({
          req,
          requestId,
          action: "batches_timeline_list",
          resourceType: "batch_timeline",
          resourceId: batchId,
          ownerUid,
          result: "deny",
          reasonCode: authz.ok ? "FORBIDDEN" : authz.code,
          ctx,
        });
        jsonError(res, requestId, authz.ok ? 403 : authz.httpStatus, authz.ok ? "FORBIDDEN" : authz.code, authz.ok ? "Forbidden" : authz.message);
        return;
      }

      const eventsSnap = await db
        .collection("batches")
        .doc(batchId)
        .collection("timeline")
        .orderBy("at", "desc")
        .limit(limit)
        .get();

      const events = eventsSnap.docs.map((d) => toTimelineEventRow(d.id, d.data() as Record<string, unknown>));
      jsonOk(res, requestId, { batchId, events });
      return;
    }

    if (route === "/v1/reservations.create") {
      const scopeCheck = requireScopes(ctx, ["reservations:write"]);
      if (!scopeCheck.ok) {
        jsonError(res, requestId, 403, "FORBIDDEN", scopeCheck.message);
        return;
      }

      const parsed = parseBody(reservationCreateSchema, req.body);
      if (!parsed.ok) {
        jsonError(res, requestId, 400, "INVALID_ARGUMENT", parsed.message);
        return;
      }

      const body = parsed.data;
      const ownerUidInput = trimOrNull(body.ownerUid);
      const ownerUid = ownerUidInput ?? ctx.uid;
      if (ownerUidInput && ownerUidInput !== ctx.uid && !isStaff) {
        jsonError(res, requestId, 403, "FORBIDDEN", "Cannot create reservation for another user");
        return;
      }

      const reservationAuthz = await assertActorAuthorized({
        req,
        ctx,
        ownerUid,
        scope: "reservations:write",
        resource: `owner:${ownerUid}`,
        allowStaff: true,
      });
      if (!reservationAuthz.ok) {
        await logReservationAuditEvent({
          req,
          requestId,
          action: "reservations_create_authz",
          resourceType: "reservation",
          resourceId: ownerUid,
          ownerUid,
          result: "deny",
          reasonCode: reservationAuthz.code,
          ctx,
        });
        jsonError(res, requestId, reservationAuthz.httpStatus, reservationAuthz.code, reservationAuthz.message);
        return;
      }

      const firingTypeRaw = trimOrNull(body.firingType) ?? "other";
      const firingType =
        firingTypeRaw === "bisque" || firingTypeRaw === "glaze" || firingTypeRaw === "other"
          ? firingTypeRaw
          : "other";

      const preferredWindow = body.preferredWindow ?? {};
      const earliestDate = parseReservationIsoDate(preferredWindow.earliestDate);
      const latestDate = parseReservationIsoDate(preferredWindow.latestDate);
      if (earliestDate && latestDate && earliestDate > latestDate) {
        jsonError(
          res,
          requestId,
          400,
          "INVALID_ARGUMENT",
          "Earliest date must come before latest date"
        );
        return;
      }

      const linkedBatchId = trimOrNull(body.linkedBatchId);
      if (linkedBatchId) {
        const batchSnap = await db.collection("batches").doc(linkedBatchId).get();
        if (!batchSnap.exists) {
          jsonError(res, requestId, 404, "NOT_FOUND", "Linked batch not found");
          return;
        }
        const batchData = batchSnap.data() as Record<string, unknown> | undefined;
        const owners = Array.isArray(batchData?.editors)
          ? batchData.editors.filter((entry): entry is string => typeof entry === "string")
          : [];
        const ownerUidFromBatch = typeof batchData?.ownerUid === "string" ? batchData.ownerUid : null;
        if (ownerUidFromBatch !== ownerUid && !owners.includes(ownerUid)) {
          jsonError(res, requestId, 403, "FORBIDDEN", "Linked batch not owned by requester");
          return;
        }
      }

      const now = nowTs();
      const clientRequestId = trimOrNull(body.clientRequestId);
      const reservationRef = clientRequestId
        ? db.collection("reservations").doc(makeIdempotencyId("reservation", ownerUid, clientRequestId))
        : db.collection("reservations").doc();

      if (clientRequestId) {
        const existing = await reservationRef.get();
        if (existing.exists) {
          const existingData = existing.data() as Record<string, unknown>;
          if (typeof existingData?.ownerUid === "string" && existingData.ownerUid === ownerUid) {
            jsonOk(res, requestId, {
              reservationId: reservationRef.id,
              status: typeof existingData?.status === "string" ? existingData.status : "REQUESTED",
              idempotentReplay: true,
            });
            return;
          }
        }
      }

      const heightInchesRaw = normalizeNumber(body.heightInches);
      const heightInches =
        typeof heightInchesRaw === "number" && heightInchesRaw > 0 ? heightInchesRaw : null;
      const footprintHalfShelvesRaw = normalizeNumber(body.footprintHalfShelves);
      const footprintHalfShelves =
        typeof footprintHalfShelvesRaw === "number" && footprintHalfShelvesRaw > 0
          ? clampNumber(footprintHalfShelvesRaw, 1, 8)
          : null;
      const tiersRaw = normalizeNumber(body.tiers);
      const tiersInput =
        typeof tiersRaw === "number" && tiersRaw > 0 ? Math.round(tiersRaw) : null;
      const providedEstimatedHalfShelves = normalizeNumber(body.estimatedHalfShelves);
      const estimatedHalfShelvesInput =
        typeof providedEstimatedHalfShelves === "number" && providedEstimatedHalfShelves > 0
          ? Math.ceil(providedEstimatedHalfShelves)
          : null;

      const resolvedTiers =
        tiersInput ??
        (typeof footprintHalfShelves === "number"
          ? Math.max(1, 1 + Math.floor(((heightInches ?? 0) - 1) / 10))
          : null);
      const resolvedEstimatedHalfShelves =
        estimatedHalfShelvesInput ??
        (typeof footprintHalfShelves === "number" && typeof resolvedTiers === "number"
          ? footprintHalfShelves * resolvedTiers
          : null);

      const intakeMode = normalizeIntakeMode(
        body.intakeMode,
        body.addOns?.wholeKilnRequested === true ? "WHOLE_KILN" : "SHELF_PURCHASE"
      );

      const shelfInput = normalizeNumber(body.shelfEquivalent, 1);
      const shelfEquivalent =
        typeof resolvedEstimatedHalfShelves === "number"
          ? Math.max(0.25, resolvedEstimatedHalfShelves / 2)
          : clampNumber(Number(shelfInput ?? 1), 0.25, 32);

      const dropInput = body.dropOffProfile ?? {};
      const pieceCountRaw = trimOrNull(dropInput.pieceCount);
      const dropOffProfile =
        trimOrNull(dropInput.id) ||
        trimOrNull(dropInput.label) ||
        pieceCountRaw ||
        dropInput.hasTall ||
        dropInput.stackable ||
        dropInput.bisqueOnly ||
        dropInput.specialHandling
          ? {
              id: trimOrNull(dropInput.id) || null,
              label: trimOrNull(dropInput.label) || null,
              pieceCount:
                pieceCountRaw === "single" || pieceCountRaw === "many" ? pieceCountRaw : null,
              hasTall: dropInput.hasTall === true,
              stackable: dropInput.stackable === true,
              bisqueOnly: dropInput.bisqueOnly === true,
              specialHandling: dropInput.specialHandling === true,
            }
          : null;

      const quantityInput = body.dropOffQuantity ?? {};
      const dropOffQuantity =
        trimOrNull(quantityInput.id) || trimOrNull(quantityInput.label) || trimOrNull(quantityInput.pieceRange)
          ? {
              id: trimOrNull(quantityInput.id) || null,
              label: trimOrNull(quantityInput.label) || null,
              pieceRange: trimOrNull(quantityInput.pieceRange) || null,
            }
          : null;

      if (dropOffProfile?.bisqueOnly && firingType !== "bisque") {
        jsonError(
          res,
          requestId,
          400,
          "INVALID_ARGUMENT",
          "Bisque-only dropoff profile is only valid for bisque firings."
        );
        return;
      }

      const notesInput = body.notes ?? {};
      const notes = {
        general: trimOrNull(notesInput.general) || null,
        clayBody: trimOrNull(notesInput.clayBody) || null,
        glazeNotes: trimOrNull(notesInput.glazeNotes) || null,
      };

      const resolvedNotes =
        notes.general || notes.clayBody || notes.glazeNotes
          ? {
              general: notes.general,
              clayBody: notes.clayBody,
              glazeNotes: notes.glazeNotes,
            }
          : null;

      const addOnsInput = body.addOns ?? {};
      const isCommunityShelf = intakeMode === "COMMUNITY_SHELF";
      const addOns = {
        rushRequested: !isCommunityShelf && addOnsInput.rushRequested === true,
        wholeKilnRequested: intakeMode === "WHOLE_KILN",
        communityShelfFillInAllowed: intakeMode === "SHELF_PURCHASE" && addOnsInput.communityShelfFillInAllowed === true,
        pickupDeliveryRequested: !isCommunityShelf && addOnsInput.pickupDeliveryRequested === true,
        returnDeliveryRequested: !isCommunityShelf && addOnsInput.returnDeliveryRequested === true,
        useStudioGlazes: !isCommunityShelf && addOnsInput.useStudioGlazes === true,
        glazeAccessCost:
          !isCommunityShelf &&
          resolvedEstimatedHalfShelves &&
          resolvedEstimatedHalfShelves > 0 &&
          addOnsInput.useStudioGlazes === true
          ? resolvedEstimatedHalfShelves * 3
          : null,
        waxResistAssistRequested: !isCommunityShelf && addOnsInput.waxResistAssistRequested === true,
        glazeSanityCheckRequested: !isCommunityShelf && addOnsInput.glazeSanityCheckRequested === true,
        deliveryAddress: trimOrNull(addOnsInput.deliveryAddress),
        deliveryInstructions: trimOrNull(addOnsInput.deliveryInstructions),
      };

      if (
        (addOns.pickupDeliveryRequested || addOns.returnDeliveryRequested) &&
        (!addOns.deliveryAddress || !addOns.deliveryInstructions)
      ) {
        jsonError(
          res,
          requestId,
          400,
          "INVALID_ARGUMENT",
          "Delivery address and instructions are required for pickup/return."
        );
        return;
      }

      const photoUrl = trimOrNull(body.photoUrl);
      const photoPath = trimOrNull(body.photoPath);
      if (photoPath && !photoPath.startsWith(`checkins/${ownerUid}/`)) {
        jsonError(res, requestId, 400, "INVALID_ARGUMENT", "Invalid photo path");
        return;
      }
      const kilnIdInput = trimOrNull(body.kilnId);
      const kilnId = kilnIdInput ? normalizeStationId(kilnIdInput) : null;
      if (kilnIdInput && (!kilnId || !isValidStation(kilnId))) {
        jsonError(res, requestId, 400, "INVALID_ARGUMENT", "Unknown station id.");
        return;
      }

      const dropOffQuantityPayload = dropOffQuantity;

      const notesPayload = resolvedNotes
        ? {
            ...resolvedNotes,
            general: resolvedNotes.general || null,
            clayBody: resolvedNotes.clayBody || null,
            glazeNotes: resolvedNotes.glazeNotes || null,
          }
        : null;

      const addOnsPayload = addOns;
      const piecesPayload = normalizeReservationPiecesInput(body.pieces, reservationRef.id);
      const estimatedCostInput = normalizeNumber(body.estimatedCost);
      const estimatedCost =
        intakeMode === "COMMUNITY_SHELF"
          ? 0
          : typeof estimatedCostInput === "number" && estimatedCostInput > 0
            ? estimatedCostInput
            : null;

      await reservationRef.set({
        ownerUid,
        status: "REQUESTED",
        loadStatus: "queued",
        intakeMode,
        firingType,
        shelfEquivalent: Number(shelfEquivalent),
        footprintHalfShelves,
        heightInches,
        tiers: resolvedTiers,
        estimatedHalfShelves: resolvedEstimatedHalfShelves,
        estimatedCost,
        preferredWindow: {
          earliestDate: earliestDate ? Timestamp.fromDate(earliestDate) : null,
          latestDate: latestDate ? Timestamp.fromDate(latestDate) : null,
        },
        linkedBatchId,
        wareType: trimOrNull(body.wareType),
        kilnId,
        assignedStationId: kilnId,
        kilnLabel: trimOrNull(body.kilnLabel),
        quantityTier: trimOrNull(body.quantityTier),
        quantityLabel: trimOrNull(body.quantityLabel),
        dropOffQuantity: dropOffQuantityPayload,
        dropOffProfile,
        photoUrl,
        photoPath,
        notes: notesPayload,
        pieces: piecesPayload,
        notesHistory: notesPayload
          ? [
              {
                at: now,
                byUid: ctx.uid,
                byRole: isStaff ? "staff" : ctx.mode === "firebase" ? "client" : "dev",
                notes: notesPayload,
              },
            ]
          : [],
        addOns: addOnsPayload,
        stageStatus: {
          stage: "intake",
          at: now,
          source: isStaff ? "staff" : "client",
          reason: "Reservation created",
          notes: null,
          actorUid: ctx.uid,
          actorRole: isStaff ? "staff" : ctx.mode === "firebase" ? "client" : "dev",
        },
        stageHistory: [],
        pickupWindow: {
          requestedStart: null,
          requestedEnd: null,
          confirmedStart: null,
          confirmedEnd: null,
          status: "open",
          confirmedAt: null,
          completedAt: null,
          missedCount: 0,
          rescheduleCount: 0,
          lastMissedAt: null,
          lastRescheduleRequestedAt: null,
        },
        storageStatus: "active",
        readyForPickupAt: null,
        pickupReminderCount: 0,
        lastReminderAt: null,
        pickupReminderFailureCount: 0,
        lastReminderFailureAt: null,
        storageNoticeHistory: [],
        createdByUid: ctx.uid,
        createdByRole: isStaff ? "staff" : ctx.mode === "firebase" ? "client" : "dev",
        createdAt: now,
        updatedAt: now,
      });

      await recomputeQueueHintsForStationSafe(kilnId, "reservations.create");

      jsonOk(res, requestId, {
        reservationId: reservationRef.id,
        status: "REQUESTED",
        idempotentReplay: false,
      });
      return;
    }

    if (route === "/v1/reservations.get") {
      const scopeCheck = requireScopes(ctx, ["reservations:read"]);
      if (!scopeCheck.ok) {
        jsonError(res, requestId, 403, "FORBIDDEN", scopeCheck.message);
        return;
      }

      const parsed = parseBody(reservationsGetSchema, req.body);
      if (!parsed.ok) {
        jsonError(res, requestId, 400, "INVALID_ARGUMENT", parsed.message);
        return;
      }

      const reservationId = parsed.data.reservationId;
      const reservationRef = db.collection("reservations").doc(reservationId);
      const reservationSnap = await reservationRef.get();
      if (!reservationSnap.exists) {
        jsonError(res, requestId, 404, "NOT_FOUND", "Reservation not found");
        return;
      }

      const row = reservationSnap.data() as Record<string, unknown>;
      const ownerUid = safeString(row.ownerUid, "");
      if (!ownerUid) {
        jsonError(res, requestId, 500, "INTERNAL", "Reservation missing owner");
        return;
      }

      const reservationAuthz = await assertActorAuthorized({
        req,
        ctx,
        ownerUid,
        scope: "reservations:read",
        resource: `reservation:${reservationId}`,
        allowStaff: true,
      });
      if (!reservationAuthz.ok) {
        await logReservationAuditEvent({
          req,
          requestId,
          action: "reservations_get_authz",
          resourceType: "reservation",
          resourceId: reservationId,
          ownerUid,
          result: "deny",
          reasonCode: reservationAuthz.code,
          ctx,
        });
        jsonError(res, requestId, reservationAuthz.httpStatus, reservationAuthz.code, reservationAuthz.message);
        return;
      }

      jsonOk(res, requestId, { reservation: toReservationRow(reservationId, row) });
      return;
    }

    if (route === "/v1/reservations.list") {
      const scopeCheck = requireScopes(ctx, ["reservations:read"]);
      if (!scopeCheck.ok) {
        jsonError(res, requestId, 403, "FORBIDDEN", scopeCheck.message);
        return;
      }

      const parsed = parseBody(reservationsListSchema, req.body);
      if (!parsed.ok) {
        jsonError(res, requestId, 400, "INVALID_ARGUMENT", parsed.message);
        return;
      }

      const targetOwnerUid = trimOrNull(parsed.data.ownerUid) ?? ctx.uid;
      const limit = parsed.data.limit ?? 100;
      const includeCancelled = parsed.data.includeCancelled === true;
      const statusFilter = trimOrNull(parsed.data.status)?.toUpperCase() ?? null;

      const reservationAuthz = await assertActorAuthorized({
        req,
        ctx,
        ownerUid: targetOwnerUid,
        scope: "reservations:read",
        resource: `owner:${targetOwnerUid}`,
        allowStaff: true,
      });
      if (!reservationAuthz.ok) {
        await logReservationAuditEvent({
          req,
          requestId,
          action: "reservations_list_authz",
          resourceType: "reservation",
          resourceId: targetOwnerUid,
          ownerUid: targetOwnerUid,
          result: "deny",
          reasonCode: reservationAuthz.code,
          ctx,
        });
        jsonError(res, requestId, reservationAuthz.httpStatus, reservationAuthz.code, reservationAuthz.message);
        return;
      }

      let snap;
      try {
        snap = await db
          .collection("reservations")
          .where("ownerUid", "==", targetOwnerUid)
          .orderBy("createdAt", "desc")
          .limit(500)
          .get();
      } catch (error: unknown) {
        if (!isMissingIndexError(error)) {
          throw error;
        }
        snap = await db.collection("reservations").where("ownerUid", "==", targetOwnerUid).limit(500).get();
      }

      const reservations = snap.docs
        .map((rowSnap) => toReservationRow(rowSnap.id, rowSnap.data() as Record<string, unknown>))
        .filter((row) => {
          if (!includeCancelled && safeString(row.status).toUpperCase() === "CANCELLED") {
            return false;
          }
          if (statusFilter) {
            return safeString(row.status).toUpperCase() === statusFilter;
          }
          return true;
        })
        .sort((a, b) => {
          const byCreatedAt = readTimestampMs(b.createdAt) - readTimestampMs(a.createdAt);
          if (byCreatedAt !== 0) return byCreatedAt;
          return String(b.id ?? "").localeCompare(String(a.id ?? ""));
        })
        .slice(0, limit);

      jsonOk(res, requestId, { ownerUid: targetOwnerUid, reservations });
      return;
    }

    if (route === "/v1/notifications.markRead") {
      const parsed = parseBody(notificationsMarkReadSchema, req.body);
      if (!parsed.ok) {
        jsonError(res, requestId, 400, "INVALID_ARGUMENT", parsed.message);
        return;
      }

      const targetOwnerUid = trimOrNull(parsed.data.ownerUid) ?? ctx.uid;
      const authz = await assertActorAuthorized({
        req,
        ctx,
        ownerUid: targetOwnerUid,
        scope: null,
        resource: `owner:${targetOwnerUid}:notifications`,
        allowStaff: true,
      });
      if (!authz.ok) {
        jsonError(res, requestId, authz.httpStatus, authz.code, authz.message);
        return;
      }

      const notificationId = parsed.data.notificationId;
      const notificationRef = db
        .collection("users")
        .doc(targetOwnerUid)
        .collection("notifications")
        .doc(notificationId);
      const notificationSnap = await notificationRef.get();
      if (!notificationSnap.exists) {
        jsonOk(res, requestId, {
          ownerUid: targetOwnerUid,
          notificationId,
          readAt: null,
          notificationMissing: true,
        });
        return;
      }

      const readAt = nowTs();
      await notificationRef.set({ readAt }, { merge: true });
      jsonOk(res, requestId, {
        ownerUid: targetOwnerUid,
        notificationId,
        readAt,
      });
      return;
    }

    if (route === "/v1/reservations.exportContinuity") {
      const scopeCheck = requireScopes(ctx, ["reservations:read"]);
      if (!scopeCheck.ok) {
        jsonError(res, requestId, 403, "FORBIDDEN", scopeCheck.message);
        return;
      }

      const parsed = parseBody(reservationsExportContinuitySchema, req.body);
      if (!parsed.ok) {
        jsonError(res, requestId, 400, "INVALID_ARGUMENT", parsed.message);
        return;
      }

      const targetOwnerUid = trimOrNull(parsed.data.ownerUid) ?? ctx.uid;
      const rowLimit = parsed.data.limit ?? 300;
      const includeCsv = parsed.data.includeCsv !== false;

      const reservationAuthz = await assertActorAuthorized({
        req,
        ctx,
        ownerUid: targetOwnerUid,
        scope: "reservations:read",
        resource: `owner:${targetOwnerUid}:continuity-export`,
        allowStaff: true,
      });
      if (!reservationAuthz.ok) {
        await logReservationAuditEvent({
          req,
          requestId,
          action: "reservations_export_continuity_authz",
          resourceType: "reservation",
          resourceId: targetOwnerUid,
          ownerUid: targetOwnerUid,
          result: "deny",
          reasonCode: reservationAuthz.code,
          ctx,
        });
        jsonError(res, requestId, reservationAuthz.httpStatus, reservationAuthz.code, reservationAuthz.message);
        return;
      }

      const reservationsSnap = await db
        .collection("reservations")
        .where("ownerUid", "==", targetOwnerUid)
        .orderBy("createdAt", "desc")
        .limit(Math.min(1000, rowLimit))
        .get();

      const reservations = reservationsSnap.docs.map((docSnap) =>
        toReservationRow(docSnap.id, docSnap.data() as Record<string, unknown>)
      );

      const stageHistoryRows: Array<Record<string, unknown>> = [];
      const pieceRows: Array<Record<string, unknown>> = [];
      const storageActionRows: Array<Record<string, unknown>> = [];
      const reservationRows = reservations.map((reservation) => {
        const notes = readObjectOrEmpty(reservation.notes);
        const stageHistory = Array.isArray(reservation.stageHistory) ? reservation.stageHistory : [];
        const pieces = Array.isArray(reservation.pieces) ? reservation.pieces : [];
        const storageNoticeHistory = Array.isArray(reservation.storageNoticeHistory)
          ? reservation.storageNoticeHistory
          : [];

        stageHistory.forEach((entry, index) => {
          const row = readObjectOrEmpty(entry);
          stageHistoryRows.push({
            reservationId: reservation.id,
            index,
            at: toIsoString(row.at),
            fromStage: readStringOrNull(row.fromStage),
            toStage: readStringOrNull(row.toStage),
            fromStatus: readStringOrNull(row.fromStatus),
            toStatus: readStringOrNull(row.toStatus),
            fromLoadStatus: readStringOrNull(row.fromLoadStatus),
            toLoadStatus: readStringOrNull(row.toLoadStatus),
            actorUid: readStringOrNull(row.actorUid),
            actorRole: readStringOrNull(row.actorRole),
            reason: readStringOrNull(row.reason),
            notes: readStringOrNull(row.notes),
          });
        });

        pieces.forEach((entry, index) => {
          const row = readObjectOrEmpty(entry);
          pieceRows.push({
            reservationId: reservation.id,
            index,
            pieceId: readStringOrNull(row.pieceId),
            pieceLabel: readStringOrNull(row.pieceLabel),
            pieceCount: normalizeNumber(row.pieceCount),
            pieceStatus: readStringOrNull(row.pieceStatus),
            hasPhoto: Boolean(readStringOrNull(row.piecePhotoUrl)),
          });
        });

        storageNoticeHistory.forEach((entry, index) => {
          const row = readObjectOrEmpty(entry);
          storageActionRows.push({
            reservationId: reservation.id,
            index,
            at: toIsoString(row.at),
            kind: readStringOrNull(row.kind),
            detail: readStringOrNull(row.detail),
            status: readStringOrNull(row.status),
            reminderOrdinal: normalizeNumber(row.reminderOrdinal),
            reminderCount: normalizeNumber(row.reminderCount),
            failureCode: readStringOrNull(row.failureCode),
          });
        });

        return {
          reservationId: reservation.id,
          status: reservation.status,
          loadStatus: reservation.loadStatus ?? null,
          intakeMode: normalizeIntakeMode(
            reservation.intakeMode,
            reservation.addOns?.wholeKilnRequested ? "WHOLE_KILN" : "SHELF_PURCHASE"
          ),
          firingType: reservation.firingType,
          shelfEquivalent: reservation.shelfEquivalent,
          estimatedHalfShelves: normalizeNumber(reservation.estimatedHalfShelves),
          queuePositionHint: normalizeNumber(reservation.queuePositionHint),
          queueClass: reservation.queueClass ?? null,
          assignedStationId: reservation.assignedStationId ?? null,
          pickupWindowStatus: readStringOrNull(readObjectOrEmpty(reservation.pickupWindow).status),
          storageStatus: reservation.storageStatus ?? null,
          arrivalStatus: reservation.arrivalStatus ?? null,
          stageHistoryCount: stageHistory.length,
          pieceRowCount: pieces.length,
          storageActionCount: storageNoticeHistory.length,
          hasPhoto: Boolean(reservation.photoUrl),
          notesGeneralPresent: Boolean(trimOrNull(notes.general)),
          createdAt: toIsoString(reservation.createdAt),
          updatedAt: toIsoString(reservation.updatedAt),
        };
      });

      const warnings: string[] = [];
      const readCollectionSafe = async (
        label: string,
        fn: () => Promise<{ docs: Array<{ id: string; data: () => Record<string, unknown> }> }>
      ): Promise<{ docs: Array<{ id: string; data: () => Record<string, unknown> }> } | null> => {
        try {
          return await fn();
        } catch (error: unknown) {
          warnings.push(`${label}: ${safeErrorMessage(error)}`);
          return null;
        }
      };

      const [storageAuditSnap, queueFairnessAuditSnap, notificationSnap] = await Promise.all([
        readCollectionSafe("reservationStorageAudit", () =>
          db
            .collection("reservationStorageAudit")
            .where("uid", "==", targetOwnerUid)
            .limit(Math.min(1000, rowLimit * 4))
            .get()
        ),
        readCollectionSafe("reservationQueueFairnessAudit", () =>
          db
            .collection("reservationQueueFairnessAudit")
            .where("ownerUid", "==", targetOwnerUid)
            .limit(Math.min(1000, rowLimit * 4))
            .get()
        ),
        readCollectionSafe("users.notifications", () =>
          db
            .collection("users")
            .doc(targetOwnerUid)
            .collection("notifications")
            .limit(Math.min(1000, rowLimit * 4))
            .get()
        ),
      ]);

      const storageAuditRows = (storageAuditSnap?.docs ?? []).map((docSnap) => {
        const row = docSnap.data() as Record<string, unknown>;
        return {
          auditId: docSnap.id,
          reservationId: readStringOrNull(row.reservationId),
          action: readStringOrNull(row.action),
          reason: readStringOrNull(row.reason),
          fromStatus: readStringOrNull(row.fromStatus),
          toStatus: readStringOrNull(row.toStatus),
          reminderOrdinal: normalizeNumber(row.reminderOrdinal),
          reminderCount: normalizeNumber(row.reminderCount),
          failureCode: readStringOrNull(row.failureCode),
          requestId: readStringOrNull(row.requestId),
          at: toIsoString(row.at),
          createdAt: toIsoString(row.createdAt),
        };
      });

      const queueFairnessAuditRows = (queueFairnessAuditSnap?.docs ?? []).map((docSnap) => {
        const row = docSnap.data() as Record<string, unknown>;
        const policy = readObjectOrEmpty(row.queueFairnessPolicy);
        return {
          evidenceId: docSnap.id,
          reservationId: readStringOrNull(row.reservationId),
          action: readStringOrNull(row.action),
          reason: readStringOrNull(row.reason),
          actorUid: readStringOrNull(row.actorUid),
          actorRole: readStringOrNull(row.actorRole),
          policyVersion: readStringOrNull(policy.policyVersion),
          effectivePenaltyPoints: normalizeNumber(policy.effectivePenaltyPoints),
          requestId: readStringOrNull(row.requestId),
          createdAt: toIsoString(row.createdAt),
        };
      });

      const notificationRows = (notificationSnap?.docs ?? []).map((docSnap) => {
        const row = docSnap.data() as Record<string, unknown>;
        return {
          notificationId: docSnap.id,
          title: readStringOrNull(row.title),
          body: readStringOrNull(row.body),
          kind: readStringOrNull(row.kind),
          createdAt: toIsoString(row.createdAt),
          readAt: toIsoString(row.readAt),
          status: readStringOrNull(row.status),
        };
      });

      const csvBundle = includeCsv
        ? {
            reservations: buildCsv(
              [
                "reservationId",
                "status",
                "loadStatus",
                "intakeMode",
                "firingType",
                "shelfEquivalent",
                "estimatedHalfShelves",
                "queuePositionHint",
                "queueClass",
                "assignedStationId",
                "pickupWindowStatus",
                "storageStatus",
                "arrivalStatus",
                "stageHistoryCount",
                "pieceRowCount",
                "storageActionCount",
                "hasPhoto",
                "notesGeneralPresent",
                "createdAt",
                "updatedAt",
              ],
              reservationRows
            ),
            stageHistory: buildCsv(
              [
                "reservationId",
                "index",
                "at",
                "fromStage",
                "toStage",
                "fromStatus",
                "toStatus",
                "fromLoadStatus",
                "toLoadStatus",
                "actorUid",
                "actorRole",
                "reason",
                "notes",
              ],
              stageHistoryRows
            ),
            pieces: buildCsv(
              ["reservationId", "index", "pieceId", "pieceLabel", "pieceCount", "pieceStatus", "hasPhoto"],
              pieceRows
            ),
            storageActions: buildCsv(
              [
                "reservationId",
                "index",
                "at",
                "kind",
                "detail",
                "status",
                "reminderOrdinal",
                "reminderCount",
                "failureCode",
              ],
              storageActionRows
            ),
            storageAudit: buildCsv(
              [
                "auditId",
                "reservationId",
                "action",
                "reason",
                "fromStatus",
                "toStatus",
                "reminderOrdinal",
                "reminderCount",
                "failureCode",
                "requestId",
                "at",
                "createdAt",
              ],
              storageAuditRows
            ),
            queueFairnessAudit: buildCsv(
              [
                "evidenceId",
                "reservationId",
                "action",
                "reason",
                "actorUid",
                "actorRole",
                "policyVersion",
                "effectivePenaltyPoints",
                "requestId",
                "createdAt",
              ],
              queueFairnessAuditRows
            ),
            notifications: buildCsv(
              ["notificationId", "title", "body", "kind", "status", "createdAt", "readAt"],
              notificationRows
            ),
          }
        : null;

      const exportGeneratedAt = new Date().toISOString();
      const summary = {
        reservations: reservationRows.length,
        stageHistory: stageHistoryRows.length,
        pieces: pieceRows.length,
        storageActions: storageActionRows.length,
        storageAudit: storageAuditRows.length,
        queueFairnessAudit: queueFairnessAuditRows.length,
        notifications: notificationRows.length,
      };
      const signatureSource = JSON.stringify({
        requestId,
        ownerUid: targetOwnerUid,
        generatedAt: exportGeneratedAt,
        schemaVersion: RESERVATION_CONTINUITY_EXPORT_SCHEMA_VERSION,
        summary,
      });
      const signature = `mfexp_${fnv1a32(signatureSource).toString(16).padStart(8, "0")}`;
      const artifactId = `mf-continuity-${targetOwnerUid}-${exportGeneratedAt
        .replace(/[-:.TZ]/g, "")
        .slice(0, 14)}`;

      jsonOk(res, requestId, {
        exportHeader: {
          artifactId,
          ownerUid: targetOwnerUid,
          generatedAt: exportGeneratedAt,
          schemaVersion: RESERVATION_CONTINUITY_EXPORT_SCHEMA_VERSION,
          format: includeCsv ? ["json", "csv"] : ["json"],
          signature,
          requestId,
        },
        redactionRules: [
          "piecePhotoUrl values are not exported; only hasPhoto flags are included.",
          "reservation notes are summarized as presence flags (notesGeneralPresent).",
          "arrival tokens are not exported.",
        ],
        summary,
        warnings,
        jsonBundle: {
          reservations: reservationRows,
          stageHistory: stageHistoryRows,
          pieces: pieceRows,
          storageActions: storageActionRows,
          storageAudit: storageAuditRows,
          queueFairnessAudit: queueFairnessAuditRows,
          notifications: notificationRows,
        },
        csvBundle,
      });
      return;
    }

    if (route === "/v1/reservations.lookupArrival") {
      const scopeCheck = requireScopes(ctx, ["reservations:read"]);
      if (!scopeCheck.ok) {
        jsonError(res, requestId, 403, "FORBIDDEN", scopeCheck.message);
        return;
      }

      const admin = await requireAdmin(req);
      if (!admin.ok) {
        await logReservationAuditEvent({
          req,
          requestId,
          action: "reservations_lookup_arrival_admin_auth",
          resourceType: "reservation",
          resourceId: route,
          result: "deny",
          reasonCode: admin.code,
          ctx,
        });
        jsonError(res, requestId, admin.httpStatus, admin.code, admin.message);
        return;
      }

      const parsed = parseBody(reservationsLookupArrivalSchema, req.body);
      if (!parsed.ok) {
        jsonError(res, requestId, 400, "INVALID_ARGUMENT", parsed.message);
        return;
      }

      const found = await findReservationByArrivalToken(parsed.data.arrivalToken);
      if (!found) {
        jsonError(res, requestId, 404, "NOT_FOUND", "Reservation not found for arrival token");
        return;
      }

      const { reservationId, row } = found;
      const ownerUid = safeString(row.ownerUid, "");
      if (!ownerUid) {
        jsonError(res, requestId, 500, "INTERNAL", "Reservation missing owner");
        return;
      }

      const reservationAuthz = await assertActorAuthorized({
        req,
        ctx,
        ownerUid,
        scope: "reservations:read",
        resource: `reservation:${reservationId}`,
        allowStaff: true,
      });
      if (!reservationAuthz.ok) {
        await logReservationAuditEvent({
          req,
          requestId,
          action: "reservations_lookup_arrival_authz",
          resourceType: "reservation",
          resourceId: reservationId,
          ownerUid,
          result: "deny",
          reasonCode: reservationAuthz.code,
          ctx,
        });
        jsonError(res, requestId, reservationAuthz.httpStatus, reservationAuthz.code, reservationAuthz.message);
        return;
      }

      const arrivalStatus = safeString(row.arrivalStatus, "").toLowerCase();
      const queuePositionHint = normalizeNumber(row.queuePositionHint);
      const assignedStationId = normalizeStationId(row.assignedStationId);
      const requiredResources = normalizeRequiredResources(row.requiredResources);

      jsonOk(res, requestId, {
        reservation: toReservationRow(reservationId, row),
        outstandingRequirements: {
          needsArrivalCheckIn: arrivalStatus !== "arrived",
          needsStationAssignment: !assignedStationId,
          needsQueuePlacement: typeof queuePositionHint !== "number",
          needsResourceProfile: !requiredResources.kilnProfile,
        },
      });
      return;
    }

    if (route === "/v1/reservations.checkIn") {
      const scopeCheck = requireScopes(ctx, ["reservations:write"]);
      if (!scopeCheck.ok) {
        jsonError(res, requestId, 403, "FORBIDDEN", scopeCheck.message);
        return;
      }

      const parsed = parseBody(reservationsCheckInSchema, req.body);
      if (!parsed.ok) {
        jsonError(res, requestId, 400, "INVALID_ARGUMENT", parsed.message);
        return;
      }

      let reservationId = trimOrNull(parsed.data.reservationId);
      let reservationRef = reservationId ? db.collection("reservations").doc(reservationId) : null;
      let reservationSnap = reservationRef ? await reservationRef.get() : null;

      if (!reservationSnap?.exists) {
        const foundByToken = await findReservationByArrivalToken(parsed.data.arrivalToken ?? "");
        if (!foundByToken) {
          jsonError(res, requestId, 404, "NOT_FOUND", "Reservation not found");
          return;
        }
        reservationId = foundByToken.reservationId;
        reservationRef = db.collection("reservations").doc(reservationId);
        reservationSnap = await reservationRef.get();
      }

      if (!reservationSnap?.exists || !reservationRef || !reservationId) {
        jsonError(res, requestId, 404, "NOT_FOUND", "Reservation not found");
        return;
      }

      const row = reservationSnap.data() as Record<string, unknown>;
      const ownerUid = safeString(row.ownerUid, "");
      if (!ownerUid) {
        jsonError(res, requestId, 500, "INTERNAL", "Reservation missing owner");
        return;
      }

      const reservationAuthz = await assertActorAuthorized({
        req,
        ctx,
        ownerUid,
        scope: "reservations:write",
        resource: `reservation:${reservationId}`,
        allowStaff: true,
      });
      if (!reservationAuthz.ok) {
        await logReservationAuditEvent({
          req,
          requestId,
          action: "reservations_checkin_authz",
          resourceType: "reservation",
          resourceId: reservationId,
          ownerUid,
          result: "deny",
          reasonCode: reservationAuthz.code,
          ctx,
        });
        jsonError(res, requestId, reservationAuthz.httpStatus, reservationAuthz.code, reservationAuthz.message);
        return;
      }

      const status = normalizeReservationStatus(row.status) ?? "REQUESTED";
      if (status === "CANCELLED") {
        jsonError(res, requestId, 409, "CONFLICT", "Reservation is cancelled");
        return;
      }
      if (status !== "CONFIRMED" && status !== "CONFIRMED_ARRIVED" && status !== "LOADED") {
        jsonError(
          res,
          requestId,
          409,
          "CONFLICT",
          "Only confirmed reservations can be checked in."
        );
        return;
      }

      const note = trimOrNull(parsed.data.note);
      const photoUrl = trimOrNull(parsed.data.photoUrl);
      const photoPath = trimOrNull(parsed.data.photoPath);
      if (photoPath && !photoPath.startsWith(`checkins/${ownerUid}/`)) {
        jsonError(res, requestId, 400, "INVALID_ARGUMENT", "Invalid photo path");
        return;
      }

      const admin = await requireAdmin(req);
      const actorRole =
        admin.ok
          ? admin.mode === "staff"
            ? "staff"
            : "dev"
          : ctx.mode === "firebase"
            ? "client"
            : "client";

      const now = nowTs();
      const existingArrivalStatus = safeString(row.arrivalStatus, "").toLowerCase();
      const alreadyArrived = existingArrivalStatus === "arrived";
      const loadStatus = normalizeLoadStatus(row.loadStatus);
      const lifecycleStage = stageForCurrentState(status, loadStatus);
      const stageHistory = normalizeReservationStageHistory(row.stageHistory);
      stageHistory.push({
        fromStatus: status,
        toStatus: status,
        fromLoadStatus: loadStatus,
        toLoadStatus: loadStatus,
        fromStage: lifecycleStage,
        toStage: lifecycleStage,
        at: now,
        actorUid: ctx.uid,
        actorRole,
        reason: parsed.data.arrivalToken ? "arrival_token_checkin" : "arrival_checkin",
        notes: note,
      });

      const existingArrivalChecks = Array.isArray(row.arrivalCheckIns)
        ? row.arrivalCheckIns
        : [];
      const arrivalCheckRecord = {
        at: now,
        byUid: ctx.uid,
        byRole: actorRole,
        via: parsed.data.arrivalToken ? "token" : "reservationId",
        note: note || null,
        photoUrl: photoUrl || null,
        photoPath: photoPath || null,
      };

      await reservationRef.set(
        {
          arrivalStatus: "arrived",
          arrivedAt: row.arrivedAt ?? now,
          arrivalCheckIns: [...existingArrivalChecks, arrivalCheckRecord].slice(-40),
          stageHistory: stageHistory.slice(-120),
          stageStatus: {
            stage: lifecycleStage,
            at: now,
            source: actorRole,
            reason: parsed.data.arrivalToken ? "Arrival via token" : "Arrival check-in",
            notes: note,
            actorUid: ctx.uid,
            actorRole,
          },
          updatedAt: now,
        },
        { merge: true }
      );

      await recomputeQueueHintsForStationSafe(normalizeStationId(row.assignedStationId), "reservations.checkIn");

      jsonOk(res, requestId, {
        reservationId,
        arrivalStatus: "arrived",
        arrivedAt: row.arrivedAt ?? now,
        idempotentReplay: alreadyArrived && !note && !photoUrl && !photoPath,
      });
      return;
    }

    if (route === "/v1/reservations.rotateArrivalToken") {
      const scopeCheck = requireScopes(ctx, ["reservations:write"]);
      if (!scopeCheck.ok) {
        jsonError(res, requestId, 403, "FORBIDDEN", scopeCheck.message);
        return;
      }

      const admin = await requireAdmin(req);
      if (!admin.ok) {
        await logReservationAuditEvent({
          req,
          requestId,
          action: "reservations_rotate_arrival_token_admin_auth",
          resourceType: "reservation",
          resourceId: route,
          result: "deny",
          reasonCode: admin.code,
          ctx,
        });
        jsonError(res, requestId, admin.httpStatus, admin.code, admin.message);
        return;
      }

      const parsed = parseBody(reservationsRotateArrivalTokenSchema, req.body);
      if (!parsed.ok) {
        jsonError(res, requestId, 400, "INVALID_ARGUMENT", parsed.message);
        return;
      }

      const reservationId = parsed.data.reservationId;
      const reservationRef = db.collection("reservations").doc(reservationId);
      const reservationSnap = await reservationRef.get();
      if (!reservationSnap.exists) {
        jsonError(res, requestId, 404, "NOT_FOUND", "Reservation not found");
        return;
      }

      const row = reservationSnap.data() as Record<string, unknown>;
      const ownerUid = safeString(row.ownerUid, "");
      if (!ownerUid) {
        jsonError(res, requestId, 500, "INTERNAL", "Reservation missing owner");
        return;
      }

      const reservationAuthz = await assertActorAuthorized({
        req,
        ctx,
        ownerUid,
        scope: "reservations:write",
        resource: `reservation:${reservationId}`,
        allowStaff: true,
      });
      if (!reservationAuthz.ok) {
        await logReservationAuditEvent({
          req,
          requestId,
          action: "reservations_rotate_arrival_token_authz",
          resourceType: "reservation",
          resourceId: reservationId,
          ownerUid,
          result: "deny",
          reasonCode: reservationAuthz.code,
          ctx,
        });
        jsonError(res, requestId, reservationAuthz.httpStatus, reservationAuthz.code, reservationAuthz.message);
        return;
      }

      const status = normalizeReservationStatus(row.status) ?? "REQUESTED";
      if (status === "CANCELLED") {
        jsonError(res, requestId, 409, "CONFLICT", "Reservation is cancelled");
        return;
      }

      const now = nowTs();
      const currentVersionRaw = normalizeNumber(row.arrivalTokenVersion);
      const currentVersion =
        typeof currentVersionRaw === "number" ? Math.max(0, Math.trunc(currentVersionRaw)) : 0;
      const nextVersion = currentVersion + 1;
      const nextToken = makeDeterministicArrivalToken(reservationId, nextVersion);
      const nextLookup = normalizeArrivalTokenLookup(nextToken);
      const nextExpiry = Timestamp.fromDate(resolveArrivalTokenExpiryDate(row, new Date()));
      const reason = trimOrNull(parsed.data.reason) || "Arrival token reissued";
      const actorRole = admin.mode === "staff" ? "staff" : "dev";
      const loadStatus = normalizeLoadStatus(row.loadStatus);
      const lifecycleStage = stageForCurrentState(status, loadStatus);
      const stageHistory = normalizeReservationStageHistory(row.stageHistory);
      stageHistory.push({
        fromStatus: status,
        toStatus: status,
        fromLoadStatus: loadStatus,
        toLoadStatus: loadStatus,
        fromStage: lifecycleStage,
        toStage: lifecycleStage,
        at: now,
        actorUid: ctx.uid,
        actorRole,
        reason: "arrival_token_rotated",
        notes: reason,
      });

      await reservationRef.set(
        {
          arrivalStatus: safeString(row.arrivalStatus, "").toLowerCase() === "arrived" ? "arrived" : "expected",
          arrivalToken: nextToken,
          arrivalTokenLookup: nextLookup,
          arrivalTokenIssuedAt: now,
          arrivalTokenExpiresAt: nextExpiry,
          arrivalTokenVersion: nextVersion,
          stageHistory: stageHistory.slice(-120),
          stageStatus: {
            stage: lifecycleStage,
            at: now,
            source: actorRole,
            reason: "Arrival token rotated",
            notes: reason,
            actorUid: ctx.uid,
            actorRole,
          },
          updatedAt: now,
        },
        { merge: true }
      );

      jsonOk(res, requestId, {
        reservationId,
        arrivalToken: nextToken,
        arrivalTokenExpiresAt: nextExpiry,
        arrivalTokenVersion: nextVersion,
      });
      return;
    }

    if (route === "/v1/reservations.pickupWindow") {
      const scopeCheck = requireScopes(ctx, ["reservations:write"]);
      if (!scopeCheck.ok) {
        jsonError(res, requestId, 403, "FORBIDDEN", scopeCheck.message);
        return;
      }

      const parsed = parseBody(reservationsPickupWindowSchema, req.body);
      if (!parsed.ok) {
        jsonError(res, requestId, 400, "INVALID_ARGUMENT", parsed.message);
        return;
      }

      const action = parsed.data.action;
      const staffOnlyAction =
        action === "staff_set_open_window" ||
        action === "staff_mark_missed" ||
        action === "staff_mark_completed";

      const reservationId = parsed.data.reservationId;
      const reservationRef = db.collection("reservations").doc(reservationId);
      const reservationSnap = await reservationRef.get();
      if (!reservationSnap.exists) {
        jsonError(res, requestId, 404, "NOT_FOUND", "Reservation not found");
        return;
      }

      const row = reservationSnap.data() as Record<string, unknown>;
      const ownerUid = safeString(row.ownerUid, "");
      if (!ownerUid) {
        jsonError(res, requestId, 500, "INTERNAL", "Reservation missing owner");
        return;
      }

      const admin = await requireAdmin(req);
      if (staffOnlyAction && !admin.ok) {
        await logReservationAuditEvent({
          req,
          requestId,
          action: "reservations_pickup_window_admin_auth",
          resourceType: "reservation",
          resourceId: reservationId,
          ownerUid,
          result: "deny",
          reasonCode: admin.code,
          ctx,
          metadata: {
            pickupWindowAction: action,
          },
        });
        jsonError(res, requestId, admin.httpStatus, admin.code, admin.message);
        return;
      }

      const reservationAuthz = await assertActorAuthorized({
        req,
        ctx,
        ownerUid,
        scope: "reservations:write",
        resource: `reservation:${reservationId}`,
        allowStaff: true,
      });
      if (!reservationAuthz.ok) {
        await logReservationAuditEvent({
          req,
          requestId,
          action: "reservations_pickup_window_authz",
          resourceType: "reservation",
          resourceId: reservationId,
          ownerUid,
          result: "deny",
          reasonCode: reservationAuthz.code,
          ctx,
          metadata: {
            pickupWindowAction: action,
          },
        });
        jsonError(res, requestId, reservationAuthz.httpStatus, reservationAuthz.code, reservationAuthz.message);
        return;
      }

      if (!staffOnlyAction && !admin.ok && ctx.uid !== ownerUid) {
        await logReservationAuditEvent({
          req,
          requestId,
          action: "reservations_pickup_window_owner_required",
          resourceType: "reservation",
          resourceId: reservationId,
          ownerUid,
          result: "deny",
          reasonCode: "FORBIDDEN",
          ctx,
          metadata: {
            pickupWindowAction: action,
          },
        });
        jsonError(res, requestId, 403, "FORBIDDEN", "Only the reservation owner can perform this action.");
        return;
      }

      try {
        const now = nowTs();
        const nowDate = now.toDate();
        const actorRole =
          admin.ok
            ? admin.mode === "staff"
              ? "staff"
              : "dev"
            : "client";
        const note = trimOrNull(parsed.data.note);
        const force = parsed.data.force === true;

        const out = await db.runTransaction(async (tx) => {
          const snap = await tx.get(reservationRef);
          if (!snap.exists) {
            throw new Error("RESERVATION_NOT_FOUND");
          }
          const row = snap.data() as Record<string, unknown>;
          const status = normalizeReservationStatus(row.status) ?? "REQUESTED";
          const loadStatus = normalizeLoadStatus(row.loadStatus);
          if (status === "CANCELLED") {
            throw new Error("RESERVATION_CANCELLED");
          }
          if (loadStatus !== "loaded" && !force) {
            throw new Error("PICKUP_WINDOW_REQUIRES_LOADED");
          }

          const pickupWindow = normalizeReservationPickupWindow(row.pickupWindow);
          const storageHistory = normalizeReservationStorageNoticeHistory(row.storageNoticeHistory);
          const updates: Record<string, unknown> = { updatedAt: now };
          let storageHistoryNext = [...storageHistory];
          let storageStatus = normalizeReservationStorageStatus(row.storageStatus) ?? "active";
          let transitionReason = "";
          let idempotentReplay = false;

          const ensureWindowRange = (startDate: Date | null, endDate: Date | null) => {
            if (!startDate || !endDate || endDate.getTime() <= startDate.getTime()) {
              throw new Error("INVALID_PICKUP_WINDOW_RANGE");
            }
          };

          const storageNotice = (kind: string, detail: string, statusOverride?: ReservationStorageStatus | null) => {
            storageHistoryNext = pushReservationStorageNotice(storageHistoryNext, {
              at: now,
              kind,
              detail,
              status: statusOverride ?? storageStatus,
              reminderOrdinal: null,
              reminderCount: null,
              failureCode: null,
            });
          };

          if (action === "staff_set_open_window") {
            const confirmedStart = parseReservationIsoDate(parsed.data.confirmedStart);
            const confirmedEnd = parseReservationIsoDate(parsed.data.confirmedEnd);
            ensureWindowRange(confirmedStart, confirmedEnd);

            const wasOpen =
              pickupWindow.status === "open" &&
              pickupWindow.confirmedStart?.getTime() === confirmedStart?.getTime() &&
              pickupWindow.confirmedEnd?.getTime() === confirmedEnd?.getTime();
            if (wasOpen) {
              idempotentReplay = true;
            } else {
              pickupWindow.confirmedStart = confirmedStart;
              pickupWindow.confirmedEnd = confirmedEnd;
              pickupWindow.requestedStart = pickupWindow.requestedStart ?? confirmedStart;
              pickupWindow.requestedEnd = pickupWindow.requestedEnd ?? confirmedEnd;
              pickupWindow.status = "open";
              pickupWindow.confirmedAt = null;
              pickupWindow.completedAt = null;
              transitionReason = "pickup_window_opened";
              storageNotice(
                "pickup_window_opened",
                "Pickup window is available. Please confirm a pickup slot."
              );
            }
          } else if (action === "member_confirm_window") {
            if (pickupWindow.status !== "open" && !force) {
              throw new Error("PICKUP_WINDOW_NOT_OPEN");
            }
            ensureWindowRange(pickupWindow.confirmedStart, pickupWindow.confirmedEnd);
            if (!force && pickupWindow.confirmedEnd && pickupWindow.confirmedEnd.getTime() < nowDate.getTime()) {
              pickupWindow.status = "expired";
              storageNotice(
                "pickup_window_expired",
                "Pickup window expired before confirmation."
              );
              throw new Error("PICKUP_WINDOW_EXPIRED");
            }

            pickupWindow.status = "confirmed";
            pickupWindow.confirmedAt = nowDate;
            transitionReason = "pickup_window_confirmed";
            storageNotice(
              "pickup_window_confirmed",
              "Pickup window confirmed by member."
            );
          } else if (action === "member_request_reschedule") {
            const priorRescheduleEvents = storageHistoryNext.filter(
              (entry) => entry.kind === "pickup_window_reschedule_requested"
            ).length;
            const effectiveRescheduleCount = Math.max(
              pickupWindow.rescheduleCount,
              priorRescheduleEvents
            );
            if (effectiveRescheduleCount >= 1 && !force) {
              throw new Error("PICKUP_WINDOW_RESCHEDULE_LIMIT");
            }
            const requestedStart = parseReservationIsoDate(parsed.data.requestedStart);
            const requestedEnd = parseReservationIsoDate(parsed.data.requestedEnd);
            ensureWindowRange(requestedStart, requestedEnd);

            pickupWindow.requestedStart = requestedStart;
            pickupWindow.requestedEnd = requestedEnd;
            pickupWindow.confirmedStart = null;
            pickupWindow.confirmedEnd = null;
            pickupWindow.confirmedAt = null;
            pickupWindow.status = "open";
            pickupWindow.rescheduleCount = effectiveRescheduleCount + 1;
            pickupWindow.lastRescheduleRequestedAt = nowDate;
            transitionReason = "pickup_window_reschedule_requested";
            storageNotice(
              "pickup_window_reschedule_requested",
              "Member requested one pickup-window reschedule."
            );
          } else if (action === "staff_mark_missed") {
            if (
              !force &&
              pickupWindow.confirmedEnd &&
              pickupWindow.confirmedEnd.getTime() > nowDate.getTime()
            ) {
              throw new Error("PICKUP_WINDOW_NOT_ELAPSED");
            }
            pickupWindow.status = "missed";
            pickupWindow.missedCount += 1;
            pickupWindow.lastMissedAt = nowDate;
            pickupWindow.confirmedAt = null;
            transitionReason = "pickup_window_missed";

            if (pickupWindow.missedCount >= 2) {
              storageStatus = "stored_by_policy";
              updates.storageStatus = storageStatus;
              storageNotice(
                "stored_by_policy",
                "Reservation exceeded pickup-window misses and moved to stored-by-policy.",
                storageStatus
              );
            } else {
              storageStatus = "hold_pending";
              updates.storageStatus = storageStatus;
              storageNotice(
                "pickup_window_missed",
                "Pickup window was missed. Reservation moved to hold-pending for follow-up.",
                storageStatus
              );
            }
          } else if (action === "staff_mark_completed") {
            pickupWindow.status = "completed";
            pickupWindow.completedAt = nowDate;
            pickupWindow.confirmedAt = pickupWindow.confirmedAt ?? nowDate;
            transitionReason = "pickup_window_completed";
            storageStatus = "active";
            updates.storageStatus = storageStatus;
            updates.readyForPickupAt = null;
            updates.pickupReminderCount = 0;
            updates.lastReminderAt = null;
            updates.pickupReminderFailureCount = 0;
            updates.lastReminderFailureAt = null;
            storageNotice(
              "pickup_window_completed",
              "Pickup completed and storage reminder counters reset.",
              storageStatus
            );
          } else {
            throw new Error("UNSUPPORTED_PICKUP_WINDOW_ACTION");
          }

          if (!transitionReason) {
            transitionReason = "pickup_window_updated";
          }

          const history = normalizeReservationStageHistory(row.stageHistory);
          const lifecycleStage = stageForCurrentState(status, loadStatus);
          history.push({
            fromStatus: status,
            toStatus: status,
            fromLoadStatus: loadStatus,
            toLoadStatus: loadStatus,
            fromStage: lifecycleStage,
            toStage: lifecycleStage,
            at: now,
            actorUid: ctx.uid,
            actorRole,
            reason: transitionReason,
            notes: note,
          });
          updates.stageHistory = history.slice(-120);
          updates.stageStatus = {
            stage: lifecycleStage,
            at: now,
            source: actorRole,
            reason: transitionReason,
            notes: note,
            actorUid: ctx.uid,
            actorRole,
          };
          updates.pickupWindow = toPickupWindowWrite(pickupWindow);
          updates.storageNoticeHistory = storageHistoryNext.slice(-80);

          tx.set(reservationRef, updates, { merge: true });
          return {
            reservationId,
            pickupWindow,
            storageStatus,
            idempotentReplay,
          };
        });

        jsonOk(res, requestId, {
          reservationId: out.reservationId,
          pickupWindowStatus: out.pickupWindow.status,
          pickupWindow: {
            requestedStart: out.pickupWindow.requestedStart,
            requestedEnd: out.pickupWindow.requestedEnd,
            confirmedStart: out.pickupWindow.confirmedStart,
            confirmedEnd: out.pickupWindow.confirmedEnd,
            status: out.pickupWindow.status,
            confirmedAt: out.pickupWindow.confirmedAt,
            completedAt: out.pickupWindow.completedAt,
            missedCount: out.pickupWindow.missedCount,
            rescheduleCount: out.pickupWindow.rescheduleCount,
            lastMissedAt: out.pickupWindow.lastMissedAt,
            lastRescheduleRequestedAt: out.pickupWindow.lastRescheduleRequestedAt,
          },
          storageStatus: out.storageStatus,
          idempotentReplay: out.idempotentReplay,
        });
      } catch (error: unknown) {
        const message = safeErrorMessage(error);
        if (message === "RESERVATION_NOT_FOUND") {
          jsonError(res, requestId, 404, "NOT_FOUND", "Reservation not found");
          return;
        }
        if (message === "RESERVATION_CANCELLED") {
          jsonError(res, requestId, 409, "CONFLICT", "Reservation is cancelled");
          return;
        }
        if (message === "PICKUP_WINDOW_REQUIRES_LOADED") {
          jsonError(
            res,
            requestId,
            409,
            "CONFLICT",
            "Reservation must be loaded before pickup window actions."
          );
          return;
        }
        if (message === "INVALID_PICKUP_WINDOW_RANGE") {
          jsonError(
            res,
            requestId,
            400,
            "INVALID_ARGUMENT",
            "Pickup window requires a valid start/end range."
          );
          return;
        }
        if (message === "PICKUP_WINDOW_NOT_OPEN") {
          jsonError(res, requestId, 409, "CONFLICT", "Pickup window is not open for confirmation.");
          return;
        }
        if (message === "PICKUP_WINDOW_EXPIRED") {
          jsonError(res, requestId, 409, "CONFLICT", "Pickup window has already expired.");
          return;
        }
        if (message === "PICKUP_WINDOW_RESCHEDULE_LIMIT") {
          jsonError(
            res,
            requestId,
            409,
            "CONFLICT",
            "Reschedule request limit reached for this reservation."
          );
          return;
        }
        if (message === "PICKUP_WINDOW_NOT_ELAPSED") {
          jsonError(
            res,
            requestId,
            409,
            "CONFLICT",
            "Pickup window has not elapsed yet. Use force=true for manual override."
          );
          return;
        }
        if (message === "UNSUPPORTED_PICKUP_WINDOW_ACTION") {
          jsonError(res, requestId, 400, "INVALID_ARGUMENT", "Unsupported pickup-window action.");
          return;
        }
        throw error;
      }
      return;
    }

    if (route === "/v1/reservations.queueFairness") {
      const scopeCheck = requireScopes(ctx, ["reservations:write"]);
      if (!scopeCheck.ok) {
        jsonError(res, requestId, 403, "FORBIDDEN", scopeCheck.message);
        return;
      }

      const parsed = parseBody(reservationsQueueFairnessSchema, req.body);
      if (!parsed.ok) {
        jsonError(res, requestId, 400, "INVALID_ARGUMENT", parsed.message);
        return;
      }

      const reservationId = parsed.data.reservationId;
      const action = parsed.data.action;
      const reason = trimOrNull(parsed.data.reason);

      const admin = await requireAdmin(req);
      if (!admin.ok) {
        await logReservationAuditEvent({
          req,
          requestId,
          action: "reservations_queue_fairness_admin_auth",
          resourceType: "reservation",
          resourceId: reservationId,
          result: "deny",
          reasonCode: admin.code,
          ctx,
          metadata: {
            fairnessAction: action,
          },
        });
        jsonError(res, requestId, admin.httpStatus, admin.code, admin.message);
        return;
      }

      const reservationRef = db.collection("reservations").doc(reservationId);
      const reservationSnap = await reservationRef.get();
      if (!reservationSnap.exists) {
        jsonError(res, requestId, 404, "NOT_FOUND", "Reservation not found");
        return;
      }

      const existing = reservationSnap.data() as Record<string, unknown>;
      const ownerUid = safeString(existing.ownerUid, "");
      if (!ownerUid) {
        jsonError(res, requestId, 500, "INTERNAL", "Reservation missing owner");
        return;
      }

      const reservationAuthz = await assertActorAuthorized({
        req,
        ctx,
        ownerUid,
        scope: "reservations:write",
        resource: `reservation:${reservationId}`,
        allowStaff: true,
      });
      if (!reservationAuthz.ok) {
        await logReservationAuditEvent({
          req,
          requestId,
          action: "reservations_queue_fairness_authz",
          resourceType: "reservation",
          resourceId: reservationId,
          ownerUid,
          result: "deny",
          reasonCode: reservationAuthz.code,
          ctx,
          metadata: {
            fairnessAction: action,
          },
        });
        jsonError(res, requestId, reservationAuthz.httpStatus, reservationAuthz.code, reservationAuthz.message);
        return;
      }

      try {
        const now = nowTs();
        const nowDate = now.toDate();
        const actorRole = admin.mode === "staff" ? "staff" : "dev";

        const out = await db.runTransaction(async (tx) => {
          const snap = await tx.get(reservationRef);
          if (!snap.exists) {
            throw new Error("RESERVATION_NOT_FOUND");
          }
          const row = snap.data() as Record<string, unknown>;
          const status = normalizeReservationStatus(row.status) ?? "REQUESTED";
          const loadStatus = normalizeLoadStatus(row.loadStatus);
          if (status === "CANCELLED") {
            throw new Error("RESERVATION_CANCELLED");
          }

          const queueFairness = normalizeReservationQueueFairness(row.queueFairness);
          const previousQueueFairness =
            row.queueFairness && typeof row.queueFairness === "object"
              ? (row.queueFairness as Record<string, unknown>)
              : null;
          let transitionReason = "";

          if (action === "record_no_show") {
            queueFairness.noShowCount += 1;
            transitionReason = "queue_fairness_no_show_recorded";
          } else if (action === "record_late_arrival") {
            queueFairness.lateArrivalCount += 1;
            transitionReason = "queue_fairness_late_arrival_recorded";
          } else if (action === "set_override_boost") {
            const boostPoints = clampNumber(Math.round(parsed.data.boostPoints ?? 0), 0, 20);
            const overrideUntil = parseReservationIsoDate(parsed.data.overrideUntil);
            if (parsed.data.overrideUntil != null && !overrideUntil) {
              throw new Error("INVALID_OVERRIDE_UNTIL");
            }
            queueFairness.overrideBoost = boostPoints;
            queueFairness.overrideReason = reason;
            queueFairness.overrideUntil = overrideUntil;
            transitionReason = "queue_fairness_override_set";
          } else if (action === "clear_override") {
            queueFairness.overrideBoost = 0;
            queueFairness.overrideReason = null;
            queueFairness.overrideUntil = null;
            transitionReason = "queue_fairness_override_cleared";
          } else {
            throw new Error("UNSUPPORTED_QUEUE_FAIRNESS_ACTION");
          }

          queueFairness.updatedAt = nowDate;
          queueFairness.updatedByUid = ctx.uid;
          queueFairness.updatedByRole = actorRole;
          queueFairness.lastPolicyNote = reason;

          const fairnessWrite = toReservationQueueFairnessWrite(queueFairness);
          const fairnessPolicy = buildReservationQueueFairnessPolicy(
            {
              ...row,
              queueFairness: queueFairness,
            },
            nowDate.getTime()
          );
          const fairnessPolicyWrite = {
            ...fairnessPolicy,
            computedAt: now,
          };

          const lifecycleStage = stageForCurrentState(status, loadStatus);
          const stageHistory = normalizeReservationStageHistory(row.stageHistory);
          stageHistory.push({
            fromStatus: status,
            toStatus: status,
            fromLoadStatus: loadStatus,
            toLoadStatus: loadStatus,
            fromStage: lifecycleStage,
            toStage: lifecycleStage,
            at: now,
            actorUid: ctx.uid,
            actorRole,
            reason: transitionReason,
            notes: reason,
          });

          const fairnessStaffNote = `[fairness:${action}] ${reason ?? "policy action recorded"}`;
          const existingStaffNotes = trimOrNull(row.staffNotes);
          const combinedStaffNotes = existingStaffNotes
            ? `${existingStaffNotes}\n${fairnessStaffNote}`
            : fairnessStaffNote;

          const evidenceId = makeIdempotencyId(
            "reservation-fairness",
            reservationId,
            `${action}:${requestId}`
          );

          tx.set(
            reservationRef,
            {
              queueFairness: fairnessWrite,
              queueFairnessPolicy: fairnessPolicyWrite,
              stageHistory: stageHistory.slice(-120),
              stageStatus: {
                stage: lifecycleStage,
                at: now,
                source: actorRole,
                reason: transitionReason,
                notes: reason,
                actorUid: ctx.uid,
                actorRole,
              },
              staffNotes: combinedStaffNotes.slice(-1500),
              updatedAt: now,
            },
            { merge: true }
          );
          tx.set(
            db.collection("reservationQueueFairnessAudit").doc(evidenceId),
            {
              reservationId,
              ownerUid,
              action,
              reason,
              actorUid: ctx.uid,
              actorRole,
              route,
              requestId,
              createdAt: now,
              queueFairness: fairnessWrite,
              queueFairnessPolicy: fairnessPolicyWrite,
              previousQueueFairness,
            },
            { merge: true }
          );

          return {
            reservationId,
            assignedStationId: normalizeStationId(row.assignedStationId),
            action,
            evidenceId,
            queueFairness,
            queueFairnessPolicy: fairnessPolicyWrite,
          };
        });

        await recomputeQueueHintsForStationSafe(
          out.assignedStationId,
          "reservations.queueFairness"
        );

        jsonOk(res, requestId, {
          reservationId: out.reservationId,
          action: out.action,
          evidenceId: out.evidenceId,
          queueFairness: {
            noShowCount: out.queueFairness.noShowCount,
            lateArrivalCount: out.queueFairness.lateArrivalCount,
            overrideBoost: out.queueFairness.overrideBoost,
            overrideReason: out.queueFairness.overrideReason,
            overrideUntil: out.queueFairness.overrideUntil,
            updatedAt: out.queueFairness.updatedAt,
            updatedByUid: out.queueFairness.updatedByUid,
            updatedByRole: out.queueFairness.updatedByRole,
            lastPolicyNote: out.queueFairness.lastPolicyNote,
          },
          queueFairnessPolicy: {
            noShowCount: out.queueFairnessPolicy.noShowCount,
            lateArrivalCount: out.queueFairnessPolicy.lateArrivalCount,
            penaltyPoints: out.queueFairnessPolicy.penaltyPoints,
            effectivePenaltyPoints: out.queueFairnessPolicy.effectivePenaltyPoints,
            overrideBoostApplied: out.queueFairnessPolicy.overrideBoostApplied,
            reasonCodes: out.queueFairnessPolicy.reasonCodes,
            policyVersion: out.queueFairnessPolicy.policyVersion,
            computedAt: out.queueFairnessPolicy.computedAt,
          },
        });
      } catch (error: unknown) {
        const message = safeErrorMessage(error);
        if (message === "RESERVATION_NOT_FOUND") {
          jsonError(res, requestId, 404, "NOT_FOUND", "Reservation not found");
          return;
        }
        if (message === "RESERVATION_CANCELLED") {
          jsonError(res, requestId, 409, "CONFLICT", "Reservation is cancelled");
          return;
        }
        if (message === "INVALID_OVERRIDE_UNTIL") {
          jsonError(
            res,
            requestId,
            400,
            "INVALID_ARGUMENT",
            "overrideUntil must be a valid date/time."
          );
          return;
        }
        if (message === "UNSUPPORTED_QUEUE_FAIRNESS_ACTION") {
          jsonError(res, requestId, 400, "INVALID_ARGUMENT", "Unsupported queue fairness action.");
          return;
        }
        throw error;
      }
      return;
    }

    if (route === "/v1/reservations.update") {
      const scopeCheck = requireScopes(ctx, ["reservations:write"]);
      if (!scopeCheck.ok) {
        jsonError(res, requestId, 403, "FORBIDDEN", scopeCheck.message);
        return;
      }

      const admin = await requireAdmin(req);
      if (!admin.ok) {
        await logReservationAuditEvent({
          req,
          requestId,
          action: "reservations_update_admin_auth",
          resourceType: "reservation",
          resourceId: route,
          result: "deny",
          reasonCode: admin.code,
          ctx,
        });
        jsonError(res, requestId, admin.httpStatus, admin.code, admin.message);
        return;
      }

      const parsed = parseBody(reservationUpdateSchema, req.body);
      if (!parsed.ok) {
        jsonError(res, requestId, 400, "INVALID_ARGUMENT", parsed.message);
        return;
      }

      const reservationId = parsed.data.reservationId;
      const reservationRef = db.collection("reservations").doc(reservationId);
      const reservationSnap = await reservationRef.get();
      if (!reservationSnap.exists) {
        jsonError(res, requestId, 404, "NOT_FOUND", "Reservation not found");
        return;
      }

      const row = reservationSnap.data() as Record<string, unknown>;
      const ownerUid = safeString(row.ownerUid, "");
      if (!ownerUid) {
        jsonError(res, requestId, 500, "INTERNAL", "Reservation missing owner");
        return;
      }

      const reservationAuthz = await assertActorAuthorized({
        req,
        ctx,
        ownerUid,
        scope: "reservations:write",
        resource: `reservation:${reservationId}`,
        allowStaff: true,
      });
      if (!reservationAuthz.ok) {
        await logReservationAuditEvent({
          req,
          requestId,
          action: "reservations_update_authz",
          resourceType: "reservation",
          resourceId: reservationId,
          ownerUid,
          result: "deny",
          reasonCode: reservationAuthz.code,
          ctx,
        });
        jsonError(res, requestId, reservationAuthz.httpStatus, reservationAuthz.code, reservationAuthz.message);
        return;
      }

      try {
        const now = nowTs();
        const actorRole = admin.mode === "staff" ? "staff" : "dev";

        const out = await db.runTransaction(async (tx) => {
          const snap = await tx.get(reservationRef);
          if (!snap.exists) {
            throw new Error("RESERVATION_NOT_FOUND");
          }

          const row = snap.data() as Record<string, unknown>;
          const existingStatus = normalizeReservationStatus(row.status) ?? "REQUESTED";
          const existingLoadStatus = normalizeLoadStatus(row.loadStatus);
          const assignedStationId = normalizeStationId(row.assignedStationId);
          const requestedStatus = parsed.data.status ?? existingStatus;
          const requestedLoadStatus = normalizeLoadStatus(parsed.data.loadStatus) ?? existingLoadStatus;
          const requestedNotes = parsed.data.staffNotes;
          const currentArrivalToken = safeString(row.arrivalToken) || null;
          const currentArrivalTokenVersionRaw = normalizeNumber(row.arrivalTokenVersion);
          const currentArrivalTokenVersion =
            typeof currentArrivalTokenVersionRaw === "number"
              ? Math.max(0, Math.trunc(currentArrivalTokenVersionRaw))
              : 0;

          const statusProvided = parsed.data.status != null;
          const loadProvided = parsed.data.loadStatus != null;
          const notesProvided = requestedNotes != null;

          if (!statusProvided && !loadProvided && !notesProvided) {
            throw new Error("NO_UPDATES");
          }

          if (statusProvided && !parsed.data.force) {
            const allowed = ALLOWED_STATUS_TRANSITIONS.get(existingStatus) ?? new Set([]);
            if (!allowed.has(requestedStatus)) {
              throw new Error(`INVALID_STATUS_TRANSITION:${existingStatus}->${requestedStatus}`);
            }
          }

          const update: Record<string, unknown> = { updatedAt: now };
          const nextStatus = statusProvided ? requestedStatus : existingStatus;
          const nextLoadStatus = loadProvided ? requestedLoadStatus : existingLoadStatus;
          let nextArrivalToken = currentArrivalToken;
          let nextArrivalTokenExpiresAt: Timestamp | null = null;

          if (statusProvided) {
            update.status = nextStatus;
          }

          if (statusProvided && nextStatus === "CONFIRMED") {
            const shouldIssueArrivalToken =
              existingStatus !== "CONFIRMED" || !currentArrivalToken;
            if (shouldIssueArrivalToken) {
              const nextArrivalTokenVersion = currentArrivalTokenVersion + 1;
              const issuedToken = makeDeterministicArrivalToken(reservationId, nextArrivalTokenVersion);
              const tokenLookup = normalizeArrivalTokenLookup(issuedToken);
              const expiryDate = resolveArrivalTokenExpiryDate(row, new Date());
              nextArrivalToken = issuedToken;
              nextArrivalTokenExpiresAt = Timestamp.fromDate(expiryDate);
              update.arrivalStatus = "expected";
              update.arrivedAt = null;
              update.arrivalToken = issuedToken;
              update.arrivalTokenLookup = tokenLookup;
              update.arrivalTokenIssuedAt = now;
              update.arrivalTokenExpiresAt = nextArrivalTokenExpiresAt;
              update.arrivalTokenVersion = nextArrivalTokenVersion;
            }
          }

          if (loadProvided) {
            update.loadStatus = nextLoadStatus;
            if (nextLoadStatus === "loaded" && existingLoadStatus !== "loaded") {
              const storageHistory = normalizeReservationStorageNoticeHistory(row.storageNoticeHistory);
              storageHistory.push({
                at: now,
                kind: "pickup_ready",
                detail: "Reservation load completed and pickup policy timer started.",
                status: "active",
                reminderOrdinal: null,
                reminderCount: 0,
                failureCode: null,
              });
              update.readyForPickupAt = now;
              update.storageStatus = "active";
              update.pickupReminderCount = 0;
              update.lastReminderAt = null;
              update.pickupReminderFailureCount = 0;
              update.lastReminderFailureAt = null;
              update.storageNoticeHistory = storageHistory.slice(-80);

              const pickupWindow = normalizeReservationPickupWindow(row.pickupWindow);
              if (!pickupWindow.status || pickupWindow.status === "expired" || pickupWindow.status === "missed") {
                pickupWindow.status = "open";
              }
              if (!pickupWindow.confirmedStart && pickupWindow.requestedStart) {
                pickupWindow.confirmedStart = pickupWindow.requestedStart;
              }
              if (!pickupWindow.confirmedEnd && pickupWindow.requestedEnd) {
                pickupWindow.confirmedEnd = pickupWindow.requestedEnd;
              }
              update.pickupWindow = toPickupWindowWrite(pickupWindow);
            }
          }

          if (notesProvided) {
            const notesTrimmed = trimOrNull(requestedNotes);
            update.staffNotes = notesTrimmed || null;
          }

          if (statusProvided || loadProvided || notesProvided) {
            const fromStage = stageForCurrentState(existingStatus, existingLoadStatus);
            const toStage = stageForCurrentState(nextStatus, nextLoadStatus);
            const history = normalizeReservationStageHistory(row.stageHistory);
            const notesTrimmed = notesProvided ? trimOrNull(requestedNotes) : null;
            const reason = statusProvided
              ? `status:${existingStatus}->${requestedStatus}`
              : makeLoadStatusReason(existingLoadStatus, nextLoadStatus);

            history.push({
              fromStatus: existingStatus,
              toStatus: nextStatus,
              fromLoadStatus: existingLoadStatus,
              toLoadStatus: nextLoadStatus,
              fromStage,
              toStage,
              at: now,
              actorUid: ctx.uid,
              actorRole,
              reason,
              notes: notesTrimmed,
            });

            update.stageHistory = history.slice(-120);
            update.stageStatus = {
              stage: toStage,
              at: now,
              source: actorRole,
              reason,
              notes: notesTrimmed,
              actorUid: ctx.uid,
              actorRole,
            };
          }

          tx.set(reservationRef, update, { merge: true });
          return {
            reservationId,
            status: requestedStatus,
            loadStatus: nextLoadStatus,
            assignedStationId,
            arrivalToken: nextArrivalToken,
            arrivalTokenExpiresAt: nextArrivalTokenExpiresAt,
            idempotentReplay: false,
          };
        });

        await recomputeQueueHintsForStationSafe(out.assignedStationId, "reservations.update");

        jsonOk(res, requestId, {
          reservationId: out.reservationId,
          status: out.status,
          loadStatus: out.loadStatus,
          arrivalToken: out.arrivalToken,
          arrivalTokenExpiresAt: out.arrivalTokenExpiresAt,
          idempotentReplay: out.idempotentReplay,
        });
      } catch (error: unknown) {
        const message = safeErrorMessage(error);
        if (message.startsWith("INVALID_STATUS_TRANSITION")) {
          jsonError(
            res,
            requestId,
            409,
            "CONFLICT",
            "Requested status transition is not permitted"
          );
          return;
        }
        if (message === "NO_UPDATES") {
          jsonError(res, requestId, 400, "INVALID_ARGUMENT", "No updates provided");
          return;
        }
        if (message === "RESERVATION_NOT_FOUND") {
          jsonError(res, requestId, 404, "NOT_FOUND", "Reservation not found");
          return;
        }
        throw error;
      }
      return;
    }

    if (route === "/v1/reservations.assignStation") {
      const scopeCheck = requireScopes(ctx, ["reservations:write"]);
      if (!scopeCheck.ok) {
        jsonError(res, requestId, 403, "FORBIDDEN", scopeCheck.message);
        return;
      }

      const admin = await requireAdmin(req);
      if (!admin.ok) {
        await logReservationAuditEvent({
          req,
          requestId,
          action: "reservations_assign_station_admin_auth",
          resourceType: "reservation",
          resourceId: route,
          result: "deny",
          reasonCode: admin.code,
          ctx,
        });
        jsonError(res, requestId, admin.httpStatus, admin.code, admin.message);
        return;
      }

      const parsed = parseBody(reservationsAssignStationSchema, req.body);
      if (!parsed.ok) {
        jsonError(res, requestId, 400, "INVALID_ARGUMENT", parsed.message);
        return;
      }

      const reservationId = parsed.data.reservationId;
      const reservationRef = db.collection("reservations").doc(reservationId);
      const reservationSnap = await reservationRef.get();
      if (!reservationSnap.exists) {
        jsonError(res, requestId, 404, "NOT_FOUND", "Reservation not found");
        return;
      }

      const existing = reservationSnap.data() as Record<string, unknown>;
      const ownerUid = safeString(existing.ownerUid, "");
      if (!ownerUid) {
        jsonError(res, requestId, 500, "INTERNAL", "Reservation missing owner");
        return;
      }

      const reservationAuthz = await assertActorAuthorized({
        req,
        ctx,
        ownerUid,
        scope: "reservations:write",
        resource: `reservation:${reservationId}`,
        allowStaff: true,
      });
      if (!reservationAuthz.ok) {
        await logReservationAuditEvent({
          req,
          requestId,
          action: "reservations_assign_authz",
          resourceType: "reservation",
          resourceId: reservationId,
          ownerUid,
          result: "deny",
          reasonCode: reservationAuthz.code,
          ctx,
        });
        jsonError(res, requestId, reservationAuthz.httpStatus, reservationAuthz.code, reservationAuthz.message);
        return;
      }

      try {
        const now = nowTs();
        const actorRole = admin.mode === "staff" ? "staff" : "dev";
        const assignedStationId = normalizeStationId(parsed.data.assignedStationId);

        if (!assignedStationId || !isValidStation(assignedStationId)) {
          jsonError(res, requestId, 400, "INVALID_ARGUMENT", "Unknown station id.");
          return;
        }

        const out = await db.runTransaction(async (tx) => {
          const snap = await tx.get(reservationRef);
          if (!snap.exists) {
            throw new Error("RESERVATION_NOT_FOUND");
          }

          const row = snap.data() as Record<string, unknown>;
          const status = normalizeReservationStatus(row.status) ?? "REQUESTED";
          if (status === "CANCELLED") {
            throw new Error("RESERVATION_CANCELLED");
          }

          const currentAssignedStation = normalizeStationId(row.assignedStationId);
          const currentQueueClass = normalizeQueueClass(row.queueClass);
          const currentRequiredResources = normalizeRequiredResources(row.requiredResources);
          const requestedQueueClass = normalizeQueueClass(parsed.data.queueClass);
          const hasRequiredResourcesRequest = parsed.data.requiredResources !== undefined;
          const requestedRequiredResources =
            hasRequiredResourcesRequest
              ? parsed.data.requiredResources === null
                ? null
                : normalizeRequiredResources(parsed.data.requiredResources)
              : currentRequiredResources;
          const requiredResources = requestedRequiredResources;

          const queueClassChanged =
            parsed.data.queueClass !== undefined && requestedQueueClass !== currentQueueClass;
          const resourcesChanged =
            hasRequiredResourcesRequest
              ? requestedRequiredResources === null
                ? row.requiredResources != null
                : !isSameRequiredResources(currentRequiredResources, requestedRequiredResources)
              : false;
          const stationChanged = currentAssignedStation !== assignedStationId;

          const requestedNoop =
            !stationChanged && !queueClassChanged && !resourcesChanged;

          const stationCapacity = getStationCapacity(assignedStationId);
          let stationUsedAfter: number | null = null;

          if (stationChanged) {
            const activeDocs = await tx.get(
              db.collection("reservations").where("assignedStationId", "==", assignedStationId)
            );

            stationUsedAfter = activeDocs.docs
              .map((r) => {
                if (r.id === reservationId) return 0;
                const raw = r.data() as Record<string, unknown>;
                const rowStatus = normalizeReservationStatus(raw.status);
                if (rowStatus === "CANCELLED") return 0;
                if (!isCapacityRelevantLoadStatus(raw.loadStatus)) return 0;
                if (isCommunityShelfReservationRow(raw)) return 0;
                return estimateHalfShelves(raw);
              })
              .reduce((total, each) => total + each, 0);

            if (!isCommunityShelfReservationRow(row)) {
              stationUsedAfter += estimateHalfShelves(row);
            }

            if (stationUsedAfter > stationCapacity) {
              throw new Error("STATION_CAPACITY_EXCEEDED");
            }
          }

          if (requestedNoop) {
            return {
              reservationId,
              assignedStationId,
              previousAssignedStationId: currentAssignedStation,
              stationCapacity,
              stationUsedAfter,
              idempotentReplay: true,
            };
          }

          const updates: Record<string, unknown> = {
            assignedStationId,
            updatedAt: now,
            updatedByUid: ctx.uid,
            updatedByRole: actorRole,
          };

          if (parsed.data.queueClass !== undefined) {
            updates.queueClass = requestedQueueClass;
          }
          if (parsed.data.requiredResources !== undefined) {
            updates.requiredResources = requiredResources;
          }

          if (stationChanged) {
            const history = normalizeReservationStageHistory(row.stageHistory);
            history.push({
              fromStatus: normalizeReservationStatus(row.status),
              toStatus: normalizeReservationStatus(row.status),
              fromLoadStatus: normalizeLoadStatus(row.loadStatus),
              toLoadStatus: normalizeLoadStatus(row.loadStatus),
              fromStage: stageForCurrentState(
                normalizeReservationStatus(row.status),
                normalizeLoadStatus(row.loadStatus)
              ),
              toStage: stageForCurrentState(
                normalizeReservationStatus(row.status),
                normalizeLoadStatus(row.loadStatus)
              ),
              at: now,
              actorUid: ctx.uid,
              actorRole,
              reason: "Station assignment updated",
              notes: null,
            });
            updates.stageHistory = history.slice(-120);
          }

          tx.set(reservationRef, updates, { merge: true });

          if (stationUsedAfter === null) {
            const activeDocs = await tx.get(
              db.collection("reservations").where("assignedStationId", "==", assignedStationId)
            );
            stationUsedAfter = activeDocs.docs
              .map((r) => {
                if (r.id === reservationId) return 0;
                const raw = r.data() as Record<string, unknown>;
                const rowStatus = normalizeReservationStatus(raw.status);
                if (rowStatus === "CANCELLED") return 0;
                if (!isCapacityRelevantLoadStatus(raw.loadStatus)) return 0;
                if (isCommunityShelfReservationRow(raw)) return 0;
                return estimateHalfShelves(raw);
              })
              .reduce((total, each) => total + each, 0);
            if (!isCommunityShelfReservationRow(row)) {
              stationUsedAfter += estimateHalfShelves(row);
            }
          }

          return {
            reservationId,
            assignedStationId,
            previousAssignedStationId: currentAssignedStation,
            stationCapacity,
            stationUsedAfter,
            idempotentReplay: false,
          };
        });

        await recomputeQueueHintsForStationSafe(out.assignedStationId, "reservations.assignStation");
        if (
          out.previousAssignedStationId &&
          out.previousAssignedStationId !== out.assignedStationId
        ) {
          await recomputeQueueHintsForStationSafe(
            out.previousAssignedStationId,
            "reservations.assignStation.previous"
          );
        }

        jsonOk(res, requestId, {
          reservationId: out.reservationId,
          assignedStationId: out.assignedStationId,
          previousAssignedStationId: out.previousAssignedStationId,
          stationCapacity: out.stationCapacity,
          stationUsedAfter: out.stationUsedAfter,
          idempotentReplay: out.idempotentReplay,
        });
        return;
      } catch (error: unknown) {
        const message = safeErrorMessage(error);
        if (message === "RESERVATION_NOT_FOUND") {
          jsonError(res, requestId, 404, "NOT_FOUND", "Reservation not found");
          return;
        }
        if (message === "RESERVATION_CANCELLED") {
          jsonError(res, requestId, 409, "CONFLICT", "Reservation is cancelled");
          return;
        }
        if (message === "STATION_CAPACITY_EXCEEDED") {
          jsonError(res, requestId, 409, "CONFLICT", "Station is at capacity");
          return;
        }
        throw error;
      }
    }

    if (route === "/v1/firings.listUpcoming") {
      const scopeCheck = requireScopes(ctx, ["firings:read"]);
      if (!scopeCheck.ok) {
        jsonError(res, requestId, 403, "FORBIDDEN", scopeCheck.message);
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

      const firings = snap.docs.map((d) => toFiringRow(d.id, d.data() as Record<string, unknown>));
      jsonOk(res, requestId, { firings, now });
      return;
    }

    if (route === "/v1/library.items.list") {
      const parsed = parseBody(libraryItemsListSchema, req.body);
      if (!parsed.ok) {
        jsonError(res, requestId, 400, "INVALID_ARGUMENT", parsed.message);
        return;
      }

      const sort: LibraryListSort = parsed.data.sort ?? "recently_added";
      const page = parsed.data.page ?? 1;
      const pageSize = parsed.data.pageSize ?? 24;
      const ratingMin = parsed.data.ratingMin;
      const ratingMax = parsed.data.ratingMax;
      const searchQuery = normalizeToken(parsed.data.q);
      const genreFilter = normalizeToken(parsed.data.genre);
      const availabilityFilter = normalizeToken(parsed.data.availability);
      const mediaTypeFilters = new Set((parsed.data.mediaType ?? []).map((entry) => normalizeToken(entry)).filter(Boolean));
      const studioFilters = new Set((parsed.data.studioCategory ?? []).map((entry) => normalizeToken(entry)).filter(Boolean));

      let itemsSnap;
      try {
        itemsSnap = await db.collection("libraryItems").orderBy("title", "asc").limit(1200).get();
      } catch (error) {
        logger.warn("library.items.list orderBy fallback engaged", {
          requestId,
          message: safeErrorMessage(error),
        });
        itemsSnap = await db.collection("libraryItems").limit(1200).get();
      }

      const needsReviewSignals =
        searchQuery.length > 0 ||
        sort === "highest_rated" ||
        sort === "recently_reviewed" ||
        ratingMin !== undefined ||
        ratingMax !== undefined;
      const reviewSignals = needsReviewSignals ? await loadLibraryReviewSignals(3000) : emptyLibraryReviewSignals();
      const borrowCounts = sort === "most_borrowed" ? await loadLibraryBorrowCounts(3000) : new Map<string, number>();

      const rows: Array<{ id: string; row: Record<string, unknown> }> = [];
      for (const docSnap of itemsSnap.docs) {
        const row = docSnap.data() as Record<string, unknown>;
        if (!row || typeof row !== "object") continue;
        if (isLibraryRowSoftDeleted(row)) continue;

        if (mediaTypeFilters.size > 0 && !mediaTypeFilters.has(readLibraryMediaType(row))) continue;
        if (genreFilter && readLibraryGenre(row) !== genreFilter) continue;
        if (studioFilters.size > 0 && !studioFilters.has(readLibraryStudioCategory(row))) continue;
        if (availabilityFilter && normalizeLibraryStatus(row) !== availabilityFilter) continue;

        const rating = readLibraryRating(row, docSnap.id, reviewSignals);
        if (ratingMin !== undefined && (rating === null || rating < ratingMin)) continue;
        if (ratingMax !== undefined && (rating === null || rating > ratingMax)) continue;

        if (searchQuery) {
          const haystack = collectLibrarySearchText(docSnap.id, row, reviewSignals);
          if (!haystack.includes(searchQuery)) continue;
        }

        rows.push({ id: docSnap.id, row });
      }

      rows.sort((a, b) => {
        const titleA = normalizeToken(a.row.title);
        const titleB = normalizeToken(b.row.title);
        const titleCompare = titleA.localeCompare(titleB);

        if (sort === "staff_picks") {
          const staffPickDelta = Number(readLibraryStaffPick(b.row)) - Number(readLibraryStaffPick(a.row));
          if (staffPickDelta !== 0) return staffPickDelta;
          const rankDelta = readLibraryShelfRank(a.row) - readLibraryShelfRank(b.row);
          if (rankDelta !== 0) return rankDelta;
          const updatedDelta = readLibraryUpdatedMs(b.row) - readLibraryUpdatedMs(a.row);
          if (updatedDelta !== 0) return updatedDelta;
          return titleCompare;
        }

        if (sort === "highest_rated") {
          const ratingDelta =
            (readLibraryRating(b.row, b.id, reviewSignals) ?? 0) - (readLibraryRating(a.row, a.id, reviewSignals) ?? 0);
          if (ratingDelta !== 0) return ratingDelta;
          const countDelta =
            readLibraryRatingCount(b.row, b.id, reviewSignals) - readLibraryRatingCount(a.row, a.id, reviewSignals);
          if (countDelta !== 0) return countDelta;
          return titleCompare;
        }

        if (sort === "most_borrowed") {
          const borrowDelta = readLibraryBorrowCount(b.row, b.id, borrowCounts) - readLibraryBorrowCount(a.row, a.id, borrowCounts);
          if (borrowDelta !== 0) return borrowDelta;
          const updatedDelta = readLibraryUpdatedMs(b.row) - readLibraryUpdatedMs(a.row);
          if (updatedDelta !== 0) return updatedDelta;
          return titleCompare;
        }

        if (sort === "recently_reviewed") {
          const reviewedDelta =
            readLibraryLastReviewedMs(b.row, b.id, reviewSignals) - readLibraryLastReviewedMs(a.row, a.id, reviewSignals);
          if (reviewedDelta !== 0) return reviewedDelta;
          return titleCompare;
        }

        const createdDelta = readLibraryCreatedMs(b.row) - readLibraryCreatedMs(a.row);
        if (createdDelta !== 0) return createdDelta;
        return titleCompare;
      });

      const total = rows.length;
      const offset = Math.max(0, (page - 1) * pageSize);
      const paged = rows.slice(offset, offset + pageSize);
      const items = paged.map((entry) => toLibraryApiItemRow(entry.id, entry.row, reviewSignals, borrowCounts));

      jsonOk(res, requestId, { items, page, pageSize, total, sort });
      return;
    }

    if (route === "/v1/library.items.get") {
      const parsed = parseBody(libraryItemGetSchema, req.body);
      if (!parsed.ok) {
        jsonError(res, requestId, 400, "INVALID_ARGUMENT", parsed.message);
        return;
      }

      const itemId = safeString(parsed.data.itemId).trim();
      const snap = await db.collection("libraryItems").doc(itemId).get();
      if (!snap.exists) {
        jsonError(res, requestId, 404, "NOT_FOUND", "Library item not found");
        return;
      }
      const row = snap.data() as Record<string, unknown>;
      if (!row || typeof row !== "object" || isLibraryRowSoftDeleted(row)) {
        jsonError(res, requestId, 404, "NOT_FOUND", "Library item not found");
        return;
      }

      const reviewSignals = await loadLibraryReviewSignals(3000);
      const borrowCounts = await loadLibraryBorrowCounts(3000);
      const item = toLibraryApiItemRow(itemId, row, reviewSignals, borrowCounts);

      jsonOk(res, requestId, { item });
      return;
    }

    if (route === "/v1/library.discovery.get") {
      const parsed = parseBody(libraryDiscoverySchema, req.body);
      if (!parsed.ok) {
        jsonError(res, requestId, 400, "INVALID_ARGUMENT", parsed.message);
        return;
      }

      const limit = parsed.data.limit ?? 8;
      let itemsSnap;
      try {
        itemsSnap = await db.collection("libraryItems").orderBy("title", "asc").limit(1200).get();
      } catch (error) {
        logger.warn("library.discovery.get orderBy fallback engaged", {
          requestId,
          message: safeErrorMessage(error),
        });
        itemsSnap = await db.collection("libraryItems").limit(1200).get();
      }

      const reviewSignals = await loadLibraryReviewSignals(3000);
      const borrowCounts = await loadLibraryBorrowCounts(3000);
      const rows = itemsSnap.docs
        .map((docSnap) => ({ id: docSnap.id, row: docSnap.data() as Record<string, unknown> }))
        .filter((entry) => entry.row && typeof entry.row === "object" && !isLibraryRowSoftDeleted(entry.row));

      const byTitle = (a: { row: Record<string, unknown> }, b: { row: Record<string, unknown> }) =>
        normalizeToken(a.row.title).localeCompare(normalizeToken(b.row.title));
      const byCreatedDesc = (a: { row: Record<string, unknown> }, b: { row: Record<string, unknown> }) =>
        readLibraryCreatedMs(b.row) - readLibraryCreatedMs(a.row);
      const byReviewedDesc = (a: { id: string; row: Record<string, unknown> }, b: { id: string; row: Record<string, unknown> }) =>
        readLibraryLastReviewedMs(b.row, b.id, reviewSignals) - readLibraryLastReviewedMs(a.row, a.id, reviewSignals);
      const byBorrowedDesc = (a: { id: string; row: Record<string, unknown> }, b: { id: string; row: Record<string, unknown> }) =>
        readLibraryBorrowCount(b.row, b.id, borrowCounts) - readLibraryBorrowCount(a.row, a.id, borrowCounts);

      const staffPicks = rows
        .filter((entry) => readLibraryStaffPick(entry.row))
        .sort((a, b) => {
          const rankDelta = readLibraryShelfRank(a.row) - readLibraryShelfRank(b.row);
          if (rankDelta !== 0) return rankDelta;
          const updatedDelta = readLibraryUpdatedMs(b.row) - readLibraryUpdatedMs(a.row);
          if (updatedDelta !== 0) return updatedDelta;
          return byTitle(a, b);
        })
        .slice(0, limit)
        .map((entry) => toLibraryApiItemRow(entry.id, entry.row, reviewSignals, borrowCounts));

      const mostBorrowed = [...rows]
        .sort((a, b) => {
          const borrowDelta = byBorrowedDesc(a, b);
          if (borrowDelta !== 0) return borrowDelta;
          return byTitle(a, b);
        })
        .slice(0, limit)
        .map((entry) => toLibraryApiItemRow(entry.id, entry.row, reviewSignals, borrowCounts));

      const recentlyAdded = [...rows]
        .sort((a, b) => {
          const createdDelta = byCreatedDesc(a, b);
          if (createdDelta !== 0) return createdDelta;
          return byTitle(a, b);
        })
        .slice(0, limit)
        .map((entry) => toLibraryApiItemRow(entry.id, entry.row, reviewSignals, borrowCounts));

      const recentlyReviewed = [...rows]
        .sort((a, b) => {
          const reviewedDelta = byReviewedDesc(a, b);
          if (reviewedDelta !== 0) return reviewedDelta;
          return byTitle(a, b);
        })
        .slice(0, limit)
        .map((entry) => toLibraryApiItemRow(entry.id, entry.row, reviewSignals, borrowCounts));

      jsonOk(res, requestId, {
        limit,
        staffPicks,
        mostBorrowed,
        recentlyAdded,
        recentlyReviewed,
      });
      return;
    }

    if (route === "/v1/library.externalLookup") {
      const parsed = parseBody(libraryExternalLookupSchema, req.body);
      if (!parsed.ok) {
        jsonError(res, requestId, 400, "INVALID_ARGUMENT", parsed.message);
        return;
      }

      const q = safeString(parsed.data.q).trim();
      const limit = parsed.data.limit ?? 6;
      if (!q) {
        jsonError(res, requestId, 400, "INVALID_ARGUMENT", "Search query is required.");
        return;
      }

      try {
        const result = await lookupLibraryExternalSources({ q, limit });
        await logLibraryAuditEvent({
          req,
          requestId,
          action: "library_external_lookup",
          resourceType: "library_external_lookup",
          resourceId: q.slice(0, 120),
          ownerUid: ctx.uid,
          result: "allow",
          ctx,
          metadata: {
            queryLength: q.length,
            requestedLimit: limit,
            resultCount: result.items.length,
            cacheHit: result.cacheHit,
            degraded: result.degraded,
            policyLimited: result.policyLimited === true,
            providers: result.providers.map((provider) => ({
              provider: provider.provider,
              ok: provider.ok,
              itemCount: provider.itemCount,
              cached: provider.cached,
              disabled: provider.disabled === true,
            })),
          },
        });

        jsonOk(res, requestId, result);
      } catch (error: unknown) {
        await logLibraryAuditEvent({
          req,
          requestId,
          action: "library_external_lookup",
          resourceType: "library_external_lookup",
          resourceId: q.slice(0, 120),
          ownerUid: ctx.uid,
          result: "error",
          reasonCode: "LOOKUP_FAILURE",
          ctx,
          metadata: {
            queryLength: q.length,
            requestedLimit: limit,
            message: safeErrorMessage(error),
          },
        });
        jsonOk(res, requestId, {
          q,
          limit,
          items: [],
          cacheHit: false,
          degraded: true,
          policyLimited: false,
          providers: [],
        });
      }
      return;
    }

    if (route === LIBRARY_ROUTE_ROLLOUT_GET) {
      const parsed = parseBody(libraryRolloutGetSchema, req.body);
      if (!parsed.ok) {
        jsonError(res, requestId, 400, "INVALID_ARGUMENT", parsed.message);
        return;
      }

      try {
        const config = await getLibraryRolloutConfig();
        await logLibraryAuditEvent({
          req,
          requestId,
          action: "library_rollout_get",
          resourceType: "library_rollout_config",
          resourceId: "rolloutPhase",
          ownerUid: ctx.uid,
          result: "allow",
          ctx,
          metadata: {
            phase: config.phase,
            updatedAtMs: config.updatedAtMs,
          },
        });
        jsonOk(res, requestId, {
          phase: config.phase,
          note: config.note,
          updatedAtMs: config.updatedAtMs,
          updatedByUid: config.updatedByUid,
        });
      } catch (error: unknown) {
        await logLibraryAuditEvent({
          req,
          requestId,
          action: "library_rollout_get",
          resourceType: "library_rollout_config",
          resourceId: "rolloutPhase",
          ownerUid: ctx.uid,
          result: "error",
          reasonCode: "LOOKUP_FAILURE",
          ctx,
          metadata: {
            message: safeErrorMessage(error),
          },
        });
        jsonError(res, requestId, 500, "INTERNAL", "Failed to load library rollout config");
      }
      return;
    }

    if (route === LIBRARY_ROUTE_ROLLOUT_SET) {
      const parsed = parseBody(libraryRolloutSetSchema, req.body);
      if (!parsed.ok) {
        jsonError(res, requestId, 400, "INVALID_ARGUMENT", parsed.message);
        return;
      }

      try {
        const config = await setLibraryRolloutConfig({
          phase: parsed.data.phase,
          note: parsed.data.note,
          updatedByUid: ctx.uid,
        });
        await logLibraryAuditEvent({
          req,
          requestId,
          action: "library_rollout_set",
          resourceType: "library_rollout_config",
          resourceId: "rolloutPhase",
          ownerUid: ctx.uid,
          result: "allow",
          ctx,
          metadata: {
            phase: config.phase,
            hasNote: Boolean(config.note),
          },
        });
        jsonOk(res, requestId, {
          phase: config.phase,
          note: config.note,
          updatedAtMs: config.updatedAtMs,
          updatedByUid: config.updatedByUid,
        });
      } catch (error: unknown) {
        await logLibraryAuditEvent({
          req,
          requestId,
          action: "library_rollout_set",
          resourceType: "library_rollout_config",
          resourceId: "rolloutPhase",
          ownerUid: ctx.uid,
          result: "error",
          reasonCode: "UPDATE_FAILURE",
          ctx,
          metadata: {
            message: safeErrorMessage(error),
          },
        });
        jsonError(res, requestId, 500, "INTERNAL", "Failed to update library rollout config");
      }
      return;
    }

    if (route === "/v1/library.externalLookup.providerConfig.get") {
      try {
        const config = await getLibraryExternalLookupProviderConfig();
        await logLibraryAuditEvent({
          req,
          requestId,
          action: "library_external_lookup_provider_config_get",
          resourceType: "library_external_lookup_provider_config",
          resourceId: "externalLookupProviders",
          ownerUid: ctx.uid,
          result: "allow",
          ctx,
          metadata: {
            openlibraryEnabled: config.openlibraryEnabled,
            googlebooksEnabled: config.googlebooksEnabled,
            disabledProviders: config.disabledProviders,
          },
        });
        jsonOk(res, requestId, {
          openlibraryEnabled: config.openlibraryEnabled,
          googlebooksEnabled: config.googlebooksEnabled,
          disabledProviders: config.disabledProviders,
          note: config.note,
          updatedAtMs: config.updatedAtMs,
          updatedByUid: config.updatedByUid,
        });
      } catch (error: unknown) {
        await logLibraryAuditEvent({
          req,
          requestId,
          action: "library_external_lookup_provider_config_get",
          resourceType: "library_external_lookup_provider_config",
          resourceId: "externalLookupProviders",
          ownerUid: ctx.uid,
          result: "error",
          reasonCode: "LOOKUP_FAILURE",
          ctx,
          metadata: {
            message: safeErrorMessage(error),
          },
        });
        jsonError(res, requestId, 500, "INTERNAL", "Failed to load provider config");
      }
      return;
    }

    if (route === "/v1/library.externalLookup.providerConfig.set") {
      const parsed = parseBody(libraryExternalLookupProviderConfigSetSchema, req.body);
      if (!parsed.ok) {
        jsonError(res, requestId, 400, "INVALID_ARGUMENT", parsed.message);
        return;
      }

      try {
        const config = await setLibraryExternalLookupProviderConfig({
          openlibraryEnabled: parsed.data.openlibraryEnabled,
          googlebooksEnabled: parsed.data.googlebooksEnabled,
          note: parsed.data.note ?? null,
          updatedByUid: ctx.uid,
        });
        await logLibraryAuditEvent({
          req,
          requestId,
          action: "library_external_lookup_provider_config_set",
          resourceType: "library_external_lookup_provider_config",
          resourceId: "externalLookupProviders",
          ownerUid: ctx.uid,
          result: "allow",
          ctx,
          metadata: {
            openlibraryEnabled: config.openlibraryEnabled,
            googlebooksEnabled: config.googlebooksEnabled,
            disabledProviders: config.disabledProviders,
            hasNote: Boolean(config.note),
          },
        });
        jsonOk(res, requestId, {
          openlibraryEnabled: config.openlibraryEnabled,
          googlebooksEnabled: config.googlebooksEnabled,
          disabledProviders: config.disabledProviders,
          note: config.note,
          updatedAtMs: config.updatedAtMs,
          updatedByUid: config.updatedByUid,
        });
      } catch (error: unknown) {
        await logLibraryAuditEvent({
          req,
          requestId,
          action: "library_external_lookup_provider_config_set",
          resourceType: "library_external_lookup_provider_config",
          resourceId: "externalLookupProviders",
          ownerUid: ctx.uid,
          result: "error",
          reasonCode: "UPDATE_FAILURE",
          ctx,
          metadata: {
            message: safeErrorMessage(error),
          },
        });
        jsonError(res, requestId, 500, "INTERNAL", "Failed to update provider config");
      }
      return;
    }

    if (route === "/v1/library.items.resolveIsbn") {
      const parsed = parseBody(libraryItemResolveIsbnSchema, req.body);
      if (!parsed.ok) {
        jsonError(res, requestId, 400, "INVALID_ARGUMENT", parsed.message);
        return;
      }

      const allowRemoteLookup = parsed.data.allowRemoteLookup !== false;
      try {
        const resolved = await resolveLibraryIsbn({
          isbn: parsed.data.isbn,
          allowRemoteLookup,
        });
        await logLibraryAuditEvent({
          req,
          requestId,
          action: "library_item_resolve_isbn",
          resourceType: "library_item",
          resourceId: resolved.normalized.primary,
          ownerUid: ctx.uid,
          result: "allow",
          ctx,
          metadata: {
            source: resolved.lookup.source,
            fallback: resolved.fallback,
            usedRemoteLookup: resolved.usedRemoteLookup,
          },
        });
        jsonOk(res, requestId, {
          isbn: resolved.normalized.primary,
          isbn10: resolved.normalized.isbn10,
          isbn13: resolved.normalized.isbn13,
          source: resolved.lookup.source,
          fallback: resolved.fallback,
          usedRemoteLookup: resolved.usedRemoteLookup,
          item: {
            title: resolved.lookup.title,
            subtitle: resolved.lookup.subtitle,
            authors: resolved.lookup.authors,
            description: resolved.lookup.description,
            publisher: resolved.lookup.publisher,
            publishedDate: resolved.lookup.publishedDate,
            pageCount: resolved.lookup.pageCount,
            subjects: resolved.lookup.subjects,
            coverUrl: resolved.lookup.coverUrl,
            format: resolved.lookup.format,
            identifiers: {
              isbn10: resolved.lookup.identifiers.isbn10,
              isbn13: resolved.lookup.identifiers.isbn13,
              olid: resolved.lookup.identifiers.olid,
              googleVolumeId: resolved.lookup.identifiers.googleVolumeId,
            },
          },
        });
      } catch (error: unknown) {
        const message = safeErrorMessage(error);
        const invalid = message.toLowerCase().includes("isbn");
        const code = invalid ? "INVALID_ARGUMENT" : "INTERNAL";
        const httpStatus = invalid ? 400 : 500;
        const reasonCode = invalid ? "INVALID_ISBN" : "LOOKUP_FAILURE";
        await logLibraryAuditEvent({
          req,
          requestId,
          action: "library_item_resolve_isbn",
          resourceType: "library_item",
          resourceId: safeString(parsed.data.isbn).slice(0, 80),
          ownerUid: ctx.uid,
          result: invalid ? "deny" : "error",
          reasonCode,
          ctx,
          metadata: {
            message,
            usedRemoteLookup: allowRemoteLookup,
          },
        });
        jsonError(
          res,
          requestId,
          httpStatus,
          code,
          invalid ? message : "Failed to resolve ISBN",
          {
            reasonCode,
          },
        );
      }
      return;
    }

    if (route === "/v1/library.items.create") {
      const parsed = parseBody(libraryItemCreateSchema, req.body);
      if (!parsed.ok) {
        jsonError(res, requestId, 400, "INVALID_ARGUMENT", parsed.message);
        return;
      }

      const inputIsbn = trimOrNull(parsed.data.isbn);
      const allowRemoteLookup = parsed.data.allowRemoteLookup !== false;
      let resolved:
        | Awaited<ReturnType<typeof resolveLibraryIsbn>>
        | null = null;
      if (inputIsbn) {
        try {
          resolved = await resolveLibraryIsbn({
            isbn: inputIsbn,
            allowRemoteLookup,
          });
        } catch (error: unknown) {
          const message = safeErrorMessage(error);
          await logLibraryAuditEvent({
            req,
            requestId,
            action: "library_item_create",
            resourceType: "library_item",
            resourceId: inputIsbn,
            ownerUid: ctx.uid,
            result: "deny",
            reasonCode: "INVALID_ISBN",
            ctx,
            metadata: { message },
          });
          jsonError(res, requestId, 400, "INVALID_ARGUMENT", message, {
            reasonCode: "INVALID_ISBN",
          });
          return;
        }

        const duplicateItemId = await findExistingLibraryItemIdByIsbn({
          isbn10: resolved.normalized.isbn10,
          isbn13: resolved.normalized.isbn13,
          includeSoftDeleted: false,
        });
        if (duplicateItemId) {
          await logLibraryAuditEvent({
            req,
            requestId,
            action: "library_item_create",
            resourceType: "library_item",
            resourceId: duplicateItemId,
            ownerUid: ctx.uid,
            result: "deny",
            reasonCode: "ISBN_ALREADY_EXISTS",
            ctx,
            metadata: {
              isbn10: resolved.normalized.isbn10,
              isbn13: resolved.normalized.isbn13,
            },
          });
          jsonError(res, requestId, 409, "CONFLICT", "An active library item already uses that ISBN.", {
            reasonCode: "ISBN_ALREADY_EXISTS",
            duplicateItemId,
          });
          return;
        }
      }

      const requestedItemId = trimOrNull(parsed.data.itemId);
      const normalizedIsbn = resolved?.normalized.primary ?? null;
      let itemId = requestedItemId
        ?? (normalizedIsbn ? `isbn-${normalizedIsbn}` : `item_${randomBytes(10).toString("hex")}`);
      const existingSnap = await db.collection("libraryItems").doc(itemId).get();
      if (existingSnap.exists) {
        const existingRow = (existingSnap.data() ?? {}) as Record<string, unknown>;
        if (requestedItemId || !isLibraryRowSoftDeleted(existingRow)) {
          await logLibraryAuditEvent({
            req,
            requestId,
            action: "library_item_create",
            resourceType: "library_item",
            resourceId: itemId,
            ownerUid: ctx.uid,
            result: "deny",
            reasonCode: "ITEM_ID_EXISTS",
            ctx,
          });
          jsonError(res, requestId, 409, "CONFLICT", "Library item id already exists.", {
            reasonCode: "ITEM_ID_EXISTS",
            itemId,
          });
          return;
        }
        itemId = `${itemId}-${randomBytes(4).toString("hex")}`;
      }

      const now = nowTs();
      const copyCounts = computeLibraryItemCopyCounts({
        totalCopies: parsed.data.totalCopies,
        availableCopies: parsed.data.availableCopies,
      });
      const status = libraryStatusFromCopies(parsed.data.status, copyCounts.availableCopies);
      const title = trimOrNull(parsed.data.title) ?? resolved?.lookup.title ?? (normalizedIsbn ? `ISBN ${normalizedIsbn}` : "Library item");
      const tags = Object.prototype.hasOwnProperty.call(parsed.data, "tags")
        ? normalizeLibraryItemStringArray(parsed.data.tags, 60)
        : [];
      const authors = Object.prototype.hasOwnProperty.call(parsed.data, "authors")
        ? normalizeLibraryItemStringArray(parsed.data.authors, 20)
        : (resolved?.lookup.authors ?? []);
      const subjects = Object.prototype.hasOwnProperty.call(parsed.data, "subjects")
        ? normalizeLibraryItemStringArray(parsed.data.subjects, 40)
        : (resolved?.lookup.subjects ?? []);
      const source = trimOrNull(parsed.data.source) ?? resolved?.lookup.source ?? "manual";

      const itemRow: Record<string, unknown> = {
        title,
        subtitle: trimOrNull(parsed.data.subtitle) ?? resolved?.lookup.subtitle ?? null,
        authors,
        description: trimOrNull(parsed.data.description) ?? resolved?.lookup.description ?? null,
        publisher: trimOrNull(parsed.data.publisher) ?? resolved?.lookup.publisher ?? null,
        publishedDate: trimOrNull(parsed.data.publishedDate) ?? resolved?.lookup.publishedDate ?? null,
        pageCount: parsed.data.pageCount ?? resolved?.lookup.pageCount ?? null,
        subjects,
        coverUrl: trimOrNull(parsed.data.coverUrl) ?? resolved?.lookup.coverUrl ?? null,
        format: trimOrNull(parsed.data.format) ?? resolved?.lookup.format ?? null,
        mediaType: trimOrNull(parsed.data.mediaType) ?? "book",
        status,
        current_lending_status: status,
        totalCopies: copyCounts.totalCopies,
        availableCopies: copyCounts.availableCopies,
        isbn: normalizedIsbn,
        isbn10: resolved?.normalized.isbn10 ?? null,
        isbn13: resolved?.normalized.isbn13 ?? null,
        isbn_normalized: normalizedIsbn,
        identifiers: {
          isbn10: resolved?.normalized.isbn10 ?? null,
          isbn13: resolved?.normalized.isbn13 ?? null,
          olid: resolved?.lookup.identifiers.olid ?? null,
          googleVolumeId: resolved?.lookup.identifiers.googleVolumeId ?? null,
        },
        source,
        metadataSource: "api_v1_create",
        createdAt: now,
        createdByUid: ctx.uid,
        updatedAt: now,
        updatedByUid: ctx.uid,
        actorMode: ctx.mode,
      };

      if (Object.prototype.hasOwnProperty.call(parsed.data, "replacementValueCents")) {
        itemRow.replacementValueCents = parsed.data.replacementValueCents ?? null;
      }
      if (tags.length > 0) {
        itemRow.tags = tags;
        itemRow.secondaryTags = tags;
      }

      await db.collection("libraryItems").doc(itemId).set(itemRow, { merge: false });

      await logLibraryAuditEvent({
        req,
        requestId,
        action: "library_item_create",
        resourceType: "library_item",
        resourceId: itemId,
        ownerUid: ctx.uid,
        result: "allow",
        ctx,
        metadata: {
          source,
          status,
          hasIsbn: Boolean(normalizedIsbn),
          usedRemoteLookup: resolved?.usedRemoteLookup === true,
        },
      });

      jsonOk(res, requestId, {
        item: toLibraryLifecycleSummary(itemId, itemRow),
      });
      return;
    }

    if (route === "/v1/library.items.update") {
      const parsed = parseBody(libraryItemUpdateSchema, req.body);
      if (!parsed.ok) {
        jsonError(res, requestId, 400, "INVALID_ARGUMENT", parsed.message);
        return;
      }

      const itemId = safeString(parsed.data.itemId).trim();
      const itemRef = db.collection("libraryItems").doc(itemId);
      const itemSnap = await itemRef.get();
      if (!itemSnap.exists) {
        jsonError(res, requestId, 404, "NOT_FOUND", "Library item not found");
        return;
      }
      const existingRow = (itemSnap.data() ?? {}) as Record<string, unknown>;
      if (!existingRow || typeof existingRow !== "object" || isLibraryRowSoftDeleted(existingRow)) {
        jsonError(res, requestId, 404, "NOT_FOUND", "Library item not found");
        return;
      }

      const now = nowTs();
      const patch: Record<string, unknown> = {
        updatedAt: now,
        updatedByUid: ctx.uid,
        actorMode: ctx.mode,
      };

      let resolved:
        | Awaited<ReturnType<typeof resolveLibraryIsbn>>
        | null = null;
      if (Object.prototype.hasOwnProperty.call(parsed.data, "isbn")) {
        const nextIsbn = trimOrNull(parsed.data.isbn);
        if (!nextIsbn) {
          patch.isbn = null;
          patch.isbn10 = null;
          patch.isbn13 = null;
          patch.isbn_normalized = null;
          const existingIdentifiers = readObjectOrEmpty(existingRow.identifiers);
          patch.identifiers = {
            isbn10: null,
            isbn13: null,
            olid: trimOrNull(existingIdentifiers.olid),
            googleVolumeId: trimOrNull(existingIdentifiers.googleVolumeId),
          };
        } else {
          try {
            resolved = await resolveLibraryIsbn({
              isbn: nextIsbn,
              allowRemoteLookup: parsed.data.allowRemoteLookup !== false,
            });
          } catch (error: unknown) {
            jsonError(res, requestId, 400, "INVALID_ARGUMENT", safeErrorMessage(error), {
              reasonCode: "INVALID_ISBN",
            });
            return;
          }

          const duplicateItemId = await findExistingLibraryItemIdByIsbn({
            isbn10: resolved.normalized.isbn10,
            isbn13: resolved.normalized.isbn13,
            includeSoftDeleted: false,
            excludeItemId: itemId,
          });
          if (duplicateItemId) {
            jsonError(res, requestId, 409, "CONFLICT", "An active library item already uses that ISBN.", {
              reasonCode: "ISBN_ALREADY_EXISTS",
              duplicateItemId,
            });
            return;
          }

          const existingIdentifiers = readObjectOrEmpty(existingRow.identifiers);
          patch.isbn = resolved.normalized.primary;
          patch.isbn10 = resolved.normalized.isbn10;
          patch.isbn13 = resolved.normalized.isbn13;
          patch.isbn_normalized = resolved.normalized.primary;
          patch.identifiers = {
            isbn10: resolved.normalized.isbn10,
            isbn13: resolved.normalized.isbn13,
            olid: resolved.lookup.identifiers.olid ?? trimOrNull(existingIdentifiers.olid),
            googleVolumeId:
              resolved.lookup.identifiers.googleVolumeId ?? trimOrNull(existingIdentifiers.googleVolumeId),
          };
          patch.source = trimOrNull(parsed.data.source) ?? resolved.lookup.source;
        }
      } else if (Object.prototype.hasOwnProperty.call(parsed.data, "source")) {
        patch.source = trimOrNull(parsed.data.source);
      }

      if (Object.prototype.hasOwnProperty.call(parsed.data, "title")) {
        patch.title = trimOrNull(parsed.data.title);
      } else if (resolved) {
        patch.title = resolved.lookup.title;
      }
      if (Object.prototype.hasOwnProperty.call(parsed.data, "subtitle")) {
        patch.subtitle = trimOrNull(parsed.data.subtitle);
      } else if (resolved) {
        patch.subtitle = resolved.lookup.subtitle;
      }
      if (Object.prototype.hasOwnProperty.call(parsed.data, "authors")) {
        patch.authors = normalizeLibraryItemStringArray(parsed.data.authors, 20);
      } else if (resolved) {
        patch.authors = resolved.lookup.authors;
      }
      if (Object.prototype.hasOwnProperty.call(parsed.data, "description")) {
        patch.description = trimOrNull(parsed.data.description);
      } else if (resolved) {
        patch.description = resolved.lookup.description;
      }
      if (Object.prototype.hasOwnProperty.call(parsed.data, "publisher")) {
        patch.publisher = trimOrNull(parsed.data.publisher);
      } else if (resolved) {
        patch.publisher = resolved.lookup.publisher;
      }
      if (Object.prototype.hasOwnProperty.call(parsed.data, "publishedDate")) {
        patch.publishedDate = trimOrNull(parsed.data.publishedDate);
      } else if (resolved) {
        patch.publishedDate = resolved.lookup.publishedDate;
      }
      if (Object.prototype.hasOwnProperty.call(parsed.data, "pageCount")) {
        patch.pageCount = parsed.data.pageCount ?? null;
      } else if (resolved) {
        patch.pageCount = resolved.lookup.pageCount;
      }
      if (Object.prototype.hasOwnProperty.call(parsed.data, "subjects")) {
        patch.subjects = normalizeLibraryItemStringArray(parsed.data.subjects, 40);
      } else if (resolved) {
        patch.subjects = resolved.lookup.subjects;
      }
      if (Object.prototype.hasOwnProperty.call(parsed.data, "coverUrl")) {
        patch.coverUrl = trimOrNull(parsed.data.coverUrl);
      } else if (resolved) {
        patch.coverUrl = resolved.lookup.coverUrl;
      }
      if (Object.prototype.hasOwnProperty.call(parsed.data, "format")) {
        patch.format = trimOrNull(parsed.data.format);
      } else if (resolved) {
        patch.format = resolved.lookup.format;
      }
      if (Object.prototype.hasOwnProperty.call(parsed.data, "mediaType")) {
        patch.mediaType = trimOrNull(parsed.data.mediaType);
      }
      if (Object.prototype.hasOwnProperty.call(parsed.data, "replacementValueCents")) {
        patch.replacementValueCents = parsed.data.replacementValueCents ?? null;
      }
      if (Object.prototype.hasOwnProperty.call(parsed.data, "tags")) {
        const tags = normalizeLibraryItemStringArray(parsed.data.tags, 60);
        patch.tags = tags;
        patch.secondaryTags = tags;
      }

      const nextCopyCounts = computeLibraryItemCopyCounts({
        totalCopies: Object.prototype.hasOwnProperty.call(parsed.data, "totalCopies")
          ? parsed.data.totalCopies
          : Math.max(1, Math.trunc(readFiniteNumberOrNull(existingRow.totalCopies) ?? 1)),
        availableCopies: Object.prototype.hasOwnProperty.call(parsed.data, "availableCopies")
          ? parsed.data.availableCopies
          : Math.max(0, Math.trunc(readFiniteNumberOrNull(existingRow.availableCopies) ?? readFiniteNumberOrNull(existingRow.totalCopies) ?? 1)),
      });

      if (
        Object.prototype.hasOwnProperty.call(parsed.data, "totalCopies") ||
        Object.prototype.hasOwnProperty.call(parsed.data, "availableCopies")
      ) {
        patch.totalCopies = nextCopyCounts.totalCopies;
        patch.availableCopies = nextCopyCounts.availableCopies;
      }
      if (Object.prototype.hasOwnProperty.call(parsed.data, "status")) {
        patch.status = parsed.data.status;
        patch.current_lending_status = parsed.data.status;
      }

      await itemRef.set(patch, { merge: true });
      const itemRow = {
        ...existingRow,
        ...patch,
      };

      await logLibraryAuditEvent({
        req,
        requestId,
        action: "library_item_update",
        resourceType: "library_item",
        resourceId: itemId,
        ownerUid: ctx.uid,
        result: "allow",
        ctx,
        metadata: {
          hasResolvedIsbn: Boolean(resolved),
          status: trimOrNull(itemRow.status),
        },
      });

      jsonOk(res, requestId, {
        item: toLibraryLifecycleSummary(itemId, itemRow),
      });
      return;
    }

    if (route === "/v1/library.items.delete") {
      const parsed = parseBody(libraryItemDeleteSchema, req.body);
      if (!parsed.ok) {
        jsonError(res, requestId, 400, "INVALID_ARGUMENT", parsed.message);
        return;
      }

      const itemId = safeString(parsed.data.itemId).trim();
      const note = trimOrNull(parsed.data.note);
      const itemRef = db.collection("libraryItems").doc(itemId);
      const itemSnap = await itemRef.get();
      if (!itemSnap.exists) {
        jsonError(res, requestId, 404, "NOT_FOUND", "Library item not found");
        return;
      }
      const existingRow = (itemSnap.data() ?? {}) as Record<string, unknown>;
      if (!existingRow || typeof existingRow !== "object" || isLibraryRowSoftDeleted(existingRow)) {
        jsonError(res, requestId, 404, "NOT_FOUND", "Library item not found");
        return;
      }

      const now = nowTs();
      const patch: Record<string, unknown> = {
        deletedAt: now,
        deletedByUid: ctx.uid,
        deletedReason: note ?? null,
        status: "archived",
        current_lending_status: "archived",
        availableCopies: 0,
        updatedAt: now,
        updatedByUid: ctx.uid,
      };
      await itemRef.set(patch, { merge: true });

      await logLibraryAuditEvent({
        req,
        requestId,
        action: "library_item_delete",
        resourceType: "library_item",
        resourceId: itemId,
        ownerUid: ctx.uid,
        result: "allow",
        ctx,
        metadata: {
          hasNote: Boolean(note),
        },
      });

      jsonOk(res, requestId, {
        item: {
          id: itemId,
          deleted: true,
          status: "archived",
        },
      });
      return;
    }

    if (route === "/v1/library.items.importIsbns") {
      if (!isStaff) {
        await logLibraryAuditEvent({
          req,
          requestId,
          action: "library_items_import_isbns",
          resourceType: "library_items",
          resourceId: "isbn_import_batch",
          ownerUid: ctx.uid,
          result: "deny",
          reasonCode: "FORBIDDEN",
          ctx,
        });
        jsonError(res, requestId, 403, "FORBIDDEN", "Only staff can import ISBN catalogs.");
        return;
      }
      const parsed = parseBody(libraryItemsImportIsbnsSchema, req.body);
      if (!parsed.ok) {
        jsonError(res, requestId, 400, "INVALID_ARGUMENT", parsed.message);
        return;
      }

      try {
        const result = await importLibraryIsbnBatch({
          isbns: parsed.data.isbns,
          source: trimOrNull(parsed.data.source) ?? "api_v1",
        });
        await logLibraryAuditEvent({
          req,
          requestId,
          action: "library_items_import_isbns",
          resourceType: "library_items",
          resourceId: "isbn_import_batch",
          ownerUid: ctx.uid,
          result: "allow",
          ctx,
          metadata: {
            requested: result.requested,
            created: result.created,
            updated: result.updated,
            errors: result.errors.length,
          },
        });
        jsonOk(res, requestId, result);
      } catch (error: unknown) {
        await logLibraryAuditEvent({
          req,
          requestId,
          action: "library_items_import_isbns",
          resourceType: "library_items",
          resourceId: "isbn_import_batch",
          ownerUid: ctx.uid,
          result: "error",
          reasonCode: "INVALID_ARGUMENT",
          ctx,
          metadata: {
            message: safeErrorMessage(error),
          },
        });
        jsonError(res, requestId, 400, "INVALID_ARGUMENT", safeErrorMessage(error));
      }
      return;
    }

    if (route === "/v1/library.recommendations.list") {
      const parsed = parseBody(libraryRecommendationsListSchema, req.body);
      if (!parsed.ok) {
        jsonError(res, requestId, 400, "INVALID_ARGUMENT", parsed.message);
        return;
      }

      const itemIdFilter = trimOrNull(parsed.data.itemId);
      const statusFilter = parsed.data.status ?? null;
      const sort = parsed.data.sort ?? "newest";
      const limit = parsed.data.limit ?? 30;
      const scanLimit = Math.max(limit * 5, 120);

      let snap;
      try {
        snap = await db.collection("libraryRecommendations").orderBy("createdAt", "desc").limit(scanLimit).get();
      } catch (error) {
        logger.warn("library.recommendations.list orderBy fallback engaged", {
          requestId,
          message: safeErrorMessage(error),
        });
        snap = await db.collection("libraryRecommendations").limit(scanLimit).get();
      }

      const rows = snap.docs
        .map((docSnap) => ({ id: docSnap.id, row: docSnap.data() as Record<string, unknown> }))
        .filter((entry) => entry.row && typeof entry.row === "object")
        .filter((entry) => {
          const recommendationItemId = trimOrNull(entry.row.itemId);
          if (itemIdFilter && recommendationItemId !== itemIdFilter) return false;

          const moderationStatus = normalizeLibraryRecommendationModerationStatus(entry.row.moderationStatus);
          const ownerUid = trimOrNull(entry.row.recommenderUid);
          if (!isStaff && moderationStatus !== "approved" && ownerUid !== ctx.uid) return false;
          if (statusFilter && moderationStatus !== statusFilter) return false;
          return true;
        });

      rows.sort((a, b) => {
        const helpfulDelta =
          Math.max(0, Math.trunc(readFiniteNumberOrNull(b.row.helpfulCount) ?? 0)) -
          Math.max(0, Math.trunc(readFiniteNumberOrNull(a.row.helpfulCount) ?? 0));
        const createdDelta = readTimestampLikeMs(b.row.createdAt) - readTimestampLikeMs(a.row.createdAt);
        if (sort === "helpful") {
          if (helpfulDelta !== 0) return helpfulDelta;
          return createdDelta;
        }
        if (createdDelta !== 0) return createdDelta;
        return helpfulDelta;
      });

      const recommendations = rows.slice(0, limit).map((entry) => {
        const recommendation = toLibraryRecommendationRow(entry.id, entry.row);
        recommendation.isMine = trimOrNull(entry.row.recommenderUid) === ctx.uid;
        return recommendation;
      });

      await logLibraryAuditEvent({
        req,
        requestId,
        action: "library_recommendations_list",
        resourceType: "library_recommendation",
        resourceId: itemIdFilter ?? "all",
        ownerUid: ctx.uid,
        result: "allow",
        ctx,
        metadata: {
          itemId: itemIdFilter,
          status: statusFilter,
          sort,
          requestedLimit: limit,
          returned: recommendations.length,
        },
      });

      jsonOk(res, requestId, {
        recommendations,
        itemId: itemIdFilter,
        status: statusFilter,
        sort,
        limit,
      });
      return;
    }

    if (route === "/v1/library.recommendations.create") {
      const parsed = parseBody(libraryRecommendationsCreateSchema, req.body);
      if (!parsed.ok) {
        jsonError(res, requestId, 400, "INVALID_ARGUMENT", parsed.message);
        return;
      }

      const itemId = trimOrNull(parsed.data.itemId);
      let title = trimOrNull(parsed.data.title);
      let author = trimOrNull(parsed.data.author);
      let isbn = trimOrNull(parsed.data.isbn);
      const rationale = trimOrNull(parsed.data.rationale);
      const tags = normalizeLibraryRecommendationTags(parsed.data.tags);

      if (!rationale || rationale.length < 8) {
        jsonError(res, requestId, 400, "INVALID_ARGUMENT", "Recommendation rationale must be at least 8 characters.");
        return;
      }

      if (isbn) {
        const cleanedIsbn = isbn.replace(/[^0-9xX]/g, "").toUpperCase();
        if (cleanedIsbn) isbn = cleanedIsbn;
      }

      if (itemId) {
        const itemSnap = await db.collection("libraryItems").doc(itemId).get();
        if (!itemSnap.exists) {
          await logLibraryAuditEvent({
            req,
            requestId,
            action: "library_recommendation_create",
            resourceType: "library_recommendation",
            resourceId: itemId,
            ownerUid: ctx.uid,
            result: "deny",
            reasonCode: "ITEM_NOT_FOUND",
            ctx,
          });
          jsonError(res, requestId, 404, "NOT_FOUND", "Library item not found");
          return;
        }
        const itemRow = itemSnap.data() as Record<string, unknown>;
        if (!itemRow || typeof itemRow !== "object" || isLibraryRowSoftDeleted(itemRow)) {
          await logLibraryAuditEvent({
            req,
            requestId,
            action: "library_recommendation_create",
            resourceType: "library_recommendation",
            resourceId: itemId,
            ownerUid: ctx.uid,
            result: "deny",
            reasonCode: "ITEM_NOT_FOUND",
            ctx,
          });
          jsonError(res, requestId, 404, "NOT_FOUND", "Library item not found");
          return;
        }
        title = title ?? trimOrNull(itemRow.title);
        author = author ?? trimOrNull(readStringArray(itemRow.authors)[0] ?? itemRow.author);
        isbn = isbn ?? trimOrNull(itemRow.isbn13) ?? trimOrNull(itemRow.isbn10) ?? trimOrNull(itemRow.isbn);
      }

      const recommendationId = `rec_${randomBytes(12).toString("hex")}`;
      const now = nowTs();
      const recommendationRow: Record<string, unknown> = {
        itemId: itemId ?? null,
        title: title ?? null,
        author: author ?? null,
        isbn: isbn ?? null,
        rationale,
        tags,
        helpfulCount: 0,
        feedbackCount: 0,
        moderationStatus: "pending_review",
        recommenderUid: ctx.uid,
        createdAt: now,
        updatedAt: now,
        actorMode: ctx.mode,
      };
      await db.collection("libraryRecommendations").doc(recommendationId).set(recommendationRow, { merge: false });

      await logLibraryAuditEvent({
        req,
        requestId,
        action: "library_recommendation_create",
        resourceType: "library_recommendation",
        resourceId: recommendationId,
        ownerUid: ctx.uid,
        result: "allow",
        ctx,
        metadata: {
          itemId: itemId ?? null,
          hasIsbn: Boolean(isbn),
          hasTags: tags.length > 0,
          moderationStatus: "pending_review",
        },
      });

      jsonOk(res, requestId, {
        recommendation: toLibraryRecommendationRow(recommendationId, recommendationRow),
      });
      return;
    }

    if (route === "/v1/library.recommendations.feedback.submit") {
      const parsed = parseBody(libraryRecommendationsFeedbackSubmitSchema, req.body);
      if (!parsed.ok) {
        jsonError(res, requestId, 400, "INVALID_ARGUMENT", parsed.message);
        return;
      }

      const recommendationId = trimOrNull(parsed.data.recommendationId);
      if (!recommendationId) {
        jsonError(res, requestId, 400, "INVALID_ARGUMENT", "Recommendation id is required.");
        return;
      }
      const helpfulInput = parsed.data.helpful;
      const commentInput = trimOrNull(parsed.data.comment);

      const result = await db.runTransaction(async (tx) => {
        const recommendationRef = db.collection("libraryRecommendations").doc(recommendationId);
        const recommendationSnap = await tx.get(recommendationRef) as {
          exists: boolean;
          data: () => Record<string, unknown> | undefined;
        };
        if (!recommendationSnap.exists) {
          return {
            ok: false as const,
            code: "NOT_FOUND",
            message: "Recommendation not found",
            reasonCode: "RECOMMENDATION_NOT_FOUND",
          };
        }
        const recommendationRow = (recommendationSnap.data() ?? {}) as Record<string, unknown>;
        const recommendationOwnerUid = trimOrNull(recommendationRow.recommenderUid);
        const recommendationStatus = normalizeLibraryRecommendationModerationStatus(recommendationRow.moderationStatus);
        if (!isStaff && recommendationStatus !== "approved" && recommendationOwnerUid !== ctx.uid) {
          return {
            ok: false as const,
            code: "FORBIDDEN",
            message: "Recommendation is not available for feedback",
            reasonCode: "RECOMMENDATION_NOT_VISIBLE",
          };
        }

        const feedbackId = `${recommendationId}__${ctx.uid}`;
        const feedbackRef = db.collection("libraryRecommendationFeedback").doc(feedbackId);
        const feedbackSnap = await tx.get(feedbackRef) as {
          exists: boolean;
          data: () => Record<string, unknown> | undefined;
        };
        const existingFeedback = (feedbackSnap.data() ?? {}) as Record<string, unknown>;
        const existingHelpful = existingFeedback.helpful === true;
        const nextHelpful = typeof helpfulInput === "boolean" ? helpfulInput : existingHelpful;
        const nextComment = commentInput ?? trimOrNull(existingFeedback.comment);
        const currentHelpfulCount = Math.max(0, Math.trunc(readFiniteNumberOrNull(recommendationRow.helpfulCount) ?? 0));
        const helpfulDelta = nextHelpful === existingHelpful ? 0 : nextHelpful ? 1 : -1;
        const nextHelpfulCount = Math.max(0, currentHelpfulCount + helpfulDelta);
        const currentFeedbackCount = Math.max(0, Math.trunc(readFiniteNumberOrNull(recommendationRow.feedbackCount) ?? 0));
        const nextFeedbackCount = feedbackSnap.exists ? currentFeedbackCount : currentFeedbackCount + 1;

        const now = nowTs();
        const feedbackModerationStatus = feedbackSnap.exists
          ? normalizeLibraryRecommendationModerationStatus(existingFeedback.moderationStatus)
          : "pending_review";
        const feedbackRow: Record<string, unknown> = {
          recommendationId,
          recommendationItemId: trimOrNull(recommendationRow.itemId),
          recommendationOwnerUid,
          reviewerUid: ctx.uid,
          helpful: nextHelpful,
          comment: nextComment,
          moderationStatus: feedbackModerationStatus,
          updatedAt: now,
          updatedByUid: ctx.uid,
          actorMode: ctx.mode,
        };
        if (!feedbackSnap.exists) {
          feedbackRow.createdAt = now;
        }
        tx.set(feedbackRef, feedbackRow, { merge: true });
        tx.set(
          recommendationRef,
          {
            helpfulCount: nextHelpfulCount,
            feedbackCount: nextFeedbackCount,
            updatedAt: now,
            lastFeedbackAt: now,
          },
          { merge: true }
        );

        return {
          ok: true as const,
          recommendationId,
          feedbackId,
          feedbackRow,
          helpfulCount: nextHelpfulCount,
          feedbackCount: nextFeedbackCount,
          wasCreate: !feedbackSnap.exists,
        };
      });

      if (!result.ok) {
        const httpStatus = result.code === "NOT_FOUND" ? 404 : result.code === "FORBIDDEN" ? 403 : 400;
        await logLibraryAuditEvent({
          req,
          requestId,
          action: "library_recommendation_feedback_submit",
          resourceType: "library_recommendation_feedback",
          resourceId: recommendationId,
          ownerUid: ctx.uid,
          result: "deny",
          reasonCode: result.reasonCode,
          ctx,
          metadata: {
            code: result.code,
          },
        });
        jsonError(res, requestId, httpStatus, result.code, result.message, {
          reasonCode: result.reasonCode,
        });
        return;
      }

      await logLibraryAuditEvent({
        req,
        requestId,
        action: "library_recommendation_feedback_submit",
        resourceType: "library_recommendation_feedback",
        resourceId: result.feedbackId,
        ownerUid: ctx.uid,
        result: "allow",
        ctx,
        metadata: {
          recommendationId: result.recommendationId,
          helpfulCount: result.helpfulCount,
          feedbackCount: result.feedbackCount,
          created: result.wasCreate,
          helpful: result.feedbackRow.helpful === true,
          hasComment: Boolean(trimOrNull(result.feedbackRow.comment)),
        },
      });

      jsonOk(res, requestId, {
        feedback: toLibraryRecommendationFeedbackRow(result.feedbackId, result.feedbackRow),
        recommendation: {
          id: result.recommendationId,
          helpfulCount: result.helpfulCount,
          feedbackCount: result.feedbackCount,
        },
      });
      return;
    }

    if (route === "/v1/library.recommendations.moderate") {
      if (!isStaff) {
        await logLibraryAuditEvent({
          req,
          requestId,
          action: "library_recommendation_moderate",
          resourceType: "library_recommendation",
          resourceId: "moderation",
          ownerUid: ctx.uid,
          result: "deny",
          reasonCode: "FORBIDDEN",
          ctx,
        });
        jsonError(res, requestId, 403, "FORBIDDEN", "Only staff can moderate recommendations.");
        return;
      }

      const parsed = parseBody(libraryRecommendationsModerateSchema, req.body);
      if (!parsed.ok) {
        jsonError(res, requestId, 400, "INVALID_ARGUMENT", parsed.message);
        return;
      }

      const recommendationId = trimOrNull(parsed.data.recommendationId);
      if (!recommendationId) {
        jsonError(res, requestId, 400, "INVALID_ARGUMENT", "Recommendation id is required.");
        return;
      }

      const moderationAction = parsed.data.action;
      const moderationStatus = recommendationModerationStatusFromAction(moderationAction);
      const moderationNote = trimOrNull(parsed.data.note);

      const recommendationRef = db.collection("libraryRecommendations").doc(recommendationId);
      const recommendationSnap = await recommendationRef.get();
      if (!recommendationSnap.exists) {
        await logLibraryAuditEvent({
          req,
          requestId,
          action: "library_recommendation_moderate",
          resourceType: "library_recommendation",
          resourceId: recommendationId,
          ownerUid: ctx.uid,
          result: "deny",
          reasonCode: "RECOMMENDATION_NOT_FOUND",
          ctx,
        });
        jsonError(res, requestId, 404, "NOT_FOUND", "Recommendation not found");
        return;
      }

      const existingRecommendation = (recommendationSnap.data() ?? {}) as Record<string, unknown>;
      const now = nowTs();
      const moderationPatch: Record<string, unknown> = {
        moderationStatus,
        moderationAction,
        moderationNote: moderationNote ?? null,
        moderatedAt: now,
        moderatedByUid: ctx.uid,
        updatedAt: now,
        updatedByUid: ctx.uid,
      };
      await recommendationRef.set(moderationPatch, { merge: true });
      const recommendationRow = {
        ...existingRecommendation,
        ...moderationPatch,
      };

      await logLibraryAuditEvent({
        req,
        requestId,
        action: "library_recommendation_moderate",
        resourceType: "library_recommendation",
        resourceId: recommendationId,
        ownerUid: ctx.uid,
        result: "allow",
        ctx,
        metadata: {
          action: moderationAction,
          moderationStatus,
          hasNote: Boolean(moderationNote),
        },
      });

      jsonOk(res, requestId, {
        recommendation: toLibraryRecommendationRow(recommendationId, recommendationRow),
        moderation: {
          action: moderationAction,
          moderationStatus,
          note: moderationNote,
        },
      });
      return;
    }

    if (route === "/v1/library.recommendations.feedback.moderate") {
      if (!isStaff) {
        await logLibraryAuditEvent({
          req,
          requestId,
          action: "library_recommendation_feedback_moderate",
          resourceType: "library_recommendation_feedback",
          resourceId: "moderation",
          ownerUid: ctx.uid,
          result: "deny",
          reasonCode: "FORBIDDEN",
          ctx,
        });
        jsonError(res, requestId, 403, "FORBIDDEN", "Only staff can moderate recommendation feedback.");
        return;
      }

      const parsed = parseBody(libraryRecommendationsFeedbackModerateSchema, req.body);
      if (!parsed.ok) {
        jsonError(res, requestId, 400, "INVALID_ARGUMENT", parsed.message);
        return;
      }

      const feedbackId = trimOrNull(parsed.data.feedbackId);
      if (!feedbackId) {
        jsonError(res, requestId, 400, "INVALID_ARGUMENT", "Feedback id is required.");
        return;
      }

      const moderationAction = parsed.data.action;
      const moderationStatus = recommendationModerationStatusFromAction(moderationAction);
      const moderationNote = trimOrNull(parsed.data.note);

      const feedbackRef = db.collection("libraryRecommendationFeedback").doc(feedbackId);
      const feedbackSnap = await feedbackRef.get();
      if (!feedbackSnap.exists) {
        await logLibraryAuditEvent({
          req,
          requestId,
          action: "library_recommendation_feedback_moderate",
          resourceType: "library_recommendation_feedback",
          resourceId: feedbackId,
          ownerUid: ctx.uid,
          result: "deny",
          reasonCode: "FEEDBACK_NOT_FOUND",
          ctx,
        });
        jsonError(res, requestId, 404, "NOT_FOUND", "Recommendation feedback not found");
        return;
      }

      const existingFeedback = (feedbackSnap.data() ?? {}) as Record<string, unknown>;
      const recommendationId = trimOrNull(existingFeedback.recommendationId);
      const now = nowTs();
      const moderationPatch: Record<string, unknown> = {
        moderationStatus,
        moderationAction,
        moderationNote: moderationNote ?? null,
        moderatedAt: now,
        moderatedByUid: ctx.uid,
        updatedAt: now,
        updatedByUid: ctx.uid,
      };
      await feedbackRef.set(moderationPatch, { merge: true });
      if (recommendationId) {
        await db.collection("libraryRecommendations").doc(recommendationId).set(
          {
            updatedAt: now,
            lastFeedbackModeratedAt: now,
          },
          { merge: true }
        );
      }
      const feedbackRow = {
        ...existingFeedback,
        ...moderationPatch,
      };

      await logLibraryAuditEvent({
        req,
        requestId,
        action: "library_recommendation_feedback_moderate",
        resourceType: "library_recommendation_feedback",
        resourceId: feedbackId,
        ownerUid: ctx.uid,
        result: "allow",
        ctx,
        metadata: {
          recommendationId,
          action: moderationAction,
          moderationStatus,
          hasNote: Boolean(moderationNote),
        },
      });

      jsonOk(res, requestId, {
        feedback: toLibraryRecommendationFeedbackRow(feedbackId, feedbackRow),
        recommendationId,
        moderation: {
          action: moderationAction,
          moderationStatus,
          note: moderationNote,
        },
      });
      return;
    }

    if (route === "/v1/library.ratings.upsert") {
      const parsed = parseBody(libraryRatingUpsertSchema, req.body);
      if (!parsed.ok) {
        jsonError(res, requestId, 400, "INVALID_ARGUMENT", parsed.message);
        return;
      }

      const itemId = safeString(parsed.data.itemId).trim();
      const itemSnap = await db.collection("libraryItems").doc(itemId).get();
      if (!itemSnap.exists) {
        jsonError(res, requestId, 404, "NOT_FOUND", "Library item not found");
        return;
      }
      const itemRow = itemSnap.data() as Record<string, unknown>;
      if (!itemRow || typeof itemRow !== "object" || isLibraryRowSoftDeleted(itemRow)) {
        jsonError(res, requestId, 404, "NOT_FOUND", "Library item not found");
        return;
      }

      const ratingId = `${ctx.uid}__${itemId}`;
      const ratingRef = db.collection("libraryRatings").doc(ratingId);
      const existing = await ratingRef.get();
      const now = nowTs();
      const payload: Record<string, unknown> = {
        itemId,
        userId: ctx.uid,
        stars: parsed.data.stars,
        updatedAt: now,
        updatedByUid: ctx.uid,
        actorMode: ctx.mode,
      };
      if (!existing.exists) {
        payload.createdAt = now;
      }
      await ratingRef.set(payload, { merge: true });
      await refreshLibraryItemCommunitySignalsSafely(itemId, requestId);

      await logLibraryAuditEvent({
        req,
        requestId,
        action: "library_rating_upsert",
        resourceType: "library_item",
        resourceId: itemId,
        ownerUid: ctx.uid,
        result: "allow",
        ctx,
        metadata: {
          stars: parsed.data.stars,
          ratingId,
        },
      });

      jsonOk(res, requestId, {
        rating: {
          id: ratingId,
          itemId,
          userId: ctx.uid,
          stars: parsed.data.stars,
        },
      });
      return;
    }

    if (route === "/v1/library.reviews.create") {
      const parsed = parseBody(libraryReviewCreateSchema, req.body);
      if (!parsed.ok) {
        jsonError(res, requestId, 400, "INVALID_ARGUMENT", parsed.message);
        return;
      }

      const itemId = safeString(parsed.data.itemId).trim();
      const itemSnap = await db.collection("libraryItems").doc(itemId).get();
      if (!itemSnap.exists) {
        jsonError(res, requestId, 404, "NOT_FOUND", "Library item not found");
        return;
      }
      const itemRow = itemSnap.data() as Record<string, unknown>;
      if (!itemRow || typeof itemRow !== "object" || isLibraryRowSoftDeleted(itemRow)) {
        jsonError(res, requestId, 404, "NOT_FOUND", "Library item not found");
        return;
      }

      const now = nowTs();
      const bodyText = trimOrNull(parsed.data.body);
      const bestFor = trimOrNull(parsed.data.bestFor);
      const reflection = trimOrNull(parsed.data.reflection);
      const reviewRef = await db.collection("libraryReviews").add({
        itemId,
        itemTitle: trimOrNull(itemRow.title) ?? "Library item",
        body: bodyText,
        practicality: parsed.data.practicality ?? null,
        difficulty: parsed.data.difficulty ?? null,
        bestFor,
        reflection,
        reviewerUid: ctx.uid,
        createdAt: now,
        updatedAt: now,
        actorMode: ctx.mode,
      });
      await refreshLibraryItemCommunitySignalsSafely(itemId, requestId);

      await logLibraryAuditEvent({
        req,
        requestId,
        action: "library_review_create",
        resourceType: "library_item",
        resourceId: itemId,
        ownerUid: ctx.uid,
        result: "allow",
        ctx,
        metadata: {
          reviewId: reviewRef.id,
          hasBody: Boolean(bodyText),
          hasReflection: Boolean(reflection),
        },
      });

      jsonOk(res, requestId, {
        review: {
          id: reviewRef.id,
          itemId,
        },
      });
      return;
    }

    if (route === "/v1/library.reviews.update") {
      const parsed = parseBody(libraryReviewUpdateSchema, req.body);
      if (!parsed.ok) {
        jsonError(res, requestId, 400, "INVALID_ARGUMENT", parsed.message);
        return;
      }

      const reviewId = trimOrNull(parsed.data.reviewId);
      if (!reviewId) {
        jsonError(res, requestId, 400, "INVALID_ARGUMENT", "Review id is required.");
        return;
      }

      const reviewRef = db.collection("libraryReviews").doc(reviewId);
      const reviewSnap = await reviewRef.get();
      if (!reviewSnap.exists) {
        jsonError(res, requestId, 404, "NOT_FOUND", "Review not found");
        return;
      }

      const existingReview = (reviewSnap.data() ?? {}) as Record<string, unknown>;
      const reviewerUid = trimOrNull(existingReview.reviewerUid);
      if (!isStaff && reviewerUid !== ctx.uid) {
        await logLibraryAuditEvent({
          req,
          requestId,
          action: "library_review_update",
          resourceType: "library_review",
          resourceId: reviewId,
          ownerUid: ctx.uid,
          result: "deny",
          reasonCode: "FORBIDDEN",
          ctx,
          metadata: {
            reviewerUid,
          },
        });
        jsonError(res, requestId, 403, "FORBIDDEN", "Only the review author or staff can edit this review.");
        return;
      }

      const patch: Record<string, unknown> = {
        updatedAt: nowTs(),
        updatedByUid: ctx.uid,
        actorMode: ctx.mode,
      };
      if (Object.prototype.hasOwnProperty.call(parsed.data, "body")) {
        patch.body = trimOrNull(parsed.data.body);
      }
      if (Object.prototype.hasOwnProperty.call(parsed.data, "practicality")) {
        patch.practicality = parsed.data.practicality ?? null;
      }
      if (Object.prototype.hasOwnProperty.call(parsed.data, "difficulty")) {
        patch.difficulty = parsed.data.difficulty ?? null;
      }
      if (Object.prototype.hasOwnProperty.call(parsed.data, "bestFor")) {
        patch.bestFor = trimOrNull(parsed.data.bestFor);
      }
      if (Object.prototype.hasOwnProperty.call(parsed.data, "reflection")) {
        patch.reflection = trimOrNull(parsed.data.reflection);
      }

      await reviewRef.set(patch, { merge: true });
      const reviewItemId = trimOrNull(existingReview.itemId);
      if (reviewItemId) {
        await refreshLibraryItemCommunitySignalsSafely(reviewItemId, requestId);
      }

      await logLibraryAuditEvent({
        req,
        requestId,
        action: "library_review_update",
        resourceType: "library_review",
        resourceId: reviewId,
        ownerUid: ctx.uid,
        result: "allow",
        ctx,
        metadata: {
          itemId: reviewItemId,
          hasBody: Object.prototype.hasOwnProperty.call(patch, "body"),
          hasPracticality: Object.prototype.hasOwnProperty.call(patch, "practicality"),
          hasDifficulty: Object.prototype.hasOwnProperty.call(patch, "difficulty"),
          hasBestFor: Object.prototype.hasOwnProperty.call(patch, "bestFor"),
          hasReflection: Object.prototype.hasOwnProperty.call(patch, "reflection"),
        },
      });

      jsonOk(res, requestId, {
        review: {
          id: reviewId,
          itemId: trimOrNull(existingReview.itemId),
        },
      });
      return;
    }

    if (route === "/v1/library.tags.submissions.create") {
      const parsed = parseBody(libraryTagSubmissionCreateSchema, req.body);
      if (!parsed.ok) {
        jsonError(res, requestId, 400, "INVALID_ARGUMENT", parsed.message);
        return;
      }

      const itemId = safeString(parsed.data.itemId).trim();
      const normalizedTagLabel = normalizeLibraryTagLabel(parsed.data.tag);
      const normalizedTagToken = normalizeLibraryTagToken(parsed.data.tag);
      if (!normalizedTagLabel || !normalizedTagToken) {
        jsonError(res, requestId, 400, "INVALID_ARGUMENT", "Tag must include at least one alphanumeric character.");
        return;
      }

      const itemSnap = await db.collection("libraryItems").doc(itemId).get();
      if (!itemSnap.exists) {
        jsonError(res, requestId, 404, "NOT_FOUND", "Library item not found");
        return;
      }
      const itemRow = itemSnap.data() as Record<string, unknown>;
      if (!itemRow || typeof itemRow !== "object" || isLibraryRowSoftDeleted(itemRow)) {
        jsonError(res, requestId, 404, "NOT_FOUND", "Library item not found");
        return;
      }

      const existingItemTags = readStringArray((itemRow.tags ?? itemRow.secondaryTags) as unknown)
        .map((entry) => normalizeLibraryTagToken(entry))
        .filter((entry): entry is string => Boolean(entry));
      if (existingItemTags.includes(normalizedTagToken)) {
        jsonError(res, requestId, 409, "CONFLICT", "This item already includes that tag.");
        return;
      }

      let existingAssociationFound = false;
      try {
        const itemTagSnap = await db.collection("libraryItemTags").where("itemId", "==", itemId).limit(250).get();
        for (const docSnap of itemTagSnap.docs) {
          const row = (docSnap.data() ?? {}) as Record<string, unknown>;
          const rowItemId = trimOrNull(row.itemId);
          if (rowItemId !== itemId) continue;
          const rowToken = normalizeLibraryTagToken(row.normalizedTag ?? row.tag ?? row.name);
          const rowStatus = normalizeToken(row.status || "active");
          if (rowToken === normalizedTagToken && rowStatus !== "merged") {
            existingAssociationFound = true;
            break;
          }
        }
      } catch {
        existingAssociationFound = false;
      }
      if (existingAssociationFound) {
        jsonError(res, requestId, 409, "CONFLICT", "This item already includes that tag.");
        return;
      }

      const submissionSnap = await db.collection("libraryTagSubmissions").limit(300).get();
      const duplicatePending = submissionSnap.docs.some((docSnap) => {
        const row = (docSnap.data() ?? {}) as Record<string, unknown>;
        const rowItemId = trimOrNull(row.itemId);
        const rowTagToken = normalizeLibraryTagToken(row.normalizedTag ?? row.tag);
        const rowStatus = normalizeToken(row.status || "pending");
        const rowOwner = trimOrNull(row.submittedByUid);
        return rowItemId === itemId && rowTagToken === normalizedTagToken && rowStatus === "pending" && rowOwner === ctx.uid;
      });
      if (duplicatePending) {
        jsonError(res, requestId, 409, "CONFLICT", "You already submitted this tag and it is pending review.");
        return;
      }

      const submissionId = `tagsub_${randomBytes(10).toString("hex")}`;
      const now = nowTs();
      const submissionRow: Record<string, unknown> = {
        itemId,
        itemTitle: trimOrNull(itemRow.title) ?? "Library item",
        tag: normalizedTagLabel,
        normalizedTag: normalizedTagToken,
        status: "pending",
        submittedByUid: ctx.uid,
        submittedByName: trimOrNull(ctx.decoded?.name) ?? null,
        createdAt: now,
        updatedAt: now,
        actorMode: ctx.mode,
      };
      await db.collection("libraryTagSubmissions").doc(submissionId).set(submissionRow, { merge: false });

      await logLibraryAuditEvent({
        req,
        requestId,
        action: "library_tag_submission_create",
        resourceType: "library_tag_submission",
        resourceId: submissionId,
        ownerUid: ctx.uid,
        result: "allow",
        ctx,
        metadata: {
          itemId,
          tag: normalizedTagLabel,
        },
      });

      jsonOk(res, requestId, {
        submission: {
          id: submissionId,
          itemId,
          tag: normalizedTagLabel,
          normalizedTag: normalizedTagToken,
          status: "pending",
        },
      });
      return;
    }

    if (route === "/v1/library.tags.submissions.approve") {
      if (!isStaff) {
        jsonError(res, requestId, 403, "FORBIDDEN", "Only staff can approve tag submissions.");
        return;
      }

      const parsed = parseBody(libraryTagSubmissionApproveSchema, req.body);
      if (!parsed.ok) {
        jsonError(res, requestId, 400, "INVALID_ARGUMENT", parsed.message);
        return;
      }

      const submissionId = trimOrNull(parsed.data.submissionId);
      if (!submissionId) {
        jsonError(res, requestId, 400, "INVALID_ARGUMENT", "Submission id is required.");
        return;
      }

      const submissionRef = db.collection("libraryTagSubmissions").doc(submissionId);
      const submissionSnap = await submissionRef.get();
      if (!submissionSnap.exists) {
        jsonError(res, requestId, 404, "NOT_FOUND", "Tag submission not found");
        return;
      }

      const submissionRow = (submissionSnap.data() ?? {}) as Record<string, unknown>;
      const itemId = trimOrNull(submissionRow.itemId);
      if (!itemId) {
        jsonError(res, requestId, 400, "FAILED_PRECONDITION", "Submission is missing item reference.");
        return;
      }
      const submissionTagLabel = normalizeLibraryTagLabel(submissionRow.tag);
      const submissionTagToken = normalizeLibraryTagToken(submissionRow.normalizedTag ?? submissionRow.tag);
      if (!submissionTagLabel || !submissionTagToken) {
        jsonError(res, requestId, 400, "FAILED_PRECONDITION", "Submission tag is invalid.");
        return;
      }

      let canonicalTagId = trimOrNull(parsed.data.canonicalTagId);
      let canonicalTagLabel =
        normalizeLibraryTagLabel(parsed.data.canonicalTagName) ??
        submissionTagLabel;
      let canonicalTagToken = normalizeLibraryTagToken(canonicalTagLabel) ?? submissionTagToken;
      const now = nowTs();

      if (canonicalTagId) {
        const canonicalSnap = await db.collection("libraryTags").doc(canonicalTagId).get();
        if (!canonicalSnap.exists) {
          jsonError(res, requestId, 404, "NOT_FOUND", "Canonical tag not found");
          return;
        }
        const canonicalRow = (canonicalSnap.data() ?? {}) as Record<string, unknown>;
        canonicalTagLabel =
          normalizeLibraryTagLabel(canonicalRow.name ?? canonicalRow.tag ?? canonicalTagLabel) ??
          canonicalTagLabel;
        canonicalTagToken =
          normalizeLibraryTagToken(canonicalRow.normalizedTag ?? canonicalRow.token ?? canonicalTagLabel) ??
          canonicalTagToken;
      } else {
        const tagsSnap = await db.collection("libraryTags").limit(500).get();
        const existingTag = tagsSnap.docs.find((docSnap) => {
          const row = (docSnap.data() ?? {}) as Record<string, unknown>;
          const status = normalizeToken(row.status || "active");
          const token = normalizeLibraryTagToken(row.normalizedTag ?? row.token ?? row.name ?? row.tag);
          return status !== "merged" && token === canonicalTagToken;
        });
        if (existingTag) {
          canonicalTagId = existingTag.id;
          const existingRow = (existingTag.data() ?? {}) as Record<string, unknown>;
          canonicalTagLabel =
            normalizeLibraryTagLabel(existingRow.name ?? existingRow.tag ?? canonicalTagLabel) ??
            canonicalTagLabel;
          canonicalTagToken =
            normalizeLibraryTagToken(existingRow.normalizedTag ?? existingRow.token ?? canonicalTagLabel) ??
            canonicalTagToken;
        } else {
          canonicalTagId = `tag_${randomBytes(10).toString("hex")}`;
          await db.collection("libraryTags").doc(canonicalTagId).set(
            {
              name: canonicalTagLabel,
              tag: canonicalTagLabel,
              normalizedTag: canonicalTagToken,
              status: "active",
              createdAt: now,
              createdByUid: ctx.uid,
              updatedAt: now,
              updatedByUid: ctx.uid,
            },
            { merge: false }
          );
        }
      }

      const itemTagId = `${itemId}__${canonicalTagId}`;
      await db.collection("libraryItemTags").doc(itemTagId).set(
        {
          itemId,
          tagId: canonicalTagId,
          tag: canonicalTagLabel,
          normalizedTag: canonicalTagToken,
          status: "active",
          approvedFromSubmissionId: submissionId,
          approvedByUid: ctx.uid,
          createdAt: now,
          updatedAt: now,
        },
        { merge: true }
      );

      await submissionRef.set(
        {
          status: "approved",
          canonicalTagId,
          canonicalTag: canonicalTagLabel,
          canonicalNormalizedTag: canonicalTagToken,
          moderatedAt: now,
          moderatedByUid: ctx.uid,
          updatedAt: now,
        },
        { merge: true }
      );

      const itemRef = db.collection("libraryItems").doc(itemId);
      const itemSnap = await itemRef.get();
      if (itemSnap.exists) {
        const itemRow = (itemSnap.data() ?? {}) as Record<string, unknown>;
        const existingTags = readStringArray((itemRow.tags ?? itemRow.secondaryTags) as unknown)
          .map((entry) => normalizeLibraryTagLabel(entry))
          .filter((entry): entry is string => Boolean(entry));
        if (!existingTags.includes(canonicalTagLabel)) {
          const nextTags = Array.from(new Set([...existingTags, canonicalTagLabel])).slice(0, 60);
          await itemRef.set(
            {
              tags: nextTags,
              secondaryTags: nextTags,
              updatedAt: now,
              updatedByUid: ctx.uid,
            },
            { merge: true }
          );
        }
      }

      await logLibraryAuditEvent({
        req,
        requestId,
        action: "library_tag_submission_approve",
        resourceType: "library_tag_submission",
        resourceId: submissionId,
        ownerUid: ctx.uid,
        result: "allow",
        ctx,
        metadata: {
          itemId,
          canonicalTagId,
          canonicalTag: canonicalTagLabel,
        },
      });

      jsonOk(res, requestId, {
        submission: {
          id: submissionId,
          itemId,
          status: "approved",
          canonicalTagId,
          canonicalTag: canonicalTagLabel,
        },
        tag: {
          id: canonicalTagId,
          name: canonicalTagLabel,
          normalizedTag: canonicalTagToken,
        },
      });
      return;
    }

    if (route === "/v1/library.tags.merge") {
      if (!isStaff) {
        jsonError(res, requestId, 403, "FORBIDDEN", "Only staff can merge tags.");
        return;
      }

      const parsed = parseBody(libraryTagMergeSchema, req.body);
      if (!parsed.ok) {
        jsonError(res, requestId, 400, "INVALID_ARGUMENT", parsed.message);
        return;
      }

      const sourceTagId = trimOrNull(parsed.data.sourceTagId);
      const targetTagId = trimOrNull(parsed.data.targetTagId);
      const note = trimOrNull(parsed.data.note);
      if (!sourceTagId || !targetTagId) {
        jsonError(res, requestId, 400, "INVALID_ARGUMENT", "Source and target tag IDs are required.");
        return;
      }
      if (sourceTagId === targetTagId) {
        jsonError(res, requestId, 400, "INVALID_ARGUMENT", "Source and target tags must differ.");
        return;
      }

      const sourceRef = db.collection("libraryTags").doc(sourceTagId);
      const targetRef = db.collection("libraryTags").doc(targetTagId);
      const [sourceSnap, targetSnap] = await Promise.all([sourceRef.get(), targetRef.get()]);
      if (!sourceSnap.exists || !targetSnap.exists) {
        jsonError(res, requestId, 404, "NOT_FOUND", "Source or target tag not found");
        return;
      }

      const sourceRow = (sourceSnap.data() ?? {}) as Record<string, unknown>;
      const targetRow = (targetSnap.data() ?? {}) as Record<string, unknown>;
      const targetTagLabel =
        normalizeLibraryTagLabel(targetRow.name ?? targetRow.tag) ??
        normalizeLibraryTagLabel(sourceRow.name ?? sourceRow.tag) ??
        "tag";
      const targetTagToken = normalizeLibraryTagToken(targetRow.normalizedTag ?? targetTagLabel) ?? targetTagLabel;
      const now = nowTs();

      let migratedItemTags = 0;
      const itemTagSnap = await db.collection("libraryItemTags").limit(2000).get();
      for (const docSnap of itemTagSnap.docs) {
        const row = (docSnap.data() ?? {}) as Record<string, unknown>;
        const rowTagId = trimOrNull(row.tagId);
        if (rowTagId !== sourceTagId) continue;
        const itemId = trimOrNull(row.itemId);
        if (!itemId) continue;

        const targetAssociationId = `${itemId}__${targetTagId}`;
        await db.collection("libraryItemTags").doc(targetAssociationId).set(
          {
            itemId,
            tagId: targetTagId,
            tag: targetTagLabel,
            normalizedTag: targetTagToken,
            status: "active",
            mergedFromTagId: sourceTagId,
            updatedAt: now,
            updatedByUid: ctx.uid,
          },
          { merge: true }
        );
        await db.collection("libraryItemTags").doc(docSnap.id).set(
          {
            status: "merged",
            mergedIntoTagId: targetTagId,
            mergedAt: now,
            mergedByUid: ctx.uid,
            updatedAt: now,
            updatedByUid: ctx.uid,
          },
          { merge: true }
        );
        migratedItemTags += 1;
      }

      let retargetedSubmissions = 0;
      const submissionSnap = await db.collection("libraryTagSubmissions").limit(2000).get();
      for (const docSnap of submissionSnap.docs) {
        const row = (docSnap.data() ?? {}) as Record<string, unknown>;
        const canonicalTagId = trimOrNull(row.canonicalTagId);
        if (canonicalTagId !== sourceTagId) continue;
        await db.collection("libraryTagSubmissions").doc(docSnap.id).set(
          {
            canonicalTagId: targetTagId,
            canonicalTag: targetTagLabel,
            canonicalNormalizedTag: targetTagToken,
            updatedAt: now,
            updatedByUid: ctx.uid,
          },
          { merge: true }
        );
        retargetedSubmissions += 1;
      }

      await sourceRef.set(
        {
          status: "merged",
          mergedIntoTagId: targetTagId,
          mergedAt: now,
          mergedByUid: ctx.uid,
          mergeNote: note ?? null,
          updatedAt: now,
          updatedByUid: ctx.uid,
        },
        { merge: true }
      );
      await targetRef.set(
        {
          updatedAt: now,
          updatedByUid: ctx.uid,
        },
        { merge: true }
      );

      await logLibraryAuditEvent({
        req,
        requestId,
        action: "library_tags_merge",
        resourceType: "library_tag",
        resourceId: sourceTagId,
        ownerUid: ctx.uid,
        result: "allow",
        ctx,
        metadata: {
          sourceTagId,
          targetTagId,
          migratedItemTags,
          retargetedSubmissions,
          hasNote: Boolean(note),
        },
      });

      jsonOk(res, requestId, {
        sourceTagId,
        targetTagId,
        migratedItemTags,
        retargetedSubmissions,
      });
      return;
    }

    if (route === "/v1/library.readingStatus.upsert") {
      const parsed = parseBody(libraryReadingStatusUpsertSchema, req.body);
      if (!parsed.ok) {
        jsonError(res, requestId, 400, "INVALID_ARGUMENT", parsed.message);
        return;
      }

      const itemId = safeString(parsed.data.itemId).trim();
      const itemSnap = await db.collection("libraryItems").doc(itemId).get();
      if (!itemSnap.exists) {
        jsonError(res, requestId, 404, "NOT_FOUND", "Library item not found");
        return;
      }
      const itemRow = itemSnap.data() as Record<string, unknown>;
      if (!itemRow || typeof itemRow !== "object" || isLibraryRowSoftDeleted(itemRow)) {
        jsonError(res, requestId, 404, "NOT_FOUND", "Library item not found");
        return;
      }

      const statusId = `${ctx.uid}__${itemId}`;
      const statusRef = db.collection("libraryReadingStatus").doc(statusId);
      const existing = await statusRef.get();
      const now = nowTs();
      const payload: Record<string, unknown> = {
        userId: ctx.uid,
        itemId,
        status: parsed.data.status,
        updatedAt: now,
        updatedByUid: ctx.uid,
        actorMode: ctx.mode,
      };
      if (!existing.exists) {
        payload.createdAt = now;
      }
      await statusRef.set(payload, { merge: true });

      await logLibraryAuditEvent({
        req,
        requestId,
        action: "library_reading_status_upsert",
        resourceType: "library_item",
        resourceId: itemId,
        ownerUid: ctx.uid,
        result: "allow",
        ctx,
        metadata: {
          status: parsed.data.status,
          statusId,
        },
      });

      jsonOk(res, requestId, {
        readingStatus: {
          id: statusId,
          itemId,
          userId: ctx.uid,
          status: parsed.data.status,
        },
      });
      return;
    }

    if (route === "/v1/library.loans.checkout") {
      const parsed = parseBody(libraryLoanCheckoutSchema, req.body);
      if (!parsed.ok) {
        jsonError(res, requestId, 400, "INVALID_ARGUMENT", parsed.message);
        return;
      }

      const itemId = safeString(parsed.data.itemId).trim();
      const loanWindowMs = 28 * 24 * 60 * 60 * 1000;
      const nowMs = Date.now();
      const dueAt = Timestamp.fromMillis(nowMs + loanWindowMs);
      const suggestedDonationCents = parsed.data.suggestedDonationCents ?? null;
      const idempotencyKeyResult = resolveIdempotencyKey(req, parsed.data.idempotencyKey);
      if (!idempotencyKeyResult.ok) {
        jsonError(res, requestId, 400, "INVALID_ARGUMENT", idempotencyKeyResult.message);
        return;
      }
      const idempotencyKey = idempotencyKeyResult.key;
      const idempotencyFingerprint = libraryLoanIdempotencyFingerprint("checkout", {
        itemId,
        suggestedDonationCents,
      });
      if (idempotencyKey) {
        const replay = await readLibraryLoanIdempotencyReplay({
          actorUid: ctx.uid,
          operation: "checkout",
          key: idempotencyKey,
          fingerprint: idempotencyFingerprint,
        });
        if (replay.kind === "conflict") {
          await logLibraryAuditEvent({
            req,
            requestId,
            action: "library_loan_checkout",
            resourceType: "library_item",
            resourceId: itemId,
            ownerUid: ctx.uid,
            result: "deny",
            reasonCode: "IDEMPOTENCY_KEY_CONFLICT",
            ctx,
            metadata: {
              code: "CONFLICT",
              idempotencyKeyProvided: true,
            },
          });
          jsonError(
            res,
            requestId,
            409,
            "CONFLICT",
            "Idempotency key is already in use for a different checkout request.",
            { reasonCode: "IDEMPOTENCY_KEY_CONFLICT" },
          );
          return;
        }
        if (replay.kind === "replay") {
          await logLibraryAuditEvent({
            req,
            requestId,
            action: "library_loan_checkout",
            resourceType: "library_item",
            resourceId: itemId,
            ownerUid: ctx.uid,
            result: "allow",
            ctx,
            metadata: {
              idempotentReplay: true,
              idempotencyKeyProvided: true,
            },
          });
          jsonOk(res, requestId, replay.responseData);
          return;
        }
      }

      const result = await db.runTransaction(async (tx) => {
        const itemRef = db.collection("libraryItems").doc(itemId);
        const loanId = idempotencyKey
          ? makeIdempotencyId("library-loan-checkout", ctx.uid, idempotencyKey)
          : `loan_${randomBytes(12).toString("hex")}`;
        const loanRef = db.collection("libraryLoans").doc(loanId);
        const [itemSnap, existingLoanSnap] = await Promise.all([
          tx.get(itemRef) as Promise<{ exists: boolean; data: () => Record<string, unknown> | undefined }>,
          tx.get(loanRef) as Promise<{ exists: boolean; data: () => Record<string, unknown> | undefined }>,
        ]);
        if (existingLoanSnap.exists) {
          const existingLoan = (existingLoanSnap.data() ?? {}) as Record<string, unknown>;
          const existingItemId = safeString(existingLoan.itemId).trim();
          const existingBorrowerUid = safeString(existingLoan.borrowerUid).trim();
          const existingDonationRaw = readFiniteNumberOrNull(existingLoan.suggestedDonationCents);
          const existingDonationCents = existingDonationRaw === null ? null : Math.trunc(existingDonationRaw);
          if (
            existingItemId !== itemId ||
            existingBorrowerUid !== ctx.uid ||
            existingDonationCents !== suggestedDonationCents
          ) {
            return {
              ok: false as const,
              code: "CONFLICT",
              message: "Idempotency key is already in use for a different checkout request.",
              reasonCode: "IDEMPOTENCY_KEY_CONFLICT",
            };
          }
          const itemRow = itemSnap.exists
            ? ((itemSnap.data() ?? {}) as Record<string, unknown>)
            : null;
          const availableCopies =
            itemRow && !isLibraryRowSoftDeleted(itemRow)
              ? Math.max(
                0,
                Math.trunc(
                  readFiniteNumberOrNull(itemRow.availableCopies) ??
                    readFiniteNumberOrNull(itemRow.totalCopies) ??
                    0,
                ),
              )
              : 0;
          const itemStatus =
            itemRow && !isLibraryRowSoftDeleted(itemRow)
              ? normalizeLibraryStatus(itemRow)
              : "checked_out";
          return {
            ok: true as const,
            loanId,
            itemId: existingItemId || itemId,
            dueAt: existingLoan.dueAt ?? dueAt,
            status: normalizeLibraryLoanStatus(existingLoan.status || "checked_out"),
            nextItemStatus: itemStatus,
            availableCopies,
            idempotentReplay: true,
          };
        }

        if (!itemSnap.exists) {
          return { ok: false as const, code: "NOT_FOUND", message: "Library item not found", reasonCode: "ITEM_NOT_FOUND" };
        }
        const itemRow = (itemSnap.data() ?? {}) as Record<string, unknown>;
        if (isLibraryRowSoftDeleted(itemRow)) {
          return { ok: false as const, code: "NOT_FOUND", message: "Library item not found", reasonCode: "ITEM_NOT_FOUND" };
        }
        if (!isLibraryItemLendingEligible(itemRow)) {
          return {
            ok: false as const,
            code: "CONFLICT",
            message: "Item is not eligible for physical lending",
            reasonCode: "ITEM_NOT_LENDABLE",
          };
        }

        const status = normalizeLibraryStatus(itemRow);
        const totalCopies = Math.max(1, Math.trunc(readFiniteNumberOrNull(itemRow.totalCopies) ?? 1));
        const availableCopies = Math.max(
          0,
          Math.trunc(readFiniteNumberOrNull(itemRow.availableCopies) ?? totalCopies),
        );
        if (status === "lost") {
          return {
            ok: false as const,
            code: "CONFLICT",
            message: "Item is marked lost and cannot be checked out",
            reasonCode: "ITEM_MARKED_LOST",
          };
        }
        if (status === "archived" || status === "unavailable") {
          return {
            ok: false as const,
            code: "CONFLICT",
            message: "Item is not currently available for checkout",
            reasonCode: "ITEM_NOT_AVAILABLE",
          };
        }
        if (status !== "available" || availableCopies < 1) {
          return {
            ok: false as const,
            code: "CONFLICT",
            message: "Item is not currently available for checkout",
            reasonCode: "NO_AVAILABLE_COPIES",
          };
        }

        const nextAvailableCopies = Math.max(0, availableCopies - 1);
        const nextStatus = nextAvailableCopies > 0 ? "available" : "checked_out";
        const nowTsValue = nowTs();

        tx.set(
          loanRef,
          {
            itemId,
            itemTitle: trimOrNull(itemRow.title) ?? "Library item",
            borrowerUid: ctx.uid,
            borrowerName: null,
            borrowerEmail: null,
            status: "checked_out",
            loanedAt: nowTsValue,
            dueAt,
            returnedAt: null,
            renewalEligible: true,
            renewalCount: 0,
            renewalLimit: 1,
            renewalPolicyNote: "Standard 4-week lending cycle.",
            suggestedDonationCents,
            createdAt: nowTsValue,
            updatedAt: nowTsValue,
          },
          { merge: true },
        );

        tx.set(
          itemRef,
          {
            availableCopies: nextAvailableCopies,
            status: nextStatus,
            current_lending_status: nextStatus,
            updatedAt: nowTsValue,
          },
          { merge: true },
        );

        return {
          ok: true as const,
          loanId,
          itemId,
          dueAt,
          status: "checked_out",
          nextItemStatus: nextStatus,
          availableCopies: nextAvailableCopies,
          idempotentReplay: false,
        };
      });

      if (!result.ok) {
        const httpStatus = result.code === "NOT_FOUND" ? 404 : result.code === "CONFLICT" ? 409 : 400;
        await logLibraryAuditEvent({
          req,
          requestId,
          action: "library_loan_checkout",
          resourceType: "library_item",
          resourceId: itemId,
          ownerUid: ctx.uid,
          result: "deny",
          reasonCode: result.reasonCode,
          ctx,
          metadata: {
            code: result.code,
            idempotencyKeyProvided: Boolean(idempotencyKey),
          },
        });
        jsonError(res, requestId, httpStatus, result.code, result.message, {
          reasonCode: result.reasonCode ?? null,
        });
        return;
      }

      await logLibraryAuditEvent({
        req,
        requestId,
        action: "library_loan_checkout",
        resourceType: "library_item",
        resourceId: result.itemId,
        ownerUid: ctx.uid,
        result: "allow",
        ctx,
        metadata: {
          loanId: result.loanId,
          dueAt: result.dueAt,
          availableCopies: result.availableCopies,
          idempotentReplay: result.idempotentReplay,
          idempotencyKeyProvided: Boolean(idempotencyKey),
        },
      });
      const responseData = {
        loan: {
          id: result.loanId,
          itemId: result.itemId,
          status: result.status,
          dueAt: result.dueAt,
          idempotentReplay: result.idempotentReplay,
        },
        item: {
          itemId: result.itemId,
          status: result.nextItemStatus,
          availableCopies: result.availableCopies,
        },
      };
      if (idempotencyKey) {
        await persistLibraryLoanIdempotencyRecord({
          actorUid: ctx.uid,
          operation: "checkout",
          key: idempotencyKey,
          fingerprint: idempotencyFingerprint,
          responseData,
          requestId,
        });
      }
      jsonOk(res, requestId, responseData);
      return;
    }

    if (route === "/v1/library.loans.checkIn") {
      const parsed = parseBody(libraryLoanCheckInSchema, req.body);
      if (!parsed.ok) {
        jsonError(res, requestId, 400, "INVALID_ARGUMENT", parsed.message);
        return;
      }

      const loanId = safeString(parsed.data.loanId).trim();
      const idempotencyKeyResult = resolveIdempotencyKey(req, parsed.data.idempotencyKey);
      if (!idempotencyKeyResult.ok) {
        jsonError(res, requestId, 400, "INVALID_ARGUMENT", idempotencyKeyResult.message);
        return;
      }
      const idempotencyKey = idempotencyKeyResult.key;
      const idempotencyFingerprint = libraryLoanIdempotencyFingerprint("checkIn", { loanId });
      if (idempotencyKey) {
        const replay = await readLibraryLoanIdempotencyReplay({
          actorUid: ctx.uid,
          operation: "checkIn",
          key: idempotencyKey,
          fingerprint: idempotencyFingerprint,
        });
        if (replay.kind === "conflict") {
          await logLibraryAuditEvent({
            req,
            requestId,
            action: "library_loan_checkin",
            resourceType: "library_loan",
            resourceId: loanId,
            ownerUid: ctx.uid,
            result: "deny",
            reasonCode: "IDEMPOTENCY_KEY_CONFLICT",
            ctx,
            metadata: {
              code: "CONFLICT",
              idempotencyKeyProvided: true,
            },
          });
          jsonError(
            res,
            requestId,
            409,
            "CONFLICT",
            "Idempotency key is already in use for a different check-in request.",
            { reasonCode: "IDEMPOTENCY_KEY_CONFLICT" },
          );
          return;
        }
        if (replay.kind === "replay") {
          await logLibraryAuditEvent({
            req,
            requestId,
            action: "library_loan_checkin",
            resourceType: "library_loan",
            resourceId: loanId,
            ownerUid: ctx.uid,
            result: "allow",
            ctx,
            metadata: {
              idempotentReplay: true,
              idempotencyKeyProvided: true,
            },
          });
          jsonOk(res, requestId, replay.responseData);
          return;
        }
      }
      const result = await db.runTransaction(async (tx) => {
        const loanRef = db.collection("libraryLoans").doc(loanId);
        const loanSnap = await tx.get(loanRef) as { exists: boolean; data: () => Record<string, unknown> | undefined };
        if (!loanSnap.exists) {
          return { ok: false as const, code: "NOT_FOUND", message: "Loan not found", reasonCode: "LOAN_NOT_FOUND" };
        }
        const loanRow = (loanSnap.data() ?? {}) as Record<string, unknown>;
        const borrowerUid = safeString(loanRow.borrowerUid).trim();
        if (!isStaff && borrowerUid !== ctx.uid) {
          return {
            ok: false as const,
            code: "FORBIDDEN",
            message: "Only the borrower or staff can check in this loan",
            reasonCode: "CHECKIN_FORBIDDEN",
          };
        }
        const currentStatus = normalizeLibraryLoanStatus(loanRow.status);
        const itemId = safeString(loanRow.itemId).trim();
        if (!itemId) {
          return {
            ok: false as const,
            code: "FAILED_PRECONDITION",
            message: "Loan is missing item linkage",
            reasonCode: "LOAN_MISSING_ITEM_LINKAGE",
          };
        }

        const itemRef = db.collection("libraryItems").doc(itemId);
        const itemSnap = await tx.get(itemRef) as { exists: boolean; data: () => Record<string, unknown> | undefined };
        if (!itemSnap.exists) {
          return {
            ok: false as const,
            code: "NOT_FOUND",
            message: "Linked library item not found",
            reasonCode: "ITEM_NOT_FOUND",
          };
        }
        const itemRow = (itemSnap.data() ?? {}) as Record<string, unknown>;
        if (isLibraryRowSoftDeleted(itemRow)) {
          return {
            ok: false as const,
            code: "NOT_FOUND",
            message: "Linked library item not found",
            reasonCode: "ITEM_NOT_FOUND",
          };
        }

        if (currentStatus === "returned") {
          const availableCopies = Math.max(
            0,
            Math.trunc(readFiniteNumberOrNull(itemRow.availableCopies) ?? readFiniteNumberOrNull(itemRow.totalCopies) ?? 1),
          );
          return {
            ok: true as const,
            loanId,
            itemId,
            idempotentReplay: true,
            availableCopies,
          };
        }
        if (currentStatus !== "checked_out" && currentStatus !== "overdue" && currentStatus !== "return_requested") {
          return {
            ok: false as const,
            code: "CONFLICT",
            message: "Loan status cannot transition to returned",
            reasonCode: "INVALID_LOAN_TRANSITION",
          };
        }

        const nowTsValue = nowTs();
        const totalCopies = Math.max(1, Math.trunc(readFiniteNumberOrNull(itemRow.totalCopies) ?? 1));
        const availableCopies = Math.max(
          0,
          Math.trunc(readFiniteNumberOrNull(itemRow.availableCopies) ?? totalCopies),
        );
        const nextAvailableCopies = Math.min(totalCopies, availableCopies + 1);
        tx.set(
          loanRef,
          {
            status: "returned",
            returnedAt: nowTsValue,
            updatedAt: nowTsValue,
            updatedByUid: ctx.uid,
          },
          { merge: true },
        );
        tx.set(
          itemRef,
          {
            availableCopies: nextAvailableCopies,
            status: "available",
            current_lending_status: "available",
            updatedAt: nowTsValue,
          },
          { merge: true },
        );

        return {
          ok: true as const,
          loanId,
          itemId,
          idempotentReplay: false,
          availableCopies: nextAvailableCopies,
        };
      });

      if (!result.ok) {
        const httpStatus =
          result.code === "NOT_FOUND" ? 404 : result.code === "FORBIDDEN" ? 403 : result.code === "CONFLICT" ? 409 : 400;
        await logLibraryAuditEvent({
          req,
          requestId,
          action: "library_loan_checkin",
          resourceType: "library_loan",
          resourceId: loanId,
          ownerUid: ctx.uid,
          result: "deny",
          reasonCode: result.reasonCode,
          ctx,
          metadata: {
            code: result.code,
            idempotencyKeyProvided: Boolean(idempotencyKey),
          },
        });
        jsonError(res, requestId, httpStatus, result.code, result.message, {
          reasonCode: result.reasonCode ?? null,
        });
        return;
      }

      await logLibraryAuditEvent({
        req,
        requestId,
        action: "library_loan_checkin",
        resourceType: "library_loan",
        resourceId: result.loanId,
        ownerUid: ctx.uid,
        result: "allow",
        ctx,
        metadata: {
          itemId: result.itemId,
          idempotentReplay: result.idempotentReplay,
          availableCopies: result.availableCopies,
          idempotencyKeyProvided: Boolean(idempotencyKey),
        },
      });

      const responseData = {
        loan: {
          id: result.loanId,
          status: "returned",
          idempotentReplay: result.idempotentReplay,
        },
        item: {
          itemId: result.itemId,
          status: "available",
          availableCopies: result.availableCopies,
        },
      };
      if (idempotencyKey) {
        await persistLibraryLoanIdempotencyRecord({
          actorUid: ctx.uid,
          operation: "checkIn",
          key: idempotencyKey,
          fingerprint: idempotencyFingerprint,
          responseData,
          requestId,
        });
      }
      jsonOk(res, requestId, responseData);
      return;
    }

    if (route === "/v1/library.loans.markLost") {
      if (!isStaff) {
        jsonError(res, requestId, 403, "FORBIDDEN", "Only staff can mark loans as lost.");
        return;
      }
      const parsed = parseBody(libraryLoanMarkLostSchema, req.body);
      if (!parsed.ok) {
        jsonError(res, requestId, 400, "INVALID_ARGUMENT", parsed.message);
        return;
      }

      const loanId = safeString(parsed.data.loanId).trim();
      const lostNote = trimOrNull(parsed.data.note);
      const idempotencyKeyResult = resolveIdempotencyKey(req, parsed.data.idempotencyKey);
      if (!idempotencyKeyResult.ok) {
        jsonError(res, requestId, 400, "INVALID_ARGUMENT", idempotencyKeyResult.message);
        return;
      }
      const idempotencyKey = idempotencyKeyResult.key;
      const idempotencyFingerprint = libraryLoanIdempotencyFingerprint("markLost", {
        loanId,
        note: lostNote,
      });
      if (idempotencyKey) {
        const replay = await readLibraryLoanIdempotencyReplay({
          actorUid: ctx.uid,
          operation: "markLost",
          key: idempotencyKey,
          fingerprint: idempotencyFingerprint,
        });
        if (replay.kind === "conflict") {
          await logLibraryAuditEvent({
            req,
            requestId,
            action: "library_loan_mark_lost",
            resourceType: "library_loan",
            resourceId: loanId,
            ownerUid: ctx.uid,
            result: "deny",
            reasonCode: "IDEMPOTENCY_KEY_CONFLICT",
            ctx,
            metadata: {
              code: "CONFLICT",
              idempotencyKeyProvided: true,
            },
          });
          jsonError(
            res,
            requestId,
            409,
            "CONFLICT",
            "Idempotency key is already in use for a different mark-lost request.",
            { reasonCode: "IDEMPOTENCY_KEY_CONFLICT" },
          );
          return;
        }
        if (replay.kind === "replay") {
          await logLibraryAuditEvent({
            req,
            requestId,
            action: "library_loan_mark_lost",
            resourceType: "library_loan",
            resourceId: loanId,
            ownerUid: ctx.uid,
            result: "allow",
            ctx,
            metadata: {
              idempotentReplay: true,
              idempotencyKeyProvided: true,
            },
          });
          jsonOk(res, requestId, replay.responseData);
          return;
        }
      }
      const result = await db.runTransaction(async (tx) => {
        const loanRef = db.collection("libraryLoans").doc(loanId);
        const loanSnap = await tx.get(loanRef) as { exists: boolean; data: () => Record<string, unknown> | undefined };
        if (!loanSnap.exists) {
          return { ok: false as const, code: "NOT_FOUND", message: "Loan not found", reasonCode: "LOAN_NOT_FOUND" };
        }
        const loanRow = (loanSnap.data() ?? {}) as Record<string, unknown>;
        const itemId = safeString(loanRow.itemId).trim();
        if (!itemId) {
          return {
            ok: false as const,
            code: "FAILED_PRECONDITION",
            message: "Loan is missing item linkage",
            reasonCode: "LOAN_MISSING_ITEM_LINKAGE",
          };
        }
        const itemRef = db.collection("libraryItems").doc(itemId);
        const itemSnap = await tx.get(itemRef) as { exists: boolean; data: () => Record<string, unknown> | undefined };
        if (!itemSnap.exists) {
          return {
            ok: false as const,
            code: "NOT_FOUND",
            message: "Linked library item not found",
            reasonCode: "ITEM_NOT_FOUND",
          };
        }
        const itemRow = (itemSnap.data() ?? {}) as Record<string, unknown>;
        if (isLibraryRowSoftDeleted(itemRow)) {
          return {
            ok: false as const,
            code: "NOT_FOUND",
            message: "Linked library item not found",
            reasonCode: "ITEM_NOT_FOUND",
          };
        }

        const currentStatus = normalizeLibraryLoanStatus(loanRow.status);
        const replacementValueCents = Math.max(
          readLibraryReplacementValueCents(loanRow),
          readLibraryReplacementValueCents(itemRow),
        );
        if (currentStatus === "returned") {
          return {
            ok: false as const,
            code: "CONFLICT",
            message: "Returned loans cannot be marked lost",
            reasonCode: "LOAN_ALREADY_RETURNED",
          };
        }
        if (currentStatus === "lost") {
          return {
            ok: true as const,
            loanId,
            itemId,
            replacementValueCents,
            idempotentReplay: true,
          };
        }
        if (currentStatus !== "checked_out" && currentStatus !== "overdue" && currentStatus !== "return_requested") {
          return {
            ok: false as const,
            code: "CONFLICT",
            message: "Loan status cannot transition to lost",
            reasonCode: "INVALID_LOAN_TRANSITION",
          };
        }

        const nowTsValue = nowTs();
        tx.set(
          loanRef,
          {
            status: "lost",
            lostAt: nowTsValue,
            lostByUid: ctx.uid,
            lostNote: lostNote ?? null,
            replacementValueCents,
            updatedAt: nowTsValue,
            updatedByUid: ctx.uid,
          },
          { merge: true },
        );
        tx.set(
          itemRef,
          {
            status: "lost",
            current_lending_status: "lost",
            lostAt: nowTsValue,
            lostByUid: ctx.uid,
            updatedAt: nowTsValue,
            updatedByUid: ctx.uid,
          },
          { merge: true },
        );
        return {
          ok: true as const,
          loanId,
          itemId,
          replacementValueCents,
          idempotentReplay: false,
        };
      });

      if (!result.ok) {
        const httpStatus =
          result.code === "NOT_FOUND"
            ? 404
            : result.code === "CONFLICT"
              ? 409
              : result.code === "FAILED_PRECONDITION"
                ? 412
                : 400;
        await logLibraryAuditEvent({
          req,
          requestId,
          action: "library_loan_mark_lost",
          resourceType: "library_loan",
          resourceId: loanId,
          ownerUid: ctx.uid,
          result: "deny",
          reasonCode: result.reasonCode,
          ctx,
          metadata: {
            code: result.code,
            idempotencyKeyProvided: Boolean(idempotencyKey),
          },
        });
        jsonError(res, requestId, httpStatus, result.code, result.message, {
          reasonCode: result.reasonCode ?? null,
        });
        return;
      }

      await logLibraryAuditEvent({
        req,
        requestId,
        action: "library_loan_mark_lost",
        resourceType: "library_loan",
        resourceId: result.loanId,
        ownerUid: ctx.uid,
        result: "allow",
        ctx,
        metadata: {
          itemId: result.itemId,
          idempotentReplay: result.idempotentReplay,
          replacementValueCents: result.replacementValueCents,
          hasNote: Boolean(lostNote),
          idempotencyKeyProvided: Boolean(idempotencyKey),
        },
      });

      const responseData = {
        loan: {
          id: result.loanId,
          status: "lost",
          idempotentReplay: result.idempotentReplay,
          replacementValueCents: result.replacementValueCents,
        },
        item: {
          itemId: result.itemId,
          status: "lost",
        },
      };
      if (idempotencyKey) {
        await persistLibraryLoanIdempotencyRecord({
          actorUid: ctx.uid,
          operation: "markLost",
          key: idempotencyKey,
          fingerprint: idempotencyFingerprint,
          responseData,
          requestId,
        });
      }
      jsonOk(res, requestId, responseData);
      return;
    }

    if (route === "/v1/library.loans.assessReplacementFee") {
      if (!isStaff) {
        jsonError(res, requestId, 403, "FORBIDDEN", "Only staff can assess replacement fees.");
        return;
      }
      const parsed = parseBody(libraryLoanAssessReplacementFeeSchema, req.body);
      if (!parsed.ok) {
        jsonError(res, requestId, 400, "INVALID_ARGUMENT", parsed.message);
        return;
      }
      if (parsed.data.confirm !== true) {
        jsonError(res, requestId, 400, "INVALID_ARGUMENT", "Replacement fee assessment requires confirm=true.");
        return;
      }

      const loanId = safeString(parsed.data.loanId).trim();
      const feeNote = trimOrNull(parsed.data.note);
      const explicitAmountCents = parsed.data.amountCents ?? null;
      const idempotencyKeyResult = resolveIdempotencyKey(req, parsed.data.idempotencyKey);
      if (!idempotencyKeyResult.ok) {
        jsonError(res, requestId, 400, "INVALID_ARGUMENT", idempotencyKeyResult.message);
        return;
      }
      const idempotencyKey = idempotencyKeyResult.key;
      const idempotencyFingerprint = libraryLoanIdempotencyFingerprint("assessReplacementFee", {
        loanId,
        amountCents: explicitAmountCents,
        note: feeNote,
        confirm: true,
      });
      if (idempotencyKey) {
        const replay = await readLibraryLoanIdempotencyReplay({
          actorUid: ctx.uid,
          operation: "assessReplacementFee",
          key: idempotencyKey,
          fingerprint: idempotencyFingerprint,
        });
        if (replay.kind === "conflict") {
          await logLibraryAuditEvent({
            req,
            requestId,
            action: "library_loan_assess_replacement_fee",
            resourceType: "library_loan",
            resourceId: loanId,
            ownerUid: ctx.uid,
            result: "deny",
            reasonCode: "IDEMPOTENCY_KEY_CONFLICT",
            ctx,
            metadata: {
              code: "CONFLICT",
              hasExplicitAmount: explicitAmountCents !== null,
              idempotencyKeyProvided: true,
            },
          });
          jsonError(
            res,
            requestId,
            409,
            "CONFLICT",
            "Idempotency key is already in use for a different replacement-fee request.",
            { reasonCode: "IDEMPOTENCY_KEY_CONFLICT" },
          );
          return;
        }
        if (replay.kind === "replay") {
          await logLibraryAuditEvent({
            req,
            requestId,
            action: "library_loan_assess_replacement_fee",
            resourceType: "library_loan",
            resourceId: loanId,
            ownerUid: ctx.uid,
            result: "allow",
            ctx,
            metadata: {
              idempotentReplay: true,
              hasExplicitAmount: explicitAmountCents !== null,
              idempotencyKeyProvided: true,
            },
          });
          jsonOk(res, requestId, replay.responseData);
          return;
        }
      }
      const result = await db.runTransaction(async (tx) => {
        const loanRef = db.collection("libraryLoans").doc(loanId);
        const loanSnap = await tx.get(loanRef) as { exists: boolean; data: () => Record<string, unknown> | undefined };
        if (!loanSnap.exists) {
          return { ok: false as const, code: "NOT_FOUND", message: "Loan not found", reasonCode: "LOAN_NOT_FOUND" };
        }
        const loanRow = (loanSnap.data() ?? {}) as Record<string, unknown>;
        const itemId = safeString(loanRow.itemId).trim();
        if (!itemId) {
          return {
            ok: false as const,
            code: "FAILED_PRECONDITION",
            message: "Loan is missing item linkage",
            reasonCode: "LOAN_MISSING_ITEM_LINKAGE",
          };
        }
        const loanStatus = normalizeLibraryLoanStatus(loanRow.status);
        if (loanStatus !== "lost") {
          return {
            ok: false as const,
            code: "CONFLICT",
            message: "Replacement fees can only be assessed for lost loans",
            reasonCode: "REPLACEMENT_FEE_REQUIRES_LOST_STATUS",
          };
        }

        const itemRef = db.collection("libraryItems").doc(itemId);
        const itemSnap = await tx.get(itemRef) as { exists: boolean; data: () => Record<string, unknown> | undefined };
        if (!itemSnap.exists) {
          return {
            ok: false as const,
            code: "NOT_FOUND",
            message: "Linked library item not found",
            reasonCode: "ITEM_NOT_FOUND",
          };
        }
        const itemRow = (itemSnap.data() ?? {}) as Record<string, unknown>;
        if (isLibraryRowSoftDeleted(itemRow)) {
          return {
            ok: false as const,
            code: "NOT_FOUND",
            message: "Linked library item not found",
            reasonCode: "ITEM_NOT_FOUND",
          };
        }

        const existingFeeId = trimOrNull(loanRow.replacementFeeId);
        const existingFeeStatus = normalizeToken(loanRow.replacementFeeStatus || "");
        const existingAmountCents = Math.max(
          0,
          Math.trunc(readFiniteNumberOrNull(loanRow.replacementFeeAmountCents) ?? 0),
        );
        if (existingFeeId && (existingFeeStatus === "assessed" || existingFeeStatus === "pending_charge")) {
          return {
            ok: true as const,
            idempotentReplay: true,
            feeId: existingFeeId,
            loanId,
            itemId,
            amountCents: existingAmountCents,
          };
        }

        const fallbackAmountCents = Math.max(
          readLibraryReplacementValueCents(loanRow),
          readLibraryReplacementValueCents(itemRow),
        );
        const amountCents = Math.max(
          0,
          Math.trunc(explicitAmountCents === null ? fallbackAmountCents : explicitAmountCents),
        );
        if (amountCents < 1) {
          return {
            ok: false as const,
            code: "FAILED_PRECONDITION",
            message: "Replacement fee amount is required. Set replacement value or provide amountCents.",
            reasonCode: "REPLACEMENT_AMOUNT_REQUIRED",
          };
        }

        const nowTsValue = nowTs();
        const feeId = `lostfee_${randomBytes(10).toString("hex")}`;
        const feeRef = db.collection("libraryReplacementFees").doc(feeId);
        tx.set(
          feeRef,
          {
            loanId,
            itemId,
            borrowerUid: trimOrNull(loanRow.borrowerUid),
            borrowerName: trimOrNull(loanRow.borrowerName),
            borrowerEmail: trimOrNull(loanRow.borrowerEmail),
            amountCents,
            status: "pending_charge",
            chargeWorkflow: "stripe_ready",
            note: feeNote ?? null,
            assessedAt: nowTsValue,
            assessedByUid: ctx.uid,
            createdAt: nowTsValue,
            updatedAt: nowTsValue,
          },
          { merge: false },
        );
        tx.set(
          loanRef,
          {
            replacementFeeId: feeId,
            replacementFeeStatus: "assessed",
            replacementFeeAmountCents: amountCents,
            replacementFeeAssessedAt: nowTsValue,
            replacementFeeAssessedByUid: ctx.uid,
            replacementFeeNote: feeNote ?? null,
            updatedAt: nowTsValue,
            updatedByUid: ctx.uid,
          },
          { merge: true },
        );

        return {
          ok: true as const,
          idempotentReplay: false,
          feeId,
          loanId,
          itemId,
          amountCents,
        };
      });

      if (!result.ok) {
        const httpStatus =
          result.code === "NOT_FOUND"
            ? 404
            : result.code === "CONFLICT"
              ? 409
              : result.code === "FAILED_PRECONDITION"
                ? 412
                : 400;
        await logLibraryAuditEvent({
          req,
          requestId,
          action: "library_loan_assess_replacement_fee",
          resourceType: "library_loan",
          resourceId: loanId,
          ownerUid: ctx.uid,
          result: "deny",
          reasonCode: result.reasonCode,
          ctx,
          metadata: {
            code: result.code,
            hasExplicitAmount: explicitAmountCents !== null,
            idempotencyKeyProvided: Boolean(idempotencyKey),
          },
        });
        jsonError(res, requestId, httpStatus, result.code, result.message, {
          reasonCode: result.reasonCode ?? null,
        });
        return;
      }

      await logLibraryAuditEvent({
        req,
        requestId,
        action: "library_loan_assess_replacement_fee",
        resourceType: "library_loan",
        resourceId: result.loanId,
        ownerUid: ctx.uid,
        result: "allow",
        ctx,
        metadata: {
          feeId: result.feeId,
          itemId: result.itemId,
          amountCents: result.amountCents,
          idempotentReplay: result.idempotentReplay,
          hasNote: Boolean(feeNote),
          hasExplicitAmount: explicitAmountCents !== null,
          idempotencyKeyProvided: Boolean(idempotencyKey),
        },
      });

      const responseData = {
        fee: {
          id: result.feeId,
          loanId: result.loanId,
          itemId: result.itemId,
          amountCents: result.amountCents,
          status: "pending_charge",
          idempotentReplay: result.idempotentReplay,
        },
      };
      if (idempotencyKey) {
        await persistLibraryLoanIdempotencyRecord({
          actorUid: ctx.uid,
          operation: "assessReplacementFee",
          key: idempotencyKey,
          fingerprint: idempotencyFingerprint,
          responseData,
          requestId,
        });
      }
      jsonOk(res, requestId, responseData);
      return;
    }

    if (route === "/v1/library.items.overrideStatus") {
      if (!isStaff) {
        jsonError(res, requestId, 403, "FORBIDDEN", "Only staff can override library item status.");
        return;
      }
      const parsed = parseBody(libraryItemOverrideStatusSchema, req.body);
      if (!parsed.ok) {
        jsonError(res, requestId, 400, "INVALID_ARGUMENT", parsed.message);
        return;
      }

      const itemId = safeString(parsed.data.itemId).trim();
      const overrideStatus = parsed.data.status;
      const overrideNote = trimOrNull(parsed.data.note);
      const itemRef = db.collection("libraryItems").doc(itemId);
      const itemSnap = await itemRef.get();
      if (!itemSnap.exists) {
        jsonError(res, requestId, 404, "NOT_FOUND", "Library item not found");
        return;
      }
      const itemRow = (itemSnap.data() ?? {}) as Record<string, unknown>;
      if (!itemRow || typeof itemRow !== "object" || isLibraryRowSoftDeleted(itemRow)) {
        jsonError(res, requestId, 404, "NOT_FOUND", "Library item not found");
        return;
      }

      const totalCopies = Math.max(1, Math.trunc(readFiniteNumberOrNull(itemRow.totalCopies) ?? 1));
      const currentAvailableCopies = Math.max(
        0,
        Math.trunc(readFiniteNumberOrNull(itemRow.availableCopies) ?? totalCopies),
      );
      let nextAvailableCopies = currentAvailableCopies;
      if (overrideStatus === "available") {
        nextAvailableCopies = Math.max(1, Math.min(totalCopies, currentAvailableCopies || totalCopies));
      } else if (overrideStatus === "checked_out" || overrideStatus === "overdue") {
        nextAvailableCopies = Math.max(0, Math.min(totalCopies - 1, currentAvailableCopies));
      } else if (overrideStatus === "lost" || overrideStatus === "unavailable" || overrideStatus === "archived") {
        nextAvailableCopies = 0;
      }

      const now = nowTs();
      await itemRef.set(
        {
          status: overrideStatus,
          current_lending_status: overrideStatus,
          availableCopies: nextAvailableCopies,
          statusOverrideAt: now,
          statusOverrideByUid: ctx.uid,
          statusOverrideNote: overrideNote ?? null,
          updatedAt: now,
          updatedByUid: ctx.uid,
        },
        { merge: true },
      );

      await logLibraryAuditEvent({
        req,
        requestId,
        action: "library_item_override_status",
        resourceType: "library_item",
        resourceId: itemId,
        ownerUid: ctx.uid,
        result: "allow",
        ctx,
        metadata: {
          status: overrideStatus,
          availableCopies: nextAvailableCopies,
          hasNote: Boolean(overrideNote),
        },
      });

      jsonOk(res, requestId, {
        item: {
          id: itemId,
          status: overrideStatus,
          availableCopies: nextAvailableCopies,
        },
      });
      return;
    }

    if (route === "/v1/library.loans.listMine") {
      const parsed = parseBody(libraryLoansListMineSchema, req.body);
      if (!parsed.ok) {
        jsonError(res, requestId, 400, "INVALID_ARGUMENT", parsed.message);
        return;
      }

      const limit = parsed.data.limit ?? 80;
      const snap = await db.collection("libraryLoans").where("borrowerUid", "==", ctx.uid).limit(limit).get();
      const loans = snap.docs
        .map((docSnap) => ({ id: docSnap.id, row: docSnap.data() as Record<string, unknown> }))
        .filter((entry) => safeString(entry.row.borrowerUid).trim() === ctx.uid)
        .sort((a, b) => readTimestampLikeMs(b.row.loanedAt) - readTimestampLikeMs(a.row.loanedAt))
        .map((entry) => toBatchDetailRow(entry.id, entry.row));

      jsonOk(res, requestId, { loans, limit });
      return;
    }

    if (route === "/v1/events.feed") {
      const scopeCheck = requireScopes(ctx, ["events:read"]);
      if (!scopeCheck.ok) {
        jsonError(res, requestId, 403, "FORBIDDEN", scopeCheck.message);
        return;
      }

      const parsed = parseBody(eventsFeedSchema, req.body);
      if (!parsed.ok) {
        jsonError(res, requestId, 400, "INVALID_ARGUMENT", parsed.message);
        return;
      }

      const targetUid = parsed.data.uid ? String(parsed.data.uid) : ctx.uid;
      const eventsFeedAuthz = await assertActorAuthorized({
        req,
        ctx,
        ownerUid: targetUid,
        scope: "events:read",
        resource: `owner:${targetUid}`,
        allowStaff: true,
      });
      if (!eventsFeedAuthz.ok) {
        await logAuditEvent({
          req,
          requestId,
          action: "events_feed_authz",
          resourceType: "agent_events",
          resourceId: targetUid,
          ownerUid: targetUid,
          result: "deny",
          reasonCode: eventsFeedAuthz.code,
          ctx,
        });
        jsonError(res, requestId, eventsFeedAuthz.httpStatus, eventsFeedAuthz.code, eventsFeedAuthz.message);
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
        jsonError(res, requestId, 403, "FORBIDDEN", scopeCheck.message);
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
        jsonError(res, requestId, 403, "FORBIDDEN", scopeCheck.message);
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
        jsonError(res, requestId, 403, "FORBIDDEN", scopeCheck.message);
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

      type AgentReserveTxFailure = {
        ok: false;
        httpStatus: number;
        code: string;
        message: string;
        ownerUid: string | null;
      };
      type AgentReserveTxSuccess = {
        ok: true;
        reservationId: string;
        reservation: Record<string, unknown>;
        idempotentReplay: boolean;
      };
      type AgentReserveTxResult = AgentReserveTxFailure | AgentReserveTxSuccess;

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
        const reserveAuthz = await assertActorAuthorized({
          req,
          ctx,
          ownerUid: quoteOwnerUid,
          scope: "reserve:write",
          resource: `quote:${quoteId}`,
          allowStaff: true,
        });
        if (!reserveAuthz.ok) {
          return {
            ok: false,
            httpStatus: reserveAuthz.httpStatus,
            code: reserveAuthz.code,
            message: reserveAuthz.message,
            ownerUid: quoteOwnerUid || null,
          };
        }
        const delegatedPolicy = await loadDelegatedRiskPolicy(ctx);
        const independentAccount =
          delegatedPolicy && ctx.mode === "delegated"
            ? await getOrInitAgentAccount(delegatedPolicy.agentClientId)
            : null;

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
        if (independentAccount?.independentEnabled) {
          const subtotalCents = typeof quote.subtotalCents === "number" ? quote.subtotalCents : 0;
          const category = typeof quote.category === "string" ? quote.category : "other";
          const limitCheck = evaluateIndependentAccountLimits({
            account: independentAccount,
            subtotalCents,
            category,
          });
          if (!limitCheck.ok) {
            throw new Error(limitCheck.code);
          }
        }

        if (existingReservationSnap.exists) {
          const existing = existingReservationSnap.data() as Record<string, unknown>;
          return {
            ok: true,
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
      }) as AgentReserveTxResult;

      if (!txResult.ok) {
        if (txResult.httpStatus === 403 && txResult.ownerUid) {
          await logAuditEvent({
            req,
            requestId,
            action: "agent_reserve_authz",
            resourceType: "agent_quote",
            resourceId: quoteId,
            ownerUid: txResult.ownerUid,
            result: "deny",
            reasonCode: txResult.code,
            ctx,
          });
        }
        jsonError(res, requestId, txResult.httpStatus, txResult.code, txResult.message);
        return;
      }

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
        jsonError(res, requestId, 403, "FORBIDDEN", scopeCheck.message);
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
      const reservationAuthz = await assertActorAuthorized({
        req,
        ctx,
        ownerUid: reservationUid,
        scope: "pay:write",
        resource: `reservation:${reservationId}`,
        allowStaff: true,
      });
      if (!reservationAuthz.ok) {
        await logAuditEvent({
          req,
          requestId,
          action: "agent_pay_authz",
          resourceType: "agent_order",
          resourceId: reservationId,
          ownerUid: reservationUid,
          result: "deny",
          reasonCode: reservationAuthz.code,
          ctx,
        });
        jsonError(res, requestId, reservationAuthz.httpStatus, reservationAuthz.code, reservationAuthz.message);
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
      const independentAccount =
        delegatedPolicy && ctx.mode === "delegated"
          ? await getOrInitAgentAccount(delegatedPolicy.agentClientId)
          : null;
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
      if (independentAccount?.independentEnabled) {
        const reservationCategory =
          typeof reservation.category === "string" ? reservation.category : "other";
        const limitCheck = evaluateIndependentAccountLimits({
          account: independentAccount,
          subtotalCents: reservationSubtotal,
          category: reservationCategory,
        });
        if (!limitCheck.ok) {
          await db.collection("agentAuditLogs").add({
            actorUid: ctx.uid,
            actorMode: ctx.mode,
            action: "agent_pay_denied_independent_account",
            requestId,
            reservationId,
            agentClientId: delegatedPolicy?.agentClientId ?? null,
            code: limitCheck.code,
            message: limitCheck.message,
            subtotalCents: reservationSubtotal,
            createdAt: now,
          });
          jsonError(res, requestId, 403, "FAILED_PRECONDITION", limitCheck.message, {
            code: limitCheck.code,
          });
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
        const delegatedPolicyForAccount = independentAccount && delegatedPolicy ? delegatedPolicy : null;
        const accountRef =
          delegatedPolicyForAccount
            ? db.collection("agentAccounts").doc(delegatedPolicyForAccount.agentClientId)
            : null;
        const accountSnap = accountRef ? await tx.get(accountRef) : null;
        const accountRow = accountSnap
          ? normalizeAgentAccountRow(
              safeString(delegatedPolicyForAccount?.agentClientId),
              accountSnap.exists ? (accountSnap.data() as Record<string, unknown>) : null
            )
          : null;
        const accountActive = accountRow ? withDailySpendWindow(accountRow) : null;

        const order = {
          orderId,
          uid: reservationUid,
          reservationId,
          quoteId: typeof reservation.quoteId === "string" ? reservation.quoteId : null,
          agentClientId:
            ctx.mode === "delegated"
              ? ctx.delegated.agentClientId
              : (typeof reservation.agentClientId === "string" ? reservation.agentClientId : null),
          status: accountActive?.independentEnabled ? "paid" : "payment_required",
          paymentStatus: accountActive?.independentEnabled ? "paid_prepay" : "checkout_pending",
          fulfillmentStatus: "queued",
          paymentProvider: accountActive?.independentEnabled ? "internal_prepay" : "stripe",
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
        if (accountRef && accountActive?.independentEnabled) {
          const subtotal = Math.max(0, Math.trunc(order.amountCents as number));
          const category = typeof reservation.category === "string" ? reservation.category : "other";
          const categorySpent = accountActive.spentByCategoryCents[category] ?? 0;
          const accountPatch: Record<string, unknown> = {
            prepaidBalanceCents: Math.max(0, accountActive.prepaidBalanceCents - subtotal),
            spendDayKey: accountActive.spendDayKey,
            spentTodayCents: accountActive.spentTodayCents + subtotal,
            updatedAt: now,
            updatedByUid: ctx.uid,
            [`spentByCategoryCents.${category}`]: categorySpent + subtotal,
          };
          tx.set(accountRef, accountPatch, { merge: true });
          const ledgerRef = accountRef.collection("ledger").doc(orderId);
          tx.set(ledgerRef, {
            type: "debit_order",
            orderId,
            reservationId,
            amountCents: -subtotal,
            category,
            actorUid: ctx.uid,
            actorMode: ctx.mode,
            createdAt: now,
          });
        }
        tx.set(
          reservationRef,
          {
            status: accountActive?.independentEnabled ? "paid" : "payment_required",
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
          paidFromPrepay: accountActive?.independentEnabled === true,
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
          provider: order.paymentProvider === "internal_prepay" ? "internal_prepay" : "stripe",
          ready: order.paymentProvider === "internal_prepay" ? true : priceConfigured,
          requiresUserFirebaseAuth: order.paymentProvider === "internal_prepay" ? false : true,
          checkoutEndpoint: order.paymentProvider === "internal_prepay" ? null : "createAgentCheckoutSession",
          payloadHint: priceConfigured
            && order.paymentProvider !== "internal_prepay"
            ? {
                orderId,
              }
            : null,
          message: order.paymentProvider === "internal_prepay"
            ? "Order paid from independent-agent prepaid balance."
            : priceConfigured
            ? "Call createAgentCheckoutSession to complete payment."
            : "No Stripe priceId is configured for this service. Staff must update Agent service catalog.",
        },
      });
      return;
    }

    if (route === "/v1/agent.status") {
      const scopeCheck = requireScopes(ctx, ["status:read"]);
      if (!scopeCheck.ok) {
        jsonError(res, requestId, 403, "FORBIDDEN", scopeCheck.message);
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
      const statusAuthz = await assertActorAuthorized({
        req,
        ctx,
        ownerUid,
        scope: "status:read",
        resource: `owner:${ownerUid}`,
        allowStaff: true,
      });
      if (!statusAuthz.ok) {
        await logAuditEvent({
          req,
          requestId,
          action: "agent_status_authz",
          resourceType: "agent_status",
          resourceId: orderId || reservationId || quoteId || ownerUid,
          ownerUid,
          result: "deny",
          reasonCode: statusAuthz.code,
          ctx,
        });
        jsonError(res, requestId, statusAuthz.httpStatus, statusAuthz.code, statusAuthz.message);
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
        jsonError(res, requestId, 403, "FORBIDDEN", scopeCheck.message);
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
      const orderAuthz = await assertActorAuthorized({
        req,
        ctx,
        ownerUid,
        scope: "status:read",
        resource: `order:${orderId}`,
        allowStaff: true,
      });
      if (!orderAuthz.ok) {
        await logAuditEvent({
          req,
          requestId,
          action: "agent_order_authz",
          resourceType: "agent_order",
          resourceId: orderId,
          ownerUid,
          result: "deny",
          reasonCode: orderAuthz.code,
          ctx,
        });
        jsonError(res, requestId, orderAuthz.httpStatus, orderAuthz.code, orderAuthz.message);
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
        jsonError(res, requestId, 403, "FORBIDDEN", scopeCheck.message);
        return;
      }

      const parsed = parseBody(agentOrdersListSchema, req.body);
      if (!parsed.ok) {
        jsonError(res, requestId, 400, "INVALID_ARGUMENT", parsed.message);
        return;
      }

      const targetUid = parsed.data.uid ? String(parsed.data.uid) : ctx.uid;
      const ordersListAuthz = await assertActorAuthorized({
        req,
        ctx,
        ownerUid: targetUid,
        scope: "status:read",
        resource: `owner:${targetUid}`,
        allowStaff: true,
      });
      if (!ordersListAuthz.ok) {
        await logAuditEvent({
          req,
          requestId,
          action: "agent_orders_list_authz",
          resourceType: "agent_orders",
          resourceId: targetUid,
          ownerUid: targetUid,
          result: "deny",
          reasonCode: ordersListAuthz.code,
          ctx,
        });
        jsonError(res, requestId, ordersListAuthz.httpStatus, ordersListAuthz.code, ordersListAuthz.message);
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

    if (route === "/v1/agent.revenue.summary") {
      const scopeCheck = requireScopes(ctx, ["status:read"]);
      if (!scopeCheck.ok) {
        jsonError(res, requestId, 403, "FORBIDDEN", scopeCheck.message);
        return;
      }

      const parsed = parseBody(agentRevenueSummarySchema, req.body);
      if (!parsed.ok) {
        jsonError(res, requestId, 400, "INVALID_ARGUMENT", parsed.message);
        return;
      }

      const targetUid = parsed.data.uid ? String(parsed.data.uid) : ctx.uid;
      const summaryAuthz = await assertActorAuthorized({
        req,
        ctx,
        ownerUid: targetUid,
        scope: "status:read",
        resource: `owner:${targetUid}`,
        allowStaff: true,
      });
      if (!summaryAuthz.ok) {
        await logAuditEvent({
          req,
          requestId,
          action: "agent_revenue_summary_authz",
          resourceType: "agent_revenue",
          resourceId: targetUid,
          ownerUid: targetUid,
          result: "deny",
          reasonCode: summaryAuthz.code,
          ctx,
        });
        jsonError(res, requestId, summaryAuthz.httpStatus, summaryAuthz.code, summaryAuthz.message);
        return;
      }

      const limit = parsed.data.limit ?? 200;
      const orderSnap = await db.collection("agentOrders").where("uid", "==", targetUid).limit(limit).get();
      const orderCount = orderSnap.docs.length;

      let grossCents = 0;
      let paidCents = 0;
      let unpaidCents = 0;
      let refundedCents = 0;
      const orderRevenue = new Map<string, { amountCents: number; paymentStatus: string }>();
      for (const docSnap of orderSnap.docs) {
        const row = docSnap.data() as Record<string, unknown>;
        const amountCents = typeof row.amountCents === "number" ? Math.max(0, Math.trunc(row.amountCents)) : 0;
        const paymentStatus = typeof row.paymentStatus === "string" ? row.paymentStatus : "unknown";
        grossCents += amountCents;
        if (paymentStatus === "paid") {
          paidCents += amountCents;
        } else if (paymentStatus === "refunded") {
          refundedCents += amountCents;
        } else {
          unpaidCents += amountCents;
        }
        orderRevenue.set(docSnap.id, { amountCents, paymentStatus });
      }

      const commissionSnap = await db.collection(AGENT_REQUESTS_COL).where("createdByUid", "==", targetUid).limit(500).get();
      const commissionOrderIds = new Set<string>();
      for (const docSnap of commissionSnap.docs) {
        const row = docSnap.data() as Record<string, unknown>;
        if (String(row.kind ?? "") !== "commission") {
          continue;
        }
        const commissionOrderId = typeof row.commissionOrderId === "string" ? row.commissionOrderId.trim() : "";
        if (commissionOrderId) {
          commissionOrderIds.add(commissionOrderId);
        }
      }

      let commissionLinkedCount = 0;
      let commissionLinkedGrossCents = 0;
      let commissionLinkedPaidCents = 0;
      let commissionLinkedUnpaidCents = 0;
      for (const orderId of commissionOrderIds.values()) {
        const revenue = orderRevenue.get(orderId);
        if (!revenue) {
          continue;
        }
        commissionLinkedCount += 1;
        commissionLinkedGrossCents += revenue.amountCents;
        if (revenue.paymentStatus === "paid") {
          commissionLinkedPaidCents += revenue.amountCents;
        } else if (revenue.paymentStatus !== "refunded") {
          commissionLinkedUnpaidCents += revenue.amountCents;
        }
      }

      await db.collection("agentAuditLogs").add({
        actorUid: ctx.uid,
        actorMode: ctx.mode,
        action: "agent_revenue_summary_read",
        requestId,
        uid: targetUid,
        returnedOrders: orderCount,
        commissionLinkedCount,
        createdAt: nowTs(),
      });

      jsonOk(res, requestId, {
        uid: targetUid,
        summary: {
          orderCount,
          grossCents,
          paidCents,
          unpaidCents,
          refundedCents,
          commissionLinkedCount,
          commissionLinkedGrossCents,
          commissionLinkedPaidCents,
          commissionLinkedUnpaidCents,
        },
      });
      return;
    }

    if (route === "/v1/agent.requests.create") {
      const scopeCheck = requireScopes(ctx, ["requests:write"]);
      if (!scopeCheck.ok) {
        jsonError(res, requestId, 403, "FORBIDDEN", scopeCheck.message);
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
      const isX1cPrint = parsed.data.kind === "x1c_print";
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
      const x1cPolicy = isX1cPrint
        ? evaluateX1cPolicy({
            fileType: trimOrNull(parsed.data.x1cFileType),
            materialProfile: trimOrNull(parsed.data.x1cMaterialProfile),
            dimensionsMm: parsed.data.x1cDimensionsMm
              ? {
                  x: parsed.data.x1cDimensionsMm.x,
                  y: parsed.data.x1cDimensionsMm.y,
                  z: parsed.data.x1cDimensionsMm.z,
                }
              : null,
            quantity: parsed.data.x1cQuantity ?? null,
            title: parsed.data.title,
            summary: trimOrNull(parsed.data.summary),
            notes: trimOrNull(parsed.data.notes),
          })
        : null;
      if (x1cPolicy && !x1cPolicy.ok) {
        jsonError(
          res,
          requestId,
          400,
          "FAILED_PRECONDITION",
          "X1C request failed validation.",
          { validationVersion: X1C_VALIDATION_VERSION, reasonCodes: x1cPolicy.reasonCodes }
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
          x1cValidationVersion: isX1cPrint ? X1C_VALIDATION_VERSION : null,
        },
        x1cSpec: x1cPolicy && x1cPolicy.ok ? x1cPolicy.normalized : null,
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
          x1cValidationVersion: isX1cPrint ? X1C_VALIDATION_VERSION : null,
          x1cReasonCodes: [],
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
        x1cValidationVersion: isX1cPrint ? X1C_VALIDATION_VERSION : null,
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
        jsonError(res, requestId, 403, "FORBIDDEN", scopeCheck.message);
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
          return toAgentRequestRow(docSnap.id, data);
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
        jsonError(res, requestId, 403, "FORBIDDEN", scopeCheck.message);
        return;
      }
      if (!isStaff) {
        jsonError(res, requestId, 403, "FORBIDDEN", "Forbidden");
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
          return toAgentRequestRow(docSnap.id, data);
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
        jsonError(res, requestId, 403, "FORBIDDEN", scopeCheck.message);
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
      const requestAuthz = await assertActorAuthorized({
        req,
        ctx,
        ownerUid,
        scope: "requests:write",
        resource: `agent_request:${parsed.data.requestId}`,
        allowStaff: true,
      });
      if (!requestAuthz.ok) {
        await logAuditEvent({
          req,
          requestId,
          action: "agent_request_status_update_authz",
          resourceType: "agent_request",
          resourceId: parsed.data.requestId,
          ownerUid,
          result: "deny",
          reasonCode: requestAuthz.code,
          ctx,
        });
        jsonError(res, requestId, requestAuthz.httpStatus, requestAuthz.code, requestAuthz.message);
        return;
      }
      if (!isStaff && !ownerCanCancel) {
        jsonError(res, requestId, 403, "FORBIDDEN", "Forbidden");
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
        jsonError(res, requestId, 403, "FORBIDDEN", scopeCheck.message);
        return;
      }
      if (!isStaff) {
        jsonError(res, requestId, 403, "FORBIDDEN", "Forbidden");
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

    if (route === "/v1/agent.requests.createCommissionOrder") {
      const scopeCheck = requireScopes(ctx, ["requests:write"]);
      if (!scopeCheck.ok) {
        jsonError(res, requestId, 403, "FORBIDDEN", scopeCheck.message);
        return;
      }
      if (!isStaff) {
        jsonError(res, requestId, 403, "FORBIDDEN", "Forbidden");
        return;
      }
      const parsed = parseBody(agentRequestCreateCommissionOrderSchema, req.body);
      if (!parsed.ok) {
        jsonError(res, requestId, 400, "INVALID_ARGUMENT", parsed.message);
        return;
      }
      const requestRef = db.collection(AGENT_REQUESTS_COL).doc(parsed.data.requestId);
      const requestSnap = await requestRef.get();
      if (!requestSnap.exists) {
        jsonError(res, requestId, 404, "NOT_FOUND", "Request not found");
        return;
      }
      const requestRow = requestSnap.data() as Record<string, unknown>;
      if (String(requestRow.kind ?? "") !== "commission") {
        jsonError(res, requestId, 400, "FAILED_PRECONDITION", "Only commission requests can create commission orders.");
        return;
      }
      const statusValue = String(requestRow.status ?? "new");
      if (statusValue !== "accepted" && statusValue !== "in_progress" && statusValue !== "ready") {
        jsonError(
          res,
          requestId,
          400,
          "FAILED_PRECONDITION",
          "Commission request must be accepted, in_progress, or ready before payment order creation."
        );
        return;
      }
      const ownerUid = typeof requestRow.createdByUid === "string" ? requestRow.createdByUid : "";
      if (!ownerUid) {
        jsonError(res, requestId, 500, "INTERNAL", "Request missing owner uid.");
        return;
      }
      const orderId = makeIdempotencyId("agent-commission-order", ownerUid, parsed.data.requestId);
      const orderRef = db.collection("agentOrders").doc(orderId);
      const orderSnap = await orderRef.get();
      const now = nowTs();
      if (!orderSnap.exists) {
        const metadata =
          requestRow.metadata && typeof requestRow.metadata === "object"
            ? (requestRow.metadata as Record<string, unknown>)
            : {};
        const stripeConfigSnap = await db.doc("config/stripe").get();
        const stripeConfig = (stripeConfigSnap.data() ?? {}) as Record<string, unknown>;
        const stripeMode = typeof stripeConfig.mode === "string" ? stripeConfig.mode : "test";
        const priceIds =
          stripeConfig.priceIds && typeof stripeConfig.priceIds === "object"
            ? (stripeConfig.priceIds as Record<string, unknown>)
            : {};
        const selectedPriceId =
          trimOrNull(parsed.data.priceId) ||
          trimOrNull(metadata.commissionPriceId) ||
          trimOrNull(priceIds.agent_commission) ||
          trimOrNull(priceIds.commission) ||
          trimOrNull(priceIds.agent_default);
        if (!selectedPriceId) {
          jsonError(
            res,
            requestId,
            412,
            "FAILED_PRECONDITION",
            "No commission Stripe priceId configured. Set config/stripe.priceIds.agent_commission (or commission)."
          );
          return;
        }
        const quantity = parsed.data.quantity ?? 1;
        await orderRef.set({
          orderId,
          uid: ownerUid,
          reservationId: null,
          quoteId: null,
          agentRequestId: parsed.data.requestId,
          agentClientId: typeof requestRow.createdByTokenId === "string" ? requestRow.createdByTokenId : null,
          status: "payment_required",
          paymentStatus: "checkout_pending",
          fulfillmentStatus: "queued",
          paymentProvider: "stripe",
          stripeCheckoutSessionId: null,
          stripePaymentIntentId: null,
          amountCents: 0,
          currency: "USD",
          quantity,
          priceId: selectedPriceId,
          mode: stripeMode,
          createdAt: now,
          updatedAt: now,
        });
      }

      await requestRef.set(
        {
          commissionOrderId: orderId,
          commissionPaymentStatus: "checkout_pending",
          updatedAt: now,
          staff: {
            assignedToUid: ctx.uid,
            triagedAt: now,
          },
        },
        { merge: true }
      );
      await requestRef.collection("audit").add({
        at: now,
        type: "commission_order_created",
        actorUid: ctx.uid,
        actorMode: ctx.mode,
        details: {
          orderId,
          idempotentReplay: orderSnap.exists,
        },
      });
      await db.collection("agentAuditLogs").add({
        actorUid: ctx.uid,
        actorMode: ctx.mode,
        action: "agent_commission_order_created",
        requestId,
        agentRequestId: requestRef.id,
        orderId,
        idempotentReplay: orderSnap.exists,
        createdAt: now,
      });
      jsonOk(res, requestId, {
        agentRequestId: requestRef.id,
        orderId,
        idempotentReplay: orderSnap.exists,
      });
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
      jsonError(res, requestId, 403, "FORBIDDEN", "Forbidden");
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
      jsonError(res, requestId, 403, "FORBIDDEN", "Delegated client not found");
      return;
    }
    if (msg === "DELEGATED_CLIENT_INACTIVE") {
      jsonError(res, requestId, 403, "FORBIDDEN", "Delegated client is not active");
      return;
    }
    if (msg === "DELEGATED_CLIENT_COOLDOWN") {
      jsonError(res, requestId, 429, "RATE_LIMITED", "Delegated client is in cooldown");
      return;
    }
    if (msg === "ACCOUNT_ON_HOLD") {
      jsonError(res, requestId, 403, "FAILED_PRECONDITION", "Independent agent account is on hold");
      return;
    }
    if (msg === "PREPAY_REQUIRED") {
      jsonError(res, requestId, 402, "FAILED_PRECONDITION", "Insufficient prepaid balance");
      return;
    }
    if (msg === "DAILY_CAP_EXCEEDED") {
      jsonError(res, requestId, 403, "FAILED_PRECONDITION", "Daily spend cap exceeded");
      return;
    }
    if (msg === "CATEGORY_CAP_EXCEEDED") {
      jsonError(res, requestId, 403, "FAILED_PRECONDITION", "Category spend cap exceeded");
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
