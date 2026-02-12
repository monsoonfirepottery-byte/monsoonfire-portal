import { onRequest } from "firebase-functions/v2/https";
import { z } from "zod";
import {
  applyCors,
  db,
  nowTs,
  parseBody,
  requireAdmin,
  requireAuthUid,
} from "./shared";

const REGION = "us-central1";
const AGENT_OPS_CONFIG_PATH = "config/agentOps";

const listOpsSchema = z.object({
  limit: z.number().int().min(1).max(200).optional(),
});

const reviewReservationSchema = z.object({
  reservationId: z.string().min(1),
  decision: z.enum(["approve", "reject"]),
  reason: z.string().max(500).optional().nullable(),
});

const updateAgentOpsConfigSchema = z.object({
  enabled: z.boolean().optional(),
  allowPayments: z.boolean().optional(),
  reason: z.string().max(500).optional().nullable(),
});

const updateOrderFulfillmentSchema = z.object({
  orderId: z.string().min(1),
  toStatus: z.enum([
    "queued",
    "scheduled",
    "loaded",
    "firing",
    "cooling",
    "ready",
    "picked_up",
    "shipped",
    "exception",
  ]),
  reason: z.string().max(500).optional().nullable(),
});

const exportDeniedEventsSchema = z.object({
  clientId: z.string().trim().min(1).max(120).optional(),
  action: z
    .enum([
      "agent_quote_denied_risk_limit",
      "agent_pay_denied_risk_limit",
      "agent_pay_denied_velocity",
      "all",
    ])
    .optional(),
  fromIso: z.string().trim().min(1).max(60).optional(),
  toIso: z.string().trim().min(1).max(60).optional(),
  limit: z.number().int().min(1).max(2000).optional(),
});

const FULFILLMENT_ORDER = [
  "queued",
  "scheduled",
  "loaded",
  "firing",
  "cooling",
  "ready",
  "picked_up",
  "shipped",
] as const;

const TERMINAL_OR_EXCEPTION = new Set<string>(["picked_up", "shipped", "exception"]);
const DENIED_ACTIONS = new Set<string>([
  "agent_quote_denied_risk_limit",
  "agent_pay_denied_risk_limit",
  "agent_pay_denied_velocity",
]);

function canTransitionFulfillment(from: string, to: string): boolean {
  if (from === to) return true;
  if (to === "exception") return true;
  if (from === "exception") return false;
  if (TERMINAL_OR_EXCEPTION.has(from)) return false;
  const fromIdx = FULFILLMENT_ORDER.indexOf(from as (typeof FULFILLMENT_ORDER)[number]);
  const toIdx = FULFILLMENT_ORDER.indexOf(to as (typeof FULFILLMENT_ORDER)[number]);
  if (fromIdx < 0 || toIdx < 0) return false;
  return toIdx === fromIdx + 1;
}

function tsToMillis(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (!value || typeof value !== "object") return 0;
  const row = value as {
    toMillis?: () => number;
    toDate?: () => Date;
    seconds?: number;
    nanoseconds?: number;
  };
  if (typeof row.toMillis === "function") return row.toMillis();
  if (typeof row.toDate === "function") return row.toDate().getTime();
  if (typeof row.seconds === "number") {
    return Math.floor(row.seconds * 1000 + (typeof row.nanoseconds === "number" ? row.nanoseconds : 0) / 1_000_000);
  }
  return 0;
}

function toCsvCell(value: unknown): string {
  const raw = value == null ? "" : String(value);
  if (!/[",\n]/.test(raw)) return raw;
  return `"${raw.replace(/"/g, "\"\"")}"`;
}

function toCsvLine(cells: unknown[]): string {
  return cells.map((cell) => toCsvCell(cell)).join(",");
}

export async function getAgentOpsConfig(): Promise<{ enabled: boolean; allowPayments: boolean }> {
  const snap = await db.doc(AGENT_OPS_CONFIG_PATH).get();
  const row = (snap.data() ?? {}) as Record<string, unknown>;
  return {
    enabled: row.enabled !== false,
    allowPayments: row.allowPayments !== false,
  };
}

async function readCollection(
  collection: string,
  orderByField: string,
  limit: number
): Promise<Array<Record<string, unknown>>> {
  const snap = await db.collection(collection).orderBy(orderByField, "desc").limit(limit).get();
  return snap.docs.map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() as Record<string, unknown>) }));
}

function summarizeRiskDenialsByClient(auditRows: Array<Record<string, unknown>>): Record<string, {
  total: number;
  quoteLimit: number;
  payLimit: number;
  velocity: number;
}> {
  const out: Record<string, { total: number; quoteLimit: number; payLimit: number; velocity: number }> = {};
  for (const row of auditRows) {
    const action = typeof row.action === "string" ? row.action : "";
    if (
      action !== "agent_quote_denied_risk_limit" &&
      action !== "agent_pay_denied_risk_limit" &&
      action !== "agent_pay_denied_velocity"
    ) {
      continue;
    }
    const clientId = typeof row.agentClientId === "string" ? row.agentClientId : "";
    if (!clientId) continue;
    if (!out[clientId]) {
      out[clientId] = { total: 0, quoteLimit: 0, payLimit: 0, velocity: 0 };
    }
    out[clientId].total += 1;
    if (action === "agent_quote_denied_risk_limit") out[clientId].quoteLimit += 1;
    if (action === "agent_pay_denied_risk_limit") out[clientId].payLimit += 1;
    if (action === "agent_pay_denied_velocity") out[clientId].velocity += 1;
  }
  return out;
}

export const staffListAgentOperations = onRequest(
  { region: REGION, timeoutSeconds: 60 },
  async (req, res) => {
    if (applyCors(req, res)) return;
    if (req.method !== "POST") {
      res.status(405).json({ ok: false, message: "Use POST" });
      return;
    }

    const auth = await requireAuthUid(req);
    if (!auth.ok) {
      res.status(401).json({ ok: false, message: auth.message });
      return;
    }
    const admin = await requireAdmin(req);
    if (!admin.ok) {
      res.status(403).json({ ok: false, message: admin.message });
      return;
    }

    const parsed = parseBody(listOpsSchema, req.body ?? {});
    if (!parsed.ok) {
      res.status(400).json({ ok: false, message: parsed.message });
      return;
    }
    const limit = parsed.data.limit ?? 80;

    const [quotes, reservations, orders, audit] = await Promise.all([
      readCollection("agentQuotes", "createdAt", limit),
      readCollection("agentReservations", "createdAt", limit),
      readCollection("agentOrders", "updatedAt", limit),
      readCollection("agentAuditLogs", "createdAt", Math.max(limit, 300)),
    ]);
    const riskByClient = summarizeRiskDenialsByClient(audit);

    res.status(200).json({
      ok: true,
      snapshot: {
        quotes: quotes.length,
        reservations: reservations.length,
        orders: orders.length,
        auditEvents: audit.length,
        riskDeniedEvents: Object.values(riskByClient).reduce((sum, row) => sum + row.total, 0),
      },
      quotes,
      reservations,
      orders,
      audit,
      riskByClient,
    });
  }
);

export const staffReviewAgentReservation = onRequest(
  { region: REGION, timeoutSeconds: 60 },
  async (req, res) => {
    if (applyCors(req, res)) return;
    if (req.method !== "POST") {
      res.status(405).json({ ok: false, message: "Use POST" });
      return;
    }

    const auth = await requireAuthUid(req);
    if (!auth.ok) {
      res.status(401).json({ ok: false, message: auth.message });
      return;
    }
    const admin = await requireAdmin(req);
    if (!admin.ok) {
      res.status(403).json({ ok: false, message: admin.message });
      return;
    }

    const parsed = parseBody(reviewReservationSchema, req.body ?? {});
    if (!parsed.ok) {
      res.status(400).json({ ok: false, message: parsed.message });
      return;
    }

    const reservationId = parsed.data.reservationId.trim();
    const decision = parsed.data.decision;
    const reason = (parsed.data.reason ?? "").trim() || null;
    const reservationRef = db.collection("agentReservations").doc(reservationId);
    const reservationSnap = await reservationRef.get();
    if (!reservationSnap.exists) {
      res.status(404).json({ ok: false, message: "Reservation not found" });
      return;
    }

    const reservation = reservationSnap.data() as Record<string, unknown>;
    const currentStatus = typeof reservation.status === "string" ? reservation.status : "unknown";
    if (currentStatus !== "pending_review" && currentStatus !== "payment_required") {
      res.status(409).json({ ok: false, message: `Reservation is not reviewable (status=${currentStatus})` });
      return;
    }

    const nextStatus = decision === "approve" ? "reserved" : "rejected";
    const orderId = typeof reservation.orderId === "string" ? reservation.orderId : "";
    const nowTsValue = nowTs();

    const writes: Array<Promise<unknown>> = [
      reservationRef.set(
        {
          status: nextStatus,
          reviewDecision: decision,
          reviewReason: reason,
          reviewedByUid: auth.uid,
          reviewedAt: nowTsValue,
          updatedAt: nowTsValue,
        },
        { merge: true }
      ),
      db.collection("agentAuditLogs").add({
        actorUid: auth.uid,
        actorMode: "firebase",
        action: "agent_reservation_reviewed",
        reservationId,
        decision,
        reason,
        createdAt: nowTsValue,
      }),
    ];

    if (orderId) {
      writes.push(
        db.collection("agentOrders").doc(orderId).set(
          {
            status: decision === "approve" ? "payment_required" : "cancelled",
            paymentStatus: decision === "approve" ? "checkout_pending" : "cancelled",
            updatedAt: nowTsValue,
            reviewDecision: decision,
            reviewReason: reason,
          },
          { merge: true }
        )
      );
    }

    await Promise.all(writes);
    res.status(200).json({
      ok: true,
      reservationId,
      status: nextStatus,
      decision,
      orderId: orderId || null,
    });
  }
);

export const staffGetAgentOpsConfig = onRequest(
  { region: REGION, timeoutSeconds: 60 },
  async (req, res) => {
    if (applyCors(req, res)) return;
    if (req.method !== "POST") {
      res.status(405).json({ ok: false, message: "Use POST" });
      return;
    }

    const auth = await requireAuthUid(req);
    if (!auth.ok) {
      res.status(401).json({ ok: false, message: auth.message });
      return;
    }
    const admin = await requireAdmin(req);
    if (!admin.ok) {
      res.status(403).json({ ok: false, message: admin.message });
      return;
    }

    const config = await getAgentOpsConfig();
    res.status(200).json({ ok: true, config });
  }
);

export const staffUpdateAgentOpsConfig = onRequest(
  { region: REGION, timeoutSeconds: 60 },
  async (req, res) => {
    if (applyCors(req, res)) return;
    if (req.method !== "POST") {
      res.status(405).json({ ok: false, message: "Use POST" });
      return;
    }

    const auth = await requireAuthUid(req);
    if (!auth.ok) {
      res.status(401).json({ ok: false, message: auth.message });
      return;
    }
    const admin = await requireAdmin(req);
    if (!admin.ok) {
      res.status(403).json({ ok: false, message: admin.message });
      return;
    }

    const parsed = parseBody(updateAgentOpsConfigSchema, req.body ?? {});
    if (!parsed.ok) {
      res.status(400).json({ ok: false, message: parsed.message });
      return;
    }

    const patch: Record<string, unknown> = {
      updatedAt: nowTs(),
      updatedByUid: auth.uid,
    };
    if (typeof parsed.data.enabled === "boolean") patch.enabled = parsed.data.enabled;
    if (typeof parsed.data.allowPayments === "boolean") {
      patch.allowPayments = parsed.data.allowPayments;
    }
    const reason = parsed.data.reason?.trim() || null;
    if ((parsed.data.enabled === false || parsed.data.allowPayments === false) && !reason) {
      res.status(400).json({ ok: false, message: "Reason is required when disabling agent controls." });
      return;
    }
    if (reason) patch.lastControlReason = reason;

    await db.doc(AGENT_OPS_CONFIG_PATH).set(patch, { merge: true });
    await db.collection("agentAuditLogs").add({
      actorUid: auth.uid,
      actorMode: "firebase",
      action: "agent_ops_config_updated",
      patch,
      reason,
      createdAt: nowTs(),
    });

    const config = await getAgentOpsConfig();
    res.status(200).json({ ok: true, config });
  }
);

export const staffUpdateAgentOrderFulfillment = onRequest(
  { region: REGION, timeoutSeconds: 60 },
  async (req, res) => {
    if (applyCors(req, res)) return;
    if (req.method !== "POST") {
      res.status(405).json({ ok: false, message: "Use POST" });
      return;
    }

    const auth = await requireAuthUid(req);
    if (!auth.ok) {
      res.status(401).json({ ok: false, message: auth.message });
      return;
    }
    const admin = await requireAdmin(req);
    if (!admin.ok) {
      res.status(403).json({ ok: false, message: admin.message });
      return;
    }

    const parsed = parseBody(updateOrderFulfillmentSchema, req.body ?? {});
    if (!parsed.ok) {
      res.status(400).json({ ok: false, message: parsed.message });
      return;
    }

    const orderId = parsed.data.orderId.trim();
    const toStatus = parsed.data.toStatus;
    const reason = (parsed.data.reason ?? "").trim() || null;

    const orderRef = db.collection("agentOrders").doc(orderId);
    const orderSnap = await orderRef.get();
    if (!orderSnap.exists) {
      res.status(404).json({ ok: false, message: "Order not found" });
      return;
    }

    const row = orderSnap.data() as Record<string, unknown>;
    const fromStatus =
      typeof row.fulfillmentStatus === "string" ? row.fulfillmentStatus : "queued";
    if (!canTransitionFulfillment(fromStatus, toStatus)) {
      res.status(409).json({
        ok: false,
        message: `Invalid fulfillment transition: ${fromStatus} -> ${toStatus}`,
      });
      return;
    }

    const paymentStatus = typeof row.paymentStatus === "string" ? row.paymentStatus : "";
    const isPaid = paymentStatus === "paid" || paymentStatus === "payment_succeeded";
    if (!isPaid && toStatus !== "exception") {
      res.status(409).json({
        ok: false,
        message: "Order must be paid before non-exception fulfillment updates.",
      });
      return;
    }

    const now = nowTs();
    await Promise.all([
      orderRef.set(
        {
          fulfillmentStatus: toStatus,
          status: toStatus === "exception" ? "exception" : row.status ?? "paid",
          fulfillmentUpdatedAt: now,
          fulfillmentUpdatedByUid: auth.uid,
          fulfillmentReason: reason,
          updatedAt: now,
        },
        { merge: true }
      ),
      db.collection("agentAuditLogs").add({
        actorUid: auth.uid,
        actorMode: "firebase",
        action: "agent_order_fulfillment_updated",
        orderId,
        fromStatus,
        toStatus,
        reason,
        createdAt: now,
      }),
    ]);

    res.status(200).json({
      ok: true,
      orderId,
      fromStatus,
      toStatus,
    });
  }
);

export const staffExportAgentDeniedEventsCsv = onRequest(
  { region: REGION, timeoutSeconds: 60 },
  async (req, res) => {
    if (applyCors(req, res)) return;
    if (req.method !== "POST") {
      res.status(405).json({ ok: false, message: "Use POST" });
      return;
    }

    const auth = await requireAuthUid(req);
    if (!auth.ok) {
      res.status(401).json({ ok: false, message: auth.message });
      return;
    }
    const admin = await requireAdmin(req);
    if (!admin.ok) {
      res.status(403).json({ ok: false, message: admin.message });
      return;
    }

    const parsed = parseBody(exportDeniedEventsSchema, req.body ?? {});
    if (!parsed.ok) {
      res.status(400).json({ ok: false, message: parsed.message });
      return;
    }

    const limit = parsed.data.limit ?? 500;
    const clientIdFilter = (parsed.data.clientId ?? "").trim();
    const actionFilter = parsed.data.action ?? "all";
    const fromMs = parsed.data.fromIso ? Date.parse(parsed.data.fromIso) : NaN;
    const toMs = parsed.data.toIso ? Date.parse(parsed.data.toIso) : NaN;
    if (parsed.data.fromIso && !Number.isFinite(fromMs)) {
      res.status(400).json({ ok: false, message: "Invalid fromIso" });
      return;
    }
    if (parsed.data.toIso && !Number.isFinite(toMs)) {
      res.status(400).json({ ok: false, message: "Invalid toIso" });
      return;
    }

    const auditRows = await readCollection("agentAuditLogs", "createdAt", Math.max(limit * 4, 300));
    const filtered = auditRows
      .filter((row) => {
        const action = typeof row.action === "string" ? row.action : "";
        if (!DENIED_ACTIONS.has(action)) return false;
        if (actionFilter !== "all" && action !== actionFilter) return false;

        const rowClientId = typeof row.agentClientId === "string" ? row.agentClientId : "";
        if (clientIdFilter && rowClientId !== clientIdFilter) return false;

        const createdAtMs = tsToMillis(row.createdAt);
        if (Number.isFinite(fromMs) && createdAtMs && createdAtMs < fromMs) return false;
        if (Number.isFinite(toMs) && createdAtMs && createdAtMs > toMs) return false;
        return true;
      })
      .slice(0, limit);

    const header = [
      "id",
      "atIso",
      "action",
      "clientId",
      "actorUid",
      "quoteId",
      "reservationId",
      "orderId",
      "riskLevel",
      "serviceId",
      "reason",
      "metadataJson",
    ];
    const lines = [toCsvLine(header)];
    for (const row of filtered) {
      const createdAtMs = tsToMillis(row.createdAt);
      const metadata = row.metadata && typeof row.metadata === "object"
        ? (row.metadata as Record<string, unknown>)
        : null;
      lines.push(
        toCsvLine([
          row.id ?? "",
          createdAtMs ? new Date(createdAtMs).toISOString() : "",
          typeof row.action === "string" ? row.action : "",
          typeof row.agentClientId === "string" ? row.agentClientId : "",
          typeof row.actorUid === "string" ? row.actorUid : "",
          typeof row.quoteId === "string" ? row.quoteId : "",
          typeof row.reservationId === "string" ? row.reservationId : "",
          typeof row.orderId === "string" ? row.orderId : "",
          typeof row.riskLevel === "string" ? row.riskLevel : "",
          typeof row.serviceId === "string" ? row.serviceId : "",
          typeof row.reason === "string" ? row.reason : "",
          metadata ? JSON.stringify(metadata) : "",
        ])
      );
    }
    const csv = `${lines.join("\n")}\n`;
    const filename = `agent-denied-events-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.csv`;

    await db.collection("agentAuditLogs").add({
      actorUid: auth.uid,
      actorMode: "firebase",
      action: "staff_export_agent_denied_events_csv",
      clientIdFilter: clientIdFilter || null,
      actionFilter,
      fromIso: parsed.data.fromIso ?? null,
      toIso: parsed.data.toIso ?? null,
      rowCount: filtered.length,
      createdAt: nowTs(),
    });

    res.status(200).json({
      ok: true,
      rowCount: filtered.length,
      filename,
      csv,
    });
  }
);
