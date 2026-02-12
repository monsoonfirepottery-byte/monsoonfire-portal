import { onRequest } from "firebase-functions/v2/https";
import { z } from "zod";
import {
  applyCors,
  db,
  parseBody,
  requireAdmin,
  requireAuthUid,
} from "./shared";

const REGION = "us-central1";

const listOpsSchema = z.object({
  limit: z.number().int().min(1).max(200).optional(),
});

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

