import type { User } from "firebase/auth";
import { useBatches } from "../hooks/useBatches";
import type { Announcement, DirectMessageThread } from "../types/messaging";
import { formatMaybeTimestamp } from "../utils/format";

const SAMPLE_KILNS = [
  { name: "Kiln 3", status: "Firing", temp: "2200F", eta: "6h" },
  { name: "Kiln 1", status: "Loading", temp: "Ambient", eta: "Tonight" },
];

const SAMPLE_WORKSHOPS = [
  { name: "Wheel Lab", time: "Sat 10:00 AM", seats: "3 open" },
  { name: "Glaze Science", time: "Sun 4:00 PM", seats: "Waitlist" },
];

const DASHBOARD_PIECES_PREVIEW = 3;

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

  return (
    <div className="dashboard">
      <div className="dashboard-heat" aria-hidden="true" />
      <div className="dashboard-embers" aria-hidden="true">
        <span className="dashboard-ember" />
        <span className="dashboard-ember" />
        <span className="dashboard-ember" />
        <span className="dashboard-ember" />
        <span className="dashboard-ember" />
        <span className="dashboard-ember" />
        <span className="dashboard-ember" />
        <span className="dashboard-ember" />
        <span className="dashboard-ember" />
        <span className="dashboard-ember" />
      </div>
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
