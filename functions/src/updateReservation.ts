/* eslint-disable @typescript-eslint/no-explicit-any */
import { onRequest } from "firebase-functions/v2/https";
import { z } from "zod";
import {
  applyCors,
  db,
  nowTs,
  requireAdmin,
  requireAuthUid,
  enforceRateLimit,
  parseBody,
  safeString,
} from "./shared";

const REGION = "us-central1";

const ALLOWED_STATUS_TRANSITIONS: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ["REQUESTED", new Set(["REQUESTED", "CONFIRMED", "WAITLISTED", "CANCELLED"])],
  ["CONFIRMED", new Set(["CONFIRMED", "WAITLISTED", "CANCELLED"])],
  ["WAITLISTED", new Set(["WAITLISTED", "CONFIRMED", "CANCELLED"])],
  ["CANCELLED", new Set(["CANCELLED"])],
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

type ReservationStatus = "REQUESTED" | "CONFIRMED" | "WAITLISTED" | "CANCELLED";
type LoadStatus = "queued" | "loading" | "loaded";

type StageHistoryEntry = {
  fromStatus: ReservationStatus | null;
  toStatus: ReservationStatus | null;
  fromLoadStatus: LoadStatus | null;
  toLoadStatus: LoadStatus | null;
  fromStage: string;
  toStage: string;
  at: any;
  actorUid: string;
  actorRole: "staff" | "dev";
  reason: string;
  notes: string | null;
};

type ReservationStage = {
  status: ReservationStatus | null;
  loadStatus: LoadStatus | null;
};

function normalizeStatus(value: unknown): ReservationStatus | null {
  if (typeof value !== "string") return null;
  const upper = value.toUpperCase();
  return upper === "REQUESTED" || upper === "CONFIRMED" || upper === "WAITLISTED" || upper === "CANCELLED"
    ? upper
    : null;
}

function normalizeLoadStatus(value: unknown): LoadStatus | null {
  if (value === "queued" || value === "loading" || value === "loaded") return value;
  if (typeof value !== "string") return null;
  const lowered = value.trim().toLowerCase();
  if (lowered === "queued" || lowered === "loading" || lowered === "loaded") {
    return lowered;
  }
  return null;
}

function stageForCurrentState(status: ReservationStatus | null, loadStatus: LoadStatus | null): string {
  if (status === "CANCELLED") return "canceled";
  if (loadStatus === "loaded") return "loaded";
  if (loadStatus === "loading" || loadStatus === "queued") return "queued";
  return status === "CONFIRMED" || status === "WAITLISTED" || status === "REQUESTED" ? "intake" : "intake";
}

function normalizeStageHistory(raw: unknown): StageHistoryEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: StageHistoryEntry[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const next = row as Record<string, unknown>;
    const toStage = safeString(next.toStage, "");
    const fromStage = safeString(next.fromStage, "");
    const fromStatusValue = normalizeStatus(next.fromStatus);
    const toStatusValue = normalizeStatus(next.toStatus);
    const fromLoadStatus = normalizeLoadStatus(next.fromLoadStatus);
    const toLoadStatus = normalizeLoadStatus(next.toLoadStatus);
    out.push({
      fromStatus: fromStatusValue,
      toStatus: toStatusValue,
      fromLoadStatus,
      toLoadStatus,
      fromStage: fromStage.length ? fromStage : "queued",
      toStage: toStage.length ? toStage : "queued",
      at: next.at ?? nowTs(),
      actorUid: safeString(next.actorUid),
      actorRole: next.actorRole === "dev" ? "dev" : "staff",
      reason: safeString(next.reason, "").trim() || "reservation_update",
      notes: typeof next.notes === "string" ? next.notes.trim() : null,
    });
  }
  return out.slice(-120);
}

function makeLoadStatusReason(before: LoadStatus | null, after: LoadStatus | null): string {
  if (before === after) return "load_status_refresh";
  if (after === "loaded") return "reservation_loaded";
  if (before === null && after === "loading") return "reservation_loading_start";
  return "reservation_load_status_change";
}

export const updateReservation = onRequest(
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
      res.status(401).json({ ok: false, message: admin.message });
      return;
    }

    const rate = await enforceRateLimit({
      req,
      key: "updateReservation",
      max: 120,
      windowMs: 60_000,
    });
    if (!rate.ok) {
      res.set("Retry-After", String(Math.ceil(rate.retryAfterMs / 1000)));
      res.status(429).json({ ok: false, message: "Too many requests" });
      return;
    }

    const parsed = parseBody(reservationUpdateSchema, req.body);
    if (!parsed.ok) {
      res.status(400).json({ ok: false, message: parsed.message });
      return;
    }

    const reservationId = parsed.data.reservationId.trim();
    const requestedStatus = parsed.data.status ?? null;
    const requestedLoadStatus = parsed.data.loadStatus ?? null;
    const staffNotes = parsed.data.staffNotes ?? null;
    const forceTransition = parsed.data.force === true;
    const actorUid = auth.uid;
    const actorRole = admin.mode === "staff" ? "staff" : "dev";
    const now = nowTs();

    try {
      const out = await db.runTransaction(async (tx) => {
        const reservationRef = db.collection("reservations").doc(reservationId);
        const reservationSnap = await tx.get(reservationRef);
        if (!reservationSnap.exists) {
          throw new Error("RESERVATION_NOT_FOUND");
        }

        const data = reservationSnap.data() as Record<string, unknown>;
    const existingStatus: ReservationStatus = normalizeStatus(data.status) ?? "REQUESTED";
    const existingLoadStatus = normalizeLoadStatus(data.loadStatus);
    const current: ReservationStage = {
      status: existingStatus,
      loadStatus: existingLoadStatus,
    };
    const nextStatus: ReservationStatus = requestedStatus ?? existingStatus;
        const nextLoadStatus: LoadStatus | null = requestedLoadStatus ?? existingLoadStatus;

        const statusProvided = requestedStatus != null;
        const loadProvided = requestedLoadStatus != null;
        const notesProvided = staffNotes != null;

        if (statusProvided) {
          const allowed = ALLOWED_STATUS_TRANSITIONS.get(existingStatus) ?? new Set([]);
          if (!allowed.has(nextStatus) && !forceTransition) {
            throw new Error(`INVALID_STATUS_TRANSITION:${existingStatus}->${nextStatus}`);
          }
        }

        if (!statusProvided && !loadProvided && !notesProvided) {
          throw new Error("NO_UPDATES");
        }

        const hasStatusChange = current.status !== nextStatus;
        const hasLoadChange = current.loadStatus !== nextLoadStatus;
        const update: Record<string, any> = {
          updatedAt: now,
        };

        let newStatus = current.status;
        if (statusProvided) {
          update.status = nextStatus;
          newStatus = nextStatus;
        }
        if (loadProvided) {
          update.loadStatus = nextLoadStatus;
        }
        if (notesProvided) {
          const normalizedNotes = safeString(staffNotes, "").trim();
          update.staffNotes = normalizedNotes.length ? normalizedNotes : null;
        }

        const history = normalizeStageHistory(data.stageHistory);
        if (hasStatusChange || hasLoadChange || notesProvided) {
          const currentStatusForStage = normalizeStatus(current.status);
          const currentLoadStatusForStage = normalizeLoadStatus(current.loadStatus);
          const nextStatusForStage = normalizeStatus(nextStatus);
          const nextLoadStatusForStage = normalizeLoadStatus(nextLoadStatus);
          const fromStage = stageForCurrentState(currentStatusForStage, currentLoadStatusForStage);
          const toStatusStage = stageForCurrentState(nextStatusForStage, nextLoadStatusForStage);
          const toLoadStatusStage = stageForCurrentState(nextStatusForStage, nextLoadStatusForStage);
          const finalStage = hasLoadChange ? toLoadStatusStage : toStatusStage;
          const notesTrimmed = notesProvided ? safeString(staffNotes, "").trim() || null : null;
          const reason = statusProvided
            ? `status:${currentStatusForStage ?? "null"}->${nextStatusForStage ?? "null"}`
            : makeLoadStatusReason(currentLoadStatusForStage, nextLoadStatusForStage);

          history.push({
            fromStatus: currentStatusForStage,
            toStatus: nextStatusForStage,
            fromLoadStatus: currentLoadStatusForStage,
            toLoadStatus: nextLoadStatusForStage,
            fromStage,
            toStage: finalStage,
            at: now,
            actorUid,
            actorRole,
            reason,
            notes: notesTrimmed,
          });
          update.stageHistory = history.slice(-120);
          update.stageStatus = {
            stage: finalStage,
            at: now,
            source: "staff",
            reason,
            notes: notesTrimmed,
            actorUid,
            actorRole,
          };
        }

        tx.set(reservationRef, update, { merge: true });
        return {
          reservationId,
          status: newStatus,
          loadStatus: nextLoadStatus,
          idempotentReplay: false,
        };
      });

      res.status(200).json({
        ok: true,
        reservationId: out.reservationId,
        status: out.status,
        loadStatus: out.loadStatus,
        idempotentReplay: out.idempotentReplay,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "UPDATE_FAILED";

      if (message === "RESERVATION_NOT_FOUND") {
        res.status(404).json({ ok: false, code: "NOT_FOUND", message: "Reservation not found" });
        return;
      }
      if (message === "NO_UPDATES") {
        res.status(400).json({ ok: false, code: "INVALID_ARGUMENT", message: "No updates provided" });
        return;
      }
      if (message.startsWith("INVALID_STATUS_TRANSITION")) {
        res.status(409).json({
          ok: false,
          code: "INVALID_TRANSITION",
          message: "Requested status transition is not permitted",
        });
        return;
      }
      if (message.startsWith("INVALID_REQUEST")) {
        res.status(400).json({ ok: false, code: "INVALID_ARGUMENT", message });
        return;
      }
      res.status(500).json({ ok: false, code: "INTERNAL", message: "Failed to update reservation" });
    }
  }
);
