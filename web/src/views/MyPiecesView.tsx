import React, { useEffect, useMemo, useState } from "react";
import type { User } from "firebase/auth";
import { collection, getDocs, orderBy, query } from "firebase/firestore";
import { db } from "../firebase";
import { useBatches } from "../hooks/useBatches";
import { createPortalApi, PortalApiError } from "../api/portalApi";
import type { PortalApiMeta } from "../api/portalContracts";
import { getResultBatchId } from "../api/portalContracts";
import type { TimelineEvent } from "../types/domain";
import { TIMELINE_EVENT_LABELS, normalizeTimelineEventType } from "../timelineEventTypes";
import { formatCents, formatMaybeTimestamp } from "../utils/format";

const PIECES_PREVIEW_COUNT = 10;

type Props = {
  user: User;
  adminToken: string;
};

function getTimelineLabel(type: unknown): string {
  const normalized = normalizeTimelineEventType(type);
  if (normalized) return TIMELINE_EVENT_LABELS[normalized];
  if (typeof type === "string" && type.trim()) return type;
  return "Event";
}

export default function MyPiecesView({ user, adminToken }: Props) {
  const { active, history, error } = useBatches(user);
  const canContinue = active.length === 0;
  const [status, setStatus] = useState("");
  const [meta, setMeta] = useState<PortalApiMeta | null>(null);
  const [inFlight, setInFlight] = useState<Record<string, boolean>>({});
  const portalApi = useMemo(() => createPortalApi(), []);

  const isBusy = (key: string) => !!inFlight[key];
  const setBusy = (key: string, value: boolean) => {
    setInFlight((prev) => ({ ...prev, [key]: value }));
  };
  const [showAllActive, setShowAllActive] = useState(false);
  const [showAllHistory, setShowAllHistory] = useState(false);
  const [timelineBatchId, setTimelineBatchId] = useState<string | null>(null);
  const [timelineEvents, setTimelineEvents] = useState<TimelineEvent[]>([]);
  const [timelineLoading, setTimelineLoading] = useState(false);
  const [timelineError, setTimelineError] = useState("");
  const [piecesFilter, setPiecesFilter] = useState<"all" | "active" | "history">("all");

  const visibleActive = showAllActive ? active : active.slice(0, PIECES_PREVIEW_COUNT);
  const visibleHistory = showAllHistory ? history : history.slice(0, PIECES_PREVIEW_COUNT);

  const showActiveSection = piecesFilter === "all" || piecesFilter === "active";
  const showHistorySection = piecesFilter === "all" || piecesFilter === "history";

  useEffect(() => {
    if (!timelineBatchId) return;

    setTimelineLoading(true);
    setTimelineError("");
    setTimelineEvents([]);

    const loadTimeline = async () => {
      try {
        const timelineQuery = query(
          collection(db, "batches", timelineBatchId, "timeline"),
          orderBy("at", "asc")
        );
        const snap = await getDocs(timelineQuery);
        const rows: TimelineEvent[] = snap.docs.map((docSnap) => ({
          id: docSnap.id,
          ...(docSnap.data() as any),
        }));
        setTimelineEvents(rows);
      } catch (err: any) {
        setTimelineError(`Timeline failed: ${err.message || String(err)}`);
      } finally {
        setTimelineLoading(false);
      }
    };

    void loadTimeline();
  }, [timelineBatchId]);

  function toggleTimeline(batchId: string) {
    setTimelineBatchId((prev) => (prev === batchId ? null : batchId));
  }

  async function handleContinueJourney(batchId: string) {
    if (!batchId) return;
    const busyKey = `continue:${batchId}`;
    if (isBusy(busyKey)) return;

    setBusy(busyKey, true);
    setStatus("Continuing journey...");
    setMeta(null);

    try {
      const idToken = await user.getIdToken();
      const trimmedAdminToken = adminToken.trim();
      const response = await portalApi.continueJourney({
        idToken,
        adminToken: trimmedAdminToken ? trimmedAdminToken : undefined,
        payload: { uid: user.uid, fromBatchId: batchId },
      });
      setMeta(response.meta);
      const newId = getResultBatchId(response.data);
      setStatus(newId ? `Journey continued. New batch id: ${newId}` : "Journey continued.");
    } catch (err: any) {
      if (err instanceof PortalApiError) {
        setMeta(err.meta);
        setStatus(`Continue journey failed: ${err.message}`);
      } else {
        setStatus(`Continue journey failed: ${err?.message || String(err)}`);
      }
    } finally {
      setBusy(busyKey, false);
    }
  }

  async function handleArchive(batchId: string) {
    if (!batchId) return;
    const busyKey = `archive:${batchId}`;
    if (isBusy(busyKey)) return;

    setBusy(busyKey, true);
    setStatus("Archiving piece...");
    setMeta(null);

    try {
      const idToken = await user.getIdToken();
      const trimmedAdminToken = adminToken.trim();
      const response = await portalApi.pickedUpAndClose({
        idToken,
        adminToken: trimmedAdminToken ? trimmedAdminToken : undefined,
        payload: { uid: user.uid, batchId },
      });
      setMeta(response.meta);
      setStatus("Piece archived.");
    } catch (err: any) {
      if (err instanceof PortalApiError) {
        setMeta(err.meta);
        setStatus(`Archive failed: ${err.message}`);
      } else {
        setStatus(`Archive failed: ${err?.message || String(err)}`);
      }
    } finally {
      setBusy(busyKey, false);
    }
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1>My Pieces</h1>
        <p className="page-subtitle">
          Live studio tracking for your wares. Updates appear as the team moves your pieces through the kiln.
        </p>
      </div>

      {status ? <div className="status-line">{status}</div> : null}
      {error ? <div className="card card-3d alert">{error}</div> : null}

      {!canContinue && history.length > 0 ? (
        <div className="card card-3d alert">
          Continue journey is available once all active pieces are closed.
        </div>
      ) : null}

      <div className="filter-chips">
        <button
          className={`chip ${piecesFilter === "all" ? "active" : ""}`}
          onClick={() => setPiecesFilter("all")}
        >
          All ({active.length + history.length})
        </button>
        <button
          className={`chip ${piecesFilter === "active" ? "active" : ""}`}
          onClick={() => setPiecesFilter("active")}
        >
          In progress ({active.length})
        </button>
        <button
          className={`chip ${piecesFilter === "history" ? "active" : ""}`}
          onClick={() => setPiecesFilter("history")}
        >
          Completed ({history.length})
        </button>
      </div>

      <div className="pieces-grid">
        {showActiveSection ? (
          <div className="card card-3d">
            <div className="card-title">In progress</div>
            {active.length === 0 ? (
              <div className="empty-state">No active pieces yet.</div>
            ) : (
              <div className="pieces-list">
                {visibleActive.map((batch) => (
                  <div className="piece-row" key={batch.id}>
                    <div>
                      <div className="piece-title-row">
                        <div className="piece-title">{batch.title || "Untitled piece"}</div>
                        {batch.status ? <div className="pill piece-status">{batch.status}</div> : null}
                      </div>
                      <div className="piece-meta">ID: {batch.id}</div>
                    </div>
                    <div className="piece-right">
                      <div className="piece-meta">Updated: {formatMaybeTimestamp(batch.updatedAt)}</div>
                      <div className="piece-meta">
                        Est. cost: {formatCents(batch.estimatedCostCents ?? batch.priceCents)}
                      </div>
                      <div className="piece-actions">
                        <button className="btn btn-ghost" onClick={() => toggleTimeline(batch.id)}>
                          {timelineBatchId === batch.id ? "Hide timeline" : "View timeline"}
                        </button>
                        <button
                          className="btn btn-ghost"
                          onClick={() => handleArchive(batch.id)}
                          disabled={isBusy(`archive:${batch.id}`)}
                        >
                          {isBusy(`archive:${batch.id}`) ? "Archiving..." : "Archive"}
                        </button>
                      </div>
                    </div>
                    {timelineBatchId === batch.id ? (
                      <div className="timeline-inline">
                        {timelineLoading ? (
                          <div className="empty-state">Loading timeline...</div>
                        ) : timelineError ? (
                          <div className="alert inline-alert">{timelineError}</div>
                        ) : timelineEvents.length === 0 ? (
                          <div className="empty-state">No timeline events yet.</div>
                        ) : (
                          <div className="timeline-list">
                            {timelineEvents.map((ev) => (
                              <div className="timeline-row" key={ev.id}>
                                <div className="timeline-at">{formatMaybeTimestamp(ev.at)}</div>
                                <div>
                                  <div className="timeline-title">{getTimelineLabel(ev.type)}</div>
                                  <div className="timeline-meta">
                                    {ev.actorName ? `by ${ev.actorName}` : ""}
                                    {ev.kilnName ? `  kiln: ${ev.kilnName}` : ""}
                                  </div>
                                  {ev.notes ? <div className="timeline-notes">{ev.notes}</div> : null}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ) : null}
                  </div>
                ))}
                {active.length > PIECES_PREVIEW_COUNT ? (
                  <button
                    className="btn btn-ghost show-more"
                    onClick={() => setShowAllActive((prev) => !prev)}
                  >
                    {showAllActive ? "Show fewer" : `Show more (${active.length - PIECES_PREVIEW_COUNT})`}
                  </button>
                ) : null}
              </div>
            )}
          </div>
        ) : null}

        {showHistorySection ? (
          <div className="card card-3d">
            <div className="card-title">Completed</div>
            {history.length === 0 ? (
              <div className="empty-state">No completed pieces yet.</div>
            ) : (
              <div className="pieces-list">
                {visibleHistory.map((batch) => (
                  <div className="piece-row" key={batch.id}>
                    <div>
                      <div className="piece-title-row">
                        <div className="piece-title">{batch.title || "Untitled piece"}</div>
                        <div className="pill piece-status">Complete</div>
                      </div>
                      <div className="piece-meta">ID: {batch.id}</div>
                      <div className="piece-meta">Closed: {formatMaybeTimestamp(batch.closedAt)}</div>
                    </div>
                    <div className="piece-right">
                      <div className="piece-meta">Updated: {formatMaybeTimestamp(batch.updatedAt)}</div>
                      <div className="piece-meta">
                        Final cost: {formatCents(batch.priceCents ?? batch.estimatedCostCents)}
                      </div>
                      <div className="piece-actions">
                        <button className="btn btn-ghost" onClick={() => toggleTimeline(batch.id)}>
                          {timelineBatchId === batch.id ? "Hide timeline" : "View timeline"}
                        </button>
                        <button
                          className="btn btn-ghost"
                          onClick={() => handleContinueJourney(batch.id)}
                          disabled={!canContinue || isBusy(`continue:${batch.id}`)}
                        >
                          {isBusy(`continue:${batch.id}`) ? "Continuing..." : "Continue journey"}
                        </button>
                      </div>
                    </div>
                    {timelineBatchId === batch.id ? (
                      <div className="timeline-inline">
                        {timelineLoading ? (
                          <div className="empty-state">Loading timeline...</div>
                        ) : timelineError ? (
                          <div className="alert inline-alert">{timelineError}</div>
                        ) : timelineEvents.length === 0 ? (
                          <div className="empty-state">No timeline events yet.</div>
                        ) : (
                          <div className="timeline-list">
                            {timelineEvents.map((ev) => (
                              <div className="timeline-row" key={ev.id}>
                                <div className="timeline-at">{formatMaybeTimestamp(ev.at)}</div>
                                <div>
                                  <div className="timeline-title">{getTimelineLabel(ev.type)}</div>
                                  <div className="timeline-meta">
                                    {ev.actorName ? `by ${ev.actorName}` : ""}
                                    {ev.kilnName ? `  kiln: ${ev.kilnName}` : ""}
                                  </div>
                                  {ev.notes ? <div className="timeline-notes">{ev.notes}</div> : null}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ) : null}
                  </div>
                ))}
                {history.length > PIECES_PREVIEW_COUNT ? (
                  <button
                    className="btn btn-ghost show-more"
                    onClick={() => setShowAllHistory((prev) => !prev)}
                  >
                    {showAllHistory ? "Show fewer" : `Show more (${history.length - PIECES_PREVIEW_COUNT})`}
                  </button>
                ) : null}
              </div>
            )}
          </div>
        ) : null}
      </div>

      {meta ? (
        <details className="card card-3d troubleshooting">
          <summary>Request details</summary>
          <div className="troubleshooting-grid">
            <div className="troubleshooting-block">
              <div className="troubleshooting-label">Status</div>
              <div className="troubleshooting-value">
                {meta.ok ? "OK" : "Error"} · {meta.status ?? "No status"}
              </div>
            </div>
            <div className="troubleshooting-block">
              <div className="troubleshooting-label">Endpoint</div>
              <div className="troubleshooting-value">
                {meta.fn} · {meta.url}
              </div>
            </div>
          </div>
          <div className="troubleshooting-block">
            <div className="troubleshooting-label">Curl (copy/paste)</div>
            <pre className="mono">{meta.curlExample || "Unavailable"}</pre>
          </div>
          <div className="troubleshooting-block">
            <div className="troubleshooting-label">Request payload</div>
            <pre className="mono">{JSON.stringify(meta.payload ?? {}, null, 2)}</pre>
          </div>
          <div className="troubleshooting-block">
            <div className="troubleshooting-label">Response body</div>
            <pre className="mono">{JSON.stringify(meta.response ?? {}, null, 2)}</pre>
          </div>
          <div className="troubleshooting-block">
            <div className="troubleshooting-label">Raw meta</div>
            <pre className="mono">{JSON.stringify(meta, null, 2)}</pre>
          </div>
        </details>
      ) : null}
    </div>
  );
}
