import { onRequest } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import {
  applyCors,
  db,
  safeString,
  nowTs,
  Timestamp,
  enforceRateLimit,
} from "./shared";
import {
  STATION_IDS,
  STATION_LABELS,
  STATION_FALLBACK_CAPACITY_HALF_SHELVES,
  getStationCapacity,
} from "./reservationStationConfig";

const REGION = "us-central1";

const DEFAULT_CONTROLLER = "Manual";
const DEFAULT_STATION_NAME = "Kiln";
const ACTIVE_RESERVATION_STATUSES = ["REQUESTED", "CONFIRMED", "WAITLISTED"] as const;
const MAX_ACTIVE_RESERVATIONS_FOR_BOARD = 500;

type BoardReservationRow = {
  status: string;
  loadStatus: string | null;
  assignedStationId: string | null;
  kilnId: string | null;
  shelfEquivalent: number | null;
  footprintHalfShelves: number | null;
  estimatedHalfShelves: number | null;
  tiers: number | null;
};

type BoardFiringRow = {
  kilnId: string | null;
  cycleType: string | null;
  title: string | null;
  startAt: Date | null;
  endAt: Date | null;
  status: string | null;
  notes: string | null;
};

type BoardStation = {
  id: string;
  name: string;
  controller: string;
  queuedHalfShelves: number;
  loadingHalfShelves: number;
  loadedHalfShelves: number;
  stationCapacity: number;
  nextFire: BoardFiringRow | null;
};

function normalizeStatus(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function normalizeStation(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function normalizeLoadStatus(value: unknown): "queued" | "loading" | "loaded" {
  const raw = normalizeStatus(value);
  return raw === "loading" || raw === "loaded" ? raw : "queued";
}

function asDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (value instanceof Timestamp) {
    return value.toDate();
  }
  if (typeof value === "object" && value !== null) {
    const toDate = (value as { toDate?: () => Date }).toDate;
    if (typeof toDate === "function") {
      try {
        const next = toDate();
        return Number.isNaN(next.getTime()) ? null : next;
      } catch {
        return null;
      }
    }
  }
  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

function asNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function estimateHalfShelves(data: BoardReservationRow): number {
  const estimatedHalfShelves = asNumber(data.estimatedHalfShelves);
  if (typeof estimatedHalfShelves === "number") {
    return Math.max(1, Math.ceil(estimatedHalfShelves));
  }

  const shelfEquivalent = asNumber(data.shelfEquivalent);
  if (typeof shelfEquivalent === "number") {
    return Math.max(1, Math.round(shelfEquivalent * 2));
  }

  const footprint = asNumber(data.footprintHalfShelves);
  const tiers = asNumber(data.tiers);
  if (typeof footprint === "number" && typeof tiers === "number") {
    return Math.max(1, Math.ceil(footprint * Math.max(1, Math.round(tiers))));
  }

  return 1;
}

function formatDateRange(value: Date | null): string {
  if (!value) return "TBD";
  try {
    return value.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    });
  } catch {
    return value.toISOString();
  }
}

function formatBoardDate(value: Date | null, now: Date): string {
  if (!value) return "Next load announced in portal";
  const delta = value.getTime() - now.getTime();
  if (delta <= 0) return "Current or live now";
  return `${formatDateRange(value)}`;
}

function buildStationLabel(stationId: string): string {
  const id = stationId.trim().toLowerCase();
  return STATION_LABELS[id] || `${DEFAULT_STATION_NAME} ${id}`;
}

function normalizeStationName(stationId: string, sourceName: string): string {
  const trimmed = sourceName.trim();
  if (trimmed) return trimmed;
  return buildStationLabel(stationId);
}

export const websiteKilnBoard = onRequest({ region: REGION, cors: true }, async (req, res) => {
  if (applyCors(req, res)) return;
  if (req.method !== "GET") {
    res.status(405).json({ ok: false, message: "Use GET" });
    return;
  }

  const rate = await enforceRateLimit({
    req,
    key: "websiteKilnBoard",
    max: 45,
    windowMs: 60_000,
  });

  if (!rate.ok) {
    res.set("Retry-After", String(Math.ceil(rate.retryAfterMs / 1000)));
    res.status(429).json({ ok: false, message: "Too many requests" });
    return;
  }

  try {
    const [kilnsSnap, firingsSnap, reservationsSnap] = await Promise.all([
      db.collection("kilns").get(),
      db
        .collection("kilnFirings")
        .orderBy("startAt", "asc")
        .limit(80)
        .get(),
      db
        .collection("reservations")
        .where("status", "in", ACTIVE_RESERVATION_STATUSES)
        .limit(MAX_ACTIVE_RESERVATIONS_FOR_BOARD)
        .get(),
    ]);

    const now = nowTs().toDate();
    const nowMs = now.getTime();

    const stationMap = new Map<string, BoardStation>();

    kilnsSnap.forEach((docSnap) => {
      const raw = docSnap.data() as Record<string, unknown>;
      const id = docSnap.id;
      const name = normalizeStationName(id, safeString(raw.name, ""));
      const controller = safeString(raw.controller, DEFAULT_CONTROLLER);
      stationMap.set(id, {
        id,
        name,
        controller,
        stationCapacity: getStationCapacity(id),
        queuedHalfShelves: 0,
        loadingHalfShelves: 0,
        loadedHalfShelves: 0,
        nextFire: null,
      });
    });

    const fallbackStationIds = new Set(STATION_IDS);
    for (const fallbackId of fallbackStationIds) {
      if (!stationMap.has(fallbackId)) {
        stationMap.set(fallbackId, {
          id: fallbackId,
          name: buildStationLabel(fallbackId),
          controller: DEFAULT_CONTROLLER,
          stationCapacity: getStationCapacity(fallbackId),
          queuedHalfShelves: 0,
          loadingHalfShelves: 0,
          loadedHalfShelves: 0,
          nextFire: null,
        });
      }
    }

    reservationsSnap.forEach((docSnap) => {
      const raw = docSnap.data() as Record<string, unknown>;
      const status = normalizeStatus(raw.status);
      if (status === "cancelled" || status === "canceled") return;

      const stationId = normalizeStation(raw.assignedStationId) || normalizeStation(raw.kilnId);
      if (!stationId) return;

      const row: BoardReservationRow = {
        status,
        loadStatus: normalizeLoadStatus(raw.loadStatus),
        assignedStationId: stationId,
        kilnId: normalizeStation(raw.kilnId),
        shelfEquivalent: asNumber(raw.shelfEquivalent),
        footprintHalfShelves: asNumber(raw.footprintHalfShelves),
        estimatedHalfShelves: asNumber(raw.estimatedHalfShelves),
        tiers: asNumber(raw.tiers),
      };

      const entry =
        stationMap.get(stationId) ??
        {
          id: stationId,
          name: buildStationLabel(stationId),
          controller: DEFAULT_CONTROLLER,
          stationCapacity: getStationCapacity(stationId),
          queuedHalfShelves: 0,
          loadingHalfShelves: 0,
          loadedHalfShelves: 0,
          nextFire: null,
        };
      const halfShelves = estimateHalfShelves(row);
      if (row.loadStatus === "loading") {
        entry.loadingHalfShelves += halfShelves;
      } else if (row.loadStatus === "loaded") {
        entry.loadedHalfShelves += halfShelves;
      } else {
        entry.queuedHalfShelves += halfShelves;
      }

      stationMap.set(stationId, entry);
    });

    const firingsByStation = new Map<string, BoardFiringRow[]>();
    firingsSnap.forEach((docSnap) => {
      const raw = docSnap.data() as Record<string, unknown>;
      const stationId = normalizeStation(raw.kilnId);
      if (!stationId) return;
      const startAt = asDate(raw.startAt);
      const endAt = asDate(raw.endAt);
      const status = normalizeStatus(raw.status);

      const row: BoardFiringRow = {
        kilnId: stationId,
        cycleType: safeString(raw.cycleType),
        title: safeString(raw.title),
        startAt,
        endAt,
        status,
        notes: safeString(raw.notes),
      };

      const existing = firingsByStation.get(stationId) ?? [];
      existing.push(row);
      firingsByStation.set(stationId, existing);
    });

    firingsByStation.forEach((rows, stationId) => {
      const station = stationMap.get(stationId);
      if (!station) return;

      const futureRows = rows
        .filter((row) => !row.endAt || row.endAt.getTime() >= nowMs)
        .sort((a, b) => {
          const aTime = a.startAt?.getTime() ?? Number.POSITIVE_INFINITY;
          const bTime = b.startAt?.getTime() ?? Number.POSITIVE_INFINITY;
          return aTime - bTime;
        });

      station.nextFire = futureRows[0] ?? null;
    });

    const sortedStations = Array.from(stationMap.values()).sort((a, b) => {
      const occupancyA = a.queuedHalfShelves + a.loadingHalfShelves + a.loadedHalfShelves;
      const occupancyB = b.queuedHalfShelves + b.loadingHalfShelves + b.loadedHalfShelves;
      if (occupancyA === occupancyB) {
        return a.name.localeCompare(b.name);
      }
      return occupancyB - occupancyA;
    });

    const isRelevantStation = (station: BoardStation) => {
      if (station.nextFire !== null) return true;
      return station.queuedHalfShelves > 0 || station.loadingHalfShelves > 0 || station.loadedHalfShelves > 0;
    };

    const payloadStations = sortedStations.filter(isRelevantStation).map((station) => {
      const totalActive = station.queuedHalfShelves + station.loadingHalfShelves + station.loadedHalfShelves;
      const queueNotes =
        totalActive > 0
          ? `Queue: ${station.queuedHalfShelves} queued / ${station.loadingHalfShelves} loading / ${station.loadedHalfShelves} loaded`
          : "No active queue now.";
      const load = station.nextFire;
      if (load) {
        const nextStart = formatDateRange(load.startAt);
        const statusText = load.status === "in-progress" ? "In progress" : load.status === "completed" ? "Completed" : "Scheduled";
        return {
          name: station.name,
          controller: station.controller,
          nextFireType: load.cycleType || load.title || "Firing cycle",
          nextFirePlanned: `${statusText}: ${formatBoardDate(load.startAt, now)}`,
          readyForPickup: load.endAt ? `Ready near ${formatDateRange(load.endAt)}` : nextStart,
          notes: queueNotes,
          capacity: `${totalActive}/${station.stationCapacity}`,
        };
      }

      return {
        name: station.name,
        controller: station.controller,
        nextFireType: "Manual schedule",
        nextFirePlanned: "Next load announced in portal",
        readyForPickup: totalActive > 0 ? `Currently ${totalActive} half-shelves active` : "2+ days after firing",
        notes: queueNotes,
        capacity: `${totalActive}/${station.stationCapacity}`,
      };
    });

    if (payloadStations.length === 0) {
      payloadStations.push({
        name: STATION_LABELS["studio-electric"] ?? "L&L eQ2827-3",
        controller: DEFAULT_CONTROLLER,
        nextFireType: "Manual schedule",
        nextFirePlanned: "Next load announced in portal",
        readyForPickup: "—",
        notes: "No active queue right now.",
        capacity: `0/${STATION_FALLBACK_CAPACITY_HALF_SHELVES}`,
      });
    }

    const lastUpdated = now.toISOString();
    const out = {
      lastUpdated,
      updatedBy: "Monsoon Fire System",
      kilns: payloadStations,
    };

    res.status(200).json(out);
  } catch (error: unknown) {
    logger.error("websiteKilnBoard failed", error);
    res.status(500).json({
      ok: false,
      message: error instanceof Error ? error.message : "Failed to load kiln board",
      lastUpdated: nowTs().toDate().toISOString(),
      updatedBy: "Monsoon Fire System",
      kilns: [],
    });
  }
});
