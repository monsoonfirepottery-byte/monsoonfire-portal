/* eslint-disable @typescript-eslint/no-explicit-any */

import { onRequest } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import * as logger from "firebase-functions/logger";

import {
  db,
  applyCors,
  requireAdmin,
  requireAuthUid,
  nowTs,
  asInt,
  safeString,
  FieldValue,
  Timestamp,
} from "./shared";
import { TimelineEventType } from "./timelineEventTypes";

// -----------------------------
// Config
// -----------------------------
const REGION = "us-central1";

/**
 * IMPORTANT:
 * This is the Google Calendar ID for "MF Firings" (the calendar you're syncing from).
 * Keep it EXACT (no whitespace). You already verified it with /debugCalendarId.
 */

const FIRINGS_CALENDAR_ID =
  "a985b8d46f34392d2ad6b520742b95e5e83e0db237980ea87dc690334da0f52f@group.calendar.google.com";

function getGoogleCalendarCredsJson(): string | null {
  const raw = (process.env.GOOGLE_CALENDAR_CREDENTIALS ?? "").trim();
  return raw.length ? raw : null;
}

// -----------------------------
// Types (lightweight)
// -----------------------------
type IntakeMode = "STAFF_HANDOFF" | "SELF_SERVICE";

type BatchState =
  | "DRAFT"
  | "SUBMITTED"
  | "SHELVED"
  | "LOADED"
  | "FIRED"
  | "READY_FOR_PICKUP"
  | "CLOSED_PICKED_UP"
  | "CLOSED_OTHER";

type PieceState =
  | "OK"
  | "DAMAGED_IN_HANDLING"
  | "DESTROYED_IN_HANDLING"
  | "FIRING_ISSUE";

function batchesCol() {
  return db.collection("batches");
}
function batchDoc(batchId: string) {
  return batchesCol().doc(batchId);
}
function timelineCol(batchId: string) {
  return batchDoc(batchId).collection("timeline");
}

// -----------------------------
// Timeline helper
// -----------------------------
async function addTimelineEvent(params: {
  batchId: string;
  type: TimelineEventType;
  at?: Timestamp;
  actorUid?: string | null;
  actorName?: string | null;
  notes?: string | null;
  kilnId?: string | null;
  kilnName?: string | null;
  photos?: string[];
  pieceState?: PieceState | null;
  extra?: Record<string, any>;
}) {
  const {
    batchId,
    type,
    at = nowTs(),
    actorUid = null,
    actorName = null,
    notes = null,
    kilnId = null,
    kilnName = null,
    photos = [],
    pieceState = null,
    extra = {},
  } = params;

  await timelineCol(batchId).add({
    type,
    at,
    actorUid,
    actorName,
    notes,
    kilnId,
    kilnName,
    photos,
    pieceState,
    ...extra,
  });
}

// -----------------------------
// Google Calendar client (lazy import)
// -----------------------------
async function getCalendarClient() {
  const raw = getGoogleCalendarCredsJson();
  if (!raw) {
    throw new Error("GOOGLE_CALENDAR_CREDENTIALS not configured");
  }

  let creds: any;
  try {
    creds = JSON.parse(raw);
  } catch {
    throw new Error("GOOGLE_CALENDAR_CREDENTIALS is not valid JSON");
  }

  const { google } = await import("googleapis");

  const auth = new google.auth.JWT({
    email: creds.client_email,
    key: creds.private_key,
    scopes: ["https://www.googleapis.com/auth/calendar"],
  });

  const calendar = google.calendar({ version: "v3", auth });
  return { calendar, clientEmail: creds.client_email as string };
}

// -----------------------------
// Public: hello
// -----------------------------
export const hello = onRequest({ region: REGION }, async (req, res) => {
  if (applyCors(req, res)) return;

  const auth = await requireAuthUid(req);
  if (!auth.ok) {
    res.status(401).json({ ok: false, message: auth.message });
    return;
  }

  res.status(200).json({ ok: true, message: "ok" });
});

// -----------------------------
// Debug: calendar id sanity check
// -----------------------------
export const debugCalendarId = onRequest({ region: REGION }, async (req, res) => {
  if (applyCors(req, res)) return;

  const auth = await requireAuthUid(req);
  if (!auth.ok) {
    res.status(401).json({ ok: false, message: auth.message });
    return;
  }

  const trimmed = FIRINGS_CALENDAR_ID.trim();
  const tail = trimmed.slice(-23);
  const tailCharCodes = tail.split("").map((c) => c.charCodeAt(0));

  res.status(200).json({
    calendarId: FIRINGS_CALENDAR_ID,
    trimmed,
    sameAfterTrim: FIRINGS_CALENDAR_ID === trimmed,
    length: FIRINGS_CALENDAR_ID.length,
    trimmedLength: trimmed.length,
    hasWhitespaceAnywhere: /\s/.test(FIRINGS_CALENDAR_ID),
    tail,
    tailCharCodes,
  });
});

// -----------------------------
// Utility: accept/insert the shared calendar into the service account's calendar list
// -----------------------------
export const acceptFiringsCalendar = onRequest(
  { region: REGION, timeoutSeconds: 60 },
  async (req, res) => {
    if (applyCors(req, res)) return;

    const auth = await requireAuthUid(req);
    if (!auth.ok) {
      res.status(401).json({ ok: false, message: auth.message });
      return;
    }

    try {
      const { calendar, clientEmail } = await getCalendarClient();

      // Insert into calendar list (helps in some cases + confirms access)
      const inserted = await calendar.calendarList.insert({
        requestBody: { id: FIRINGS_CALENDAR_ID },
      });

      res.status(200).json({
        ok: true,
        clientEmail,
        inserted: true,
        calendarId: FIRINGS_CALENDAR_ID,
        summary: inserted.data.summary ?? null,
      });
    } catch (e: any) {
      logger.error("acceptFiringsCalendar failed", e);
      res.status(200).json({
        ok: false,
        calendarId: FIRINGS_CALENDAR_ID,
        message: e?.message ?? String(e),
        hint:
          "If you see NOT_FOUND, share the calendar to the service account email under Google Calendar > Settings and sharing > Share with specific people.",
      });
    }
  }
);

// -----------------------------
// Calendar -> Firestore sync
// Writes into collection: firingsCalendarEvents/{eventId}
// -----------------------------
async function syncFiringsCore(): Promise<{ synced: number; clientEmail: string }> {
  const { calendar, clientEmail } = await getCalendarClient();

  // Fetch a reasonable window (tweak later)
  const timeMin = new Date(Date.now() - 1000 * 60 * 60 * 24 * 60).toISOString(); // 60 days back
  const timeMax = new Date(Date.now() + 1000 * 60 * 60 * 24 * 365).toISOString(); // 1 year forward

  const resp = await calendar.events.list({
    calendarId: FIRINGS_CALENDAR_ID,
    timeMin,
    timeMax,
    singleEvents: true,
    orderBy: "startTime",
    maxResults: 2500,
  });

  const items = resp.data.items ?? [];
  const col = db.collection("firingsCalendarEvents");

  const batch = db.batch();
  let writes = 0;

  for (const ev of items) {
    if (!ev.id) continue;

    const docRef = col.doc(ev.id);
    batch.set(
      docRef,
      {
        calendarId: FIRINGS_CALENDAR_ID,
        eventId: ev.id,
        summary: ev.summary ?? null,
        description: ev.description ?? null,
        status: ev.status ?? null,
        htmlLink: ev.htmlLink ?? null,
        start: ev.start ?? null,
        end: ev.end ?? null,
        updated: ev.updated ?? null,
        raw: ev,
        syncedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    writes++;
    // If you ever exceed 500 writes, you must commit in chunks.
    // For now we stay simple; if you add tons of events later, we’ll chunk it.
    if (writes >= 450) break;
  }

  await batch.commit();
  return { synced: writes, clientEmail };
}

export const syncFiringsNow = onRequest(
  { region: REGION, timeoutSeconds: 60 },
  async (req, res) => {
    if (applyCors(req, res)) return;

    const auth = await requireAuthUid(req);
    if (!auth.ok) {
      res.status(401).json({ ok: false, message: auth.message });
      return;
    }

    try {
      const out = await syncFiringsCore();
      res.status(200).json({
        ok: true,
        synced: out.synced,
        calendarId: FIRINGS_CALENDAR_ID,
        clientEmail: out.clientEmail,
      });
    } catch (e: any) {
      logger.error("syncFiringsNow failed", e);
      res.status(200).json({
        ok: false,
        calendarId: FIRINGS_CALENDAR_ID,
        message: e?.message ?? String(e),
        code: e?.code ?? null,
        gaxiosStatus: e?.response?.status ?? null,
        gaxiosData: e?.response?.data ?? null,
        hint:
          "If you see NOT_FOUND, confirm the calendar is shared to the service account AND the Calendar API is enabled.",
      });
    }
  }
);

// Scheduled version (daily)
export const syncFirings = onSchedule(
  { region: REGION, schedule: "every day 03:15", timeZone: "America/Phoenix" },
  async () => {
    try {
      const out = await syncFiringsCore();
      logger.info("syncFirings ok", out);
    } catch (e) {
      logger.error("syncFirings failed", e);
    }
  }
);

// -----------------------------
// Batches: createBatch (admin-only)
// -----------------------------
export const createBatch = onRequest(
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

    const admin = requireAdmin(req);
    if (!admin.ok) {
      res.status(401).json({ ok: false, message: admin.message });
      return;
    }

    const ownerUid = safeString(req.body?.ownerUid);
    const ownerDisplayName = safeString(req.body?.ownerDisplayName);
    const title = safeString(req.body?.title);
    const intakeMode = safeString(req.body?.intakeMode) as IntakeMode;
    const estimatedCostCents = asInt(req.body?.estimatedCostCents, 0);
    const kilnName = safeString(req.body?.kilnName);
    const estimateNotes = safeString(req.body?.estimateNotes || req.body?.notes);

    if (!ownerUid || !title) {
      res.status(400).json({ ok: false, message: "ownerUid and title required" });
      return;
    }

    const ref = batchesCol().doc();
    const createdAt = nowTs();

    const doc = {
      ownerUid,
      ownerDisplayName: ownerDisplayName || null,
      title,
      intakeMode: intakeMode || "STAFF_HANDOFF",
      estimatedCostCents,
      kilnName: kilnName || null,
      estimateNotes: estimateNotes || null,

      state: "DRAFT" as BatchState,
      isClosed: false,
      createdAt,
      updatedAt: createdAt,
      closedAt: null,

      // journey tracking
      journeyRootBatchId: ref.id,
      journeyParentBatchId: null,
    };

    await ref.set(doc);
    await addTimelineEvent({
      batchId: ref.id,
      type: TimelineEventType.CREATE_BATCH,
      at: createdAt,
      actorUid: "admin",
      actorName: "admin",
      notes: "Batch created",
    });

    res.status(200).json({ ok: true, batchId: ref.id });
  }
);

// -----------------------------
// Batches: submitDraftBatch (client sets state -> SUBMITTED)
// -----------------------------
export const submitDraftBatch = onRequest(
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
    const uid = auth.uid;

    const batchId = safeString(req.body?.batchId);

    if (!uid || !batchId) {
      res.status(400).json({ ok: false, message: "uid and batchId required" });
      return;
    }

    const ref = batchDoc(batchId);
    const snap = await ref.get();
    if (!snap.exists) {
      res.status(404).json({ ok: false, message: "Batch not found" });
      return;
    }

    const data = snap.data() as any;
    if (data.ownerUid !== uid) {
      res.status(403).json({ ok: false, message: "Forbidden" });
      return;
    }

    const t = nowTs();
    await ref.set(
      {
        state: "SUBMITTED" as BatchState,
        updatedAt: t,
      },
      { merge: true }
    );

    await addTimelineEvent({
      batchId,
      type: TimelineEventType.SUBMIT_DRAFT,
      at: t,
      actorUid: uid,
      actorName: data.ownerDisplayName ?? null,
      notes: safeString(req.body?.notes) || "Submitted",
    });

    res.status(200).json({ ok: true });
  }
);

// -----------------------------
// Batches: pickedUpAndClose (admin-only)
// Closes the batch, but keeps pieces reusable later.
// -----------------------------
export const pickedUpAndClose = onRequest(
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

    const admin = requireAdmin(req);
    if (!admin.ok) {
      res.status(401).json({ ok: false, message: admin.message });
      return;
    }

    const batchId = safeString(req.body?.batchId);
    if (!batchId) {
      res.status(400).json({ ok: false, message: "batchId required" });
      return;
    }

    const ref = batchDoc(batchId);
    const t = nowTs();

    await ref.set(
      {
        isClosed: true,
        state: "CLOSED_PICKED_UP" as BatchState,
        closedAt: t,
        updatedAt: t,
      },
      { merge: true }
    );

    await addTimelineEvent({
      batchId,
      type: TimelineEventType.PICKED_UP_AND_CLOSE,
      at: t,
      actorUid: "admin",
      actorName: "admin",
      notes: safeString(req.body?.notes) || "Picked up; batch closed",
    });

    res.status(200).json({ ok: true });
  }
);

// -----------------------------
// Batches: continueJourney (client)
// Creates a NEW DRAFT batch linked to the same journeyRootBatchId.
// -----------------------------
export const continueJourney = onRequest(
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
    const uid = auth.uid;

    const fromBatchId = safeString(req.body?.fromBatchId);
    if (!uid || !fromBatchId) {
      res.status(400).json({ ok: false, message: "uid and fromBatchId required" });
      return;
    }

    const fromSnap = await batchDoc(fromBatchId).get();
    if (!fromSnap.exists) {
      res.status(404).json({ ok: false, message: "Source batch not found" });
      return;
    }

    const from = fromSnap.data() as any;
    if (from.ownerUid !== uid) {
      res.status(403).json({ ok: false, message: "Forbidden" });
      return;
    }

    const rootId = safeString(from.journeyRootBatchId) || fromBatchId;

    const newRef = batchesCol().doc();
    const t = nowTs();

    await newRef.set({
      ownerUid: uid,
      ownerDisplayName: from.ownerDisplayName ?? null,
      title: safeString(req.body?.title) || `${from.title} (resubmission)`,
      intakeMode: from.intakeMode ?? "SELF_SERVICE",
      estimatedCostCents: 0,
      estimateNotes: null,

      state: "DRAFT" as BatchState,
      isClosed: false,
      createdAt: t,
      updatedAt: t,
      closedAt: null,

      journeyRootBatchId: rootId,
      journeyParentBatchId: fromBatchId,
    });

    await addTimelineEvent({
      batchId: newRef.id,
      type: TimelineEventType.CONTINUE_JOURNEY,
      at: t,
      actorUid: uid,
      actorName: from.ownerDisplayName ?? null,
      notes: `Continued journey from ${fromBatchId}`,
      extra: { fromBatchId },
    });

    res.status(200).json({ ok: true, batchId: newRef.id, rootId });
  }
);

// -----------------------------
// Optional admin lifecycle helpers (safe no-op-ish, but real writes)
// -----------------------------
export const shelveBatch = onRequest({ region: REGION }, async (req, res) => {
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

  const batchId = safeString(req.body?.batchId);
  if (!batchId) {
    res.status(400).json({ ok: false, message: "batchId required" });
    return;
  }

  const t = nowTs();
  await batchDoc(batchId).set(
    { state: "SHELVED" as BatchState, updatedAt: t },
    { merge: true }
  );
  await addTimelineEvent({
    batchId,
    type: TimelineEventType.SHELVED,
    at: t,
    actorUid: "admin",
    actorName: "admin",
    notes: safeString(req.body?.notes) || "Shelved",
  });

  res.status(200).json({ ok: true });
});

export const kilnLoad = onRequest({ region: REGION }, async (req, res) => {
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

  const batchId = safeString(req.body?.batchId);
  const kilnId = safeString(req.body?.kilnId);
  const kilnName = safeString(req.body?.kilnName);

  if (!batchId || !kilnId) {
    res.status(400).json({ ok: false, message: "batchId and kilnId required" });
    return;
  }

  const t = nowTs();
  await batchDoc(batchId).set(
    {
      state: "LOADED" as BatchState,
      updatedAt: t,
      currentKilnId: kilnId,
      currentKilnName: kilnName || null,
    },
    { merge: true }
  );

  await addTimelineEvent({
    batchId,
    type: TimelineEventType.KILN_LOAD,
    at: t,
    actorUid: "admin",
    actorName: "admin",
    kilnId,
    kilnName: kilnName || null,
    notes: safeString(req.body?.notes) || "Loaded to kiln",
    photos: Array.isArray(req.body?.photos) ? req.body.photos : [],
  });

  res.status(200).json({ ok: true });
});

export const kilnUnload = onRequest({ region: REGION }, async (req, res) => {
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

  const batchId = safeString(req.body?.batchId);
  if (!batchId) {
    res.status(400).json({ ok: false, message: "batchId required" });
    return;
  }

  const t = nowTs();
  await batchDoc(batchId).set(
    {
      updatedAt: t,
      // Leaving state alone here; you may set FIRED or READY_FOR_PICKUP next
      currentKilnId: FieldValue.delete(),
      currentKilnName: FieldValue.delete(),
    },
    { merge: true }
  );

  await addTimelineEvent({
    batchId,
    type: TimelineEventType.KILN_UNLOAD,
    at: t,
    actorUid: "admin",
    actorName: "admin",
    notes: safeString(req.body?.notes) || "Unloaded from kiln",
    photos: Array.isArray(req.body?.photos) ? req.body.photos : [],
  });

  res.status(200).json({ ok: true });
});

export const readyForPickup = onRequest({ region: REGION }, async (req, res) => {
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

  const batchId = safeString(req.body?.batchId);
  if (!batchId) {
    res.status(400).json({ ok: false, message: "batchId required" });
    return;
  }

  const t = nowTs();
  await batchDoc(batchId).set(
    { state: "READY_FOR_PICKUP" as BatchState, updatedAt: t },
    { merge: true }
  );

  await addTimelineEvent({
    batchId,
    type: TimelineEventType.READY_FOR_PICKUP,
    at: t,
    actorUid: "admin",
    actorName: "admin",
    notes: safeString(req.body?.notes) || "Ready for pickup",
  });

  res.status(200).json({ ok: true });
});

export { createReservation } from "./createReservation";
export { normalizeTimelineEventTypes } from "./normalizeTimelineEventTypes";
export { createMaterialsCheckoutSession, listMaterialsProducts, seedMaterialsCatalog, stripeWebhook } from "./materials";
export {
  listEvents,
  listEventSignups,
  getEvent,
  createEvent,
  publishEvent,
  signupForEvent,
  cancelEventSignup,
  claimEventOffer,
  checkInEvent,
  createEventCheckoutSession,
  eventStripeWebhook,
  sweepEventOffers,
} from "./events";
export { listBillingSummary } from "./billingSummary";

// -----------------------------
// Backfill helper: ensure isClosed field exists (admin-only)
// -----------------------------
export const backfillIsClosed = onRequest(
  { region: REGION, timeoutSeconds: 60 },
  async (req, res) => {
    if (applyCors(req, res)) return;

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

    const limit = Math.min(Math.max(asInt(req.body?.limit, 200), 1), 500);

    const snaps = await batchesCol().limit(limit).get();
    const batch = db.batch();
    let updated = 0;

    snaps.forEach((docSnap) => {
      const d = docSnap.data() as any;
      if (typeof d.isClosed !== "boolean") {
        batch.set(docSnap.ref, { isClosed: false }, { merge: true });
        updated++;
      }
    });

    if (updated > 0) await batch.commit();

    res.status(200).json({ ok: true, scanned: snaps.size, updated });
  }
);


