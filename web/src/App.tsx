// web/src/App.tsx
import React, { useEffect, useMemo, useState } from "react";
import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  type User,
} from "firebase/auth";
import {
  collection,
  onSnapshot,
  orderBy,
  query,
  where,
  type Timestamp,
} from "firebase/firestore";
import { auth, db } from "./firebase";
import { createPortalApi, PortalApiError, type PortalApiMeta } from "./api/portalApi";

/**
 * Safety rails:
 * - ErrorBoundary prevents white-screen failures
 * - in-flight guards prevent double submit
 * - troubleshooting panel shows last request payload/response + safe curl example
 * - admin token persisted in localStorage
 *
 * iOS-forward:
 * - all Cloud Function calls go through api client
 * - explicit request/response, tolerant parsing
 */

type Batch = {
  id: string;
  ownerUid?: string;
  ownerDisplayName?: string;

  title?: string;

  // backend may use either naming; UI is tolerant
  estimatedCostCents?: number;
  priceCents?: number;

  intakeMode?: string;
  status?: string;

  isClosed?: boolean;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
  closedAt?: Timestamp;
};

type TimelineEvent = {
  id: string;
  type?: string;
  at?: Timestamp;
  notes?: string;
  actorName?: string;
  kilnName?: string;
};

const DEV_ADMIN_TOKEN_STORAGE_KEY = "mf_dev_admin_token";

class AppErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; message: string }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: "" };
  }
  static getDerivedStateFromError(err: any) {
    return { hasError: true, message: err?.message || String(err) };
  }
  componentDidCatch(err: any) {
    // eslint-disable-next-line no-console
    console.error("AppErrorBoundary caught:", err);
  }
  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div style={styles.page}>
        <div style={styles.card}>
          <div style={styles.h1}>Monsoon Fire Portal</div>
          <div style={styles.warn}>
            The app hit a runtime error (React blank-screen). Refreshing usually fixes it.
          </div>
          <pre style={styles.pre}>{this.state.message}</pre>
          <button style={styles.btn} onClick={() => window.location.reload()}>
            Reload
          </button>
        </div>
      </div>
    );
  }
}

function formatMoneyFromBatch(b: Batch) {
  const cents =
    typeof b.estimatedCostCents === "number"
      ? b.estimatedCostCents
      : typeof b.priceCents === "number"
        ? b.priceCents
        : undefined;

  if (typeof cents !== "number") return "$0.00";
  return `$${(cents / 100).toFixed(2)}`;
}

function formatTs(ts?: Timestamp) {
  if (!ts) return "";
  try {
    return ts.toDate().toLocaleString();
  } catch {
    return "";
  }
}

function safeJsonStringify(v: any) {
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

export default function App() {
  const api = useMemo(() => createPortalApi(), []);

  const [user, setUser] = useState<User | null>(null);
  const [status, setStatus] = useState<string>("");

  const [adminToken, setAdminToken] = useState<string>(() => {
    return localStorage.getItem(DEV_ADMIN_TOKEN_STORAGE_KEY) || "";
  });

  const [active, setActive] = useState<Batch[]>([]);
  const [history, setHistory] = useState<Batch[]>([]);

  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(null);
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const [timelineLoading, setTimelineLoading] = useState<boolean>(false);

  const [inFlight, setInFlight] = useState<Record<string, boolean>>({});
  const [lastReq, setLastReq] = useState<PortalApiMeta | null>(null);

  const hasActive = active.length > 0;

  function setBusy(key: string, busy: boolean) {
    setInFlight((prev) => ({ ...prev, [key]: busy }));
  }
  function isBusy(key: string) {
    return !!inFlight[key];
  }

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => setUser(u));
    return () => unsub();
  }, []);

  useEffect(() => {
    localStorage.setItem(DEV_ADMIN_TOKEN_STORAGE_KEY, adminToken);
  }, [adminToken]);

  useEffect(() => {
    if (!user) {
      setActive([]);
      setHistory([]);
      setSelectedBatchId(null);
      setTimeline([]);
      return;
    }

    const uid = user.uid;

    // NOTE: may require composite indexes:
    // ownerUid + isClosed + orderBy(updatedAt/closedAt)
    const qActive = query(
      collection(db, "batches"),
      where("ownerUid", "==", uid),
      where("isClosed", "==", false),
      orderBy("updatedAt", "desc")
    );

    const unsubActive = onSnapshot(
      qActive,
      (snap) => {
        const rows: Batch[] = snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as any),
        }));
        setActive(rows);
      },
      (err) => setStatus(`Active query failed: ${err.message}`)
    );

    const qHistory = query(
      collection(db, "batches"),
      where("ownerUid", "==", uid),
      where("isClosed", "==", true),
      orderBy("closedAt", "desc")
    );

    const unsubHistory = onSnapshot(
      qHistory,
      (snap) => {
        const rows: Batch[] = snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as any),
        }));
        setHistory(rows);
      },
      (err) => setStatus(`History query failed: ${err.message}`)
    );

    return () => {
      unsubActive();
      unsubHistory();
    };
  }, [user]);

  async function ensureIdToken(): Promise<string> {
    if (!user) throw new Error("Not signed in.");
    return await user.getIdToken();
  }

  function handleApiError(e: any, prefix: string) {
    if (e instanceof PortalApiError) {
      setLastReq(e.meta);
      setStatus(`${prefix}: ${e.message} (requestId: ${e.meta.requestId})`);
      return;
    }
    setStatus(`${prefix}: ${e?.message || String(e)}`);
  }

  async function doSignIn() {
    setStatus("");
    const provider = new GoogleAuthProvider();
    await signInWithPopup(auth, provider);
  }

  async function doSignOut() {
    setStatus("");
    await signOut(auth);
  }

  async function createTestBatch() {
    const key = "createTestBatch";
    if (isBusy(key)) return;
    setBusy(key, true);

    try {
      setStatus("");
      if (!user) throw new Error("Not signed in.");
      const idToken = await ensureIdToken();

      // Backend-shaped payload (restores your previously-working createBatch contract)
      const payload = {
        ownerUid: user.uid,
        ownerDisplayName: user.displayName || user.email || "Client",
        title: "Test wareboard batch",
        intakeMode: "STAFF_HANDOFF",
        estimatedCostCents: 2500,
        estimateNotes: "Estimate only",
        // Do NOT include fields that might be undefined (e.g., kilnName)
      };

      const { data, meta } = await api.createBatch({
        idToken,
        adminToken: adminToken.trim() || undefined,
        payload,
      });

      setLastReq(meta);
      if (data.ok) setStatus(`Created batch: ${data.batchId ?? "ok"} (requestId: ${meta.requestId})`);
      else setStatus(`createBatch: not ok (requestId: ${meta.requestId})`);
    } catch (e: any) {
      handleApiError(e, "createBatch failed");
    } finally {
      setBusy(key, false);
    }
  }

  async function pickedUpAndClose(batchId: string) {
    const key = `close:${batchId}`;
    if (isBusy(key)) return;
    setBusy(key, true);

    try {
      setStatus("");
      const idToken = await ensureIdToken();

      const { data, meta } = await api.pickedUpAndClose({
        idToken,
        adminToken: adminToken.trim() || undefined,
        payload: { uid: user!.uid, batchId }, // tolerant: include uid in case function expects it
      });

      setLastReq(meta);
      if (data.ok) setStatus(`Closed batch. (requestId: ${meta.requestId})`);
    } catch (e: any) {
      handleApiError(e, "pickedUpAndClose failed");
    } finally {
      setBusy(key, false);
    }
  }

  async function continueJourney(fromBatchId: string) {
    const key = `continue:${fromBatchId}`;
    if (isBusy(key)) return;
    setBusy(key, true);

    try {
      if (hasActive) {
        setStatus("You already have an active batch. Close it before continuing a previous batch.");
        return;
      }

      setStatus("");
      const idToken = await ensureIdToken();

      const { data, meta } = await api.continueJourney({
        idToken,
        adminToken: adminToken.trim() || undefined,
        payload: { uid: user!.uid, fromBatchId },
      });

      setLastReq(meta);

      const id = data.batchId || data.newBatchId || data.existingBatchId;
      if (data.ok) setStatus(`Continue journey started: ${id ?? "ok"} (requestId: ${meta.requestId})`);
      else setStatus(`continueJourney: ${data.message ?? "not ok"} (requestId: ${meta.requestId})`);
    } catch (e: any) {
      handleApiError(e, "continueJourney failed");
    } finally {
      setBusy(key, false);
    }
  }

  async function loadTimeline(batchId: string) {
    setTimelineLoading(true);
    setTimeline([]);
    setSelectedBatchId(batchId);

    try {
      const q = query(
        collection(db, "batches", batchId, "timeline"),
        orderBy("at", "asc")
      );

      // one-shot-ish: unsubscribe after first snapshot
      const unsub = onSnapshot(
        q,
        (snap) => {
          const rows: TimelineEvent[] = snap.docs.map((d) => ({
            id: d.id,
            ...(d.data() as any),
          }));
          setTimeline(rows);
          setTimelineLoading(false);
          unsub();
        },
        (err) => {
          setStatus(`Timeline failed: ${err.message}`);
          setTimelineLoading(false);
        }
      );
    } catch (e: any) {
      setStatus(`Timeline failed: ${e?.message || String(e)}`);
      setTimelineLoading(false);
    }
  }

  const selectedBatch = useMemo(() => {
    const all = [...active, ...history];
    return all.find((b) => b.id === selectedBatchId) || null;
  }, [active, history, selectedBatchId]);

  const canContinueJourney = !hasActive;

  return (
    <AppErrorBoundary>
      <div style={styles.page}>
        <div style={styles.container}>
          <div style={styles.h1}>Monsoon Fire Portal</div>
          <div style={styles.muted}>
            Functions base: <b>{api.baseUrl}</b>
          </div>

          <div style={styles.row}>
            {user ? (
              <>
                <button style={styles.btn} onClick={doSignOut}>
                  Sign out
                </button>
                <div style={styles.muted}>
                  Signed in as <b>{user.displayName || user.email || user.uid}</b>
                </div>
              </>
            ) : (
              <button style={styles.btn} onClick={doSignIn}>
                Sign in with Google
              </button>
            )}
          </div>

          <div style={styles.card}>
            <div style={styles.label}>Admin token (dev only)</div>
            <input
              style={styles.input}
              placeholder="x-admin-token"
              value={adminToken}
              onChange={(e) => setAdminToken(e.target.value)}
            />
            <div style={{ height: 10 }} />
            <button
              style={styles.btn}
              onClick={createTestBatch}
              disabled={!user || isBusy("createTestBatch")}
              title={!user ? "Sign in first" : undefined}
            >
              {isBusy("createTestBatch") ? "Working..." : "Create test batch"}
            </button>

            {status ? <div style={styles.status}>{status}</div> : null}
          </div>

          <div style={styles.sectionTitle}>Active</div>
          {active.length === 0 ? (
            <div style={styles.muted}>(none)</div>
          ) : (
            active.map((b) => (
              <div key={b.id} style={styles.batchCard}>
                <div style={styles.batchLeft}>
                  <div style={styles.batchTitle}>{b.title || "Batch"}</div>
                  <div style={styles.batchMeta}>
                    {formatMoneyFromBatch(b)} • {b.intakeMode || b.status || "—"} • {b.id}
                  </div>
                  <div style={styles.batchMeta}>Updated: {formatTs(b.updatedAt)}</div>
                </div>

                <div style={styles.batchRight}>
                  <button style={styles.btnSmall} onClick={() => loadTimeline(b.id)} disabled={!user}>
                    History
                  </button>
                  <button
                    style={styles.btnSmall}
                    onClick={() => pickedUpAndClose(b.id)}
                    disabled={!user || isBusy(`close:${b.id}`)}
                    title={!adminToken.trim() ? "Requires x-admin-token" : undefined}
                  >
                    {isBusy(`close:${b.id}`) ? "Working..." : "Picked up & close"}
                  </button>
                </div>
              </div>
            ))
          )}

          <div style={styles.sectionTitle}>History</div>
          {history.length === 0 ? (
            <div style={styles.muted}>(none)</div>
          ) : (
            history.map((b) => (
              <div key={b.id} style={styles.batchCard}>
                <div style={styles.batchLeft}>
                  <div style={styles.batchTitle}>{b.title || "Batch"}</div>
                  <div style={styles.batchMeta}>
                    {formatMoneyFromBatch(b)} • {b.isClosed ? "closed" : "—"} • {b.id}
                  </div>
                  <div style={styles.batchMeta}>Closed: {formatTs(b.closedAt)}</div>
                </div>

                <div style={styles.batchRight}>
                  <button style={styles.btnSmall} onClick={() => loadTimeline(b.id)} disabled={!user}>
                    History
                  </button>
                  <button
                    style={{
                      ...styles.btnSmall,
                      opacity: canContinueJourney ? 1 : 0.5,
                    }}
                    onClick={() => continueJourney(b.id)}
                    disabled={!user || !canContinueJourney || isBusy(`continue:${b.id}`)}
                    title={
                      !canContinueJourney
                        ? "You already have an active batch. Close it before continuing a previous batch."
                        : "Creates a new batch"
                    }
                  >
                    {isBusy(`continue:${b.id}`) ? "Working..." : "Continue journey (creates new batch)"}
                  </button>
                </div>
              </div>
            ))
          )}

          {/* Timeline viewer */}
          {selectedBatchId ? (
            <div style={styles.card}>
              <div style={styles.rowBetween}>
                <div style={styles.h2}>
                  Timeline:{" "}
                  <span style={styles.muted}>{selectedBatch?.title || selectedBatchId}</span>
                </div>
                <button style={styles.btnSmall} onClick={() => setSelectedBatchId(null)}>
                  Close
                </button>
              </div>

              {timelineLoading ? (
                <div style={styles.muted}>Loading…</div>
              ) : timeline.length === 0 ? (
                <div style={styles.muted}>(no events)</div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {timeline.map((ev) => (
                    <div key={ev.id} style={styles.timelineRow}>
                      <div style={styles.timelineAt}>{formatTs(ev.at)}</div>
                      <div style={styles.timelineBody}>
                        <div style={styles.timelineType}>{ev.type || "event"}</div>
                        <div style={styles.timelineMeta}>
                          {ev.actorName ? `by ${ev.actorName}` : ""}
                          {ev.kilnName ? ` • kiln: ${ev.kilnName}` : ""}
                        </div>
                        {ev.notes ? <div style={styles.timelineNotes}>{ev.notes}</div> : null}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : null}

          {/* Troubleshooting */}
          <details style={styles.card}>
            <summary style={styles.summary}>Troubleshooting</summary>
            <div style={styles.muted}>
              Last Cloud Function request (payload + response). Curl is token-redacted by default.
            </div>

            {!lastReq ? (
              <div style={styles.muted}>(no requests yet)</div>
            ) : (
              <>
                <div style={styles.kv}>
                  <div style={styles.k}>When</div>
                  <div style={styles.v}>{lastReq.atIso}</div>

                  <div style={styles.k}>Function</div>
                  <div style={styles.v}>{lastReq.fn}</div>

                  <div style={styles.k}>Request ID</div>
                  <div style={styles.v}>{lastReq.requestId}</div>

                  <div style={styles.k}>Status</div>
                  <div style={styles.v}>
                    {typeof lastReq.status === "number"
                      ? `${lastReq.status} ${lastReq.ok ? "(ok)" : "(error)"}`
                      : "—"}
                  </div>
                </div>

                <div style={styles.h3}>Payload</div>
                <pre style={styles.pre}>{safeJsonStringify(lastReq.payload)}</pre>

                <div style={styles.h3}>Response</div>
                <pre style={styles.pre}>{safeJsonStringify(lastReq.response)}</pre>

                {lastReq.error ? (
                  <>
                    <div style={styles.h3}>Error</div>
                    <pre style={styles.pre}>{lastReq.error}</pre>
                  </>
                ) : null}

                <div style={styles.h3}>Curl (redacted)</div>
                <pre style={styles.pre}>{lastReq.curlExample || "(no curl available)"}</pre>

                <button
                  style={styles.btnSmall}
                  onClick={async () => {
                    if (!lastReq.curlExample) return;
                    await navigator.clipboard.writeText(lastReq.curlExample);
                    setStatus("Copied redacted curl to clipboard.");
                  }}
                  disabled={!lastReq.curlExample}
                >
                  Copy curl
                </button>
              </>
            )}
          </details>

          <div style={{ height: 40 }} />
        </div>
      </div>
    </AppErrorBoundary>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: "100vh",
    background: "#1f1f1f",
    color: "#f5f5f5",
    padding: 28,
    fontFamily:
      "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, 'Apple Color Emoji','Segoe UI Emoji'",
  },
  container: {
    maxWidth: 980,
    margin: "0 auto",
    display: "flex",
    flexDirection: "column",
    gap: 18,
  },
  h1: { fontSize: 56, fontWeight: 800, letterSpacing: -1, marginTop: 10 },
  h2: { fontSize: 18, fontWeight: 700 },
  h3: { fontSize: 14, fontWeight: 700, marginTop: 10, marginBottom: 6 },
  row: { display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" },
  rowBetween: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 },
  muted: { opacity: 0.75 },
  warn: { color: "#ffd1a8", marginTop: 12, marginBottom: 12 },
  card: {
    background: "rgba(255,255,255,0.04)",
    border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: 18,
    padding: 18,
  },
  label: { fontSize: 12, opacity: 0.75, marginBottom: 8 },
  input: {
    width: "100%",
    padding: "12px 14px",
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(0,0,0,0.25)",
    color: "#fff",
    outline: "none",
    fontSize: 14,
  },
  btn: {
    padding: "10px 16px",
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(0,0,0,0.35)",
    color: "#fff",
    fontSize: 14,
    cursor: "pointer",
  },
  btnSmall: {
    padding: "10px 14px",
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(0,0,0,0.35)",
    color: "#fff",
    fontSize: 14,
    cursor: "pointer",
    whiteSpace: "nowrap",
  },
  status: { marginTop: 12, color: "#ffd1a8" },
  sectionTitle: { fontSize: 44, fontWeight: 800, marginTop: 10 },
  batchCard: {
    background: "rgba(255,255,255,0.04)",
    border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: 18,
    padding: 16,
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
    flexWrap: "wrap",
  },
  batchLeft: { minWidth: 360 },
  batchRight: { display: "flex", gap: 10, flexWrap: "wrap" },
  batchTitle: { fontSize: 18, fontWeight: 800 },
  batchMeta: { opacity: 0.75, fontSize: 13, marginTop: 3 },
  timelineRow: {
    display: "flex",
    gap: 12,
    padding: 12,
    borderRadius: 14,
    border: "1px solid rgba(255,255,255,0.08)",
    background: "rgba(0,0,0,0.18)",
  },
  timelineAt: { width: 170, opacity: 0.8, fontSize: 12, paddingTop: 2 },
  timelineBody: { flex: 1 },
  timelineType: { fontWeight: 800, fontSize: 14 },
  timelineMeta: { opacity: 0.75, fontSize: 12, marginTop: 2 },
  timelineNotes: { marginTop: 6, fontSize: 13, opacity: 0.92 },
  pre: {
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    background: "rgba(0,0,0,0.25)",
    border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: 12,
    padding: 12,
    fontSize: 12,
    lineHeight: 1.35,
    marginTop: 6,
  },
  summary: { cursor: "pointer", fontWeight: 800, fontSize: 16, marginBottom: 10 },
  kv: {
    display: "grid",
    gridTemplateColumns: "120px 1fr",
    gap: 8,
    marginTop: 10,
    marginBottom: 10,
  },
  k: { opacity: 0.7, fontSize: 12 },
  v: { fontSize: 12 },
};
