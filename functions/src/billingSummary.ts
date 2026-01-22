/* eslint-disable @typescript-eslint/no-explicit-any */

import { onRequest } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";

import {
  applyCors,
  asInt,
  db,
  requireAuthUid,
  safeString,
  Timestamp,
} from "./shared";

const REGION = "us-central1";
const EVENTS_COL = "events";
const SIGNUPS_COL = "eventSignups";
const ORDERS_COL = "materialsOrders";
const CHARGES_COL = "eventCharges";

function normalizeCurrency(value: unknown): string {
  const raw = safeString(value).trim();
  if (!raw) return "USD";
  return raw.toUpperCase();
}

function toIso(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Timestamp) {
    return value.toDate().toISOString();
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return new Date(parsed).toISOString();
  }
  if (typeof value === "number") {
    return new Date(value).toISOString();
  }
  return null;
}

function parseMs(value: unknown): number | null {
  if (!value) return null;
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return null;
}

export const listBillingSummary = onRequest({ region: REGION }, async (req, res) => {
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

  const limit = Math.min(Math.max(asInt(req.body?.limit, 20), 1), 100);
  const fromMs = parseMs(req.body?.from);
  const toMs = parseMs(req.body?.to);

  const signupsQuery = db
    .collection(SIGNUPS_COL)
    .where("uid", "==", auth.uid)
    .where("status", "==", "checked_in")
    .orderBy("createdAt", "desc")
    .limit(limit);

  const ordersQuery = db
    .collection(ORDERS_COL)
    .where("uid", "==", auth.uid)
    .orderBy("updatedAt", "desc")
    .limit(limit);

  const chargesQuery = db
    .collection(CHARGES_COL)
    .where("uid", "==", auth.uid)
    .where("paymentStatus", "==", "paid")
    .orderBy("updatedAt", "desc")
    .limit(limit);

  try {
    const [signupsSnap, ordersSnap, chargesSnap] = await Promise.all([
      signupsQuery.get(),
      ordersQuery.get(),
      chargesQuery.get(),
    ]);

    const signups = signupsSnap.docs
      .map((docSnap) => {
        const data = docSnap.data() as Record<string, any>;
        return {
          id: docSnap.id,
          eventId: safeString(data.eventId),
          status: safeString(data.status),
          paymentStatus: safeString(data.paymentStatus),
          createdAt: toIso(data.createdAt),
          checkedInAt: toIso(data.checkedInAt),
          checkInMethod: safeString(data.checkInMethod) || null,
          offerExpiresAt: toIso(data.offerExpiresAt),
        };
      })
      .filter((entry) => entry.paymentStatus !== "paid");

    const eventIds = Array.from(new Set(signups.map((entry) => entry.eventId).filter((id) => id)));
    const eventRefs = eventIds.map((eventId) => db.collection(EVENTS_COL).doc(eventId));
    const eventSnaps = eventRefs.length ? await db.getAll(...eventRefs) : [];

    const eventInfo = new Map<string, { title: string; priceCents: number; currency: string }>();
    eventSnaps.forEach((snap) => {
      const data = (snap.data() as Record<string, any>) ?? {};
      eventInfo.set(snap.id, {
        title: safeString(data.title) || "Event",
        priceCents: Math.max(asInt(data.priceCents, 0), 0),
        currency: normalizeCurrency(data.currency),
      });
    });

    const inRange = (iso: string | null) => {
      if (!iso) return true;
      const ms = Date.parse(iso);
      if (Number.isNaN(ms)) return true;
      if (fromMs !== null && ms < fromMs) return false;
      if (toMs !== null && ms > toMs) return false;
      return true;
    };

    const billingCheckIns = signups
      .map((entry) => {
        const event = eventInfo.get(entry.eventId);
        const amountCents = event?.priceCents ?? 0;
        const currency = event?.currency ?? null;
        return {
          signupId: entry.id,
          eventId: entry.eventId,
          eventTitle: event?.title ?? "Event",
          status: entry.status,
          paymentStatus: entry.paymentStatus || null,
          amountCents: amountCents > 0 ? amountCents : null,
          currency,
          offerExpiresAt: entry.offerExpiresAt,
          checkedInAt: entry.checkedInAt,
          createdAt: entry.createdAt,
          checkInMethod: entry.checkInMethod,
        };
      })
      .filter((entry) => inRange(entry.createdAt));

    const materialsOrders = ordersSnap.docs.map((docSnap) => {
      const data = docSnap.data() as Record<string, any>;
      const items = Array.isArray(data.items) ? data.items : [];
      const normalizedItems = items.map((item) => ({
        productId: safeString(item?.productId),
        name: safeString(item?.name),
        quantity: Math.max(asInt(item?.quantity, 0), 0),
        unitPrice: Math.max(asInt(item?.unitPrice, 0), 0),
        currency: normalizeCurrency(item?.currency),
      }));

      return {
        id: docSnap.id,
        status: safeString(data.status) || "unknown",
        totalCents: Math.max(asInt(data.totalCents, 0), 0),
        currency: normalizeCurrency(data.currency),
        pickupNotes: safeString(data.pickupNotes) || null,
        checkoutUrl: safeString(data.checkoutUrl) || null,
        createdAt: toIso(data.createdAt),
        updatedAt: toIso(data.updatedAt),
        items: normalizedItems,
      };
    });

    const pendingMaterialsOrders = materialsOrders.filter((order) => order.status !== "paid");

    const paidMaterialsOrders = materialsOrders.filter((order) => order.status === "paid");

    const receiptsFromOrders = paidMaterialsOrders.map((order) => ({
      id: order.id,
      type: "materials" as const,
      sourceId: order.id,
      title: `Material order`,
      amountCents: order.totalCents,
      currency: order.currency,
      paidAt: order.updatedAt,
      createdAt: order.createdAt,
      metadata: {
        pickupNotes: order.pickupNotes,
        items: order.items,
      },
    }));

    const receiptsFromCharges = chargesSnap.docs.map((docSnap) => {
      const data = docSnap.data() as Record<string, any>;
      const lineItems = Array.isArray(data.lineItems) ? data.lineItems : [];
      const title = lineItems[0]?.title || "Event ticket";

      return {
        id: docSnap.id,
        type: "event" as const,
        sourceId: safeString(data.signupId) || null,
        title,
        amountCents: Math.max(asInt(data.totalCents, 0), 0),
        currency: normalizeCurrency(data.currency),
        paidAt: toIso(data.paidAt),
        createdAt: toIso(data.createdAt),
        metadata: {
          eventId: safeString(data.eventId) || null,
          signupId: safeString(data.signupId) || null,
          lineItems,
        },
      };
    });

    const receipts = [...receiptsFromCharges, ...receiptsFromOrders].filter((entry) => inRange(entry.createdAt));

    const summary = {
      unpaidCheckInsCount: billingCheckIns.length,
      unpaidCheckInsAmountCents: billingCheckIns.reduce(
        (sum, entry) => sum + Math.max(entry.amountCents ?? 0, 0),
        0
      ),
      materialsPendingCount: pendingMaterialsOrders.length,
      materialsPendingAmountCents: pendingMaterialsOrders.reduce(
        (sum, entry) => sum + Math.max(entry.totalCents, 0),
        0
      ),
      receiptsCount: receipts.length,
      receiptsAmountCents: receipts.reduce((sum, entry) => sum + Math.max(entry.amountCents, 0), 0),
    };

    res.status(200).json({
      ok: true,
      unpaidCheckIns: billingCheckIns,
      materialsOrders,
      receipts,
      summary,
    });
  } catch (err: any) {
    logger.error("listBillingSummary failed", err);
    res.status(500).json({ ok: false, message: err?.message ?? String(err) });
  }
});
