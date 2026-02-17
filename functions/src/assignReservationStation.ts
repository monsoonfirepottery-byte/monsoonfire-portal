/* eslint-disable @typescript-eslint/no-explicit-any */
import { onRequest } from "firebase-functions/v2/https";
import { z } from "zod";
import {
  applyCors,
  db,
  nowTs,
  enforceRateLimit,
  parseBody,
  requireAdmin,
  safeString,
  type RequestLike,
} from "./shared";
import { getStationCapacity, isKnownStationId, normalizeStationId } from "./reservationStationConfig";

const REGION = "us-central1";

type StageHistoryEntry = {
  fromStation: string | null;
  toStation: string;
  at: any;
  actorUid: string;
  actorRole: "staff" | "dev";
  reason: string;
  notes: string | null;
};

type AssignStationResult = {
  reservationId: string;
  assignedStationId: string;
  previousAssignedStationId: string | null;
  stationCapacity: number | null;
  stationUsedAfter: number | null;
  idempotentReplay: boolean;
};

const assignmentSchema = z.object({
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

function normalizeQueueClass(value: unknown): string | null {
  const next = safeString(value, "").trim();
  return next.length ? next.toLowerCase() : null;
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

function isSameRequiredResources(a: ReturnType<typeof normalizeRequiredResources>, b: ReturnType<typeof normalizeRequiredResources>) {
  if (a.kilnProfile !== b.kilnProfile) return false;
  if (a.rackCount !== b.rackCount) return false;
  if (a.specialHandling.length !== b.specialHandling.length) return false;
  for (let i = 0; i < a.specialHandling.length; i += 1) {
    if (a.specialHandling[i] !== b.specialHandling[i]) return false;
  }
  return true;
}

function isCapacityRelevantLoadStatus(value: unknown): boolean {
  const normalized = normalizeQueueClass(value);
  if (normalized === null) return true;
  return normalized === "queued" || normalized === "loading" || normalized === "loaded";
}

function asNonNegativeNumber(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

function estimateHalfShelves(data: Record<string, unknown>): number {
  const estimatedHalfShelves = asNonNegativeNumber(data.estimatedHalfShelves);
  if (typeof estimatedHalfShelves === "number") return Math.max(1, Math.ceil(estimatedHalfShelves));

  const shelfEquivalent = asNonNegativeNumber(data.shelfEquivalent);
  if (typeof shelfEquivalent === "number") {
    return Math.max(1, Math.round(shelfEquivalent * 2));
  }

  const footprint = asNonNegativeNumber(data.footprintHalfShelves);
  const tiers = asNonNegativeNumber(data.tiers);
  if (typeof footprint === "number" && typeof tiers === "number") {
    return Math.max(1, Math.ceil(footprint * Math.max(1, Math.round(tiers))));
  }

  return 1;
}

function normalizeStageHistory(raw: unknown): StageHistoryEntry[] {
  if (!Array.isArray(raw)) return [];

  const out: StageHistoryEntry[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") {
      continue;
    }
    const next = row as Record<string, unknown>;
    const fromStation = normalizeQueueClass(next.fromStation);
    const toStation = normalizeQueueClass(next.toStation);
    if (!toStation) continue;
    out.push({
      fromStation: fromStation,
      toStation,
      at: next.at ?? nowTs(),
      actorUid: safeString(next.actorUid, ""),
      actorRole: next.actorRole === "dev" ? "dev" : "staff",
      reason: safeString(next.reason, "").trim() || "station_routing_update",
      notes: typeof next.notes === "string" ? next.notes.trim() || null : null,
    });
  }
  return out.slice(-40);
}

export const assignReservationStation = onRequest(
  { region: REGION, timeoutSeconds: 60 },
  async (req, res) => {
    if (applyCors(req, res)) return;
    if (req.method !== "POST") {
      res.status(405).json({ ok: false, message: "Use POST" });
      return;
    }

    const auth = await requireAdmin(req);
    if (!auth.ok) {
      res.status(401).json({ ok: false, message: auth.message });
      return;
    }

    const rate = await enforceRateLimit({
      req,
      key: "assignReservationStation",
      max: 60,
      windowMs: 60_000,
    });
    if (!rate.ok) {
      res.set("Retry-After", String(Math.ceil(rate.retryAfterMs / 1000)));
      res.status(429).json({ ok: false, message: "Too many requests" });
      return;
    }

    const parsed = parseBody(assignmentSchema, req.body);
    if (!parsed.ok) {
      res.status(400).json({ ok: false, message: parsed.message });
      return;
    }

    const reservationId = parsed.data.reservationId.trim();
    const assignedStationId = normalizeStationId(parsed.data.assignedStationId);
    const queueClass = normalizeQueueClass(parsed.data.queueClass);
    const requiredResources = normalizeRequiredResources(parsed.data.requiredResources);
    const requestLike = req as RequestLike;
    const actorContext = requestLike.__mfAuthContext as { uid?: unknown } | undefined;
    const actorUidCandidate = (requestLike.__mfAuth as { uid?: unknown } | undefined)?.uid ?? actorContext?.uid;
    const actorUid = actorUidCandidate ? safeString(actorUidCandidate) : null;
    const actorRole: "staff" | "dev" = auth.mode === "staff" ? "staff" : "dev";

    if (!isKnownStationId(assignedStationId)) {
      res.status(400).json({
        ok: false,
        code: "INVALID_STATION",
        message: "Unknown station id.",
      });
      return;
    }

    if (!actorUid) {
      res.status(401).json({ ok: false, message: "Unauthorized" });
      return;
    }
    const actor = actorUid;

    try {
      const out = await db.runTransaction(async (tx) => {
        const reservationRef = db.collection("reservations").doc(reservationId);
        const reservationSnap = await tx.get(reservationRef);
        if (!reservationSnap.exists) {
          throw new Error("RESERVATION_NOT_FOUND");
        }

        const data = reservationSnap.data() as Record<string, unknown>;
        const status = normalizeQueueClass(data.status) ?? "requested";
        if (status === "cancelled" || status === "canceled") {
          throw new Error("RESERVATION_CANCELLED");
        }

        const currentAssignedStation = normalizeStationId(data.assignedStationId);
        const currentQueueClass = normalizeQueueClass(data.queueClass);
        const currentRequiredResources = normalizeRequiredResources(data.requiredResources);
        const requestedQueueClass = queueClass === null ? null : queueClass;
        const requestedRequiredResources =
          parsed.data.requiredResources === undefined ? currentRequiredResources : requiredResources;

        const sameStation = currentAssignedStation === assignedStationId;
        const queueClassChanged = parsed.data.queueClass !== undefined && requestedQueueClass !== currentQueueClass;
        const resourcesChanged =
          parsed.data.requiredResources !== undefined &&
          !isSameRequiredResources(currentRequiredResources, requestedRequiredResources);
        const requestedNoop = sameStation && !queueClassChanged && !resourcesChanged;

        const stationCapacity = getStationCapacity(assignedStationId);
        let stationUsedAfter: number | null = null;

        if (!sameStation) {
          const stationQuery = await tx.get(
            db.collection("reservations").where("assignedStationId", "==", assignedStationId)
          );
          stationUsedAfter = stationQuery.docs
            .map((docSnap) => {
              const raw = docSnap.data() as Record<string, unknown>;
              if (docSnap.id === reservationId) return 0;
              const isActive =
                normalizeQueueClass(raw.status) !== "cancelled" &&
                isCapacityRelevantLoadStatus(raw.loadStatus);
              if (!isActive) return 0;
              if (!isCapacityRelevantLoadStatus(raw.loadStatus)) return 0;
              return estimateHalfShelves(raw);
            })
            .reduce((total, each) => total + each, 0);

          const incomingHalfShelves = estimateHalfShelves(data);
          if (stationUsedAfter + incomingHalfShelves > stationCapacity) {
            throw new Error("STATION_CAPACITY_EXCEEDED");
          }
          stationUsedAfter += incomingHalfShelves;
        }

        if (requestedNoop) {
          return {
            reservationId,
            assignedStationId,
            previousAssignedStationId: currentAssignedStation || null,
            stationCapacity: stationCapacity,
            stationUsedAfter,
            idempotentReplay: true,
          } as AssignStationResult;
        }

        const updates: Record<string, any> = {
          assignedStationId,
          updatedAt: nowTs(),
          updatedByUid: actor,
          updatedByRole: actorRole,
        };

        if (parsed.data.queueClass !== undefined) {
          updates.queueClass = requestedQueueClass;
        }
        if (parsed.data.requiredResources !== undefined) {
          updates.requiredResources = requestedRequiredResources;
        }

        if (currentAssignedStation !== assignedStationId) {
          const history = normalizeStageHistory(data.stageHistory);
          history.push({
            fromStation: currentAssignedStation || "unassigned",
            toStation: assignedStationId,
            at: nowTs(),
            actorUid: actor,
            actorRole,
            reason: "Station assignment updated",
            notes: null,
          });
          updates.stageHistory = history.slice(-40);
        }

        tx.set(reservationRef, updates, { merge: true });

        if (stationUsedAfter === null) {
          const activeDocs = await tx.get(
            db.collection("reservations").where("assignedStationId", "==", assignedStationId)
          );
          stationUsedAfter = activeDocs.docs
            .map((docSnap) => {
              if (docSnap.id === reservationId) return 0;
              const raw = docSnap.data() as Record<string, unknown>;
              const isActive = normalizeQueueClass(raw.status) !== "cancelled";
              if (!isActive) return 0;
              return isCapacityRelevantLoadStatus(raw.loadStatus) ? estimateHalfShelves(raw) : 0;
            })
            .reduce((total, each) => total + each, 0);
          const incomingHalfShelves = estimateHalfShelves(data);
          stationUsedAfter += incomingHalfShelves;
        }

        return {
          reservationId,
          assignedStationId,
          previousAssignedStationId: currentAssignedStation || null,
          stationCapacity,
          stationUsedAfter,
          idempotentReplay: false,
        } as AssignStationResult;
      });

      res.status(200).json({
        ok: true,
        reservationId: out.reservationId,
        assignedStationId: out.assignedStationId,
        previousAssignedStationId: out.previousAssignedStationId,
        idempotentReplay: out.idempotentReplay,
        stationCapacity: out.stationCapacity,
        stationUsedAfter: out.stationUsedAfter,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "ASSIGNMENT_FAILED";
      if (message === "RESERVATION_NOT_FOUND") {
        res.status(404).json({ ok: false, code: "NOT_FOUND", message: "Reservation not found" });
        return;
      }
      if (message === "RESERVATION_CANCELLED") {
        res.status(409).json({ ok: false, code: "CANCELLED", message: "Reservation is cancelled" });
        return;
      }
      if (message === "STATION_CAPACITY_EXCEEDED") {
        res.status(409).json({ ok: false, code: "CAPACITY", message: "Station is at capacity" });
        return;
      }
      if (message === "UNKNOWN_STATION") {
        res.status(400).json({ ok: false, code: "INVALID_STATION", message: "Unknown station id" });
        return;
      }
      res.status(500).json({ ok: false, code: "INTERNAL", message: "Failed to assign station" });
    }
  }
);
