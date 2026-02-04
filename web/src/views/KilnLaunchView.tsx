import {
  collection,
  doc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import type { User } from "firebase/auth";
import { useCallback, useEffect, useMemo, useState } from "react";
import { db } from "../firebase";
import "./KilnLaunchView.css";

type LoadStatus = "queued" | "loading" | "loaded";

type ReservationQueueItem = {
  id: string;
  ownerUid: string;
  firingType?: string | null;
  shelfEquivalent?: number | null;
  footprintHalfShelves?: number | null;
  heightInches?: number | null;
  tiers?: number | null;
  estimatedHalfShelves?: number | null;
  useVolumePricing?: boolean;
  volumeIn3?: number | null;
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
  if (item.useVolumePricing && item.volumeIn3) {
    parts.push(`${item.volumeIn3} in^3`);
  } else if (item.dropOffQuantity?.pieceRange) {
    parts.push(item.dropOffQuantity.pieceRange);
  }
  parts.push(item.firingBucket === "glaze" ? "Glaze" : "Bisque");
  return parts.join(" · ") || "Member check-in";
}

function isCancelled(status: string | null | undefined) {
  return typeof status === "string" && status.toUpperCase() === "CANCELLED";
}

export default function KilnLaunchView({ user, isStaff }: KilnLaunchViewProps) {
  const [reservations, setReservations] = useState<ReservationQueueItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [actionBusyId, setActionBusyId] = useState<string | null>(null);
  const [actionStatus, setActionStatus] = useState("");

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
          firingType: data.firingType ?? null,
          shelfEquivalent: typeof data.shelfEquivalent === "number" ? data.shelfEquivalent : null,
          footprintHalfShelves:
            typeof data.footprintHalfShelves === "number" ? data.footprintHalfShelves : null,
          heightInches: typeof data.heightInches === "number" ? data.heightInches : null,
          tiers: typeof data.tiers === "number" ? data.tiers : null,
          estimatedHalfShelves:
            typeof data.estimatedHalfShelves === "number" ? data.estimatedHalfShelves : null,
          useVolumePricing: data.useVolumePricing === true,
          volumeIn3: typeof data.volumeIn3 === "number" ? data.volumeIn3 : null,
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
    } catch (err: any) {
      setError(`Queue load failed: ${err?.message || String(err)}`);
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
        loadStatus: normalizeLoadStatus(item.loadStatus),
        halfShelves:
          item.estimatedHalfShelves != null
            ? normalizeHalfShelves(item.estimatedHalfShelves, true)
            : normalizeHalfShelves(item.shelfEquivalent),
        firingBucket: isGlazeFiring(item.firingType) ? "glaze" : "bisque",
      })),
    [activeReservations]
  );

  const queuedEntries = useMemo(
    () => queueEntries.filter((item) => item.loadStatus === "queued"),
    [queueEntries]
  );
  const loadingEntries = useMemo(
    () => queueEntries.filter((item) => item.loadStatus === "loading"),
    [queueEntries]
  );
  const loadedEntries = useMemo(
    () => queueEntries.filter((item) => item.loadStatus === "loaded"),
    [queueEntries]
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

  const loadStateLabel =
    loadedHalfShelves >= KILN_CAPACITY_HALF_SHELVES
      ? "Ready to fire"
      : loadingHalfShelves > 0
      ? "Loading"
      : queuedHalfShelves > 0
      ? "Awaiting load"
      : "Idle";

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
      await updateDoc(doc(db, "reservations", reservationId), {
        loadStatus: nextStatus,
        updatedAt: serverTimestamp(),
      });
      setActionStatus("Load status updated.");
      await loadReservations();
    } catch (err: any) {
      setActionStatus(`Update failed: ${err?.message || String(err)}`);
    } finally {
      setActionBusyId(null);
    }
  };

  return (
    <div className="kiln-launch-page">
      <header className="kiln-launch-header">
        <div>
          <p className="kiln-launch-kicker">View the Queues</p>
          <h1 className="kiln-launch-title">View the Queues</h1>
          <p className="kiln-launch-subtitle">
            The studio kiln holds {KILN_CAPACITY_HALF_SHELVES} half shelves. Queued work
            fills the planned load, and staff confirm what’s actually in the kiln.
          </p>
          {lastUpdated ? (
            <p className="kiln-launch-updated">Last updated {lastUpdated.toLocaleTimeString()}</p>
          ) : null}
        </div>
        <div className="kiln-launch-actions">
          <button className="btn btn-ghost" onClick={loadReservations} disabled={loading}>
            {loading ? "Refreshing..." : "Refresh"}
          </button>
        </div>
      </header>

      {error ? <div className="kiln-launch-error">{error}</div> : null}
      {actionStatus ? <div className="kiln-launch-status">{actionStatus}</div> : null}

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
              <p className="kiln-empty">No bisque requests yet.</p>
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
                        onClick={() => handleLoadStatusUpdate(item.id, "loading")}
                        disabled={actionBusyId === item.id}
                      >
                        Start loading
                      </button>
                      <button
                        className="kiln-action ghost"
                        onClick={() => handleLoadStatusUpdate(item.id, "loaded")}
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
              <div className="kiln-meter-label">
                {plannedHalfShelves} / {KILN_CAPACITY_HALF_SHELVES} half shelves planned
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
                <h2>Load status</h2>
                <p className="kiln-panel-meta">
                  {loadingEntries.length + loadedEntries.length} check-ins in progress
                </p>
              </div>
            </div>
            <div className="kiln-queue-list">
              {loadingEntries.length + loadedEntries.length === 0 ? (
                <p className="kiln-empty">No loads in progress yet.</p>
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
                            onClick={() => handleLoadStatusUpdate(item.id, "loaded")}
                            disabled={actionBusyId === item.id}
                          >
                            Confirm loaded
                          </button>
                        ) : null}
                        <button
                          className="kiln-action ghost"
                          onClick={() => handleLoadStatusUpdate(item.id, "queued")}
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
              <p className="kiln-empty">No glaze requests yet.</p>
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
                        onClick={() => handleLoadStatusUpdate(item.id, "loading")}
                        disabled={actionBusyId === item.id}
                      >
                        Start loading
                      </button>
                      <button
                        className="kiln-action ghost"
                        onClick={() => handleLoadStatusUpdate(item.id, "loaded")}
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
