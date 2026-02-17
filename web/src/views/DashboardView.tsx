import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { User } from "firebase/auth";
import { collection, getDocs, limit, orderBy, query } from "firebase/firestore";
import RevealCard from "../components/RevealCard";
import { useUiSettings } from "../context/UiSettingsContext";
import { db } from "../firebase";
import { type PortalThemeName } from "../theme/themes";
import { mockFirings, mockKilns } from "../data/kilnScheduleMock";
import { useBatches } from "../hooks/useBatches";
import { normalizeFiringDoc as normalizeFiringRow, normalizeKilnDoc as normalizeKilnRow } from "../lib/normalizers/kiln";
import type { Kiln, KilnFiring } from "../types/kiln";
import type { Announcement, DirectMessageThread } from "../types/messaging";
import { formatMaybeTimestamp } from "../utils/format";

const SAMPLE_WORKSHOPS = [
  {
    name: "Wheel Lab",
    time: "Sat 10:00 AM",
    spotsLeft: 3,
    waitlist: 0,
    level: "Beginner",
  },
  {
    name: "Glaze Science",
    time: "Sun 4:00 PM",
    spotsLeft: 0,
    waitlist: 6,
    level: "Intermediate",
  },
];

const DASHBOARD_PIECES_PREVIEW = 3;

const STATUS_LABELS: Record<string, string> = {
  idle: "Idle",
  loading: "Loading",
  firing: "Firing",
  cooling: "Cooling",
  unloading: "Unloading",
  maintenance: "Maintenance",
};

const PRIMARY_KILN_NAME = "L&L eQ2827-3";
const RAKU_KILN_NAME = "Reduction Raku Kiln";

type KilnRow = {
  id: string;
  name: string;
  timeLabel: string;
  statusLabel: string;
  pill: string;
  etaLabel: string;
  firingTypeLabel: string;
  progress: number | null;
  isOffline: boolean;
};

function isPermissionDenied(err: unknown) {
  const message = (err as { message?: string })?.message ?? "";
  const code = (err as { code?: string })?.code ?? "";
  return code === "permission-denied" || /missing or insufficient permissions/i.test(message);
}

function coerceDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  if (typeof value === "object") {
    const maybe = value as { toDate?: () => Date };
    if (typeof maybe.toDate === "function") {
      return maybe.toDate();
    }
  }
  return null;
}

function formatRelativeEta(target: Date, now: Date) {
  const diffMs = target.getTime() - now.getTime();
  if (diffMs <= 0) return "now";
  const minutes = Math.round(diffMs / 60000);
  if (minutes < 60) return `in ${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `in ${hours}h`;
  const days = Math.round(hours / 24);
  return `in ${days}d`;
}

function formatShortDate(value: Date) {
  return value.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function inferFiringTypeLabel(value?: string) {
  if (!value) return "Firing";
  const normalized = value.toLowerCase();
  if (normalized.includes("bisque")) return "Bisque";
  if (normalized.includes("glaze")) return "Glaze";
  if (normalized.includes("raku")) return "Raku";
  return "Firing";
}

function useKilnDashboardRows() {
  const [kilns, setKilns] = useState<Kiln[]>([]);
  const [firings, setFirings] = useState<KilnFiring[]>([]);
  const [loading, setLoading] = useState(true);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const isMountedRef = useRef(true);

  const reload = useCallback(async () => {
    if (!isMountedRef.current) return;

    setPermissionDenied(false);
    setLoading(true);

    try {
      const kilnsQuery = query(collection(db, "kilns"), orderBy("name", "asc"), limit(25));
      const firingsQuery = query(collection(db, "kilnFirings"), orderBy("startAt", "asc"), limit(200));
      const [kilnSnap, firingSnap] = await Promise.all([getDocs(kilnsQuery), getDocs(firingsQuery)]);
      if (!isMountedRef.current) return;
      setKilns(
        kilnSnap.docs.map((docSnap) => ({
          ...normalizeKilnRow(docSnap.id, docSnap.data() as Partial<Kiln>),
        }))
      );
      setFirings(
        firingSnap.docs.map((docSnap) => ({
          ...normalizeFiringRow(docSnap.id, docSnap.data() as Partial<KilnFiring>),
        }))
      );
    } catch (err) {
      if (!isMountedRef.current) return;
      if (isPermissionDenied(err)) {
        setPermissionDenied(true);
        setKilns([]);
        setFirings([]);
      }
    } finally {
      if (isMountedRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    isMountedRef.current = true;
    void reload();
    return () => {
      isMountedRef.current = false;
    };
  }, [reload]);

  const useMock = import.meta.env.DEV && (permissionDenied || (!loading && kilns.length === 0 && firings.length === 0));
  const rawKilns = useMock ? mockKilns : kilns;
  const rawFirings = useMock ? mockFirings : firings;
  const noData = !loading && !permissionDenied && kilns.length === 0 && firings.length === 0;
  const showRetry = permissionDenied || noData;
  const statusNotice = permissionDenied
    ? "Unable to load kiln schedules. Permissions may not be configured yet."
    : noData
      ? "No kiln status available yet."
      : loading
        ? "Loading kiln status..."
        : "";

  const primaryKiln =
    rawKilns.find((kiln) => kiln.name === PRIMARY_KILN_NAME) ??
    rawKilns.find((kiln) => /eQ2827|L&L/i.test(kiln.name)) ??
    rawKilns[0];
  const rakuKiln =
    rawKilns.find((kiln) => kiln.name === RAKU_KILN_NAME) ??
    rawKilns.find((kiln) => /raku|reduction/i.test(kiln.name)) ??
    rawKilns[1];

  const displayKilns = [primaryKiln, rakuKiln].filter(
    (kiln, index, arr) => kiln && arr.findIndex((item) => item?.id === kiln?.id) === index
  );

  const normalizedFirings = useMemo(() => {
    return rawFirings
      .map((firing) => {
        const startDate = coerceDate(firing.startAt);
        const endDate = coerceDate(firing.endAt);
        if (!startDate || !endDate) return null;
        return { ...firing, startDate, endDate };
      })
      .filter(Boolean) as Array<KilnFiring & { startDate: Date; endDate: Date }>;
  }, [rawFirings]);

  const nextFiring = useMemo(() => {
    const now = new Date();
    return normalizedFirings
      .filter((firing) => firing.status !== "cancelled" && firing.startDate > now)
      .sort((a, b) => a.startDate.getTime() - b.startDate.getTime())[0];
  }, [normalizedFirings]);

  const rows: KilnRow[] = useMemo(() => {
    const now = new Date();
    return displayKilns
      .filter(Boolean)
      .map((kiln) => {
        const isRaku = /raku/i.test(kiln.name);
        const isOffline = kiln.status === "offline";
        const active = normalizedFirings.find(
          (firing) =>
            firing.kilnId === kiln.id &&
            firing.status !== "cancelled" &&
            firing.startDate <= now &&
            firing.endDate >= now
        );
        const next = normalizedFirings
          .filter(
            (firing) =>
              firing.kilnId === kiln.id &&
              firing.status !== "cancelled" &&
              firing.startDate > now
          )
            .sort((a, b) => a.startDate.getTime() - b.startDate.getTime())[0];

        const statusLabel = isOffline
          ? "Offline"
          : active
            ? "Firing now"
            : STATUS_LABELS[kiln.status] || "Idle";
        const pill = isOffline
          ? "Offline"
          : active
            ? active.title || active.cycleType || "Firing"
            : next
              ? next.title || next.cycleType || "Scheduled"
              : STATUS_LABELS[kiln.status] || "Idle";
        const etaLabel = isOffline
          ? "Temporarily offline"
          : active
            ? `Ends ${formatRelativeEta(active.endDate, now)}`
          : next
            ? `Starts ${formatRelativeEta(next.startDate, now)}`
            : "No firing scheduled";
        const firingSource = active ?? next;
        const firingTypeLabel = inferFiringTypeLabel(
          firingSource?.title || firingSource?.cycleType || ""
        );
        const timeLabel = isOffline
          ? "Offline"
          : active
            ? `Ends ${formatRelativeEta(active.endDate, now)}`
            : next
              ? `Starts ${formatRelativeEta(next.startDate, now)}`
              : "No start scheduled";
        const progress =
          active && active.endDate.getTime() > active.startDate.getTime()
            ? Math.min(
                1,
                Math.max(
                  0,
                  (now.getTime() - active.startDate.getTime()) /
                    (active.endDate.getTime() - active.startDate.getTime())
                )
              )
            : null;

        return {
          id: kiln.id,
          name: isRaku ? "Raku" : kiln.name,
          timeLabel,
          statusLabel,
          pill,
          etaLabel,
          firingTypeLabel,
          progress,
          isOffline,
        };
      });
  }, [displayKilns, normalizedFirings]);

  const nextFiringLabel = nextFiring
    ? `${formatShortDate(nextFiring.startDate)} · ${nextFiring.title || nextFiring.cycleType || "Firing"}`
    : permissionDenied
      ? "Firing schedule unavailable."
      : "No firings scheduled yet";

  return { rows, nextFiringLabel, statusNotice, useMock, permissionDenied, loading, reload, showRetry };
}

type Props = {
  user: User;
  name: string;
  themeName: PortalThemeName;
  onThemeChange: (next: PortalThemeName) => void;
  threads: DirectMessageThread[];
  announcements: Announcement[];
  onOpenKilnRentals: () => void;
  onOpenCheckin: () => void;
  onOpenQueues: () => void;
  onOpenFirings: () => void;
  onOpenStudioResources: () => void;
  onOpenGlazeBoard: () => void;
  onOpenCommunity: () => void;
  onOpenMessages: () => void;
  onOpenPieces: () => void;
};

export default function DashboardView({
  user,
  name,
  themeName,
  onThemeChange,
  threads,
  announcements,
  onOpenKilnRentals,
  onOpenCheckin,
  onOpenQueues,
  onOpenFirings,
  onOpenStudioResources,
  onOpenGlazeBoard,
  onOpenCommunity,
  onOpenMessages,
  onOpenPieces,
}: Props) {
  const { themeName: resolvedThemeName, portalMotion } = useUiSettings();
  const motionEnabled = resolvedThemeName === "memoria" && portalMotion === "enhanced";
  const isDarkTheme = themeName === "memoria";
  const nextTheme = isDarkTheme ? "portal" : "memoria";
  const nextThemeLabel = isDarkTheme ? "light" : "dark";
  const { active, history } = useBatches(user);
  const activePreview = active.slice(0, DASHBOARD_PIECES_PREVIEW);
  const archivedCount = history.length;
  const messagePreview = threads.slice(0, 3);
  const announcementPreview = announcements.slice(0, 3);
  const {
    rows: kilnRows,
    nextFiringLabel,
    statusNotice,
    useMock,
    permissionDenied,
    showRetry,
    loading: kilnLoading,
    reload: reloadKilns,
  } = useKilnDashboardRows();
  const queueFillCount = Math.min(8, Math.max(active.length, 0));
  const queueFillRatio = Math.min(1, queueFillCount / 8);
  const averageTurnaroundDays = useMemo(() => {
    const durations = history
      .map((item) => {
        const created = coerceDate(item.createdAt);
        const closed = coerceDate(item.closedAt);
        if (!created || !closed) return null;
        const diffDays = (closed.getTime() - created.getTime()) / (1000 * 60 * 60 * 24);
        return diffDays > 0 ? diffDays : null;
      })
      .filter(Boolean) as number[];
    if (durations.length === 0) return null;
    const sample = durations.slice(0, 8);
    const avg = sample.reduce((total, value) => total + value, 0) / sample.length;
    return Math.round(avg);
  }, [history]);
  const nextPiece = activePreview[0];
  const nextPieceStatus = nextPiece?.status || "In progress";
  const nextPieceEta = nextPiece?.updatedAt
    ? formatMaybeTimestamp(nextPiece.updatedAt)
    : "Check back soon";
  const kilnEmptyStateLabel = statusNotice || "No kiln status available yet.";

  return (
    <div className="dashboard">
      <RevealCard as="section" className="card hero-card" index={0} enabled={motionEnabled}>
        <div className="hero-content">
          <div className="hero-toolbar">
            <div className="hero-title-block">
              <h1>Your studio dashboard</h1>
              <div className="hero-profile">
                <span className="hero-profile-label">Signed in as</span>
                <span className="hero-profile-name">{name}</span>
                {user.email ? <span className="hero-profile-meta">{user.email}</span> : null}
              </div>
            </div>
            <button
              type="button"
              className="theme-toggle-button"
              onClick={() => {
                onThemeChange(nextTheme);
              }}
              aria-label={`Switch to ${nextThemeLabel} theme`}
              title={`Switch to ${nextThemeLabel} theme`}
              aria-pressed={isDarkTheme}
            >
              <span className="theme-toggle-icon" aria-hidden="true">
                {isDarkTheme ? "☀️" : "🌙"}
              </span>
              {`Switch to ${nextThemeLabel} theme`}
            </button>
          </div>
          <div className="hero-actions">
            <button className="btn btn-primary" onClick={onOpenKilnRentals}>
              Kiln rentals
            </button>
            <button className="btn btn-ghost" onClick={onOpenStudioResources}>
              Studio &amp; resources
            </button>
            <button className="btn btn-ghost" onClick={onOpenCommunity}>
              Community
            </button>
          </div>
        </div>
        <div className="hero-updates">
          <div className="hero-updates-title">Studio updates</div>
          {announcementPreview.length === 0 ? (
            <div className="hero-updates-empty">No studio announcements yet.</div>
          ) : (
            <div className="hero-updates-list">
              {announcementPreview.map((item) => (
                <div className="hero-update" key={item.id}>
                  <div className="hero-update-title">{item.title || "Studio update"}</div>
                  <p className="hero-update-body">{item.body || "Details coming soon."}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </RevealCard>

      <section className="quick-actions">
        <RevealCard className="card card-3d quick-action-card" index={1} enabled={motionEnabled}>
          <div className="card-title">Quick actions</div>
          <div className="quick-action-row">
            <button className="btn btn-primary" onClick={onOpenCheckin}>
              Start a check-in
            </button>
            <button className="btn btn-ghost" onClick={onOpenQueues}>
              View the queues
            </button>
            <button className="btn btn-ghost" onClick={onOpenFirings}>
              Firings
            </button>
            <button className="btn btn-ghost" onClick={onOpenGlazeBoard}>
              Glaze inspiration
            </button>
            <button className="btn btn-ghost" onClick={onOpenMessages}>
              Message the studio
            </button>
          </div>
          <p className="quick-action-note">Pick a lane and we will take it from there.</p>
        </RevealCard>
      </section>

      <section className="dashboard-grid">
        <RevealCard className="card card-3d" index={2} enabled={motionEnabled}>
          <div className="card-title">Your pieces</div>
          <div className="card-subtitle">Personal queue</div>
          {activePreview.length === 0 ? (
            <div className="empty-block">
              <div className="empty-state">Nothing in the kiln line yet.</div>
              <div className="empty-meta">Add work to the next firing.</div>
              <button className="btn btn-primary" onClick={onOpenCheckin}>
                Start a Check-In
              </button>
            </div>
          ) : (
            <div className="pieces-preview">
              <div className="pieces-next">
                <div className="pieces-next-label">Next status</div>
                <div className="pieces-next-title">{nextPieceStatus}</div>
                <div className="pieces-next-meta">{nextPieceEta}</div>
              </div>
              <div className="pieces-thumbs">
                {activePreview.map((piece, index) => {
                  const title = piece.title || "Piece";
                  const initials = title
                    .split(" ")
                    .filter(Boolean)
                    .slice(0, 2)
                    .map((word) => word[0]?.toUpperCase())
                    .join("");
                  return (
                    <div
                      key={piece.id}
                      className="piece-thumb"
                      aria-label={`${title} preview`}
                      title={title}
                      data-index={index + 1}
                    >
                      {initials || "•"}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          <button className="btn btn-ghost dashboard-link" onClick={onOpenPieces}>
            Open My Pieces
          </button>
        </RevealCard>

        <RevealCard className="card card-3d" index={3} enabled={motionEnabled}>
          <div className="card-title">Studio snapshot</div>
          <div className="card-subtitle">Studio-wide status</div>
          <div className="snapshot-grid">
            <div className="snapshot-block">
              <div className="snapshot-label">Next scheduled firing</div>
              <div className="snapshot-value">{nextFiringLabel}</div>
            </div>
            <div className="snapshot-block">
              <div className="snapshot-label">Queue fullness</div>
              <div className="snapshot-value">
                {queueFillCount} / 8 half shelves
              </div>
              <progress
                className="meter"
                value={Math.round(queueFillRatio * 100)}
                max={100}
                aria-label="Queue fullness"
              />
            </div>
            <div className="snapshot-block">
              <div className="snapshot-label">Average turnaround this month</div>
              <div className="snapshot-value">
                {averageTurnaroundDays ? `${averageTurnaroundDays} days` : "We are still collecting data"}
              </div>
            </div>
          </div>
        </RevealCard>

        <RevealCard className="card card-3d" index={4} enabled={motionEnabled}>
          <div className="card-title">Kilns firing now</div>
          {useMock ? <div className="notice">Using sample kiln data for development.</div> : null}
          {useMock && permissionDenied ? (
            <div className="notice" role="status" aria-live="polite">
              {statusNotice}
            </div>
          ) : null}
          <div className="list">
            {kilnRows.length === 0 ? (
              <div className="empty-state" role="status" aria-live="polite">
                {kilnEmptyStateLabel}
              </div>
            ) : (
              kilnRows.map((kiln) => (
                <div className={`list-row kiln-row ${kiln.isOffline ? "kiln-offline" : ""}`} key={kiln.id}>
                  <div className="kiln-left">
                    <div className="list-title">{kiln.name}</div>
                    <div className="kiln-time" title={`Firing type: ${kiln.firingTypeLabel}`}>
                      {kiln.timeLabel}
                    </div>
                    <div className="list-meta">{kiln.statusLabel}</div>
                  </div>
                  <div className="list-right">
                    <div className="pill">{kiln.pill}</div>
                    <div className="list-meta">{kiln.etaLabel}</div>
                  </div>
                  <progress
                    className="kiln-progress"
                    value={Math.round((kiln.progress ?? 0) * 100)}
                    max={100}
                    aria-label="Kiln progress"
                    aria-hidden="true"
                  />
                </div>
              ))
            )}
          </div>
          {showRetry && !kilnLoading ? (
            <button className="btn btn-secondary" onClick={() => void reloadKilns()} disabled={kilnLoading}>
              Retry loading kiln status
            </button>
          ) : null}
        </RevealCard>

        <RevealCard className="card card-3d" index={5} enabled={motionEnabled}>
          <div className="card-title">Upcoming workshops</div>
          <div className="list">
            {SAMPLE_WORKSHOPS.map((item) => (
              <div className="list-row workshop-row" key={item.name}>
                <div>
                  <div className="list-title">{item.name}</div>
                  <div className="list-meta">{item.time}</div>
                  <div className="workshop-tags">
                    <span className="pill pill-muted">{item.level}</span>
                  </div>
                </div>
                <div className="workshop-right">
                  <div className="pill">
                    {item.spotsLeft > 0
                      ? `${item.spotsLeft} spot${item.spotsLeft === 1 ? "" : "s"} left`
                      : `${item.waitlist} on waitlist`}
                  </div>
                  <button className="btn btn-ghost btn-small">Quick RSVP</button>
                </div>
              </div>
            ))}
          </div>
        </RevealCard>

        <RevealCard className="card card-3d" index={6} enabled={motionEnabled}>
          <div className="card-title">Glaze inspiration</div>
          <div className="card-subtitle">Pick a base + top combo</div>
          <p className="card-body-copy">
            Browse the studio glaze matrix and save combos for your next firing.
          </p>
          <button className="btn btn-ghost dashboard-link" onClick={onOpenGlazeBoard}>
            Open the glaze board
          </button>
        </RevealCard>

        <RevealCard className="card card-3d" index={7} enabled={motionEnabled}>
          <div className="card-title">Direct messages</div>
          <div className="messages-preview">
            {messagePreview.length === 0 ? (
              <div className="empty-block">
                <div className="empty-state">Questions about your work? We're here.</div>
                <button className="btn btn-ghost btn-small" onClick={onOpenMessages}>
                  Ask the studio
                </button>
              </div>
            ) : (
              messagePreview.map((thread) => (
                <div className="message" key={thread.id}>
                  <div className="message-top">
                    <span className="message-sender">{thread.lastSenderName || "Studio"}</span>
                    <span className="message-subject">{thread.subject || "New message"}</span>
                  </div>
                  <div className="message-preview">
                    {thread.lastMessagePreview || "Start the conversation with the studio."}
                  </div>
                </div>
              ))
            )}
          </div>
          <button className="btn btn-ghost" onClick={onOpenMessages}>
            Open messages inbox
          </button>
        </RevealCard>

        <RevealCard className="card card-3d span-2 archived-summary" index={8} enabled={motionEnabled}>
          <div>
            <div className="card-title">Archived pieces</div>
            <div className="archived-count">
              {archivedCount === 0
                ? "No archived pieces yet."
                : `${archivedCount} piece${archivedCount === 1 ? "" : "s"} archived.`}
            </div>
          </div>
          <button className="btn btn-ghost" onClick={onOpenPieces}>
            View archived pieces
          </button>
        </RevealCard>
      </section>
    </div>
  );
}
