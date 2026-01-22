
/* eslint-disable @typescript-eslint/no-explicit-any */

import { onRequest } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import * as logger from "firebase-functions/logger";
import Stripe from "stripe";

import {
  applyCors,
  asInt,
  db,
  nowTs,
  requireAdmin,
  requireAuthUid,
  safeString,
  adminAuth,
  Timestamp,
} from "./shared";

const REGION = "us-central1";
const EVENTS_COL = "events";
const SIGNUPS_COL = "eventSignups";
const CHARGES_COL = "eventCharges";

const DEFAULT_OFFER_HOURS = 12;
const DEFAULT_CANCEL_HOURS = 3;

let stripeClient: Stripe | null = null;

function getStripe(): Stripe {
  const key = (process.env.STRIPE_SECRET_KEY ?? "").trim();
  if (!key) throw new Error("STRIPE_SECRET_KEY not configured");
  if (!stripeClient) {
    stripeClient = new Stripe(key);
  }
  return stripeClient;
}

function getPortalBaseUrl(req: any): string {
  const configured = (process.env.PORTAL_BASE_URL ?? "").trim();
  if (configured) return configured.replace(/\/+$/, "");

  const origin = typeof req.headers?.origin === "string" ? req.headers.origin : "";
  if (origin) return origin.replace(/\/+$/, "");

  const referer = typeof req.headers?.referer === "string" ? req.headers.referer : "";
  if (referer) {
    try {
      const url = new URL(referer);
      return url.origin.replace(/\/+$/, "");
    } catch {
      // ignore
    }
  }

  return "";
}

function normalizeCurrency(value: string | undefined) {
  const raw = safeString(value).trim();
  if (!raw) return "USD";
  return raw.toUpperCase();
}

function parseTimestamp(value: unknown): Timestamp | null {
  if (!value) return null;
  if (value instanceof Timestamp) return value;
  if (value instanceof Date) return Timestamp.fromDate(value);
  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return Timestamp.fromDate(parsed);
  }
  if (typeof value === "object") {
    const maybe = value as { toDate?: () => Date };
    if (typeof maybe.toDate === "function") {
      try {
        return Timestamp.fromDate(maybe.toDate());
      } catch {
        return null;
      }
    }
  }
  return null;
}

function toIso(value: unknown): string | null {
  const ts = parseTimestamp(value);
  if (!ts) return null;
  try {
    return ts.toDate().toISOString();
  } catch {
    return null;
  }
}

type EventAddOn = {
  id: string;
  title: string;
  priceCents: number;
  isActive: boolean;
};

function normalizeAddOns(raw: unknown): EventAddOn[] {
  if (!Array.isArray(raw)) return [];
  const normalized: EventAddOn[] = [];

  raw.forEach((item) => {
    const id = safeString(item?.id).trim();
    const title = safeString(item?.title).trim();
    const priceCents = asInt(item?.priceCents, 0);
    const isActive = item?.isActive !== false;

    if (!id || !title || priceCents < 0) return;

    normalized.push({ id, title, priceCents, isActive });
  });

  return normalized;
}

function readCounts(eventData: Record<string, any>) {
  const ticketedCount = Math.max(asInt(eventData.ticketedCount, 0), 0);
  const offeredCount = Math.max(asInt(eventData.offeredCount, 0), 0);
  const checkedInCount = Math.max(asInt(eventData.checkedInCount, 0), 0);
  const waitlistCount = Math.max(asInt(eventData.waitlistCount, 0), 0);

  return { ticketedCount, offeredCount, checkedInCount, waitlistCount };
}

function computeRemainingCapacity(eventData: Record<string, any>): number {
  const capacity = Math.max(asInt(eventData.capacity, 0), 0);
  const counts = readCounts(eventData);
  const reserved = counts.ticketedCount + counts.offeredCount + counts.checkedInCount;
  return Math.max(capacity - reserved, 0);
}

async function readUserIdentity(uid: string): Promise<{ displayName: string | null; email: string | null }> {
  try {
    const user = await adminAuth.getUser(uid);
    return { displayName: user.displayName ?? null, email: user.email ?? null };
  } catch {
    return { displayName: null, email: null };
  }
}

function defaultPolicyCopy() {
  return "You won't be charged unless you attend. If plans change, no worries - cancel anytime up to 3 hours before the event.";
}
export const listEvents = onRequest({ region: REGION }, async (req, res) => {
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

  const includeDrafts = !!req.body?.includeDrafts;
  const includeCancelled = !!req.body?.includeCancelled;

  if ((includeDrafts || includeCancelled) && !requireAdmin(req).ok) {
    res.status(401).json({ ok: false, message: "Admin required" });
    return;
  }

  try {
    let snaps;
    if (includeDrafts || includeCancelled) {
      snaps = await db.collection(EVENTS_COL).get();
    } else {
      snaps = await db.collection(EVENTS_COL).where("status", "==", "published").get();
    }

    const events = snaps.docs
      .map((docSnap) => {
        const data = (docSnap.data() as Record<string, any>) ?? {};
        const status = safeString(data.status).trim();
        if (!includeDrafts && status === "draft") return null;
        if (!includeCancelled && status === "cancelled") return null;

        return {
          id: docSnap.id,
          title: safeString(data.title),
          summary: safeString(data.summary),
          startAt: toIso(data.startAt),
          endAt: toIso(data.endAt),
          timezone: safeString(data.timezone),
          location: safeString(data.location),
          priceCents: asInt(data.priceCents, 0),
          currency: normalizeCurrency(data.currency),
          includesFiring: data.includesFiring === true,
          firingDetails: data.firingDetails ?? null,
          capacity: Math.max(asInt(data.capacity, 0), 0),
          waitlistEnabled: data.waitlistEnabled !== false,
          status: status || "draft",
          remainingCapacity: computeRemainingCapacity(data),
        };
      })
      .filter((event) => Boolean(event));

    res.status(200).json({ ok: true, events });
  } catch (err: any) {
    logger.error("listEvents failed", err);
    res.status(500).json({ ok: false, message: err?.message ?? String(err) });
  }
});

export const listEventSignups = onRequest({ region: REGION }, async (req, res) => {
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

  const admin = requireAdmin(req);
  if (!admin.ok) {
    res.status(401).json({ ok: false, message: admin.message });
    return;
  }

  const eventId = safeString(req.body?.eventId).trim();
  if (!eventId) {
    res.status(400).json({ ok: false, message: "eventId required" });
    return;
  }

  const includeCancelled = req.body?.includeCancelled === true;
  const includeExpired = req.body?.includeExpired === true;
  const limit = Math.min(Math.max(asInt(req.body?.limit, 200), 1), 500);

  try {
    const snaps = await db
      .collection(SIGNUPS_COL)
      .where("eventId", "==", eventId)
      .orderBy("createdAt", "asc")
      .limit(limit)
      .get();

    const signups = snaps.docs
      .map((docSnap) => {
        const data = (docSnap.data() as Record<string, any>) ?? {};
        const status = safeString(data.status).trim();
        if (!status) return null;
        if (!includeCancelled && status === "cancelled") return null;
        if (!includeExpired && status === "expired") return null;

        return {
          id: docSnap.id,
          uid: safeString(data.uid) || null,
          status,
          paymentStatus: safeString(data.paymentStatus) || null,
          displayName: safeString(data.displayName) || null,
          email: safeString(data.email) || null,
          createdAt: toIso(data.createdAt),
          offerExpiresAt: toIso(data.offerExpiresAt),
          checkedInAt: toIso(data.checkedInAt),
          checkInMethod: safeString(data.checkInMethod) || null,
        };
      })
      .filter((row) => Boolean(row));

    res.status(200).json({ ok: true, signups });
  } catch (err: any) {
    logger.error("listEventSignups failed", err);
    res.status(500).json({ ok: false, message: err?.message ?? String(err) });
  }
});


export const getEvent = onRequest({ region: REGION }, async (req, res) => {
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

  const eventId = safeString(req.body?.eventId).trim();
  if (!eventId) {
    res.status(400).json({ ok: false, message: "eventId required" });
    return;
  }

  try {
    const eventRef = db.collection(EVENTS_COL).doc(eventId);
    const eventSnap = await eventRef.get();
    if (!eventSnap.exists) {
      res.status(404).json({ ok: false, message: "Event not found" });
      return;
    }

    const eventData = (eventSnap.data() as Record<string, any>) ?? {};
    const status = safeString(eventData.status).trim();
    const admin = requireAdmin(req);

    if (status !== "published" && !admin.ok) {
      res.status(403).json({ ok: false, message: "Forbidden" });
      return;
    }

    const signupQuery = db
      .collection(SIGNUPS_COL)
      .where("eventId", "==", eventId)
      .where("uid", "==", auth.uid)
      .limit(1);

    const signupSnap = await signupQuery.get();
    const signupDoc = signupSnap.docs[0];

    const signup = signupDoc
      ? {
          id: signupDoc.id,
          status: safeString(signupDoc.data().status),
          paymentStatus: safeString(signupDoc.data().paymentStatus),
        }
      : null;

    const responseEvent = {
      id: eventSnap.id,
      title: safeString(eventData.title),
      summary: safeString(eventData.summary),
      description: safeString(eventData.description),
      startAt: toIso(eventData.startAt),
      endAt: toIso(eventData.endAt),
      timezone: safeString(eventData.timezone),
      location: safeString(eventData.location),
      priceCents: asInt(eventData.priceCents, 0),
      currency: normalizeCurrency(eventData.currency),
      includesFiring: eventData.includesFiring === true,
      firingDetails: eventData.firingDetails ?? null,
      policyCopy: safeString(eventData.policyCopy) || defaultPolicyCopy(),
      addOns: normalizeAddOns(eventData.addOns ?? []),
      capacity: Math.max(asInt(eventData.capacity, 0), 0),
      waitlistEnabled: eventData.waitlistEnabled !== false,
      offerClaimWindowHours: Math.max(asInt(eventData.offerClaimWindowHours, DEFAULT_OFFER_HOURS), 1),
      cancelCutoffHours: Math.max(asInt(eventData.cancelCutoffHours, DEFAULT_CANCEL_HOURS), 0),
      status: status || "draft",
    };

    res.status(200).json({ ok: true, event: responseEvent, signup });
  } catch (err: any) {
    logger.error("getEvent failed", err);
    res.status(500).json({ ok: false, message: err?.message ?? String(err) });
  }
});
export const createEvent = onRequest({ region: REGION, timeoutSeconds: 60 }, async (req, res) => {
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

  const admin = requireAdmin(req);
  if (!admin.ok) {
    res.status(401).json({ ok: false, message: admin.message });
    return;
  }

  const templateId = safeString(req.body?.templateId).trim() || null;
  const title = safeString(req.body?.title).trim();
  const summary = safeString(req.body?.summary).trim();
  const description = safeString(req.body?.description).trim();
  const location = safeString(req.body?.location).trim();
  const timezone = safeString(req.body?.timezone).trim();
  const capacity = Math.max(asInt(req.body?.capacity, 0), 0);
  const priceCents = Math.max(asInt(req.body?.priceCents, 0), 0);
  const currency = normalizeCurrency(req.body?.currency);
  const includesFiring = req.body?.includesFiring === true;
  const firingDetails = safeString(req.body?.firingDetails).trim() || null;
  const policyCopy = safeString(req.body?.policyCopy).trim() || defaultPolicyCopy();
  const addOns = normalizeAddOns(req.body?.addOns ?? []);
  const waitlistEnabled = req.body?.waitlistEnabled !== false;
  const offerClaimWindowHours = Math.max(
    asInt(req.body?.offerClaimWindowHours, DEFAULT_OFFER_HOURS),
    1
  );
  const cancelCutoffHours = Math.max(asInt(req.body?.cancelCutoffHours, DEFAULT_CANCEL_HOURS), 0);

  const startAt = parseTimestamp(req.body?.startAt);
  const endAt = parseTimestamp(req.body?.endAt);

  if (!title || !summary || !description || !location || !timezone) {
    res.status(400).json({ ok: false, message: "Missing required fields" });
    return;
  }

  if (!startAt || !endAt) {
    res.status(400).json({ ok: false, message: "startAt and endAt required" });
    return;
  }

  if (startAt.toMillis() >= endAt.toMillis()) {
    res.status(400).json({ ok: false, message: "startAt must be before endAt" });
    return;
  }

  const ref = db.collection(EVENTS_COL).doc();
  const t = nowTs();

  await ref.set({
    templateId,
    title,
    summary,
    description,
    location,
    timezone,
    startAt,
    endAt,
    capacity,
    priceCents,
    currency,
    includesFiring,
    firingDetails,
    policyCopy,
    addOns,
    waitlistEnabled,
    offerClaimWindowHours,
    cancelCutoffHours,
    status: "draft",
    ticketedCount: 0,
    offeredCount: 0,
    checkedInCount: 0,
    waitlistCount: 0,
    createdAt: t,
    updatedAt: t,
    publishedAt: null,
  });

  res.status(200).json({ ok: true, eventId: ref.id });
});

export const publishEvent = onRequest({ region: REGION }, async (req, res) => {
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

  const admin = requireAdmin(req);
  if (!admin.ok) {
    res.status(401).json({ ok: false, message: admin.message });
    return;
  }

  const eventId = safeString(req.body?.eventId).trim();
  if (!eventId) {
    res.status(400).json({ ok: false, message: "eventId required" });
    return;
  }

  const ref = db.collection(EVENTS_COL).doc(eventId);
  const t = nowTs();

  await ref.set(
    {
      status: "published",
      publishedAt: t,
      updatedAt: t,
    },
    { merge: true }
  );

  res.status(200).json({ ok: true, status: "published" });
});

export const signupForEvent = onRequest({ region: REGION, timeoutSeconds: 60 }, async (req, res) => {
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

  const eventId = safeString(req.body?.eventId).trim();
  if (!eventId) {
    res.status(400).json({ ok: false, message: "eventId required" });
    return;
  }

  const { displayName, email } = await readUserIdentity(auth.uid);

  const eventRef = db.collection(EVENTS_COL).doc(eventId);
  const signupRef = db.collection(SIGNUPS_COL).doc();

  try {
    const result = await db.runTransaction(async (tx) => {
      const eventSnap = await tx.get(eventRef);
      if (!eventSnap.exists) {
        throw new Error("Event not found");
      }

      const eventData = (eventSnap.data() as Record<string, any>) ?? {};
      const status = safeString(eventData.status).trim();
      if (status !== "published") {
        throw new Error("Event not published");
      }

      const existingSnap = await tx.get(
        db.collection(SIGNUPS_COL).where("eventId", "==", eventId).where("uid", "==", auth.uid)
      );

      const existing = existingSnap.docs.find((doc) => {
        const s = safeString(doc.data().status).trim();
        return s && s !== "cancelled" && s !== "expired";
      });

      if (existing) {
        return { signupId: existing.id, status: safeString(existing.data().status) };
      }

      const capacity = Math.max(asInt(eventData.capacity, 0), 0);
      const waitlistEnabled = eventData.waitlistEnabled !== false;
      const counts = readCounts(eventData);
      const reserved = counts.ticketedCount + counts.offeredCount + counts.checkedInCount;
      const hasCapacity = capacity > 0 && reserved < capacity;

      let nextStatus = "waitlisted";
      if (hasCapacity) {
        nextStatus = "ticketed";
      } else if (!waitlistEnabled) {
        throw new Error("Event sold out");
      }

      const t = nowTs();
      tx.set(signupRef, {
        eventId,
        uid: auth.uid,
        status: nextStatus,
        offerExpiresAt: null,
        offeredAt: null,
        checkedInAt: null,
        checkedInByUid: null,
        checkInMethod: null,
        paymentStatus: "unpaid",
        displayName,
        email,
        createdAt: t,
        updatedAt: t,
      });

      const nextCounts = {
        ticketedCount: counts.ticketedCount + (nextStatus === "ticketed" ? 1 : 0),
        offeredCount: counts.offeredCount,
        checkedInCount: counts.checkedInCount,
        waitlistCount: counts.waitlistCount + (nextStatus === "waitlisted" ? 1 : 0),
      };

      tx.set(
        eventRef,
        {
          ...nextCounts,
          updatedAt: t,
        },
        { merge: true }
      );

      return { signupId: signupRef.id, status: nextStatus };
    });

    res.status(200).json({ ok: true, signupId: result.signupId, status: result.status });
  } catch (err: any) {
    const msg = err?.message ?? String(err);
    const status = msg === "Event not found" ? 404 : msg === "Event sold out" ? 409 : 400;
    res.status(status).json({ ok: false, message: msg });
  }
});
export const cancelEventSignup = onRequest(
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

    const signupId = safeString(req.body?.signupId).trim();
    if (!signupId) {
      res.status(400).json({ ok: false, message: "signupId required" });
      return;
    }

    const signupRef = db.collection(SIGNUPS_COL).doc(signupId);

    try {
      await db.runTransaction(async (tx) => {
        const signupSnap = await tx.get(signupRef);
        if (!signupSnap.exists) {
          throw new Error("Signup not found");
        }

        const signup = signupSnap.data() as Record<string, any>;
        if (signup.uid !== auth.uid) {
          throw new Error("Forbidden");
        }

        const status = safeString(signup.status).trim();
        if (status === "cancelled" || status === "expired") return;
        if (status === "checked_in") {
          throw new Error("Already checked in");
        }

        const eventId = safeString(signup.eventId).trim();
        if (!eventId) {
          throw new Error("Event missing");
        }

        const eventRef = db.collection(EVENTS_COL).doc(eventId);
        const eventSnap = await tx.get(eventRef);
        if (!eventSnap.exists) {
          throw new Error("Event not found");
        }

        const eventData = (eventSnap.data() as Record<string, any>) ?? {};
        if (status === "ticketed" || status === "offered") {
          const cancelCutoffHours = Math.max(
            asInt(eventData.cancelCutoffHours, DEFAULT_CANCEL_HOURS),
            0
          );
          const startAt = parseTimestamp(eventData.startAt);
          if (startAt) {
            const cutoff = startAt.toMillis() - cancelCutoffHours * 60 * 60 * 1000;
            if (Date.now() > cutoff) {
              throw new Error("Cancellation window closed");
            }
          }
        }

        const counts = readCounts(eventData);
        const t = nowTs();

        tx.set(
          signupRef,
          {
            status: "cancelled",
            updatedAt: t,
          },
          { merge: true }
        );

        let ticketedCount = counts.ticketedCount;
        let offeredCount = counts.offeredCount;
        let checkedInCount = counts.checkedInCount;
        let waitlistCount = counts.waitlistCount;

        if (status === "ticketed") ticketedCount = Math.max(ticketedCount - 1, 0);
        if (status === "offered") offeredCount = Math.max(offeredCount - 1, 0);
        if (status === "waitlisted") waitlistCount = Math.max(waitlistCount - 1, 0);
        if (status === "checked_in") checkedInCount = Math.max(checkedInCount - 1, 0);

        const waitlistEnabled = eventData.waitlistEnabled !== false;

        const capacity = Math.max(asInt(eventData.capacity, 0), 0);
        const reserved = ticketedCount + offeredCount + checkedInCount;
        const openSpots = capacity > reserved ? capacity - reserved : 0;

        if (waitlistEnabled && openSpots > 0 && waitlistCount > 0) {
          const waitlistQuery = db
            .collection(SIGNUPS_COL)
            .where("eventId", "==", eventId)
            .where("status", "==", "waitlisted")
            .orderBy("createdAt", "asc")
            .limit(1);

          const waitlistSnap = await tx.get(waitlistQuery);
          if (!waitlistSnap.empty) {
            const offeredSignupRef = waitlistSnap.docs[0].ref;
            const offerExpiresAt = Timestamp.fromMillis(
              Date.now() +
                Math.max(asInt(eventData.offerClaimWindowHours, DEFAULT_OFFER_HOURS), 1) *
                  60 *
                  60 *
                  1000
            );

            tx.set(
              offeredSignupRef,
              {
                status: "offered",
                offeredAt: t,
                offerExpiresAt,
                updatedAt: t,
              },
              { merge: true }
            );

            waitlistCount = Math.max(waitlistCount - 1, 0);
            offeredCount += 1;
          }
        }

        tx.set(
          eventRef,
          {
            ticketedCount,
            offeredCount,
            checkedInCount,
            waitlistCount,
            updatedAt: t,
          },
          { merge: true }
        );
      });

      res.status(200).json({ ok: true, status: "cancelled" });
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      const status =
        msg === "Signup not found" || msg === "Event not found"
          ? 404
          : msg === "Forbidden"
            ? 403
            : 400;
      res.status(status).json({ ok: false, message: msg });
    }
  }
);
export const claimEventOffer = onRequest(
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

    const signupId = safeString(req.body?.signupId).trim();
    if (!signupId) {
      res.status(400).json({ ok: false, message: "signupId required" });
      return;
    }

    const signupRef = db.collection(SIGNUPS_COL).doc(signupId);

    try {
      await db.runTransaction(async (tx) => {
        const signupSnap = await tx.get(signupRef);
        if (!signupSnap.exists) {
          throw new Error("Signup not found");
        }

        const signup = signupSnap.data() as Record<string, any>;
        if (signup.uid !== auth.uid) {
          throw new Error("Forbidden");
        }

        const status = safeString(signup.status).trim();
        if (status !== "offered") {
          throw new Error("Offer not available");
        }

        const eventId = safeString(signup.eventId).trim();
        if (!eventId) {
          throw new Error("Event missing");
        }

        const eventRef = db.collection(EVENTS_COL).doc(eventId);
        const eventSnap = await tx.get(eventRef);
        if (!eventSnap.exists) {
          throw new Error("Event not found");
        }

        const eventData = (eventSnap.data() as Record<string, any>) ?? {};
        const counts = readCounts(eventData);
        const t = nowTs();

        const offerExpiresAt = parseTimestamp(signup.offerExpiresAt);
        if (offerExpiresAt && offerExpiresAt.toMillis() < Date.now()) {
          tx.set(
            signupRef,
            {
              status: "expired",
              updatedAt: t,
            },
            { merge: true }
          );

          const offeredCount = Math.max(counts.offeredCount - 1, 0);
          tx.set(
            eventRef,
            {
              offeredCount,
              updatedAt: t,
            },
            { merge: true }
          );

          throw new Error("Offer expired");
        }

        tx.set(
          signupRef,
          {
            status: "ticketed",
            offerExpiresAt: null,
            updatedAt: t,
          },
          { merge: true }
        );

        tx.set(
          eventRef,
          {
            ticketedCount: counts.ticketedCount + 1,
            offeredCount: Math.max(counts.offeredCount - 1, 0),
            updatedAt: t,
          },
          { merge: true }
        );
      });

      res.status(200).json({ ok: true, status: "ticketed" });
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      const status =
        msg === "Signup not found" || msg === "Event not found"
          ? 404
          : msg === "Forbidden"
            ? 403
            : 400;
      res.status(status).json({ ok: false, message: msg });
    }
  }
);

export const checkInEvent = onRequest(
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

    const signupId = safeString(req.body?.signupId).trim();
    const method = safeString(req.body?.method).trim() as "staff" | "self";
    if (!signupId) {
      res.status(400).json({ ok: false, message: "signupId required" });
      return;
    }

    if (method !== "staff" && method !== "self") {
      res.status(400).json({ ok: false, message: "method must be staff or self" });
      return;
    }

    if (method === "staff") {
      const admin = requireAdmin(req);
      if (!admin.ok) {
        res.status(401).json({ ok: false, message: admin.message });
        return;
      }
    }

    const signupRef = db.collection(SIGNUPS_COL).doc(signupId);

    try {
      await db.runTransaction(async (tx) => {
        const signupSnap = await tx.get(signupRef);
        if (!signupSnap.exists) {
          throw new Error("Signup not found");
        }

        const signup = signupSnap.data() as Record<string, any>;
        if (method === "self" && signup.uid !== auth.uid) {
          throw new Error("Forbidden");
        }

        const status = safeString(signup.status).trim();
        if (status === "checked_in") return;
        if (status !== "ticketed") {
          throw new Error("Ticket not active");
        }

        const eventId = safeString(signup.eventId).trim();
        if (!eventId) {
          throw new Error("Event missing");
        }

        const eventRef = db.collection(EVENTS_COL).doc(eventId);
        const eventSnap = await tx.get(eventRef);
        if (!eventSnap.exists) {
          throw new Error("Event not found");
        }

        const eventData = (eventSnap.data() as Record<string, any>) ?? {};
        const counts = readCounts(eventData);
        const t = nowTs();

        tx.set(
          signupRef,
          {
            status: "checked_in",
            checkedInAt: t,
            checkedInByUid: auth.uid,
            checkInMethod: method,
            updatedAt: t,
          },
          { merge: true }
        );

        tx.set(
          eventRef,
          {
            ticketedCount: Math.max(counts.ticketedCount - 1, 0),
            checkedInCount: counts.checkedInCount + 1,
            updatedAt: t,
          },
          { merge: true }
        );
      });

      res.status(200).json({ ok: true, status: "checked_in", paymentStatus: "unpaid" });
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      const status =
        msg === "Signup not found" || msg === "Event not found"
          ? 404
          : msg === "Forbidden"
            ? 403
            : 400;
      res.status(status).json({ ok: false, message: msg });
    }
  }
);
export const createEventCheckoutSession = onRequest(
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

    const eventId = safeString(req.body?.eventId).trim();
    const signupId = safeString(req.body?.signupId).trim();
    const rawAddOns = Array.isArray(req.body?.addOnIds) ? req.body.addOnIds : [];

    if (!eventId || !signupId) {
      res.status(400).json({ ok: false, message: "eventId and signupId required" });
      return;
    }

    try {
      const eventRef = db.collection(EVENTS_COL).doc(eventId);
      const signupRef = db.collection(SIGNUPS_COL).doc(signupId);

      const [eventSnap, signupSnap] = await Promise.all([eventRef.get(), signupRef.get()]);

      if (!eventSnap.exists) {
        res.status(404).json({ ok: false, message: "Event not found" });
        return;
      }
      if (!signupSnap.exists) {
        res.status(404).json({ ok: false, message: "Signup not found" });
        return;
      }

      const eventData = (eventSnap.data() as Record<string, any>) ?? {};
      const signup = signupSnap.data() as Record<string, any>;

      if (signup.uid !== auth.uid) {
        res.status(403).json({ ok: false, message: "Forbidden" });
        return;
      }

      if (safeString(signup.status).trim() !== "checked_in") {
        res.status(400).json({ ok: false, message: "Check-in required" });
        return;
      }

      if (safeString(signup.paymentStatus).trim() === "paid") {
        res.status(409).json({ ok: false, message: "Already paid" });
        return;
      }

      if (safeString(eventData.status).trim() === "cancelled") {
        res.status(400).json({ ok: false, message: "Event cancelled" });
        return;
      }

      const addOns = normalizeAddOns(eventData.addOns ?? []);
      const addOnIds = rawAddOns
        .map((item: any) => safeString(item).trim())
        .filter((id: string) => id.length > 0);

      const addOnLookup = new Map(addOns.map((addOn) => [addOn.id, addOn]));
      const selectedAddOns: EventAddOn[] = [];
      for (const id of addOnIds) {
        const addOn = addOnLookup.get(id);
        if (!addOn || !addOn.isActive) {
          res.status(400).json({ ok: false, message: `Invalid add-on: ${id}` });
          return;
        }
        selectedAddOns.push(addOn);
      }

      const priceCents = Math.max(asInt(eventData.priceCents, 0), 0);
      if (priceCents <= 0) {
        res.status(400).json({ ok: false, message: "Event price missing" });
        return;
      }

      const currency = normalizeCurrency(eventData.currency);
      const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [];
      const receiptItems: Array<{ id: string; title: string; priceCents: number; quantity: number }> = [];

      const baseTitle = safeString(eventData.title) || "Event ticket";
      const baseSummary = safeString(eventData.summary) || undefined;

      lineItems.push({
        price_data: {
          currency: currency.toLowerCase(),
          unit_amount: priceCents,
          product_data: {
            name: baseTitle,
            description: baseSummary,
          },
        },
        quantity: 1,
      });

      receiptItems.push({
        id: "ticket",
        title: baseTitle,
        priceCents,
        quantity: 1,
      });

      let totalCents = priceCents;

      for (const addOn of selectedAddOns) {
        if (addOn.priceCents <= 0) continue;
        lineItems.push({
          price_data: {
            currency: currency.toLowerCase(),
            unit_amount: addOn.priceCents,
            product_data: {
              name: addOn.title,
            },
          },
          quantity: 1,
        });
        receiptItems.push({
          id: addOn.id,
          title: addOn.title,
          priceCents: addOn.priceCents,
          quantity: 1,
        });
        totalCents += addOn.priceCents;
      }

      const baseUrl = getPortalBaseUrl(req);
      if (!baseUrl) {
        res.status(500).json({ ok: false, message: "PORTAL_BASE_URL not configured" });
        return;
      }

      const stripe = getStripe();
      const chargeRef = db.collection(CHARGES_COL).doc();
      const chargeId = chargeRef.id;

      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        line_items: lineItems,
        success_url: `${baseUrl}/events?status=success&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${baseUrl}/events?status=cancel`,
        customer_email: signup.email ?? undefined,
        phone_number_collection: { enabled: true },
        billing_address_collection: "auto",
        automatic_tax: { enabled: true },
        client_reference_id: signupId,
        metadata: {
          chargeId,
          signupId,
          eventId,
          uid: auth.uid,
        },
      });

      const t = nowTs();
      await chargeRef.set({
        eventId,
        signupId,
        uid: auth.uid,
        lineItems: receiptItems,
        totalCents,
        currency,
        paymentStatus: "checkout_pending",
        stripeCheckoutSessionId: session.id ?? null,
        stripePaymentIntentId: null,
        createdAt: t,
        updatedAt: t,
      });

      res.status(200).json({ ok: true, checkoutUrl: session.url });
    } catch (err: any) {
      logger.error("createEventCheckoutSession failed", err);
      res.status(500).json({ ok: false, message: err?.message ?? String(err) });
    }
  }
);
export const eventStripeWebhook = onRequest({ region: REGION, timeoutSeconds: 60 }, async (req, res) => {
  const signature = req.headers["stripe-signature"];
  if (!signature || typeof signature !== "string") {
    res.status(400).send("Missing Stripe signature");
    return;
  }

  const webhookSecret = (process.env.STRIPE_WEBHOOK_SECRET ?? "").trim();
  if (!webhookSecret) {
    res.status(500).send("STRIPE_WEBHOOK_SECRET not configured");
    return;
  }

  let event: Stripe.Event;
  try {
    const stripe = getStripe();
    event = stripe.webhooks.constructEvent(req.rawBody, signature, webhookSecret);
  } catch (err: any) {
    logger.error("eventStripeWebhook signature verification failed", err);
    res.status(400).send(`Webhook Error: ${err?.message ?? "Invalid signature"}`);
    return;
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    const chargeId = session.metadata?.chargeId;
    const signupId = session.metadata?.signupId;

    if (!chargeId) {
      logger.warn("eventStripeWebhook missing chargeId", { sessionId: session.id });
      res.status(200).json({ ok: true });
      return;
    }

    const chargeRef = db.collection(CHARGES_COL).doc(chargeId);

    try {
      await db.runTransaction(async (tx) => {
        const chargeSnap = await tx.get(chargeRef);
        if (!chargeSnap.exists) {
          logger.warn("eventStripeWebhook charge not found", { chargeId });
          return;
        }

        const charge = chargeSnap.data() as Record<string, any>;
        if (charge.paymentStatus === "paid") return;

        const t = nowTs();
        tx.set(
          chargeRef,
          {
            paymentStatus: "paid",
            updatedAt: t,
            paidAt: t,
            stripePaymentIntentId: session.payment_intent ?? null,
          },
          { merge: true }
        );

        if (signupId) {
          const signupRef = db.collection(SIGNUPS_COL).doc(signupId);
          tx.set(
            signupRef,
            {
              paymentStatus: "paid",
              updatedAt: t,
            },
            { merge: true }
          );
        }
      });
    } catch (err) {
      logger.error("eventStripeWebhook processing failed", err);
    }
  }

  res.status(200).json({ ok: true });
});

export const sweepEventOffers = onSchedule(
  { region: REGION, schedule: "every 30 minutes", timeZone: "America/Phoenix" },
  async () => {
    const now = Timestamp.fromMillis(Date.now());
    const expiredQuery = db
      .collection(SIGNUPS_COL)
      .where("status", "==", "offered")
      .where("offerExpiresAt", "<=", now)
      .limit(25);

    const snap = await expiredQuery.get();
    if (snap.empty) return;

    for (const docSnap of snap.docs) {
      const signupRef = docSnap.ref;

      try {
        await db.runTransaction(async (tx) => {
          const fresh = await tx.get(signupRef);
          if (!fresh.exists) return;

          const signup = fresh.data() as Record<string, any>;
          if (safeString(signup.status).trim() !== "offered") return;

          const offerExpiresAt = parseTimestamp(signup.offerExpiresAt);
          if (!offerExpiresAt || offerExpiresAt.toMillis() > Date.now()) return;

          const eventId = safeString(signup.eventId).trim();
          if (!eventId) return;

          const eventRef = db.collection(EVENTS_COL).doc(eventId);
          const eventSnap = await tx.get(eventRef);
          if (!eventSnap.exists) return;

          const eventData = (eventSnap.data() as Record<string, any>) ?? {};
          const counts = readCounts(eventData);
          const t = nowTs();

          tx.set(
            signupRef,
            {
              status: "expired",
              updatedAt: t,
            },
            { merge: true }
          );

          let offeredCount = Math.max(counts.offeredCount - 1, 0);
          let waitlistCount = counts.waitlistCount;
          const ticketedCount = counts.ticketedCount;
          const checkedInCount = counts.checkedInCount;

          const waitlistEnabled = eventData.waitlistEnabled !== false;
          const capacity = Math.max(asInt(eventData.capacity, 0), 0);
          const reserved = ticketedCount + offeredCount + checkedInCount;
          const openSpots = capacity > reserved ? capacity - reserved : 0;

          if (waitlistEnabled && openSpots > 0 && waitlistCount > 0) {
            const waitlistQuery = db
              .collection(SIGNUPS_COL)
              .where("eventId", "==", eventId)
              .where("status", "==", "waitlisted")
              .orderBy("createdAt", "asc")
              .limit(1);

            const waitlistSnap = await tx.get(waitlistQuery);
            if (!waitlistSnap.empty) {
              const nextRef = waitlistSnap.docs[0].ref;
              const offerExpiresAtNext = Timestamp.fromMillis(
                Date.now() +
                  Math.max(asInt(eventData.offerClaimWindowHours, DEFAULT_OFFER_HOURS), 1) *
                    60 *
                    60 *
                    1000
              );

              tx.set(
                nextRef,
                {
                  status: "offered",
                  offeredAt: t,
                  offerExpiresAt: offerExpiresAtNext,
                  updatedAt: t,
                },
                { merge: true }
              );

              waitlistCount = Math.max(waitlistCount - 1, 0);
              offeredCount += 1;
            }
          }

          tx.set(
            eventRef,
            {
              ticketedCount,
              offeredCount,
              checkedInCount,
              waitlistCount,
              updatedAt: t,
            },
            { merge: true }
          );
        });
      } catch (err) {
        logger.error("sweepEventOffers failed", err);
      }
    }
  }
);
