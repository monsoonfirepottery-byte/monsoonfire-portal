import {
  collection,
  getDocs,
  limit,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import type { User } from "firebase/auth";
import { useCallback, useEffect, useMemo, useState } from "react";
import { db } from "../firebase";
import { createPortalApi } from "../api/portalApi";
import type { ListFiringsTimelineResponse } from "../api/portalApi";
import type { KilnTimelineKiln, KilnTimelineSegment, KilnTimelineState } from "../api/portalContracts";
import { normalizeIntakeMode } from "../lib/intakeMode";
import { shortId, track } from "../lib/analytics";
import type { AnalyticsProps } from "../lib/analytics";
import { toVoidHandler } from "../utils/toVoidHandler";
import "./KilnLaunchView.css";

type LoadStatus = "queued" | "loading" | "loaded";

type ReservationQueueItem = {
  id: string;
  ownerUid: string;
  intakeMode?: string | null;
  firingType?: string | null;
  shelfEquivalent?: number | null;
  footprintHalfShelves?: number | null;
  heightInches?: number | null;
  tiers?: number | null;
  estimatedHalfShelves?: number | null;
  kilnId?: string | null;
  status?: string | null;
  loadStatus?: string | null;
  wareType?: string | null;
  dropOffProfile?: {
    label?: string | null;
    specialHandling?: boolean | null;
  } | null;
  dropOffQuantity?: {
    label?: string | null;
    pieceRange?: string | null;
  } | null;
  addOns?: {
    rushRequested?: boolean;
    wholeKilnRequested?: boolean;
  } | null;
  createdAt?: unknown;
};

type QueueEntry = ReservationQueueItem & {
  halfShelves: number;
  loadStatus: LoadStatus;
  firingBucket: "bisque" | "glaze";
  intakeMode: "SHELF_PURCHASE" | "WHOLE_KILN" | "COMMUNITY_SHELF";
};

type TimelineSegmentEntry = KilnTimelineSegment & {
  startDate: Date;
  endDate: Date;
};

type TimelineKilnEntry = Omit<KilnTimelineKiln, "segments"> & {
  segments: TimelineSegmentEntry[];
};

type KilnLaunchViewProps = {
  user: User;
  isStaff: boolean;
};

const KILN_CAPACITY_HALF_SHELVES = 8;
const KILN_ID = "studio-electric";

const LOAD_STATUS_LABELS: Record<LoadStatus, string> = {
  queued: "Awaiting",
  loading: "Loading",
  loaded: "Loaded",
};

const TIMELINE_DAYS = 7;

const TIMELINE_STATE_LABELS: Record<KilnTimelineState, string> = {
  idle: "Idle",
  scheduled: "Scheduled",
  loading: "Loading",
  firing: "Firing",
  cooling: "Cooling",
  unloading: "Unloading",
  maintenance: "Maintenance",
};

function normalizeLoadStatus(value: unknown): LoadStatus {
  if (value === "loading" || value === "loaded") return value;
  return "queued";
}

function normalizeHalfShelves(value: unknown, alreadyHalfShelves = false) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(1, Math.ceil(alreadyHalfShelves ? value : value * 2));
  }
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) {
      return Math.max(1, Math.ceil(alreadyHalfShelves ? parsed : parsed * 2));
    }
  }
  return 1;
}

function formatHalfShelfLabel(value: number) {
  const rounded = Number.isFinite(value) ? Math.round(value) : 0;
  return `${rounded} half shelf${rounded === 1 ? "" : "es"}`;
}

function isGlazeFiring(value: unknown) {
  return typeof value === "string" && value.toLowerCase() === "glaze";
}

function formatWareLabel(value: unknown) {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  return trimmed
    .split(/[\s-_]+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function getQueueTitle(item: QueueEntry) {
  if (item.dropOffProfile?.label) return item.dropOffProfile.label;
  if (item.dropOffQuantity?.label) return item.dropOffQuantity.label;
  if (Number.isFinite(item.estimatedHalfShelves)) {
    return `${Math.round(item.estimatedHalfShelves as number)} half-shelf estimate`;
  }
  return "Checked-in work";
}

function getQueueMeta(item: QueueEntry) {
  const parts: string[] = [];
  const ware = formatWareLabel(item.wareType);
  if (ware) parts.push(ware);
  if (item.dropOffQuantity?.pieceRange) {
    parts.push(item.dropOffQuantity.pieceRange);
  }
  if (item.intakeMode === "WHOLE_KILN") parts.push("Whole kiln");
  if (item.intakeMode === "COMMUNITY_SHELF") parts.push("Community shelf");
  parts.push(item.firingBucket === "glaze" ? "Glaze" : "Bisque");
  return parts.join(" · ") || "Member check-in";
}

function isCancelled(status: string | null | undefined) {
  return typeof status === "string" && status.toUpperCase() === "CANCELLED";
}

function getFiringProgressCopy(plannedHalfShelves: number) {
  if (plannedHalfShelves <= 0) return "No active load yet. The kiln is ready for the next drop-off wave.";
  if (plannedHalfShelves <= 3) return "Early load build. Staff are staging the first shelves.";
  if (plannedHalfShelves <= 6) return "Load is filling steadily. Timing gets more predictable from here.";
  return "Near firing threshold. Final layout checks are underway.";
}

function buildLoadStatusSummary(loadingCount: number, loadedCount: number) {
  if (loadingCount + loadedCount === 0) {
    return "No shelves are actively loading yet. Queue lanes are standing by.";
  }
  if (loadedCount > 0) {
    return `Load is live. ${loadedCount} check-in${
      loadedCount === 1 ? "" : "s"
    } already confirmed in the kiln.`;
  }
  return `Staff are actively loading and balancing the kiln layout. ${loadingCount} check-in${
    loadingCount === 1 ? "" : "s"
  } in progress.`;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function getErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  const value = error as { code?: unknown; name?: unknown };
  if (typeof value.code === "string") return value.code;
  if (typeof value.name === "string") return value.name;
  return undefined;
}

function coerceDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  if (typeof value === "object") {
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

function formatTimelineDay(date: Date) {
  return {
    key: date.toISOString(),
    weekday: date.toLocaleDateString([], { weekday: "short" }),
    shortDate: date.toLocaleDateString([], { month: "short", day: "numeric" }),
    compact: date.toLocaleDateString([], { month: "numeric", day: "numeric" }),
  };
}

function formatTimelineRange(startDate: Date, endDate: Date) {
  const sameDay = startDate.toDateString() === endDate.toDateString();
  const startTime = startDate.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const endTime = endDate.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (sameDay) {
    return `${startDate.toLocaleDateString([], { month: "short", day: "numeric" })} · ${startTime} - ${endTime}`;
  }
  return `${startDate.toLocaleDateString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })} to ${endDate.toLocaleDateString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })}`;
}

function getTimelineSourceLabel(source: KilnTimelineSegment["source"]) {
  if (source === "queue-forecast") return "Queued load forecast";
  if (source === "status") return "Live kiln status";
  return "Confirmed firing";
}

function getTimelineConfidenceLabel(confidence: KilnTimelineSegment["confidence"]) {
  if (confidence === "forecast") return "Forecast";
  if (confidence === "estimated") return "Estimated";
  return "Confirmed";
}

export default function KilnLaunchView({ user, isStaff }: KilnLaunchViewProps) {
  const [reservations, setReservations] = useState<ReservationQueueItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [timelineData, setTimelineData] = useState<ListFiringsTimelineResponse | null>(null);
  const [timelineLoading, setTimelineLoading] = useState(false);
  const [timelineError, setTimelineError] = useState("");
  const [selectedTimelineSegmentId, setSelectedTimelineSegmentId] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [actionBusyId, setActionBusyId] = useState<string | null>(null);
  const [actionStatus, setActionStatus] = useState("");
  const portalApi = useMemo(() => createPortalApi(), []);
  const trackStudioLifecycle = useCallback(
    (eventName: string, props: AnalyticsProps = {}) => {
      track(eventName, {
        uid: shortId(user.uid),
        surface: "kiln-launch",
        ...props,
      });
    },
    [user.uid]
  );

  const loadPageData = useCallback(async () => {
    setLoading(true);
    setTimelineLoading(true);
    setError("");
    setTimelineError("");

    const reservationsPromise = (async () => {
      const baseRef = collection(db, "reservations");
      const reservationsQuery = isStaff
        ? query(baseRef, orderBy("createdAt", "desc"), limit(250))
        : query(baseRef, where("ownerUid", "==", user.uid), orderBy("createdAt", "desc"), limit(200));
      const snap = await getDocs(reservationsQuery);
      return snap.docs.map((docSnap) => {
        const data = docSnap.data() as Partial<ReservationQueueItem>;
        return {
          id: docSnap.id,
          ownerUid: data.ownerUid ?? "",
          intakeMode: typeof data.intakeMode === "string" ? data.intakeMode : null,
          firingType: data.firingType ?? null,
          shelfEquivalent: typeof data.shelfEquivalent === "number" ? data.shelfEquivalent : null,
          footprintHalfShelves:
            typeof data.footprintHalfShelves === "number" ? data.footprintHalfShelves : null,
          heightInches: typeof data.heightInches === "number" ? data.heightInches : null,
          tiers: typeof data.tiers === "number" ? data.tiers : null,
          estimatedHalfShelves:
            typeof data.estimatedHalfShelves === "number" ? data.estimatedHalfShelves : null,
          kilnId: data.kilnId ?? null,
          status: data.status ?? null,
          loadStatus: data.loadStatus ?? null,
          wareType: data.wareType ?? null,
          dropOffProfile: data.dropOffProfile ?? null,
          dropOffQuantity: data.dropOffQuantity ?? null,
          addOns: data.addOns ?? null,
          createdAt: data.createdAt,
        };
      }) as ReservationQueueItem[];
    })();

    const timelinePromise = (async () => {
      const idToken = await user.getIdToken();
      const response = await portalApi.listFiringsTimeline({
        idToken,
        payload: {},
      });
      return response.data;
    })();

    const [reservationsResult, timelineResult] = await Promise.allSettled([
      reservationsPromise,
      timelinePromise,
    ]);

    let didUpdate = false;
    if (reservationsResult.status === "fulfilled") {
      setReservations(reservationsResult.value);
      didUpdate = true;
    } else {
      setReservations([]);
      setError(`Queue load failed: ${getErrorMessage(reservationsResult.reason)}`);
    }

    if (timelineResult.status === "fulfilled") {
      setTimelineData(timelineResult.value);
      didUpdate = true;
    } else {
      setTimelineData(null);
      setTimelineError(`Timeline unavailable: ${getErrorMessage(timelineResult.reason)}`);
    }

    if (didUpdate) {
      setLastUpdated(new Date());
    }

    setLoading(false);
    setTimelineLoading(false);
  }, [isStaff, portalApi, user]);

  useEffect(() => {
    void loadPageData();
  }, [loadPageData]);

  const scopedReservations = useMemo(
    () => reservations.filter((item) => !item.kilnId || item.kilnId === KILN_ID),
    [reservations]
  );

  const activeReservations = useMemo(
    () => scopedReservations.filter((item) => !isCancelled(item.status)),
    [scopedReservations]
  );

  const queueEntries = useMemo<QueueEntry[]>(
    () =>
      activeReservations.map((item) => ({
        ...item,
        intakeMode: normalizeIntakeMode(item.intakeMode, item.addOns?.wholeKilnRequested ? "WHOLE_KILN" : "SHELF_PURCHASE"),
        loadStatus: normalizeLoadStatus(item.loadStatus),
        halfShelves:
          item.estimatedHalfShelves != null
            ? normalizeHalfShelves(item.estimatedHalfShelves, true)
            : normalizeHalfShelves(item.shelfEquivalent),
        firingBucket: isGlazeFiring(item.firingType) ? "glaze" : "bisque",
      })),
    [activeReservations]
  );

  const communityShelfEntries = useMemo(
    () => queueEntries.filter((item) => item.intakeMode === "COMMUNITY_SHELF"),
    [queueEntries]
  );

  const schedulingEntries = useMemo(
    () => queueEntries.filter((item) => item.intakeMode !== "COMMUNITY_SHELF"),
    [queueEntries]
  );

  const queuedEntries = useMemo(
    () => schedulingEntries.filter((item) => item.loadStatus === "queued"),
    [schedulingEntries]
  );
  const loadingEntries = useMemo(
    () => schedulingEntries.filter((item) => item.loadStatus === "loading"),
    [schedulingEntries]
  );
  const loadedEntries = useMemo(
    () => schedulingEntries.filter((item) => item.loadStatus === "loaded"),
    [schedulingEntries]
  );

  const bisqueQueue = useMemo(
    () => queuedEntries.filter((item) => item.firingBucket === "bisque"),
    [queuedEntries]
  );
  const glazeQueue = useMemo(
    () => queuedEntries.filter((item) => item.firingBucket === "glaze"),
    [queuedEntries]
  );

  const bisqueHalfShelves = useMemo(
    () => bisqueQueue.reduce((sum, item) => sum + item.halfShelves, 0),
    [bisqueQueue]
  );
  const glazeHalfShelves = useMemo(
    () => glazeQueue.reduce((sum, item) => sum + item.halfShelves, 0),
    [glazeQueue]
  );
  const queuedHalfShelves = useMemo(
    () => queuedEntries.reduce((sum, item) => sum + item.halfShelves, 0),
    [queuedEntries]
  );
  const communityHalfShelves = useMemo(
    () => communityShelfEntries.reduce((sum, item) => sum + item.halfShelves, 0),
    [communityShelfEntries]
  );
  const loadingHalfShelves = useMemo(
    () => loadingEntries.reduce((sum, item) => sum + item.halfShelves, 0),
    [loadingEntries]
  );
  const loadedHalfShelves = useMemo(
    () => loadedEntries.reduce((sum, item) => sum + item.halfShelves, 0),
    [loadedEntries]
  );

  const plannedHalfShelves = Math.min(
    KILN_CAPACITY_HALF_SHELVES,
    queuedHalfShelves + loadingHalfShelves + loadedHalfShelves
  );

  const firingProgressCopy = useMemo(
    () => getFiringProgressCopy(plannedHalfShelves),
    [plannedHalfShelves]
  );

  const loadStateLabel =
    loadedHalfShelves >= KILN_CAPACITY_HALF_SHELVES
      ? "Ready to fire"
      : loadingHalfShelves > 0
      ? "Loading"
      : queuedHalfShelves > 0
      ? "Awaiting load"
      : "Idle";

  const loadStatusSummary = useMemo(
    () => buildLoadStatusSummary(loadingEntries.length, loadedEntries.length),
    [loadingEntries.length, loadedEntries.length]
  );
  const hasLoadActivity = loadingEntries.length + loadedEntries.length > 0;
  const canManageLoad = isStaff;
  const totalQueuedHalfShelves = queuedHalfShelves + communityHalfShelves;
  const queueDensityPercent = Math.min(
    100,
    Math.round((totalQueuedHalfShelves / KILN_CAPACITY_HALF_SHELVES) * 100)
  );
  const timelineWindowStart = useMemo(() => {
    const next = coerceDate(timelineData?.windowStart);
    return next ?? new Date();
  }, [timelineData?.windowStart]);
  const timelineWindowEnd = useMemo(() => {
    const next = coerceDate(timelineData?.windowEnd);
    if (next) return next;
    return new Date(timelineWindowStart.getTime() + TIMELINE_DAYS * 24 * 60 * 60 * 1000);
  }, [timelineData?.windowEnd, timelineWindowStart]);
  const timelineGeneratedAt = useMemo(
    () => coerceDate(timelineData?.generatedAt),
    [timelineData?.generatedAt]
  );
  const timelineDays = useMemo(() => {
    return Array.from({ length: TIMELINE_DAYS }, (_, index) => {
      const date = new Date(timelineWindowStart.getTime() + index * 24 * 60 * 60 * 1000);
      return formatTimelineDay(date);
    });
  }, [timelineWindowStart]);
  const timelineWindowLabel = useMemo(() => {
    const start = timelineDays[0];
    const end = timelineDays[timelineDays.length - 1];
    if (!start || !end) return "Next 7 days";
    return `${start.shortDate} - ${end.shortDate}`;
  }, [timelineDays]);
  const timelineKilns = useMemo<TimelineKilnEntry[]>(() => {
    return (timelineData?.kilns ?? []).map((kiln) => ({
      ...kiln,
      segments: (kiln.segments ?? [])
        .map((segment) => {
          const startDate = coerceDate(segment.startAt);
          const endDate = coerceDate(segment.endAt);
          if (!startDate || !endDate || endDate.getTime() <= startDate.getTime()) return null;
          return {
            ...segment,
            startDate,
            endDate,
          };
        })
        .filter((segment): segment is TimelineSegmentEntry => Boolean(segment)),
    }));
  }, [timelineData?.kilns]);
  const timelineSpanMs = Math.max(1, timelineWindowEnd.getTime() - timelineWindowStart.getTime());
  const timelineNowMarkerPercent = useMemo(() => {
    if (!timelineGeneratedAt) return null;
    const nowMs = timelineGeneratedAt.getTime();
    if (nowMs < timelineWindowStart.getTime() || nowMs > timelineWindowEnd.getTime()) return null;
    return ((nowMs - timelineWindowStart.getTime()) / timelineSpanMs) * 100;
  }, [timelineGeneratedAt, timelineSpanMs, timelineWindowEnd, timelineWindowStart]);
  const flattenedTimelineSegments = useMemo(
    () =>
      timelineKilns.flatMap((kiln) =>
        kiln.segments.map((segment) => ({
          ...segment,
          kilnName: kiln.name,
          kilnCurrentState: kiln.currentState,
          kilnCurrentLabel: kiln.currentLabel,
        }))
      ),
    [timelineKilns]
  );
  const selectedTimelineSegment = useMemo(
    () =>
      flattenedTimelineSegments.find((segment) => segment.id === selectedTimelineSegmentId) ?? null,
    [flattenedTimelineSegments, selectedTimelineSegmentId]
  );

  useEffect(() => {
    if (!selectedTimelineSegmentId) return;
    if (flattenedTimelineSegments.some((segment) => segment.id === selectedTimelineSegmentId)) return;
    setSelectedTimelineSegmentId(null);
  }, [flattenedTimelineSegments, selectedTimelineSegmentId]);

  const userEntries = useMemo(
    () => queueEntries.filter((item) => item.ownerUid === user.uid),
    [queueEntries, user.uid]
  );
  const userHalfShelves = useMemo(
    () => userEntries.reduce((sum, item) => sum + item.halfShelves, 0),
    [userEntries]
  );
  const userLoadedCount = useMemo(
    () => userEntries.filter((item) => item.loadStatus === "loaded").length,
    [userEntries]
  );
  const userLoadingCount = useMemo(
    () => userEntries.filter((item) => item.loadStatus === "loading").length,
    [userEntries]
  );
  const userQueuedCount = useMemo(
    () => userEntries.filter((item) => item.loadStatus === "queued").length,
    [userEntries]
  );

  const userFlowCopy = useMemo(() => {
    if (userEntries.length === 0) {
      return "You are not in the queue yet. Submit a check-in when you are ready to join the next firing plan.";
    }
    const shelfLabel = formatHalfShelfLabel(userHalfShelves);
    if (userLoadedCount > 0) {
      return `You have ${shelfLabel} in this plan. Part of your work is already confirmed in the kiln.`;
    }
    if (userLoadingCount > 0) {
      return `You have ${shelfLabel} in this plan. Staff are loading it now and finalizing placement.`;
    }
    if (userQueuedCount > 0) {
      return `You have ${shelfLabel} in line. Your work is queued while we shape the next firing.`;
    }
    return "Your check-ins are in the queue. Placement is confirmed as the load is built.";
  }, [userEntries.length, userHalfShelves, userLoadedCount, userLoadingCount, userQueuedCount]);

  const loadSlots = useMemo(() => {
    const slots: Array<LoadStatus | "empty"> = [];
    const pushSlots = (items: QueueEntry[], status: LoadStatus) => {
      items.forEach((item) => {
        for (let i = 0; i < item.halfShelves && slots.length < KILN_CAPACITY_HALF_SHELVES; i += 1) {
          slots.push(status);
        }
      });
    };
    pushSlots(loadedEntries, "loaded");
    pushSlots(loadingEntries, "loading");
    pushSlots(queuedEntries, "queued");
    while (slots.length < KILN_CAPACITY_HALF_SHELVES) {
      slots.push("empty");
    }
    return slots;
  }, [loadedEntries, loadingEntries, queuedEntries]);

  const getTimelineSegmentStyle = (segment: TimelineSegmentEntry) => {
    const leftPercent =
      ((segment.startDate.getTime() - timelineWindowStart.getTime()) / timelineSpanMs) * 100;
    const widthPercent =
      ((segment.endDate.getTime() - segment.startDate.getTime()) / timelineSpanMs) * 100;
    return {
      left: `${Math.max(0, Math.min(100, leftPercent))}%`,
      width: `${Math.max(2.5, Math.min(100, widthPercent))}%`,
    };
  };

  const handleLoadStatusUpdate = async (reservationId: string, nextStatus: LoadStatus) => {
    if (!isStaff || actionBusyId) return;
    const currentStatus =
      queueEntries.find((entry) => entry.id === reservationId)?.loadStatus ?? "queued";
    const reservationToken = shortId(reservationId);
    setActionBusyId(reservationId);
    setActionStatus("");
    try {
      const idToken = await user.getIdToken();
      await portalApi.updateReservation({
        idToken,
        payload: {
          reservationId,
          loadStatus: nextStatus,
        },
      });
      setActionStatus("Load status updated.");
      trackStudioLifecycle("status_transition", {
        reservationId: reservationToken,
        actorRole: "staff",
        transitionDomain: "kiln_load",
        transitionAction: "load_status_update",
        transitionFrom: currentStatus,
        transitionTo: nextStatus,
        transitionOutcome: "success",
      });
      if (nextStatus === "loading") {
        trackStudioLifecycle("kiln_load_started", {
          reservationId: reservationToken,
          actorRole: "staff",
          transitionFrom: currentStatus,
          transitionTo: nextStatus,
        });
      }
      if (nextStatus === "loaded") {
        trackStudioLifecycle("pickup_ready", {
          reservationId: reservationToken,
          actorRole: "staff",
          transitionFrom: currentStatus,
          transitionTo: nextStatus,
        });
      }
      await loadPageData();
    } catch (error: unknown) {
      setActionStatus(`Update failed: ${getErrorMessage(error)}`);
      trackStudioLifecycle("status_transition_exception", {
        reservationId: reservationToken,
        actorRole: "staff",
        transitionDomain: "kiln_load",
        transitionAction: "load_status_update",
        transitionFrom: currentStatus,
        transitionTo: nextStatus,
        errorCode: getErrorCode(error) ?? "unknown",
        errorMessage: getErrorMessage(error).slice(0, 160),
      });
    } finally {
      setActionBusyId(null);
    }
  };

  return (
    <div className="kiln-launch-page">
      <header className="kiln-launch-header">
        <div>
          <p className="kiln-launch-kicker">Kiln queues</p>
          <h1 className="kiln-launch-title">Live view of our Kilns</h1>
          <p className="kiln-launch-summary">
            Track what is queued, what is loading, and how full the next kiln plan is getting while
            staff balance bisque, glaze, and community shelf lanes into a safe, efficient firing
            plan.
            {lastUpdated ? ` Last updated ${lastUpdated.toLocaleTimeString()}.` : ""}
          </p>
        </div>
        <div className="kiln-launch-actions">
          <button
            className="btn btn-ghost"
            onClick={toVoidHandler(loadPageData)}
            disabled={loading || timelineLoading}
          >
            {loading || timelineLoading ? "Refreshing..." : "Refresh"}
          </button>
        </div>
      </header>

      {error ? <div className="kiln-launch-error">{error}</div> : null}
      {actionStatus ? <div className="kiln-launch-status">{actionStatus}</div> : null}

      <section className="kiln-launch-panel kiln-live-panel">
        <div className="kiln-panel-header">
          <div>
            <h2>What&apos;s happening now</h2>
            <p className="kiln-panel-meta">
              {hasLoadActivity
                ? `${loadStatusSummary} The calendar below shows the next seven days for each kiln.`
                : "Read-only seven-day kiln calendar with live states, confirmed firings, and queued-load forecasts."}
            </p>
          </div>
        </div>
        <div className="kiln-live-chips">
          <div className="kiln-live-chip">
            <span className="kiln-live-label">Studio kiln</span>
            <strong>{loadStateLabel}</strong>
          </div>
          <div className="kiln-live-chip">
            <span className="kiln-live-label">Planned shelves</span>
            <strong>
              {plannedHalfShelves}/{KILN_CAPACITY_HALF_SHELVES}
            </strong>
          </div>
          <div className="kiln-live-chip">
            <span className="kiln-live-label">Queue density</span>
            <strong>{queueDensityPercent}%</strong>
          </div>
          <div className="kiln-live-chip">
            <span className="kiln-live-label">Queue lanes</span>
            <strong>
              {queuedEntries.length} queued · {communityShelfEntries.length} community
            </strong>
          </div>
        </div>
        <div className="kiln-timeline">
          <div className="kiln-timeline-header">
            <div>
              <h3>Seven-day kiln calendar</h3>
              <p className="kiln-panel-meta">
                Confirmed firings are shown alongside live kiln states. Queued shelf work appears as a forecast only when it has room in the next open slot.
              </p>
            </div>
            <div className="kiln-timeline-window">{timelineWindowLabel}</div>
          </div>

          <div className="kiln-timeline-legend" aria-label="Kiln timeline legend">
            {(Object.keys(TIMELINE_STATE_LABELS) as KilnTimelineState[]).map((state) => (
              <div key={state} className="kiln-timeline-legend-item">
                <span className={`kiln-timeline-swatch state-${state}`} aria-hidden="true" />
                <span>{TIMELINE_STATE_LABELS[state]}</span>
              </div>
            ))}
          </div>

          {timelineError ? <div className="kiln-timeline-note error">{timelineError}</div> : null}

          {timelineLoading && timelineKilns.length === 0 ? (
            <p className="kiln-empty">Loading the seven-day kiln timeline.</p>
          ) : null}

          {!timelineLoading && timelineKilns.length === 0 && !timelineError ? (
            <p className="kiln-empty">
              No kiln schedule is visible yet. Confirmed firings and queued load forecasts will appear here.
            </p>
          ) : null}

          {timelineKilns.length > 0 ? (
            <>
              <div className="kiln-timeline-scroll">
                <div className="kiln-timeline-grid">
                  <div className="kiln-timeline-days" aria-hidden="true">
                    {timelineDays.map((day) => (
                      <div key={day.key} className="kiln-timeline-day">
                        <span>{day.weekday}</span>
                        <strong>{day.compact}</strong>
                      </div>
                    ))}
                  </div>

                  <div className="kiln-timeline-rows">
                    {timelineKilns.map((kiln) => (
                      <div key={kiln.id} className="kiln-timeline-row">
                        <div className="kiln-timeline-row-head">
                          <div>
                            <strong>{kiln.name}</strong>
                            <span className="kiln-timeline-row-subtitle">Read-only kiln status</span>
                          </div>
                          <span className={`kiln-timeline-pill state-${kiln.currentState}`}>
                            {kiln.currentLabel}
                          </span>
                        </div>

                        <div className="kiln-timeline-track">
                          <div className="kiln-timeline-track-grid" aria-hidden="true">
                            {timelineDays.map((day) => (
                              <span key={`${kiln.id}-${day.key}`} className="kiln-timeline-track-day" />
                            ))}
                          </div>
                          {timelineNowMarkerPercent != null ? (
                            <div
                              className="kiln-timeline-now-marker"
                              style={{ left: `${timelineNowMarkerPercent}%` }}
                              aria-hidden="true"
                            />
                          ) : null}
                          {kiln.segments.length === 0 ? (
                            <div className="kiln-timeline-idle-copy">Idle window</div>
                          ) : null}
                          {kiln.segments.map((segment) => {
                            const isSelected = selectedTimelineSegmentId === segment.id;
                            return (
                              <button
                                key={segment.id}
                                type="button"
                                className={`kiln-timeline-block state-${segment.state}${isSelected ? " active" : ""}`}
                                style={getTimelineSegmentStyle(segment)}
                                onClick={() => setSelectedTimelineSegmentId(segment.id)}
                                aria-pressed={isSelected}
                              >
                                <span className="kiln-timeline-block-label">{segment.label}</span>
                                <span className="kiln-timeline-block-meta">
                                  {TIMELINE_STATE_LABELS[segment.state]}
                                </span>
                              </button>
                            );
                          })}
                        </div>

                        {kiln.overflowNote ? (
                          <p className="kiln-timeline-overflow">{kiln.overflowNote}</p>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="kiln-timeline-detail">
                {selectedTimelineSegment ? (
                  <>
                    <div className="kiln-timeline-detail-header">
                      <div>
                        <h3>{selectedTimelineSegment.label}</h3>
                        <p className="kiln-panel-meta">
                          {selectedTimelineSegment.kilnName} · {formatTimelineRange(
                            selectedTimelineSegment.startDate,
                            selectedTimelineSegment.endDate
                          )}
                        </p>
                      </div>
                      <span
                        className={`kiln-timeline-pill state-${selectedTimelineSegment.state}`}
                      >
                        {TIMELINE_STATE_LABELS[selectedTimelineSegment.state]}
                      </span>
                    </div>
                    <div className="kiln-timeline-detail-meta">
                      <span className="kiln-tag">
                        {getTimelineSourceLabel(selectedTimelineSegment.source)}
                      </span>
                      <span className="kiln-tag">
                        {getTimelineConfidenceLabel(selectedTimelineSegment.confidence)}
                      </span>
                      <span className="kiln-tag">
                        Current kiln state: {selectedTimelineSegment.kilnCurrentLabel}
                      </span>
                    </div>
                    {selectedTimelineSegment.notes ? (
                      <p className="kiln-flow-copy">{selectedTimelineSegment.notes}</p>
                    ) : (
                      <p className="kiln-flow-copy">
                        This block is read-only on the queue page. Staff manage the actual schedule elsewhere in the portal.
                      </p>
                    )}
                  </>
                ) : (
                  <p className="kiln-flow-copy">
                    Tap a kiln block to inspect the status window, whether it is a confirmed firing or a queued-load forecast.
                  </p>
                )}
              </div>
            </>
          ) : null}
        </div>
      </section>

      <div className="kiln-launch-grid">
        <section className="kiln-launch-panel">
          <div className="kiln-panel-header">
            <div>
              <h2>Bisque queue</h2>
              <p className="kiln-panel-meta">{formatHalfShelfLabel(bisqueHalfShelves)} waiting</p>
            </div>
            <span className="kiln-panel-count">{bisqueQueue.length} check-ins</span>
          </div>
          <div className="kiln-queue-list">
            {bisqueQueue.length === 0 ? (
              <p className="kiln-empty">
                No bisque check-ins yet. That is normal between drop-off windows.
              </p>
            ) : (
              bisqueQueue.map((item) => (
                <div key={item.id} className="kiln-queue-card">
                  <div className="kiln-queue-title">
                    <strong>{getQueueTitle(item)}</strong>
                    <span>{formatHalfShelfLabel(item.halfShelves)}</span>
                  </div>
                  <div className="kiln-queue-meta">
                    <span>{getQueueMeta(item)}</span>
                  </div>
                  {item.dropOffProfile?.specialHandling ? (
                    <div className="kiln-queue-tags">
                      <span className="kiln-tag">Special handling</span>
                    </div>
                  ) : null}
                  {item.addOns?.rushRequested || item.addOns?.wholeKilnRequested ? (
                    <div className="kiln-queue-tags">
                      {item.addOns?.rushRequested ? <span className="kiln-tag">Rush</span> : null}
                      {item.addOns?.wholeKilnRequested ? (
                        <span className="kiln-tag">Whole kiln</span>
                      ) : null}
                    </div>
                  ) : null}
                  {canManageLoad ? (
                    <div className="kiln-queue-actions">
                      <button
                        className="kiln-action primary"
                        onClick={toVoidHandler(() => handleLoadStatusUpdate(item.id, "loading"))}
                        disabled={actionBusyId === item.id}
                      >
                        Start loading
                      </button>
                      <button
                        className="kiln-action ghost"
                        onClick={toVoidHandler(() => handleLoadStatusUpdate(item.id, "loaded"))}
                        disabled={actionBusyId === item.id}
                      >
                        Mark loaded
                      </button>
                    </div>
                  ) : null}
                </div>
              ))
            )}
          </div>
          <div className="kiln-community-chiplet">
            <div className="kiln-panel-header">
              <div>
                <h3>Community shelf lane</h3>
                <p className="kiln-panel-meta">
                  {communityShelfEntries.length} check-ins · {formatHalfShelfLabel(communityHalfShelves)}
                </p>
              </div>
            </div>
            {communityShelfEntries.length === 0 ? (
              <p className="kiln-empty">
                No community shelf check-ins are waiting right now.
              </p>
            ) : (
              <div className="kiln-queue-tags kiln-community-chip-list">
                {communityShelfEntries.slice(0, 8).map((item) => (
                  <span key={item.id} className="kiln-tag kiln-tag-community">
                    {getQueueTitle(item)} · {formatHalfShelfLabel(item.halfShelves)}
                  </span>
                ))}
              </div>
            )}
            <p className="kiln-panel-meta">
              Community shelf work stays lowest-priority and only moves into a firing when donated shelf space opens.
            </p>
          </div>
        </section>

        <section className="kiln-launch-center">
          <div className="kiln-launch-panel kiln-flow-panel">
            <div className="kiln-panel-header">
              <div>
                <h2>Your place in the flow</h2>
                <p className="kiln-panel-meta">
                  {userEntries.length === 0
                    ? "No check-ins yet"
                    : `${userEntries.length} check-in${userEntries.length === 1 ? "" : "s"} in motion`}
                </p>
              </div>
            </div>
            <p className="kiln-flow-copy">{userFlowCopy}</p>
          </div>

          <div className="kiln-launch-panel kiln-meter-panel">
            <div className="kiln-panel-header">
              <div>
                <h2>Studio kiln load</h2>
                <p className="kiln-panel-meta">
                  {formatHalfShelfLabel(plannedHalfShelves)} in the plan
                </p>
              </div>
              <span className={`kiln-ready ${plannedHalfShelves > 0 ? "active" : ""}`}>
                {loadStateLabel}
              </span>
            </div>

            <div className="kiln-meter">
              <div className="kiln-progress-label">Firing progress</div>
              <div className="kiln-graphic" aria-hidden="true">
                <div className="kiln-ring">
                  <div className="kiln-ring-inner">
                    <div className="kiln-slots">
                      {loadSlots.map((slot, index) => (
                        <div
                          key={`slot-${index}`}
                          className={`kiln-slot status-${slot}`}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              </div>
              <div className="kiln-progress-copy">{firingProgressCopy}</div>
              <div className="kiln-meter-label">
                {plannedHalfShelves} / {KILN_CAPACITY_HALF_SHELVES} half shelves planned
              </div>
              <div className="kiln-progress-note">
                Fuller kilns tend to fire sooner, but timing always depends on the load.
              </div>
              <div className="kiln-progress-moment">
                Firing is a shared process; each piece helps build the next load.
              </div>
              <div className="kiln-legend">
                <div className="kiln-legend-item">
                  <span className="kiln-legend-dot status-queued" />
                  Awaiting load
                </div>
                <div className="kiln-legend-item">
                  <span className="kiln-legend-dot status-loading" />
                  Loading
                </div>
                <div className="kiln-legend-item">
                  <span className="kiln-legend-dot status-loaded" />
                  Confirmed loaded
                </div>
              </div>
            </div>

            <div className="kiln-meter-footer">
              <div>
                <span className="kiln-metric-label">In kiln</span>
                <strong>{loadedHalfShelves}</strong>
              </div>
              <div>
                <span className="kiln-metric-label">Loading</span>
                <strong>{loadingHalfShelves}</strong>
              </div>
              <div>
                <span className="kiln-metric-label">Waiting</span>
                <strong>{queuedHalfShelves}</strong>
              </div>
            </div>
          </div>

          <div className="kiln-launch-panel">
            <div className="kiln-panel-header">
              <div>
                <h2>Load activity</h2>
                <p className="kiln-panel-meta">
                  {hasLoadActivity
                    ? loadStatusSummary
                    : "Live loading updates will appear here when staff start placing shelves."}
                </p>
              </div>
            </div>
            <div className="kiln-queue-list">
              {!hasLoadActivity ? (
                <p className="kiln-empty">{loadStatusSummary}</p>
              ) : (
                [...loadingEntries, ...loadedEntries].map((item) => (
                  <div key={item.id} className="kiln-queue-card">
                    <div className="kiln-queue-title">
                      <strong>{getQueueTitle(item)}</strong>
                      <span>{formatHalfShelfLabel(item.halfShelves)}</span>
                    </div>
                    <div className="kiln-queue-meta">
                      <span>{getQueueMeta(item)}</span>
                      <span className={`kiln-status-pill status-${item.loadStatus}`}>
                        {LOAD_STATUS_LABELS[item.loadStatus]}
                      </span>
                    </div>
                    {canManageLoad ? (
                      <div className="kiln-queue-actions">
                        {item.loadStatus === "loading" ? (
                          <button
                            className="kiln-action primary"
                            onClick={toVoidHandler(() => handleLoadStatusUpdate(item.id, "loaded"))}
                            disabled={actionBusyId === item.id}
                          >
                            Confirm loaded
                          </button>
                        ) : null}
                        <button
                          className="kiln-action ghost"
                          onClick={toVoidHandler(() => handleLoadStatusUpdate(item.id, "queued"))}
                          disabled={actionBusyId === item.id}
                        >
                          Return to queue
                        </button>
                      </div>
                    ) : null}
                  </div>
                ))
              )}
            </div>
          </div>
        </section>

        <section className="kiln-launch-panel">
          <div className="kiln-panel-header">
            <div>
              <h2>Glaze queue</h2>
              <p className="kiln-panel-meta">{formatHalfShelfLabel(glazeHalfShelves)} waiting</p>
            </div>
            <span className="kiln-panel-count">{glazeQueue.length} check-ins</span>
          </div>
          <div className="kiln-queue-list">
            {glazeQueue.length === 0 ? (
              <p className="kiln-empty">
                No glaze check-ins yet. Once glazed work arrives, this lane starts filling.
              </p>
            ) : (
              glazeQueue.map((item) => (
                <div key={item.id} className="kiln-queue-card">
                  <div className="kiln-queue-title">
                    <strong>{getQueueTitle(item)}</strong>
                    <span>{formatHalfShelfLabel(item.halfShelves)}</span>
                  </div>
                  <div className="kiln-queue-meta">
                    <span>{getQueueMeta(item)}</span>
                  </div>
                  {item.dropOffProfile?.specialHandling ? (
                    <div className="kiln-queue-tags">
                      <span className="kiln-tag">Special handling</span>
                    </div>
                  ) : null}
                  {item.addOns?.rushRequested || item.addOns?.wholeKilnRequested ? (
                    <div className="kiln-queue-tags">
                      {item.addOns?.rushRequested ? <span className="kiln-tag">Rush</span> : null}
                      {item.addOns?.wholeKilnRequested ? (
                        <span className="kiln-tag">Whole kiln</span>
                      ) : null}
                    </div>
                  ) : null}
                  {canManageLoad ? (
                    <div className="kiln-queue-actions">
                      <button
                        className="kiln-action primary"
                        onClick={toVoidHandler(() => handleLoadStatusUpdate(item.id, "loading"))}
                        disabled={actionBusyId === item.id}
                      >
                        Start loading
                      </button>
                      <button
                        className="kiln-action ghost"
                        onClick={toVoidHandler(() => handleLoadStatusUpdate(item.id, "loaded"))}
                        disabled={actionBusyId === item.id}
                      >
                        Mark loaded
                      </button>
                    </div>
                  ) : null}
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
