import React, { useEffect, useMemo, useState } from "react";
import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  type User,
} from "firebase/auth";
import { collection, onSnapshot, orderBy, query } from "firebase/firestore";
import { auth, db } from "./firebase";
import { useBatches } from "./hooks/useBatches";
import { createPortalApi, PortalApiError } from "./api/portalApi";
import type { PortalApiMeta } from "./api/portalContracts";
import { getResultBatchId } from "./api/portalContracts";
import type { TimelineEvent } from "./types/domain";
import "./App.css";

type NavKey =
  | "dashboard"
  | "pieces"
  | "kiln"
  | "classes"
  | "reservations"
  | "events"
  | "membership"
  | "billing"
  | "messages"
  | "support"
  | "staff";

type NavItem = {
  key: NavKey;
  label: string;
  hint?: string;
};

const CLIENT_NAV: NavItem[] = [
  { key: "dashboard", label: "Dashboard" },
  { key: "pieces", label: "My Pieces" },
  { key: "kiln", label: "Kiln Schedule" },
  { key: "classes", label: "Classes" },
  { key: "reservations", label: "Reservations" },
  { key: "events", label: "Events" },
  { key: "membership", label: "Membership" },
  { key: "billing", label: "Billing" },
  { key: "messages", label: "Messages" },
  { key: "support", label: "Support" },
];

const STAFF_NAV: NavItem[] = [
  ...CLIENT_NAV,
  { key: "staff", label: "Staff Console", hint: "Staff" },
];

const SAMPLE_KILNS = [
  { name: "Kiln 3", status: "Firing", temp: "2200F", eta: "6h" },
  { name: "Kiln 1", status: "Loading", temp: "Ambient", eta: "Tonight" },
];

const SAMPLE_CLASSES = [
  { name: "Wheel Lab", time: "Sat 10:00 AM", seats: "3 open" },
  { name: "Glaze Science", time: "Sun 4:00 PM", seats: "Waitlist" },
];

const SAMPLE_UPDATES = [
  {
    title: "Monsoon Members Night",
    note: "Open studio until 9 PM this Friday. Bring a friend.",
  },
  {
    title: "Kiln Maintenance Window",
    note: "Kiln 2 will be offline Monday afternoon.",
  },
  {
    title: "New Glaze Arrivals",
    note: "Ask staff about the new desert haze palette.",
  },
];

const SAMPLE_MESSAGES = [
  {
    sender: "Studio",
    subject: "Pickup reminder",
    preview: "Your stoneware vase is ready for pickup.",
  },
  {
    sender: "Micah",
    subject: "Class update",
    preview: "We opened two spots in Wheel Lab on Saturday.",
  },
];

const PIECES_PREVIEW_COUNT = 10;
const DASHBOARD_PIECES_PREVIEW = 3;
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
      <div className="error-screen">
        <div className="error-card">
          <div className="error-title">Monsoon Fire Portal</div>
          <div className="error-copy">
            The app hit a runtime error. Refresh usually fixes it.
          </div>
          <pre className="error-pre">{this.state.message}</pre>
          <button className="btn btn-primary" onClick={() => window.location.reload()}>
            Reload
          </button>
        </div>
      </div>
    );
  }
}

function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function getShortName(user: User) {
  if (user.displayName) return user.displayName.split(" ")[0];
  if (user.email) return user.email.split("@")[0];
  return "there";
}

function formatMaybeTimestamp(value: unknown): string {
  if (!value || typeof value !== "object") return "-";
  const maybe = value as { toDate?: () => Date };
  if (typeof maybe.toDate !== "function") return "-";
  try {
    return maybe.toDate().toLocaleString();
  } catch {
    return "-";
  }
}

function formatCents(value: unknown): string {
  if (typeof value !== "number") return "-";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(value / 100);
}

function DashboardView({
  user,
  name,
  onOpenMessages,
  onOpenPieces,
}: {
  user: User;
  name: string;
  onOpenMessages: () => void;
  onOpenPieces: () => void;
}) {
  const { active, history } = useBatches(user);
  const activePreview = active.slice(0, DASHBOARD_PIECES_PREVIEW);
  const archivedCount = history.length;

  return (
    <div className="dashboard">
      <section className="card hero-card">
        <div className="hero-content">
          <p className="eyebrow">Client Dashboard</p>
          <h1>
            {getGreeting()}, {name}.
          </h1>
          <p className="hero-copy">
            Track your wares, reserve kiln time, and keep up with studio life from one place.
          </p>
          <div className="hero-actions">
            <button className="btn btn-primary">Book a class</button>
            <button className="btn btn-ghost">View kiln schedule</button>
          </div>
        </div>
        <div className="hero-media">
          <img className="hero-logo" src="/branding/logo.png" alt="Monsoon Fire logo" />
        </div>
      </section>

      <section className="dashboard-grid">
        <div className="card card-3d">
          <div className="card-title">Studio snapshot</div>
          <div className="stat-grid">
            <div className="stat">
              <div className="stat-label">Pieces in progress</div>
              <div className="stat-value">{active.length}</div>
            </div>
            <div className="stat">
              <div className="stat-label">Ready for pickup</div>
              <div className="stat-value">{archivedCount}</div>
            </div>
            <div className="stat">
              <div className="stat-label">Membership level</div>
              <div className="stat-value">Studio</div>
            </div>
          </div>
        </div>

        <div className="card card-3d">
          <div className="card-title">Kilns firing now</div>
          <div className="list">
            {SAMPLE_KILNS.map((kiln) => (
              <div className="list-row" key={kiln.name}>
                <div>
                  <div className="list-title">{kiln.name}</div>
                  <div className="list-meta">{kiln.status}</div>
                </div>
                <div className="list-right">
                  <div className="pill">{kiln.temp}</div>
                  <div className="list-meta">ETA {kiln.eta}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="card card-3d">
          <div className="card-title">Your pieces</div>
          {activePreview.length === 0 ? (
            <div className="empty-state">No pieces in progress right now.</div>
          ) : (
            <div className="list">
              {activePreview.map((piece) => (
                <div className="list-row" key={piece.id}>
                  <div>
                    <div className="list-title">{piece.title || "Untitled piece"}</div>
                    <div className="list-meta">{piece.status || "In progress"}</div>
                  </div>
                  <div className="pill">{formatMaybeTimestamp(piece.updatedAt)}</div>
                </div>
              ))}
            </div>
          )}
          <button className="btn btn-ghost dashboard-link" onClick={onOpenPieces}>
            View all pieces
          </button>
        </div>

        <div className="card card-3d">
          <div className="card-title">Upcoming classes</div>
          <div className="list">
            {SAMPLE_CLASSES.map((item) => (
              <div className="list-row" key={item.name}>
                <div>
                  <div className="list-title">{item.name}</div>
                  <div className="list-meta">{item.time}</div>
                </div>
                <div className="pill">{item.seats}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="card card-3d span-2">
          <div className="card-title">Studio updates</div>
          <div className="updates">
            {SAMPLE_UPDATES.map((item) => (
              <div className="update" key={item.title}>
                <div className="update-title">{item.title}</div>
                <p className="update-note">{item.note}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="card card-3d">
          <div className="card-title">Messages</div>
          <div className="messages-preview">
            {SAMPLE_MESSAGES.map((message) => (
              <div className="message" key={message.subject}>
                <div className="message-top">
                  <span className="message-sender">{message.sender}</span>
                  <span className="message-subject">{message.subject}</span>
                </div>
                <div className="message-preview">{message.preview}</div>
              </div>
            ))}
          </div>
          <button className="btn btn-ghost" onClick={onOpenMessages}>
            Open messages
          </button>
        </div>

        <div className="card card-3d span-2 archived-summary">
          <div>
            <div className="card-title">Archived pieces</div>
            <div className="archived-count">
              {archivedCount === 0
                ? "No archived pieces yet."
                : `${archivedCount} piece${archivedCount === 1 ? "" : "s"} archived.`}
            </div>
          </div>
          <button className="btn btn-ghost" onClick={onOpenPieces}>
            Show more
          </button>
        </div>
      </section>
    </div>
  );
}

function MyPiecesView({
  user,
  onContinueJourney,
  onArchive,
  isBusy,
  status,
  meta,
}: {
  user: User;
  onContinueJourney: (batchId: string) => void;
  onArchive: (batchId: string) => void;
  isBusy: (key: string) => boolean;
  status: string;
  meta: PortalApiMeta | null;
}) {
  const { active, history, error } = useBatches(user);
  const canContinue = active.length === 0;
  const [showAllActive, setShowAllActive] = useState(false);
  const [showAllHistory, setShowAllHistory] = useState(false);
  const [timelineBatchId, setTimelineBatchId] = useState<string | null>(null);
  const [timelineEvents, setTimelineEvents] = useState<TimelineEvent[]>([]);
  const [timelineLoading, setTimelineLoading] = useState(false);
  const [timelineError, setTimelineError] = useState("");

  const visibleActive = showAllActive ? active : active.slice(0, PIECES_PREVIEW_COUNT);
  const visibleHistory = showAllHistory ? history : history.slice(0, PIECES_PREVIEW_COUNT);

  useEffect(() => {
    if (!timelineBatchId) return;

    setTimelineLoading(true);
    setTimelineError("");
    setTimelineEvents([]);

    const timelineQuery = query(
      collection(db, "batches", timelineBatchId, "timeline"),
      orderBy("at", "asc")
    );

    const unsub = onSnapshot(
      timelineQuery,
      (snap) => {
        const rows: TimelineEvent[] = snap.docs.map((doc) => ({
          id: doc.id,
          ...(doc.data() as any),
        }));
        setTimelineEvents(rows);
        setTimelineLoading(false);
      },
      (err) => {
        setTimelineError(`Timeline failed: ${err.message}`);
        setTimelineLoading(false);
      }
    );

    return () => unsub();
  }, [timelineBatchId]);

  function toggleTimeline(batchId: string) {
    setTimelineBatchId((prev) => (prev === batchId ? null : batchId));
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

      <div className="pieces-grid">
        <div className="card card-3d">
          <div className="card-title">In progress</div>
          {active.length === 0 ? (
            <div className="empty-state">No active pieces yet.</div>
          ) : (
            <div className="pieces-list">
              {visibleActive.map((batch) => (
                <div className="piece-row" key={batch.id}>
                  <div>
                    <div className="piece-title">{batch.title || "Untitled piece"}</div>
                    <div className="piece-meta">ID: {batch.id}</div>
                    <div className="piece-meta">Status: {batch.status || "In progress"}</div>
                  </div>
                  <div className="piece-right">
                    {batch.status ? <div className="pill">{batch.status}</div> : null}
                    <div className="piece-meta">Updated: {formatMaybeTimestamp(batch.updatedAt)}</div>
                    <div className="piece-meta">Est. cost: {formatCents(batch.estimatedCostCents ?? batch.priceCents)}</div>
                    <div className="piece-actions">
                      <button className="btn btn-ghost" onClick={() => toggleTimeline(batch.id)}>
                        {timelineBatchId === batch.id ? "Hide timeline" : "View timeline"}
                      </button>
                      <button
                        className="btn btn-ghost"
                        onClick={() => onArchive(batch.id)}
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
                                <div className="timeline-title">{ev.type || "Event"}</div>
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

        <div className="card card-3d">
          <div className="card-title">Completed</div>
          {history.length === 0 ? (
            <div className="empty-state">No completed pieces yet.</div>
          ) : (
            <div className="pieces-list">
              {visibleHistory.map((batch) => (
                <div className="piece-row" key={batch.id}>
                  <div>
                    <div className="piece-title">{batch.title || "Untitled piece"}</div>
                    <div className="piece-meta">ID: {batch.id}</div>
                    <div className="piece-meta">Closed: {formatMaybeTimestamp(batch.closedAt)}</div>
                  </div>
                  <div className="piece-right">
                    <div className="pill">Complete</div>
                    <div className="piece-meta">Updated: {formatMaybeTimestamp(batch.updatedAt)}</div>
                    <div className="piece-meta">Final cost: {formatCents(batch.priceCents ?? batch.estimatedCostCents)}</div>
                    <div className="piece-actions">
                      <button className="btn btn-ghost" onClick={() => toggleTimeline(batch.id)}>
                        {timelineBatchId === batch.id ? "Hide timeline" : "View timeline"}
                      </button>
                      <button
                        className="btn btn-ghost"
                        onClick={() => onContinueJourney(batch.id)}
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
                                <div className="timeline-title">{ev.type || "Event"}</div>
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
      </div>

      {meta ? (
        <details className="card card-3d troubleshooting">
          <summary>Request details</summary>
          <pre className="mono">{JSON.stringify(meta, null, 2)}</pre>
        </details>
      ) : null}
    </div>
  );
}

function MessagesView() {
  return (
    <div className="page">
      <div className="page-header">
        <h1>Messages</h1>
        <p className="page-subtitle">
          Keep conversations with the studio in one place. Messaging is coming online here.
        </p>
      </div>
      <div className="card card-3d">
        <div className="card-title">Latest</div>
        <div className="messages-preview">
          {SAMPLE_MESSAGES.map((message) => (
            <div className="message" key={message.subject}>
              <div className="message-top">
                <span className="message-sender">{message.sender}</span>
                <span className="message-subject">{message.subject}</span>
              </div>
              <div className="message-preview">{message.preview}</div>
            </div>
          ))}
        </div>
        <button className="btn btn-primary">Start a new message</button>
      </div>
    </div>
  );
}

function PlaceholderView({ title, description }: { title: string; description: string }) {
  return (
    <div className="page">
      <div className="page-header">
        <h1>{title}</h1>
        <p className="page-subtitle">{description}</p>
      </div>
      <div className="card card-3d">
        <div className="placeholder">This section is staged for the production build.</div>
        <button className="btn btn-ghost">Notify me when ready</button>
      </div>
    </div>
  );
}

function SignedOutView({ onSignIn, busy }: { onSignIn: () => void; busy: boolean }) {
  return (
    <div className="signed-out">
      <div className="signed-out-card">
        <img className="signed-out-logo" src="/branding/logo.png" alt="Monsoon Fire logo" />
        <h1>Monsoon Fire Pottery Studio</h1>
        <p>
          A modern home for your studio journey. Track wares, plan classes, and stay connected with
          the kiln schedule.
        </p>
        <button className="btn btn-primary" onClick={onSignIn} disabled={busy}>
          {busy ? "Signing in..." : "Sign in with Google"}
        </button>
      </div>
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [activeNav, setActiveNav] = useState<NavKey>("dashboard");
  const [authBusy, setAuthBusy] = useState(false);
  const [piecesStatus, setPiecesStatus] = useState<string>("");
  const [piecesMeta, setPiecesMeta] = useState<PortalApiMeta | null>(null);
  const [inFlight, setInFlight] = useState<Record<string, boolean>>({});
  const [adminToken, setAdminToken] = useState<string>(() => {
    return localStorage.getItem(DEV_ADMIN_TOKEN_STORAGE_KEY) || "";
  });

  const api = useMemo(() => createPortalApi(), []);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => setUser(u));
    return () => unsub();
  }, []);

  useEffect(() => {
    localStorage.setItem(DEV_ADMIN_TOKEN_STORAGE_KEY, adminToken);
  }, [adminToken]);

  const isStaff = useMemo(() => {
    if (!user?.email) return false;
    return user.email.toLowerCase().endsWith("@monsoonfire.com");
  }, [user]);

  const navItems = isStaff ? STAFF_NAV : CLIENT_NAV;

  const activeLabel = useMemo(() => {
    return navItems.find((item) => item.key === activeNav)?.label || "Dashboard";
  }, [activeNav, navItems]);

  const roleLabel = isStaff ? "Staff" : "Client";

  function setBusy(key: string, value: boolean) {
    setInFlight((prev) => ({ ...prev, [key]: value }));
  }

  function isBusy(key: string) {
    return !!inFlight[key];
  }

  async function handleSignIn() {
    if (authBusy) return;
    setAuthBusy(true);
    try {
      await signInWithPopup(auth, new GoogleAuthProvider());
    } finally {
      setAuthBusy(false);
    }
  }

  async function handleContinueJourney(fromBatchId: string) {
    if (!user) return;
    const key = `continue:${fromBatchId}`;
    if (isBusy(key)) return;
    setBusy(key, true);
    setPiecesStatus("");

    try {
      const idToken = await user.getIdToken();
      const payload = { uid: user.uid, fromBatchId };
      const { data, meta } = await api.continueJourney({
        idToken,
        adminToken: adminToken.trim() || undefined,
        payload,
      });
      setPiecesMeta(meta);
      const newId = getResultBatchId(data);
      setPiecesStatus(newId ? `Journey continued: ${newId}` : "Journey continued.");
    } catch (err: any) {
      if (err instanceof PortalApiError) setPiecesMeta(err.meta);
      setPiecesStatus(`Continue journey failed: ${err?.message || String(err)}`);
    } finally {
      setBusy(key, false);
    }
  }

  async function handleArchive(batchId: string) {
    if (!user) return;
    const key = `archive:${batchId}`;
    if (isBusy(key)) return;
    setBusy(key, true);
    setPiecesStatus("");

    try {
      const idToken = await user.getIdToken();
      const payload = { uid: user.uid, batchId };
      const { meta } = await api.pickedUpAndClose({
        idToken,
        adminToken: adminToken.trim() || undefined,
        payload,
      });
      setPiecesMeta(meta);
      setPiecesStatus("Piece archived.");
    } catch (err: any) {
      if (err instanceof PortalApiError) setPiecesMeta(err.meta);
      setPiecesStatus(`Archive failed: ${err?.message || String(err)}`);
    } finally {
      setBusy(key, false);
    }
  }

  if (!user) {
    return (
      <AppErrorBoundary>
        <SignedOutView onSignIn={handleSignIn} busy={authBusy} />
      </AppErrorBoundary>
    );
  }

  const name = getShortName(user);

  return (
    <AppErrorBoundary>
      <div className="app-root">
        <div className="app-bg" />
        <div className={`nav-overlay ${drawerOpen ? "show" : ""}`} onClick={() => setDrawerOpen(false)} />
        <div className="app-shell">
          <aside className={`app-nav ${drawerOpen ? "open" : ""}`}>
            <div className="nav-brand">
              <img src="/branding/logo.png" alt="Monsoon Fire" />
              <div>
                <div className="brand-title">Monsoon Fire</div>
                <div className="brand-sub">Pottery Studio</div>
              </div>
            </div>
            <div className="nav-section">Navigation</div>
            <nav className="nav-links">
              {navItems.map((item) => (
                <button
                  key={item.key}
                  className={`nav-item ${activeNav === item.key ? "active" : ""}`}
                  onClick={() => {
                    setActiveNav(item.key);
                    setDrawerOpen(false);
                  }}
                >
                  <span>{item.label}</span>
                  {item.hint ? <span className="nav-hint">{item.hint}</span> : null}
                </button>
              ))}
            </nav>
            <div className="nav-footer">
              <div className="nav-user">
                <div className="nav-avatar">
                  {user.photoURL ? (
                    <img src={user.photoURL} alt={user.displayName || "User"} />
                  ) : (
                    <span>{name.slice(0, 1).toUpperCase()}</span>
                  )}
                </div>
                <div>
                  <div className="nav-user-name">{user.displayName || user.email || "Member"}</div>
                  <div className="nav-user-role">{roleLabel}</div>
                </div>
              </div>
              {import.meta.env.DEV ? (
                <div className="dev-token">
                  <label htmlFor="dev-admin-token">Dev admin token</label>
                  <input
                    id="dev-admin-token"
                    type="password"
                    placeholder="x-admin-token"
                    value={adminToken}
                    onChange={(event) => setAdminToken(event.target.value)}
                  />
                </div>
              ) : null}
              <button className="btn btn-ghost" onClick={() => signOut(auth)}>
                Sign out
              </button>
            </div>
          </aside>

          <div className="app-main">
            <header className="top-bar">
              <div className="top-left">
                <button className="icon-btn" onClick={() => setDrawerOpen(true)} aria-label="Open navigation">
                  <span />
                </button>
                <div>
                  <div className="top-title">{activeLabel}</div>
                  <div className="top-subtitle">Phoenix studio overview</div>
                </div>
              </div>
              <div className="top-actions">
                <div className="pill">{roleLabel}</div>
                <button className="btn btn-ghost" onClick={() => signOut(auth)}>
                  Sign out
                </button>
              </div>
            </header>

            <main className="app-content">
              {activeNav === "dashboard" ? (
                <DashboardView
                  user={user}
                  name={name}
                  onOpenMessages={() => setActiveNav("messages")}
                  onOpenPieces={() => setActiveNav("pieces")}
                />
              ) : activeNav === "messages" ? (
                <MessagesView />
              ) : activeNav === "pieces" ? (
                <MyPiecesView
                  user={user}
                  onContinueJourney={handleContinueJourney}
                  onArchive={handleArchive}
                  isBusy={isBusy}
                  status={piecesStatus}
                  meta={piecesMeta}
                />
              ) : (
                <PlaceholderView
                  title={activeLabel}
                  description="This page is being redesigned with the full Monsoon Fire experience."
                />
              )}
            </main>
          </div>
        </div>
      </div>
    </AppErrorBoundary>
  );
}
