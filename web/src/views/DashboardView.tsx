import React from "react";
import type { User } from "firebase/auth";
import { useBatches } from "../hooks/useBatches";
import type { Announcement, DirectMessageThread } from "../types/messaging";
import { formatMaybeTimestamp } from "../utils/format";

const SAMPLE_KILNS = [
  { name: "Kiln 3", status: "Firing", temp: "2200F", eta: "6h" },
  { name: "Kiln 1", status: "Loading", temp: "Ambient", eta: "Tonight" },
];

const SAMPLE_CLASSES = [
  { name: "Wheel Lab", time: "Sat 10:00 AM", seats: "3 open" },
  { name: "Glaze Science", time: "Sun 4:00 PM", seats: "Waitlist" },
];

const DASHBOARD_PIECES_PREVIEW = 3;

function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

type Props = {
  user: User;
  name: string;
  threads: DirectMessageThread[];
  announcements: Announcement[];
  unreadTotal: number;
  onOpenMessages: () => void;
  onOpenPieces: () => void;
};

export default function DashboardView({
  user,
  name,
  threads,
  announcements,
  unreadTotal,
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
            <button className="btn btn-primary">Book a class (schedule)</button>
            <button className="btn btn-ghost">View kiln schedule details</button>
            <button className="btn btn-ghost notif-inline" onClick={onOpenMessages}>
              <span className="bell-icon" />
              Open notifications
              {unreadTotal > 0 ? <span className="notif-count">{unreadTotal}</span> : null}
            </button>
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
            Open My Pieces
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
          <div className="card-title-row">
            <div className="card-title">Studio updates</div>
            <button className="btn btn-ghost notif-inline" onClick={onOpenMessages}>
              <span className="bell-icon" />
              Open inbox
              {unreadTotal > 0 ? <span className="notif-count">{unreadTotal}</span> : null}
            </button>
          </div>
          <div className="updates">
            {announcementPreview.length === 0 ? (
              <div className="empty-state">No studio announcements yet.</div>
            ) : (
              announcementPreview.map((item) => (
                <div className="update" key={item.id}>
                  <div className="update-title">{item.title || "Studio update"}</div>
                  <p className="update-note">{item.body || "Details coming soon."}</p>
                </div>
              ))
            )}
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
