/* eslint-disable @typescript-eslint/no-explicit-any */

import { db, nowTs, Timestamp } from "./shared";

export type IntegrationEvent = {
  id: string;
  at: FirebaseFirestore.Timestamp;
  uid: string;
  type: string;
  subject: Record<string, any>;
  data: Record<string, any>;
  cursor: number;
};

type CursorDoc = {
  nextCursor: number;
  updatedAt?: Timestamp;
};

function asPlainObject(value: unknown): Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, any>;
}

export async function emitIntegrationEvent(params: {
  uid: string;
  type: string;
  subject?: Record<string, any>;
  data?: Record<string, any>;
}): Promise<{ ok: true; eventId: string; cursor: number } | { ok: false; message: string }> {
  const { uid, type } = params;
  const subject = asPlainObject(params.subject);
  const data = asPlainObject(params.data);

  if (!uid || !type) return { ok: false, message: "Missing uid/type" };

  const cursorRef = db.collection("integrationEventCursors").doc(uid);
  const eventsCol = db.collection("integrationEvents");
  const eventRef = eventsCol.doc();
  const t = nowTs();

  const out = await db.runTransaction(async (tx) => {
    const cursorSnap = await tx.get(cursorRef);
    const cursorDoc = cursorSnap.exists ? (cursorSnap.data() as CursorDoc) : null;
    const nextCursor = typeof cursorDoc?.nextCursor === "number" && Number.isFinite(cursorDoc.nextCursor)
      ? Math.max(1, Math.trunc(cursorDoc.nextCursor))
      : 1;

    const cursor = nextCursor;

    tx.set(cursorRef, { nextCursor: cursor + 1, updatedAt: t }, { merge: true });
    tx.set(eventRef, {
      at: t,
      uid,
      type,
      subject,
      data,
      cursor,
    });

    return { cursor };
  });

  return { ok: true, eventId: eventRef.id, cursor: out.cursor };
}

export async function listIntegrationEvents(params: {
  uid: string;
  cursor?: number;
  limit?: number;
}): Promise<{ ok: true; events: IntegrationEvent[]; nextCursor: number } | { ok: false; message: string }> {
  const uid = params.uid;
  const cursor = typeof params.cursor === "number" && Number.isFinite(params.cursor) ? Math.max(0, Math.trunc(params.cursor)) : 0;
  const limit =
    typeof params.limit === "number" && Number.isFinite(params.limit)
      ? Math.min(500, Math.max(1, Math.trunc(params.limit)))
      : 100;

  const snap = await db
    .collection("integrationEvents")
    .where("uid", "==", uid)
    .where("cursor", ">", cursor)
    .orderBy("cursor", "asc")
    .limit(limit)
    .get();

  const events: IntegrationEvent[] = snap.docs.map((d) => {
    const data = d.data() as any;
    return {
      id: d.id,
      at: data.at ?? nowTs(),
      uid: typeof data.uid === "string" ? data.uid : uid,
      type: typeof data.type === "string" ? data.type : "unknown",
      subject: asPlainObject(data.subject),
      data: asPlainObject(data.data),
      cursor: typeof data.cursor === "number" ? data.cursor : 0,
    };
  });

  const nextCursor = events.length ? events[events.length - 1].cursor : cursor;
  return { ok: true, events, nextCursor };
}

