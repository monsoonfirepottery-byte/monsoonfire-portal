import { normalizeIntakeMode } from "./intakeMode";
import { STATION_LABELS, normalizeStationId as normalizeKnownStationId } from "./reservationStationConfig";

export type KilnTimelineState =
  | "idle"
  | "scheduled"
  | "loading"
  | "firing"
  | "cooling"
  | "unloading"
  | "maintenance";

export type KilnTimelineConfidence = "confirmed" | "estimated" | "forecast";
export type KilnTimelineSegmentSource = "firing" | "queue-forecast" | "status";

export type KilnTimelineSegment = {
  id: string;
  kilnId: string;
  kilnName: string;
  state: KilnTimelineState;
  label: string;
  startAt: string;
  endAt: string;
  source: KilnTimelineSegmentSource;
  confidence: KilnTimelineConfidence;
  notes: string | null;
};

export type KilnTimelineKiln = {
  id: string;
  name: string;
  currentState: KilnTimelineState;
  currentLabel: string;
  segments: KilnTimelineSegment[];
  overflowNote: string | null;
};

export type KilnTimelineResult = {
  generatedAt: string;
  windowStart: string;
  windowEnd: string;
  kilns: KilnTimelineKiln[];
};

type KilnCycleDoc = {
  id?: unknown;
  name?: unknown;
  typicalDurationHours?: unknown;
};

type KilnDoc = {
  id: string;
  name?: unknown;
  status?: unknown;
  typicalCycles?: unknown;
};

type FiringDoc = {
  id: string;
  kilnId?: unknown;
  kilnName?: unknown;
  title?: unknown;
  cycleType?: unknown;
  startAt?: unknown;
  endAt?: unknown;
  status?: unknown;
  confidence?: unknown;
  notes?: unknown;
};

type ReservationDoc = {
  id: string;
  status?: unknown;
  loadStatus?: unknown;
  intakeMode?: unknown;
  firingType?: unknown;
  assignedStationId?: unknown;
  kilnId?: unknown;
  estimatedHalfShelves?: unknown;
  shelfEquivalent?: unknown;
  footprintHalfShelves?: unknown;
  tiers?: unknown;
};

type InternalKiln = {
  id: string;
  stationKey: string;
  name: string;
  status: KilnTimelineState;
  typicalCycles: Array<{ id: string; name: string; typicalDurationHours: number }>;
};

type InternalFiring = {
  id: string;
  kilnKey: string;
  kilnName: string | null;
  title: string;
  cycleType: string;
  startDate: Date;
  endDate: Date;
  status: string;
  confidence: string;
  notes: string | null;
};

type InternalReservation = {
  kilnKey: string;
  loadStatus: "queued" | "loading" | "loaded";
  intakeMode: "SHELF_PURCHASE" | "WHOLE_KILN" | "COMMUNITY_SHELF";
  firingType: string;
  halfShelves: number;
  status: string;
};

type WindowedSegment = {
  id: string;
  kilnId: string;
  kilnName: string;
  state: KilnTimelineState;
  label: string;
  startDate: Date;
  endDate: Date;
  source: KilnTimelineSegmentSource;
  confidence: KilnTimelineConfidence;
  notes: string | null;
};

const WINDOW_DAYS = 7;
const DEFAULT_FORECAST_DURATION_HOURS = 8;
const LIVE_STATES = new Set<KilnTimelineState>(["loading", "firing", "cooling", "unloading", "maintenance"]);
const QUEUEABLE_RESERVATION_STATUSES = new Set(["requested", "confirmed", "waitlisted"]);

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readNullableString(value: unknown): string | null {
  const next = readString(value);
  return next.length > 0 ? next : null;
}

function readNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function asDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  if (typeof value === "object" && value !== null) {
    const maybe = value as { toDate?: () => Date };
    if (typeof maybe.toDate === "function") {
      try {
        const parsed = maybe.toDate();
        return Number.isNaN(parsed.getTime()) ? null : parsed;
      } catch {
        return null;
      }
    }
  }
  return null;
}

function normalizeStatus(value: unknown): string {
  return readString(value).toLowerCase();
}

function normalizeKilnState(value: unknown): KilnTimelineState {
  const normalized = normalizeStatus(value);
  if (
    normalized === "loading" ||
    normalized === "firing" ||
    normalized === "cooling" ||
    normalized === "unloading" ||
    normalized === "maintenance"
  ) {
    return normalized;
  }
  if (normalized === "offline") return "maintenance";
  return "idle";
}

function normalizeLoadStatus(value: unknown): "queued" | "loading" | "loaded" {
  const normalized = normalizeStatus(value);
  if (normalized === "loading" || normalized === "loaded") return normalized;
  return "queued";
}

function estimateHalfShelves(doc: ReservationDoc): number {
  const estimatedHalfShelves = readNumber(doc.estimatedHalfShelves);
  if (typeof estimatedHalfShelves === "number") {
    return Math.max(1, Math.ceil(estimatedHalfShelves));
  }

  const shelfEquivalent = readNumber(doc.shelfEquivalent);
  if (typeof shelfEquivalent === "number") {
    return Math.max(1, Math.ceil(shelfEquivalent * 2));
  }

  const footprintHalfShelves = readNumber(doc.footprintHalfShelves);
  const tiers = readNumber(doc.tiers);
  if (typeof footprintHalfShelves === "number") {
    const multiplier = typeof tiers === "number" ? Math.max(1, Math.round(tiers)) : 1;
    return Math.max(1, Math.ceil(footprintHalfShelves * multiplier));
  }

  return 1;
}

function inferStationKey(id: unknown, name: unknown): string {
  const normalizedId = normalizeKnownStationId(id);
  if (normalizedId === "studio-electric" || normalizedId === "reduction-raku") return normalizedId;

  const source = `${readString(id)} ${readString(name)}`.toLowerCase();
  if (source.includes("reduction") || source.includes("raku")) return "reduction-raku";
  if (source.includes("eq2827") || source.includes("l&l") || source.includes("electric")) {
    return "studio-electric";
  }
  if (normalizedId.length > 0) return normalizedId;
  const normalizedName = readString(name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return normalizedName || "kiln";
}

function inferKilnName(stationKey: string, rawName: unknown): string {
  const explicit = readString(rawName);
  if (explicit.length > 0) return explicit;
  return STATION_LABELS[stationKey] || "Kiln";
}

function normalizeKiln(doc: KilnDoc): InternalKiln {
  const stationKey = inferStationKey(doc.id, doc.name);
  const rawCycles = Array.isArray(doc.typicalCycles) ? doc.typicalCycles : [];
  const typicalCycles = rawCycles
    .map((cycle, index) => {
      const row = cycle as KilnCycleDoc;
      const duration = readNumber(row.typicalDurationHours);
      return {
        id: readString(row.id) || `cycle-${index + 1}`,
        name: readString(row.name) || `Cycle ${index + 1}`,
        typicalDurationHours:
          typeof duration === "number" && duration > 0 ? duration : DEFAULT_FORECAST_DURATION_HOURS,
      };
    })
    .filter((cycle) => cycle.typicalDurationHours > 0);

  return {
    id: doc.id,
    stationKey,
    name: inferKilnName(stationKey, doc.name),
    status: normalizeKilnState(doc.status),
    typicalCycles,
  };
}

function normalizeFiring(doc: FiringDoc): InternalFiring | null {
  const startDate = asDate(doc.startAt);
  const endDate = asDate(doc.endAt);
  if (!startDate || !endDate || endDate.getTime() <= startDate.getTime()) return null;

  const kilnKey = inferStationKey(doc.kilnId, doc.kilnName);
  return {
    id: doc.id,
    kilnKey,
    kilnName: readNullableString(doc.kilnName),
    title: readString(doc.title) || "Kiln firing",
    cycleType: readString(doc.cycleType) || "firing",
    startDate,
    endDate,
    status: normalizeStatus(doc.status),
    confidence: normalizeStatus(doc.confidence),
    notes: readNullableString(doc.notes),
  };
}

function normalizeReservation(doc: ReservationDoc): InternalReservation | null {
  const status = normalizeStatus(doc.status);
  if (!QUEUEABLE_RESERVATION_STATUSES.has(status)) return null;

  const intakeMode = normalizeIntakeMode(doc.intakeMode, "SHELF_PURCHASE");
  const kilnKey = inferStationKey(doc.assignedStationId ?? doc.kilnId, doc.kilnId);
  if (!kilnKey) return null;

  return {
    kilnKey,
    loadStatus: normalizeLoadStatus(doc.loadStatus),
    intakeMode,
    firingType: normalizeStatus(doc.firingType) || "other",
    halfShelves: estimateHalfShelves(doc),
    status,
  };
}

function startOfNextHour(value: Date): Date {
  const next = new Date(value);
  next.setMilliseconds(0);
  next.setSeconds(0);
  if (next.getMinutes() > 0) {
    next.setMinutes(0);
    next.setHours(next.getHours() + 1);
    return next;
  }
  return next;
}

function endOfToday(value: Date): Date {
  const next = new Date(value);
  next.setHours(24, 0, 0, 0);
  return next;
}

function overlaps(startA: Date, endA: Date, startB: Date, endB: Date): boolean {
  return startA.getTime() < endB.getTime() && endA.getTime() > startB.getTime();
}

function clipToWindow(segment: WindowedSegment, windowStart: Date, windowEnd: Date): WindowedSegment | null {
  if (!overlaps(segment.startDate, segment.endDate, windowStart, windowEnd)) return null;
  const clippedStart = segment.startDate.getTime() < windowStart.getTime() ? windowStart : segment.startDate;
  const clippedEnd = segment.endDate.getTime() > windowEnd.getTime() ? windowEnd : segment.endDate;
  if (clippedEnd.getTime() <= clippedStart.getTime()) return null;
  return {
    ...segment,
    startDate: clippedStart,
    endDate: clippedEnd,
  };
}

function currentStateLabel(state: KilnTimelineState): string {
  switch (state) {
  case "scheduled":
    return "Scheduled";
  case "loading":
    return "Loading";
  case "firing":
    return "Firing";
  case "cooling":
    return "Cooling";
  case "unloading":
    return "Unloading";
  case "maintenance":
    return "Maintenance";
  case "idle":
  default:
    return "Idle";
  }
}

function normalizeConfidence(value: string): KilnTimelineConfidence {
  return value === "estimated" ? "estimated" : "confirmed";
}

function inferCurrentState(
  kiln: InternalKiln,
  now: Date,
  firings: InternalFiring[],
  reservations: InternalReservation[]
): KilnTimelineState {
  if (LIVE_STATES.has(kiln.status) && kiln.status !== "scheduled") return kiln.status;

  const activeFiring = firings.find((firing) =>
    firing.startDate.getTime() <= now.getTime() && firing.endDate.getTime() >= now.getTime()
  );
  if (activeFiring) {
    if (activeFiring.status === "loading") return "loading";
    if (activeFiring.status === "cooling") return "cooling";
    if (activeFiring.status === "unloading") return "unloading";
    return "firing";
  }

  if (reservations.some((reservation) => reservation.loadStatus === "loading")) return "loading";
  return "idle";
}

function buildFiringSegments(
  kiln: InternalKiln,
  firings: InternalFiring[],
  now: Date,
  currentState: KilnTimelineState,
  windowStart: Date,
  windowEnd: Date
): WindowedSegment[] {
  return firings
    .filter((firing) => firing.status !== "cancelled")
    .sort((left, right) => left.startDate.getTime() - right.startDate.getTime())
    .map((firing) => {
      const isActiveNow =
        firing.startDate.getTime() <= now.getTime() && firing.endDate.getTime() >= now.getTime();
      let state: KilnTimelineState = "scheduled";
      if (isActiveNow) {
        state = currentState !== "idle" && currentState !== "scheduled" ? currentState : "firing";
      } else if (firing.status === "completed") {
        state = "idle";
      }

      return clipToWindow(
        {
          id: `firing:${firing.id}`,
          kilnId: kiln.stationKey,
          kilnName: kiln.name,
          state,
          label: firing.title,
          startDate: firing.startDate,
          endDate: firing.endDate,
          source: "firing",
          confidence: normalizeConfidence(firing.confidence),
          notes: firing.notes,
        },
        windowStart,
        windowEnd
      );
    })
    .filter((segment): segment is WindowedSegment => Boolean(segment))
    .filter((segment) => segment.state !== "idle");
}

function buildStatusOverlay(
  kiln: InternalKiln,
  now: Date,
  currentState: KilnTimelineState,
  firingSegments: WindowedSegment[],
  windowEnd: Date
): WindowedSegment | null {
  if (currentState === "idle" || currentState === "scheduled") return null;

  const activeSegment = firingSegments.find((segment) =>
    segment.startDate.getTime() <= now.getTime() && segment.endDate.getTime() >= now.getTime()
  );
  if (activeSegment) return null;

  const nextExplicitStart = firingSegments
    .filter((segment) => segment.startDate.getTime() > now.getTime())
    .map((segment) => segment.startDate.getTime())
    .sort((left, right) => left - right)[0];
  const overlayEnd = new Date(
    Math.min(endOfToday(now).getTime(), nextExplicitStart ?? Number.POSITIVE_INFINITY, windowEnd.getTime())
  );
  if (overlayEnd.getTime() <= now.getTime()) return null;

  return {
    id: `status:${kiln.stationKey}:${currentState}`,
    kilnId: kiln.stationKey,
    kilnName: kiln.name,
    state: currentState,
    label: currentState === "maintenance" ? "Maintenance now" : `${currentStateLabel(currentState)} now`,
    startDate: now,
    endDate: overlayEnd,
    source: "status",
    confidence: "confirmed",
    notes: currentState === "maintenance" ? "Current kiln status is maintenance or offline." : null,
  };
}

function forecastDurationMs(kiln: InternalKiln, firingType: string): number {
  const normalizedTarget = firingType.toLowerCase();
  const matchingCycle = kiln.typicalCycles.find((cycle) => {
    const haystack = `${cycle.id} ${cycle.name}`.toLowerCase();
    if (normalizedTarget === "bisque") return haystack.includes("bisque");
    if (normalizedTarget === "glaze") return haystack.includes("glaze");
    if (normalizedTarget === "raku" || normalizedTarget === "reduction") {
      return haystack.includes("raku") || haystack.includes("reduction");
    }
    return false;
  });
  const hours = matchingCycle?.typicalDurationHours ?? DEFAULT_FORECAST_DURATION_HOURS;
  return hours * 60 * 60 * 1000;
}

function dominantQueueType(reservations: InternalReservation[]): string {
  const totals = new Map<string, number>();
  reservations.forEach((reservation) => {
    const key = reservation.firingType || "other";
    totals.set(key, (totals.get(key) ?? 0) + reservation.halfShelves);
  });
  return Array.from(totals.entries()).sort((left, right) => right[1] - left[1])[0]?.[0] ?? "other";
}

function queueLabelForType(firingType: string): string {
  if (firingType === "bisque") return "Queued bisque load";
  if (firingType === "glaze") return "Queued glaze load";
  return "Queued kiln load";
}

function findFirstAvailableSlot(
  segments: WindowedSegment[],
  durationMs: number,
  startAt: Date,
  windowEnd: Date
): { startDate: Date | null; wasRescheduled: boolean } {
  let candidate = startOfNextHour(startAt);
  let wasRescheduled = false;
  const blockers = [...segments].sort((left, right) => left.startDate.getTime() - right.startDate.getTime());

  while (candidate.getTime() < windowEnd.getTime()) {
    const candidateEnd = new Date(candidate.getTime() + durationMs);
    if (candidateEnd.getTime() > windowEnd.getTime()) {
      return { startDate: null, wasRescheduled };
    }

    const overlapping = blockers.find((segment) =>
      overlaps(candidate, candidateEnd, segment.startDate, segment.endDate)
    );
    if (!overlapping) return { startDate: candidate, wasRescheduled };

    candidate = startOfNextHour(new Date(overlapping.endDate));
    wasRescheduled = true;
  }

  return { startDate: null, wasRescheduled };
}

function buildQueueForecast(
  kiln: InternalKiln,
  now: Date,
  reservations: InternalReservation[],
  segments: WindowedSegment[],
  windowEnd: Date
): { segment: WindowedSegment | null; overflowNote: string | null } {
  const queueReservations = reservations.filter((reservation) =>
    reservation.intakeMode === "SHELF_PURCHASE" && reservation.loadStatus === "queued"
  );
  if (queueReservations.length === 0) {
    return { segment: null, overflowNote: null };
  }

  const firingType = dominantQueueType(queueReservations);
  const durationMs = forecastDurationMs(kiln, firingType);
  const totalHalfShelves = queueReservations.reduce((sum, reservation) => sum + reservation.halfShelves, 0);
  const { startDate, wasRescheduled } = findFirstAvailableSlot(segments, durationMs, now, windowEnd);
  if (!startDate) {
    return { segment: null, overflowNote: "Next queued load lands after this view." };
  }

  const endDate = new Date(startDate.getTime() + durationMs);
  const notes = wasRescheduled
    ? `Forecast based on ${totalHalfShelves} queued half-shelves. Moved to the next open slot after a confirmed firing.`
    : `Forecast based on ${totalHalfShelves} queued half-shelves.`;

  return {
    segment: {
      id: `forecast:${kiln.stationKey}:${startDate.toISOString()}`,
      kilnId: kiln.stationKey,
      kilnName: kiln.name,
      state: "scheduled",
      label: queueLabelForType(firingType),
      startDate,
      endDate,
      source: "queue-forecast",
      confidence: "forecast",
      notes,
    },
    overflowNote: null,
  };
}

function sortKilns(left: InternalKiln, right: InternalKiln): number {
  const leftPriority = left.stationKey === "studio-electric" ? 0 : 1;
  const rightPriority = right.stationKey === "studio-electric" ? 0 : 1;
  if (leftPriority !== rightPriority) return leftPriority - rightPriority;
  return left.name.localeCompare(right.name);
}

export function buildKilnTimeline(input: {
  kilns: KilnDoc[];
  firings: FiringDoc[];
  reservations: ReservationDoc[];
  now?: Date;
}): KilnTimelineResult {
  const now = input.now ?? new Date();
  const windowStart = new Date(now);
  const windowEnd = new Date(now.getTime() + WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const kilns = input.kilns.map((row) => normalizeKiln(row)).sort(sortKilns);
  const firings = input.firings
    .map((row) => normalizeFiring(row))
    .filter((row): row is InternalFiring => Boolean(row))
    .filter((row) => row.endDate.getTime() > windowStart.getTime());
  const reservations = input.reservations
    .map((row) => normalizeReservation(row))
    .filter((row): row is InternalReservation => Boolean(row));

  const kilnPayload = kilns.map((kiln) => {
    const kilnFirings = firings.filter((firing) => firing.kilnKey === kiln.stationKey);
    const kilnReservations = reservations.filter((reservation) => reservation.kilnKey === kiln.stationKey);
    const currentState = inferCurrentState(kiln, now, kilnFirings, kilnReservations);

    const firingSegments = buildFiringSegments(kiln, kilnFirings, now, currentState, windowStart, windowEnd);
    const statusOverlay = buildStatusOverlay(kiln, now, currentState, firingSegments, windowEnd);
    const blockingSegments = statusOverlay ? [...firingSegments, statusOverlay] : [...firingSegments];
    const forecast = buildQueueForecast(kiln, now, kilnReservations, blockingSegments, windowEnd);
    const timelineSegments = [...firingSegments];
    if (statusOverlay) timelineSegments.push(statusOverlay);
    if (forecast.segment) timelineSegments.push(forecast.segment);

    const segments = timelineSegments
      .sort((left, right) => left.startDate.getTime() - right.startDate.getTime())
      .map((segment) => ({
        id: segment.id,
        kilnId: segment.kilnId,
        kilnName: segment.kilnName,
        state: segment.state,
        label: segment.label,
        startAt: segment.startDate.toISOString(),
        endAt: segment.endDate.toISOString(),
        source: segment.source,
        confidence: segment.confidence,
        notes: segment.notes,
      }));

    return {
      id: kiln.stationKey,
      name: kiln.name,
      currentState,
      currentLabel: currentStateLabel(currentState),
      segments,
      overflowNote: forecast.overflowNote,
    };
  });

  return {
    generatedAt: now.toISOString(),
    windowStart: windowStart.toISOString(),
    windowEnd: windowEnd.toISOString(),
    kilns: kilnPayload,
  };
}
