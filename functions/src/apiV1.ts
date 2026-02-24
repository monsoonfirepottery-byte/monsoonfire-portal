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
  intakeMode: string | null;
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

const reservationCreateSchema = z.object({
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
  useVolumePricing: z.boolean().optional(),
  volumeIn3: z.number().optional(),
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

function reservationQueuePriority(row: Record<string, unknown>) {
  const status = normalizeReservationStatus(row.status) ?? "REQUESTED";
  const statusPriority =
    status === "CONFIRMED" ? 0 : status === "REQUESTED" ? 1 : status === "WAITLISTED" ? 2 : 3;
  const addOns = row.addOns && typeof row.addOns === "object" ? (row.addOns as Record<string, unknown>) : {};
  const rushPriority = addOns.rushRequested === true ? 0 : 1;
  const wholeKilnPriority = addOns.wholeKilnRequested === true ? 0 : 1;
  const queueFairnessPolicy = buildReservationQueueFairnessPolicy(row, Date.now());
  const fairnessPenalty = queueFairnessPolicy.effectivePenaltyPoints;
  const sizePenalty = estimateHalfShelves(row);
  const createdAtMs = parseReservationIsoDate(row.createdAt)?.getTime() ?? 0;
  const idTie = safeString(row.id, "");
  return {
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
    firingType: safeString(row.firingType, "other"),
    shelfEquivalent: normalizeNumber(row.shelfEquivalent, 1) as number,
    footprintHalfShelves: normalizeNumber(row.footprintHalfShelves),
    heightInches: normalizeNumber(row.heightInches),
    tiers: normalizeNumber(row.tiers),
    estimatedHalfShelves: normalizeNumber(row.estimatedHalfShelves),
    useVolumePricing: row.useVolumePricing === true,
    volumeIn3: normalizeNumber(row.volumeIn3),
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
  "/v1/reservations.lookupArrival",
  "/v1/reservations.rotateArrivalToken",
  "/v1/reservations.pickupWindow",
  "/v1/reservations.queueFairness",
  "/v1/reservations.update",
  "/v1/events.feed",
  "/v1/firings.listUpcoming",
]);

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
      const addOns = {
        rushRequested: addOnsInput.rushRequested === true,
        wholeKilnRequested: addOnsInput.wholeKilnRequested === true,
        pickupDeliveryRequested: addOnsInput.pickupDeliveryRequested === true,
        returnDeliveryRequested: addOnsInput.returnDeliveryRequested === true,
        useStudioGlazes: addOnsInput.useStudioGlazes === true,
        glazeAccessCost: resolvedEstimatedHalfShelves && resolvedEstimatedHalfShelves > 0 && addOnsInput.useStudioGlazes === true
          ? resolvedEstimatedHalfShelves * 3
          : null,
        waxResistAssistRequested: addOnsInput.waxResistAssistRequested === true,
        glazeSanityCheckRequested: addOnsInput.glazeSanityCheckRequested === true,
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

      await reservationRef.set({
        ownerUid,
        status: "REQUESTED",
        loadStatus: "queued",
        firingType,
        shelfEquivalent: Number(shelfEquivalent),
        footprintHalfShelves,
        heightInches,
        tiers: resolvedTiers,
        estimatedHalfShelves: resolvedEstimatedHalfShelves,
        useVolumePricing: body.useVolumePricing === true,
        volumeIn3: normalizeNumber(body.volumeIn3),
        estimatedCost: normalizeNumber(body.estimatedCost),
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

      const snap = await db
        .collection("reservations")
        .where("ownerUid", "==", targetOwnerUid)
        .orderBy("createdAt", "desc")
        .limit(500)
        .get();

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
        .slice(0, limit);

      jsonOk(res, requestId, { ownerUid: targetOwnerUid, reservations });
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
                return estimateHalfShelves(raw);
              })
              .reduce((total, each) => total + each, 0);

            stationUsedAfter += estimateHalfShelves(row);

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
                return estimateHalfShelves(raw);
              })
              .reduce((total, each) => total + each, 0);
            stationUsedAfter += estimateHalfShelves(row);
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
