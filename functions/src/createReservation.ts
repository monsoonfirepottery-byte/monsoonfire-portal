import { onRequest } from "firebase-functions/v2/https";

import { applyCors, db, nowTs, Timestamp, requireAuthUid } from "./shared";

const REGION = "us-central1";

const VALID_FIRING_TYPES = new Set(["bisque", "glaze", "other"] as const);
const VALID_SHELF_VALUES = new Set([0.25, 0.5, 1.0]);

type PreferredWindowInput = {
  earliestDate?: string | null;
  latestDate?: string | null;
};

function parseIsoDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
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

export const createReservation = onRequest(
  { region: REGION, timeoutSeconds: 60, cors: true },
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

    const body = req.body ?? {};
    const firingTypeRaw =
      typeof body.firingType === "string" ? body.firingType.toLowerCase() : "";
    const firingType = VALID_FIRING_TYPES.has(firingTypeRaw as any)
      ? (firingTypeRaw as "bisque" | "glaze" | "other")
      : "other";

    const shelfValue = Number(body.shelfEquivalent);
    const shelfEquivalent =
      Number.isFinite(shelfValue) && shelfValue > 0 ? shelfValue : 1;
    const normalizedShelf = VALID_SHELF_VALUES.has(shelfEquivalent)
      ? shelfEquivalent
      : 1;

    const preferredWindow: PreferredWindowInput = body.preferredWindow ?? {};
    const earliest = parseIsoDate(preferredWindow.earliestDate);
    const latest = parseIsoDate(preferredWindow.latestDate);

    if (earliest && latest && earliest > latest) {
      res
        .status(400)
        .json({ ok: false, message: "Earliest date must come before latest date" });
      return;
    }

    const windowPayload = {
      earliestDate: earliest ? Timestamp.fromDate(earliest) : null,
      latestDate: latest ? Timestamp.fromDate(latest) : null,
    };

    const linkedBatchId =
      typeof body.linkedBatchId === "string" && body.linkedBatchId.trim()
        ? body.linkedBatchId.trim()
        : null;

    const now = nowTs();
    const ref = db.collection("reservations").doc();

    await ref.set({
      ownerUid: uid,
      status: "REQUESTED",
      firingType,
      shelfEquivalent: normalizedShelf,
      preferredWindow: windowPayload,
      linkedBatchId,
      createdAt: now,
      updatedAt: now,
    });

    res
      .status(200)
      .json({ ok: true, reservationId: ref.id, status: "REQUESTED" });
  }
);
