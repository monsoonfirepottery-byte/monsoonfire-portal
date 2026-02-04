import {
  addDoc,
  collection,
  doc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import type { User } from "firebase/auth";
import { useCallback, useEffect, useMemo, useState } from "react";
import { db } from "../firebase";
import kilnIsoImage from "../assets/kiln-isometric.png";
import "./KilnLaunchView.css";


type KilnLaunchRequest = {
  id: string;
  uid: string;
  userDisplayName: string | null;
  halfShelves: number;
  clayBody: string;
  notes: string | null;
  urgency: "asap" | "next";
  status: "queued" | "loaded" | "fired" | "complete" | "cancelled";
  kilnId?: string | null;
  createdAt?: unknown;
};

type KilnLaunchViewProps = {
  user: User;
  isStaff: boolean;
};

const LAUNCH_TARGET_HALF_SHELVES = 4;
const KILN_ID = "main";

function normalizeHalfShelves(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function formatHalfShelfLabel(value: number) {
  const rounded = Number.isFinite(value) ? Math.round(value) : 0;
  return `${rounded} half shelf${rounded === 1 ? "" : "es"}`;
}

export default function KilnLaunchView({ user, isStaff }: KilnLaunchViewProps) {
  const [requests, setRequests] = useState<KilnLaunchRequest[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [submitBusy, setSubmitBusy] = useState(false);
  const [submitStatus, setSubmitStatus] = useState("");
  const [actionBusyId, setActionBusyId] = useState<string | null>(null);
  const [actionStatus, setActionStatus] = useState("");
  const [halfShelves, setHalfShelves] = useState(1);
  const [clayBody, setClayBody] = useState("");
  const [notes, setNotes] = useState("");
  const [urgency, setUrgency] = useState<"asap" | "next">("next");

  const loadRequests = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const requestsQuery = query(
        collection(db, "kilnLaunchRequests"),
        orderBy("createdAt", "desc"),
        limit(200)
      );
      const snap = await getDocs(requestsQuery);
      const rows: KilnLaunchRequest[] = snap.docs.map((docSnap) => {
        const data = docSnap.data() as Partial<KilnLaunchRequest>;
        return {
          id: docSnap.id,
          uid: data.uid ?? "",
          userDisplayName: data.userDisplayName ?? null,
          halfShelves: normalizeHalfShelves(data.halfShelves),
          clayBody: data.clayBody ?? "",
          notes: data.notes ?? null,
          urgency: data.urgency ?? "next",
          status: data.status ?? "queued",
          kilnId: data.kilnId ?? null,
          createdAt: data.createdAt,
        };
      });
      setRequests(rows);
      setLastUpdated(new Date());
    } catch (err: any) {
      setError(`Kiln launch queue failed: ${err?.message || String(err)}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadRequests();
  }, [loadRequests]);

  const scopedRequests = useMemo(
    () => requests.filter((item) => (item.kilnId ?? KILN_ID) === KILN_ID),
    [requests]
  );

  const activeRequests = useMemo(
    () => scopedRequests.filter((item) => item.status !== "cancelled" && item.status !== "complete"),
    [scopedRequests]
  );

  const queuedRequests = useMemo(
    () => activeRequests.filter((item) => item.status === "queued"),
    [activeRequests]
  );

  const loadedRequests = useMemo(
    () => activeRequests.filter((item) => item.status === "loaded"),
    [activeRequests]
  );

  const firedRequests = useMemo(
    () => activeRequests.filter((item) => item.status === "fired"),
    [activeRequests]
  );

  const asapRequests = useMemo(
    () => queuedRequests.filter((item) => item.urgency === "asap"),
    [queuedRequests]
  );
  const nextRequests = useMemo(
    () => queuedRequests.filter((item) => item.urgency === "next"),
    [queuedRequests]
  );

  const queuedHalfShelves = useMemo(
    () => queuedRequests.reduce((sum, item) => sum + normalizeHalfShelves(item.halfShelves), 0),
    [queuedRequests]
  );
  const loadedHalfShelves = useMemo(
    () => loadedRequests.reduce((sum, item) => sum + normalizeHalfShelves(item.halfShelves), 0),
    [loadedRequests]
  );
  const asapHalfShelves = useMemo(
    () => asapRequests.reduce((sum, item) => sum + normalizeHalfShelves(item.halfShelves), 0),
    [asapRequests]
  );
  const nextHalfShelves = useMemo(
    () => nextRequests.reduce((sum, item) => sum + normalizeHalfShelves(item.halfShelves), 0),
    [nextRequests]
  );

  const readyLaunches = Math.floor(loadedHalfShelves / LAUNCH_TARGET_HALF_SHELVES);
  const currentLoad = loadedHalfShelves % LAUNCH_TARGET_HALF_SHELVES;
  const visualLoad =
    loadedHalfShelves > 0 && currentLoad === 0 ? LAUNCH_TARGET_HALF_SHELVES : currentLoad;
  const filledSlots = Math.min(visualLoad, LAUNCH_TARGET_HALF_SHELVES);
  const loadStateLabel =
    loadedHalfShelves === 0
      ? "Awaiting pieces"
      : currentLoad === 0
      ? "Ready to launch"
      : "Loading";

  const handleSubmit = async () => {
    if (submitBusy) return;
    const trimmedClay = clayBody.trim();
    if (!trimmedClay) {
      setSubmitStatus("Please include the clay body.");
      return;
    }
    const parsedHalfShelves = Math.round(Number(halfShelves));
    if (!Number.isFinite(parsedHalfShelves) || parsedHalfShelves < 1 || parsedHalfShelves > LAUNCH_TARGET_HALF_SHELVES) {
      setSubmitStatus(`Half shelves must be between 1 and ${LAUNCH_TARGET_HALF_SHELVES}.`);
      return;
    }
    const trimmedNotes = notes.trim();

    setSubmitBusy(true);
    setSubmitStatus("");
    try {
      await addDoc(collection(db, "kilnLaunchRequests"), {
        uid: user.uid,
        userDisplayName: user.displayName || null,
        halfShelves: parsedHalfShelves,
        clayBody: trimmedClay,
        notes: trimmedNotes ? trimmedNotes : null,
        urgency,
        status: "queued",
        kilnId: KILN_ID,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      setSubmitStatus("Submitted. We will slot you into the next load.");
      setHalfShelves(1);
      setClayBody("");
      setNotes("");
      setUrgency("next");
      await loadRequests();
    } catch (err: any) {
      setSubmitStatus(`Submission failed: ${err?.message || String(err)}`);
    } finally {
      setSubmitBusy(false);
    }
  };

  const handleStatusUpdate = async (requestId: string, nextStatus: KilnLaunchRequest["status"]) => {
    if (!isStaff || actionBusyId) return;
    setActionBusyId(requestId);
    setActionStatus("");
    try {
      await updateDoc(doc(db, "kilnLaunchRequests", requestId), {
        status: nextStatus,
        updatedAt: serverTimestamp(),
      });
      setActionStatus("Status updated.");
      await loadRequests();
    } catch (err: any) {
      setActionStatus(`Status update failed: ${err?.message || String(err)}`);
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
            A launch is ready when the kiln reaches {LAUNCH_TARGET_HALF_SHELVES} half shelves.
          </p>
          {lastUpdated ? (
            <p className="kiln-launch-updated">Last updated {lastUpdated.toLocaleTimeString()}</p>
          ) : null}
        </div>
        <div className="kiln-launch-actions">
          <button className="btn btn-ghost" onClick={loadRequests} disabled={loading}>
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
              <h2>ASAP Queue</h2>
              <p className="kiln-panel-meta">{formatHalfShelfLabel(asapHalfShelves)} waiting</p>
            </div>
            <span className="kiln-panel-count">{asapRequests.length} requests</span>
          </div>
          <div className="kiln-queue-list">
            {asapRequests.length === 0 ? (
              <p className="kiln-empty">No ASAP requests yet.</p>
            ) : (
              asapRequests.map((item) => (
                <div key={item.id} className="kiln-queue-card">
                  <div className="kiln-queue-title">
                    <strong>{item.userDisplayName ?? "Member"}</strong>
                    <span>{formatHalfShelfLabel(item.halfShelves)}</span>
                  </div>
                  <div className="kiln-queue-meta">{item.clayBody}</div>
                  {item.notes ? <div className="kiln-queue-notes">{item.notes}</div> : null}
                  {isStaff ? (
                    <div className="kiln-queue-actions">
                      <button
                        className="kiln-action primary"
                        onClick={() => handleStatusUpdate(item.id, "loaded")}
                        disabled={actionBusyId === item.id}
                      >
                        Load
                      </button>
                      <button
                        className="kiln-action ghost"
                        onClick={() => handleStatusUpdate(item.id, "cancelled")}
                        disabled={actionBusyId === item.id}
                      >
                        Cancel
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
              <h2>Current Load</h2>
              <p className="kiln-panel-meta">{formatHalfShelfLabel(loadedHalfShelves)} loaded</p>
            </div>
            <span className={`kiln-ready ${loadedHalfShelves > 0 ? "active" : ""}`}>
              {loadStateLabel}
            </span>
          </div>

            <div className="kiln-meter">
              <div className="kiln-iso">
                <img className="kiln-iso-image" src={kilnIsoImage} alt="Kiln" />
                <div className="kiln-iso-shelves">
                  {Array.from({ length: LAUNCH_TARGET_HALF_SHELVES }).map((_, index) => (
                    <div
                      key={`slot-${index}`}
                      className={`kiln-iso-shelf ${index < filledSlots ? "filled" : ""}`}
                    />
                  ))}
                </div>
              </div>
              <div className="kiln-meter-label">
                {formatHalfShelfLabel(visualLoad)} / {LAUNCH_TARGET_HALF_SHELVES} loaded
              </div>
            </div>

            <div className="kiln-meter-footer">
              <div>
                <span className="kiln-metric-label">Ready launches</span>
                <strong>{readyLaunches}</strong>
              </div>
              <div>
                <span className="kiln-metric-label">Next launch need</span>
                <strong>{LAUNCH_TARGET_HALF_SHELVES - filledSlots} half shelves</strong>
              </div>
              <div>
                <span className="kiln-metric-label">Queued waiting</span>
                <strong>{queuedHalfShelves}</strong>
              </div>
            </div>
          </div>

          <div className="kiln-launch-panel">
            <div className="kiln-panel-header">
              <div>
                <h2>Loaded In Kiln</h2>
                <p className="kiln-panel-meta">{loadedRequests.length} items loaded</p>
              </div>
            </div>
            <div className="kiln-queue-list">
              {loadedRequests.length === 0 ? (
                <p className="kiln-empty">Nothing loaded yet.</p>
              ) : (
                loadedRequests.map((item) => (
                  <div key={item.id} className="kiln-queue-card">
                    <div className="kiln-queue-title">
                      <strong>{item.userDisplayName ?? "Member"}</strong>
                      <span>{formatHalfShelfLabel(item.halfShelves)}</span>
                    </div>
                    <div className="kiln-queue-meta">{item.clayBody}</div>
                    {item.notes ? <div className="kiln-queue-notes">{item.notes}</div> : null}
                    {isStaff ? (
                      <div className="kiln-queue-actions">
                        <button
                          className="kiln-action primary"
                          onClick={() => handleStatusUpdate(item.id, "fired")}
                          disabled={actionBusyId === item.id}
                        >
                          Mark fired
                        </button>
                        <button
                          className="kiln-action ghost"
                          onClick={() => handleStatusUpdate(item.id, "queued")}
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

          {firedRequests.length > 0 ? (
            <div className="kiln-launch-panel">
              <div className="kiln-panel-header">
                <div>
                  <h2>Fired</h2>
                  <p className="kiln-panel-meta">{firedRequests.length} batches</p>
                </div>
              </div>
              <div className="kiln-queue-list">
                {firedRequests.map((item) => (
                  <div key={item.id} className="kiln-queue-card">
                    <div className="kiln-queue-title">
                      <strong>{item.userDisplayName ?? "Member"}</strong>
                      <span>{formatHalfShelfLabel(item.halfShelves)}</span>
                    </div>
                    <div className="kiln-queue-meta">{item.clayBody}</div>
                    {isStaff ? (
                      <div className="kiln-queue-actions">
                        <button
                          className="kiln-action primary"
                          onClick={() => handleStatusUpdate(item.id, "complete")}
                          disabled={actionBusyId === item.id}
                        >
                          Complete
                        </button>
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          <div className="kiln-launch-panel">
            <div className="kiln-panel-header">
              <div>
                <h2>Submit Half Shelves</h2>
                <p className="kiln-panel-meta">Tell us what needs to be fired next.</p>
              </div>
            </div>

              <div className="kiln-form">
                <label>
                  Half shelves
                  <input
                    type="number"
                    min={1}
                  max={LAUNCH_TARGET_HALF_SHELVES}
                  step={1}
                  value={halfShelves}
                  onChange={(event) => setHalfShelves(Number(event.target.value))}
                />
              </label>
              <label>
                Clay body
                <input
                  type="text"
                  value={clayBody}
                  onChange={(event) => setClayBody(event.target.value)}
                  placeholder="e.g. B-mix, Standard 240"
                />
              </label>
              <label>
                Notes (optional)
                <textarea
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  placeholder="Glaze details, firing notes, pickup timing..."
                />
              </label>

              <div className="kiln-urgency">
                <span>Timing</span>
                <div className="kiln-urgency-options">
                  <button
                    type="button"
                    className={urgency === "asap" ? "active" : ""}
                    onClick={() => setUrgency("asap")}
                  >
                    ASAP firing
                  </button>
                  <button
                    type="button"
                    className={urgency === "next" ? "active" : ""}
                    onClick={() => setUrgency("next")}
                  >
                    Next available
                  </button>
                </div>
              </div>

              {submitStatus ? <p className="kiln-form-status">{submitStatus}</p> : null}

              <button className="btn btn-primary" onClick={handleSubmit} disabled={submitBusy}>
                {submitBusy ? "Submitting..." : "Submit request"}
              </button>
            </div>
          </div>
        </section>

        <section className="kiln-launch-panel">
          <div className="kiln-panel-header">
            <div>
              <h2>Next Available</h2>
              <p className="kiln-panel-meta">{formatHalfShelfLabel(nextHalfShelves)} waiting</p>
            </div>
            <span className="kiln-panel-count">{nextRequests.length} requests</span>
          </div>
          <div className="kiln-queue-list">
            {nextRequests.length === 0 ? (
              <p className="kiln-empty">No requests yet.</p>
            ) : (
              nextRequests.map((item) => (
                <div key={item.id} className="kiln-queue-card">
                  <div className="kiln-queue-title">
                    <strong>{item.userDisplayName ?? "Member"}</strong>
                    <span>{formatHalfShelfLabel(item.halfShelves)}</span>
                  </div>
                  <div className="kiln-queue-meta">{item.clayBody}</div>
                  {item.notes ? <div className="kiln-queue-notes">{item.notes}</div> : null}
                  {isStaff ? (
                    <div className="kiln-queue-actions">
                      <button
                        className="kiln-action primary"
                        onClick={() => handleStatusUpdate(item.id, "loaded")}
                        disabled={actionBusyId === item.id}
                      >
                        Load
                      </button>
                      <button
                        className="kiln-action ghost"
                        onClick={() => handleStatusUpdate(item.id, "cancelled")}
                        disabled={actionBusyId === item.id}
                      >
                        Cancel
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
