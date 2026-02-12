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
});

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
      readCollection("agentAuditLogs", "createdAt", limit),
    ]);

    res.status(200).json({
      ok: true,
      snapshot: {
        quotes: quotes.length,
        reservations: reservations.length,
        orders: orders.length,
        auditEvents: audit.length,
      },
      quotes,
      reservations,
      orders,
      audit,
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

    await db.doc(AGENT_OPS_CONFIG_PATH).set(patch, { merge: true });
    await db.collection("agentAuditLogs").add({
      actorUid: auth.uid,
      actorMode: "firebase",
      action: "agent_ops_config_updated",
      patch,
      createdAt: nowTs(),
    });

    const config = await getAgentOpsConfig();
    res.status(200).json({ ok: true, config });
  }
);
