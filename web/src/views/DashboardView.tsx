import { useEffect, useMemo, useState } from "react";
import type { User } from "firebase/auth";
import { collection, getDocs, limit, orderBy, query } from "firebase/firestore";
import { db } from "../firebase";
import { mockFirings, mockKilns } from "../data/kilnScheduleMock";
import { useBatches } from "../hooks/useBatches";
import type { Kiln, KilnFiring } from "../types/kiln";
import type { Announcement, DirectMessageThread } from "../types/messaging";
import { formatMaybeTimestamp } from "../utils/format";

const SAMPLE_WORKSHOPS = [
  { name: "Wheel Lab", time: "Sat 10:00 AM", seats: "3 open" },
  { name: "Glaze Science", time: "Sun 4:00 PM", seats: "Waitlist" },
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
  statusLabel: string;
  pill: string;
  etaLabel: string;
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

function useKilnDashboardRows() {
  const [kilns, setKilns] = useState<Kiln[]>([]);
  const [firings, setFirings] = useState<KilnFiring[]>([]);
  const [loading, setLoading] = useState(true);
  const [permissionDenied, setPermissionDenied] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        const kilnsQuery = query(collection(db, "kilns"), orderBy("name", "asc"), limit(25));
        const firingsQuery = query(collection(db, "kilnFirings"), orderBy("startAt", "asc"), limit(200));
        const [kilnSnap, firingSnap] = await Promise.all([getDocs(kilnsQuery), getDocs(firingsQuery)]);
        setKilns(
          kilnSnap.docs.map((docSnap) => ({
            id: docSnap.id,
            ...(docSnap.data() as any),
          }))
        );
        setFirings(
          firingSnap.docs.map((docSnap) => ({
            id: docSnap.id,
            ...(docSnap.data() as any),
          }))
        );
      } catch (err) {
        if (isPermissionDenied(err)) setPermissionDenied(true);
      } finally {
        setLoading(false);
      }
    };

    void load();
  }, []);

  const useMock = permissionDenied || (!loading && kilns.length === 0 && firings.length === 0);
  const rawKilns = useMock ? mockKilns : kilns;
  const rawFirings = useMock ? mockFirings : firings;

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

        return {
          id: kiln.id,
          name: isRaku ? "Raku" : kiln.name,
          statusLabel,
          pill,
          etaLabel,
          isOffline,
        };
      });
  }, [displayKilns, normalizedFirings]);

  return rows;
}

type Props = {
  user: User;
  name: string;
  threads: DirectMessageThread[];
  announcements: Announcement[];
  onOpenKilnRentals: () => void;
  onOpenStudioResources: () => void;
  onOpenCommunity: () => void;
  onOpenMessages: () => void;
  onOpenPieces: () => void;
};

export default function DashboardView({
  user,
  name,
  threads,
  announcements,
  onOpenKilnRentals,
  onOpenStudioResources,
  onOpenCommunity,
  onOpenMessages,
  onOpenPieces,
}: Props) {
  const { active, history } = useBatches(user);
  const activePreview = active.slice(0, DASHBOARD_PIECES_PREVIEW);
  const archivedCount = history.length;
  const messagePreview = threads.slice(0, 3);
  const announcementPreview = announcements.slice(0, 3);
  const kilnRows = useKilnDashboardRows();

  return (
    <div className="dashboard">
      <section className="card hero-card">
        <div className="hero-content">
          <p className="eyebrow">Client Dashboard</p>
          <h1>Your studio dashboard</h1>
          <p className="hero-copy">
            Track your wares, reserve kiln time, and keep up with studio life from one place.
          </p>
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
          <div className="hero-profile">
            <span className="hero-profile-label">Signed in as</span>
            <span className="hero-profile-name">{name}</span>
            {user.email ? <span className="hero-profile-meta">{user.email}</span> : null}
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
      </section>

      <section className="dashboard-grid">
        <div className="card card-3d">
          <div className="card-title">Your pieces</div>
          <div className="card-subtitle">Personal queue</div>
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
            Open My Pieces
          </button>
        </div>

        <div className="card card-3d">
          <div className="card-title">Studio snapshot</div>
          <div className="card-subtitle">Studio-wide status</div>
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
            {kilnRows.length === 0 ? (
              <div className="empty-state">No kiln status available yet.</div>
            ) : (
              kilnRows.map((kiln) => (
              <div className={`list-row ${kiln.isOffline ? "kiln-offline" : ""}`} key={kiln.id}>
                <div>
                  <div className="list-title">{kiln.name}</div>
                  <div className="list-meta">{kiln.statusLabel}</div>
                </div>
                <div className="list-right">
                  <div className="pill">{kiln.pill}</div>
                  <div className="list-meta">{kiln.etaLabel}</div>
                </div>
              </div>
              ))
            )}
          </div>
        </div>

        <div className="card card-3d">
          <div className="card-title">Upcoming workshops</div>
          <div className="list">
            {SAMPLE_WORKSHOPS.map((item) => (
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

        <div className="card card-3d">
          <div className="card-title">Direct messages</div>
          <div className="messages-preview">
            {messagePreview.length === 0 ? (
              <div className="empty-state">No conversations yet.</div>
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
            View archived pieces
          </button>
        </div>
      </section>
    </div>
  );
}
