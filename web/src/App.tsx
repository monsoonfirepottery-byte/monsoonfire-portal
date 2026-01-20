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
import { createPortalApi, PortalApiError } from "./api/portalApi";
import type {
  CreateBatchRequest,
  PickedUpAndCloseRequest,
  ContinueJourneyRequest,
  PortalApiMeta,
} from "./api/portalContracts";
import { getResultBatchId } from "./api/portalContracts";

type Batch = {
  id: string;
  title?: string;
  ownerUid?: string;
  ownerDisplayName?: string;
  isClosed?: boolean;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
  closedAt?: Timestamp;
  [k: string]: any;
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

/**
 * 👇 DEV BUILD FINGERPRINT
 * If this text changes, you are editing the file Vite is actually serving.
 */
const BUILD_FINGERPRINT = "App.tsx • web/src/App.tsx • dev";

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
      <div style={S.page}>
        <div style={S.card}>
          <div style={S.h1}>Monsoon Fire Portal</div>
          <div style={S.warn}>
            The app hit a runtime error. Refresh usually fixes it.
          </div>
          <pre style={S.pre}>{this.state.message}</pre>
          <button style={S.btn} onClick={() => window.location.reload()}>
            Reload
          </button>
          {import.meta.env.DEV ? (
            <div style={S.fingerprint}>{BUILD_FINGERPRINT}</div>
          ) : null}
        </div>
      </div>
    );
  }
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

function getFunctionsBaseUrl(): string {
  const v = (import.meta as any)?.env?.VITE_FUNCTIONS_BASE_URL;
  if (typeof v === "string" && v.trim()) return v.trim().replace(/\/$/, "");
  return "https://us-central1-monsoonfire-portal.cloudfunctions.net";
}

function isEmulatorBaseUrl(baseUrl: string): boolean {
  const u = baseUrl.toLowerCase();
  return (
    u.includes("127.0.0.1") ||
    u.includes("localhost") ||
    u.includes(":5001") ||
    u.includes("/monsoonfire-portal/us-central1")
  );
}

export default function App() {
  const baseUrl = useMemo(() => getFunctionsBaseUrl(), []);
  const api = useMemo(() => createPortalApi({ baseUrl }), [baseUrl]);
  const isEmulator = useMemo(() => isEmulatorBaseUrl(baseUrl), [baseUrl]);

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
    return user.getIdToken();
  }

  function setBusy(key: string, busy: boolean) {
    setInFlight((prev) => ({ ...prev, [key]: busy }));
  }

  function isBusy(key: string) {
    return !!inFlight[key];
  }

  async function createTestBatch() {
    const key = "createTestBatch";
    if (isBusy(key)) return;
    setBusy(key, true);

    try {
      setStatus("");
      const idToken = await ensureIdToken();

      const payload: CreateBatchRequest = {
        ownerUid: user!.uid,
        ownerDisplayName: user!.displayName || user!.email || "Client",
        title: "Test batch",
        intakeMode: "STAFF_HANDOFF",
        estimatedCostCents: 2500,
      };

      const { meta } = await api.createBatch({
        idToken,
        adminToken: adminToken.trim() || undefined,
        payload,
      });

      setLastReq(meta);
      setStatus("Batch created");
    } catch (e: any) {
      if (e instanceof PortalApiError) setLastReq(e.meta);
      setStatus(`createBatch failed: ${e?.message || String(e)}`);
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

      const payload: PickedUpAndCloseRequest = {
        batchId,
        uid: user!.uid,
      };

      const { meta } = await api.pickedUpAndClose({
        idToken,
        adminToken: adminToken.trim() || undefined,
        payload,
      });

      setLastReq(meta);
      setStatus("Batch closed.");
    } catch (e: any) {
      if (e instanceof PortalApiError) setLastReq(e.meta);
      setStatus(`pickedUpAndClose failed: ${e?.message || String(e)}`);
    } finally {
      setBusy(key, false);
    }
  }

  async function continueJourney(fromBatchId: string) {
    const key = `continue:${fromBatchId}`;
    if (isBusy(key)) return;
    setBusy(key, true);

    try {
      setStatus("");
      const idToken = await ensureIdToken();

      const payload: ContinueJourneyRequest = {
        uid: user!.uid,
        fromBatchId,
      };

      const { data, meta } = await api.continueJourney({
        idToken,
        adminToken: adminToken.trim() || undefined,
        payload,
      });

      setLastReq(meta);
      const newId = getResultBatchId(data);
      setStatus(`Journey continued: ${newId ?? "ok"}`);
    } catch (e: any) {
      if (e instanceof PortalApiError) setLastReq(e.meta);
      setStatus(`continueJourney failed: ${e?.message || String(e)}`);
    } finally {
      setBusy(key, false);
    }
  }

  async function loadTimeline(batchId: string) {
    setTimelineLoading(true);
    setTimeline([]);
    setSelectedBatchId(batchId);

    const q = query(collection(db, "batches", batchId, "timeline"), orderBy("at", "asc"));
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
  }

  const selectedBatch = useMemo(() => {
    const all = [...active, ...history];
    return all.find((b) => b.id === selectedBatchId) || null;
  }, [active, history, selectedBatchId]);

  const canContinueJourney = !hasActive;

  return (
    <AppErrorBoundary>
      <div style={S.page}>
        <div style={S.container}>
          <div style={S.headerBlock}>
            <div style={S.h1}>Monsoon Fire Portal</div>

            <div style={S.subRow}>
              <div style={S.muted}>
                Functions base: <b>{baseUrl}</b>
              </div>
              <span
                style={{
                  ...S.badge,
                  ...(isEmulator ? S.badgeEmulator : S.badgeProd),
                }}
                title={isEmulator ? "Using emulators" : "Using deployed functions"}
              >
                {isEmulator ? "Emulator" : "Prod"}
              </span>
            </div>

            {import.meta.env.DEV ? <div style={S.fingerprint}>{BUILD_FINGERPRINT}</div> : null}
          </div>

          <div style={S.row}>
            {user ? (
              <>
                <button style={S.btn} onClick={() => signOut(auth)}>
                  Sign out
                </button>
                <div style={S.muted}>
                  Signed in as <b>{user.displayName || user.email || user.uid}</b>
                </div>
              </>
            ) : (
              <button style={S.btn} onClick={() => signInWithPopup(auth, new GoogleAuthProvider())}>
                Sign in with Google
              </button>
            )}
          </div>

          <div style={S.card}>
            <div style={S.label}>Admin token (dev only)</div>
            <input
              style={S.input}
              placeholder="x-admin-token"
              value={adminToken}
              onChange={(e) => setAdminToken(e.target.value)}
            />
            <div style={{ height: 10 }} />
            <button style={S.btn} onClick={createTestBatch} disabled={!user || isBusy("createTestBatch")}>
              {isBusy("createTestBatch") ? "Working..." : "Create test batch"}
            </button>

            {status ? <div style={S.status}>{status}</div> : null}
          </div>

          <div style={S.sectionTitle}>Active</div>
          {active.length === 0 ? (
            <div style={S.muted}>(none)</div>
          ) : (
            active.map((b) => (
              <div key={b.id} style={S.batchCard}>
                <div style={S.batchLeft}>
                  <div style={S.batchTitle}>{b.title || "Batch"}</div>
                  <div style={S.batchMeta}>{b.id}</div>
                  <div style={S.batchMeta}>Updated: {formatTs(b.updatedAt)}</div>
                </div>
                <div style={S.batchRight}>
                  <button style={S.btnSmall} onClick={() => loadTimeline(b.id)} disabled={!user}>
                    Timeline
                  </button>
                  <button
                    style={S.btnSmall}
                    onClick={() => pickedUpAndClose(b.id)}
                    disabled={!user || isBusy(`close:${b.id}`)}
                  >
                    {isBusy(`close:${b.id}`) ? "Working..." : "Picked up & close"}
                  </button>
                </div>
              </div>
            ))
          )}

          <div style={S.sectionTitle}>History</div>
          {history.length === 0 ? (
            <div style={S.muted}>(none)</div>
          ) : (
            history.map((b) => (
              <div key={b.id} style={S.batchCard}>
                <div style={S.batchLeft}>
                  <div style={S.batchTitle}>{b.title || "Batch"}</div>
                  <div style={S.batchMeta}>{b.id}</div>
                  <div style={S.batchMeta}>Closed: {formatTs(b.closedAt)}</div>
                </div>
                <div style={S.batchRight}>
                  <button style={S.btnSmall} onClick={() => loadTimeline(b.id)} disabled={!user}>
                    Timeline
                  </button>
                  <button
                    style={{ ...S.btnSmall, opacity: canContinueJourney ? 1 : 0.5 }}
                    onClick={() => continueJourney(b.id)}
                    disabled={!user || !canContinueJourney || isBusy(`continue:${b.id}`)}
                    title={!canContinueJourney ? "Close active batch first" : "Creates a new batch"}
                  >
                    {isBusy(`continue:${b.id}`) ? "Working..." : "Continue journey (creates new batch)"}
                  </button>
                </div>
              </div>
            ))
          )}

          {selectedBatchId ? (
            <div style={S.card}>
              <div style={S.rowBetween}>
                <div style={S.h2}>
                  Timeline: <span style={S.muted}>{selectedBatch?.title || selectedBatchId}</span>
                </div>
                <button style={S.btnSmall} onClick={() => setSelectedBatchId(null)}>
                  Close
                </button>
              </div>

              {timelineLoading ? (
                <div style={S.muted}>Loading…</div>
              ) : timeline.length === 0 ? (
                <div style={S.muted}>(no events)</div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {timeline.map((ev) => (
                    <div key={ev.id} style={S.timelineRow}>
                      <div style={S.timelineAt}>{formatTs(ev.at)}</div>
                      <div style={S.timelineBody}>
                        <div style={S.timelineType}>{ev.type || "event"}</div>
                        <div style={S.timelineMeta}>
                          {ev.actorName ? `by ${ev.actorName}` : ""}
                          {ev.kilnName ? ` • kiln: ${ev.kilnName}` : ""}
                        </div>
                        {ev.notes ? <div style={S.timelineNotes}>{ev.notes}</div> : null}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : null}

          <details style={S.card}>
            <summary style={S.summary}>Troubleshooting</summary>
            <pre style={S.pre}>{safeJsonStringify(lastReq)}</pre>
          </details>

          <div style={{ height: 40 }} />
        </div>
      </div>
    </AppErrorBoundary>
  );
}

const S: Record<string, React.CSSProperties> = {
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
  headerBlock: { display: "flex", flexDirection: "column", gap: 6 },

  h1: { fontSize: 56, fontWeight: 800, letterSpacing: -1, marginTop: 10 },
  h2: { fontSize: 18, fontWeight: 700 },

  subRow: { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" },

  fingerprint: { fontSize: 11, opacity: 0.5, fontFamily: "monospace" },

  badge: {
    fontSize: 12,
    fontWeight: 800,
    padding: "4px 10px",
    borderRadius: 999,
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(0,0,0,0.25)",
  },
  badgeEmulator: {
    color: "#c9ffcf",
    border: "1px solid rgba(201,255,207,0.35)",
  },
  badgeProd: {
    color: "#ffd1a8",
    border: "1px solid rgba(255,209,168,0.35)",
  },

  row: { display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" },
  rowBetween: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
  },

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

  summary: {
    cursor: "pointer",
    fontWeight: 800,
    fontSize: 16,
    marginBottom: 10,
  },

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
};
