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
import { normalizeIntakeMode } from "../lib/intakeMode";
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
  if (plannedHalfShelves <= 0) return "Waiting for the first pieces to arrive.";
  if (plannedHalfShelves <= 3) return "The kiln is waking up.";
  if (plannedHalfShelves <= 6) return "This firing is taking shape.";
  return "Almost ready to fire.";
}

function buildLoadStatusSummary(loadingCount: number, loadedCount: number) {
  if (loadingCount + loadedCount === 0) {
    return "No pieces are being loaded yet. Staff will confirm the load once firing prep begins.";
  }
  if (loadedCount > 0) {
    return `Staff are confirming the load. ${loadedCount} check-in${
      loadedCount === 1 ? "" : "s"
    } already in the kiln.`;
  }
  return `Staff are loading pieces and planning the final layout. ${loadingCount} check-in${
    loadingCount === 1 ? "" : "s"
  } in progress.`;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export default function KilnLaunchView({ user, isStaff }: KilnLaunchViewProps) {
  const [reservations, setReservations] = useState<ReservationQueueItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [actionBusyId, setActionBusyId] = useState<string | null>(null);
  const [actionStatus, setActionStatus] = useState("");
  const portalApi = useMemo(() => createPortalApi(), []);

  const loadReservations = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const baseRef = collection(db, "reservations");
      const reservationsQuery = isStaff
        ? query(baseRef, orderBy("createdAt", "desc"), limit(250))
        : query(baseRef, where("ownerUid", "==", user.uid), orderBy("createdAt", "desc"), limit(200));
      const snap = await getDocs(reservationsQuery);
      const rows: ReservationQueueItem[] = snap.docs.map((docSnap) => {
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
      });
      setReservations(rows);
      setLastUpdated(new Date());
    } catch (error: unknown) {
      setError(`Queue load failed: ${getErrorMessage(error)}`);
    } finally {
      setLoading(false);
    }
  }, [isStaff, user.uid]);

  useEffect(() => {
    void loadReservations();
  }, [loadReservations]);

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
      return "No check-ins yet. Start a check-in when you are ready to join the line for the next firing.";
    }
    const shelfLabel = formatHalfShelfLabel(userHalfShelves);
    if (userLoadedCount > 0) {
      return `You have ${shelfLabel} in this plan. Some of your work is confirmed in the kiln; we will review placement together at drop-off.`;
    }
    if (userLoadingCount > 0) {
      return `You have ${shelfLabel} in this plan. Staff are loading your work now and confirm placement with you.`;
    }
    if (userQueuedCount > 0) {
      return `You have ${shelfLabel} in line. Your work is awaiting load while we build the next firing plan.`;
    }
    return "Your check-ins are in line. We will confirm placement together at drop-off.";
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

  const handleLoadStatusUpdate = async (reservationId: string, nextStatus: LoadStatus) => {
    if (!isStaff || actionBusyId) return;
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
      await loadReservations();
    } catch (error: unknown) {
      setActionStatus(`Update failed: ${getErrorMessage(error)}`);
    } finally {
      setActionBusyId(null);
    }
  };

  return (
    <div className="kiln-launch-page">
      <header className="kiln-launch-header">
        <div>
          <p className="kiln-launch-kicker">Kiln queues</p>
          <h1 className="kiln-launch-title">The next firing is coming together</h1>
          <p className="kiln-launch-subtitle">
            Work is lining up, the load is taking shape, and the kiln plan keeps moving forward.
          </p>
          <p className="kiln-launch-meaning">
            What this means for you: as queues fill, staff plan the next firing and confirm what
            fits, and your check-ins help shape that plan.
          </p>
          {lastUpdated ? (
            <p className="kiln-launch-updated">Last updated {lastUpdated.toLocaleTimeString()}</p>
          ) : null}
        </div>
        <div className="kiln-launch-actions">
          <button className="btn btn-ghost" onClick={toVoidHandler(loadReservations)} disabled={loading}>
            {loading ? "Refreshing..." : "Refresh"}
          </button>
        </div>
      </header>

      {error ? <div className="kiln-launch-error">{error}</div> : null}
      {actionStatus ? <div className="kiln-launch-status">{actionStatus}</div> : null}
      {communityShelfEntries.length > 0 ? (
        <div className="kiln-launch-status">
          Community shelf check-ins: {communityShelfEntries.length} (tracked separately; excluded from firing thresholds).
        </div>
      ) : null}

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
                No bisque check-ins yet. This is normal between drop-offs; the queue wakes up with
                the first pieces.
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
                  {isStaff ? (
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
                <h2>What&apos;s happening now</h2>
                <p className="kiln-panel-meta">
                  {hasLoadActivity
                    ? loadStatusSummary
                    : "Staff updates will appear here as the load begins."}
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
                    {isStaff ? (
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
                No glaze check-ins yet. Planning starts once the first glazed pieces arrive, so
                nothing is wrong.
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
                  {isStaff ? (
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
