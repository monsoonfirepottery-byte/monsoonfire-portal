import { useMemo, useState } from "react";
import type { User } from "firebase/auth";
import { doc, serverTimestamp, updateDoc } from "firebase/firestore";
import { db } from "../firebase";
import { formatDateTime } from "../utils/format";
import { toVoidHandler } from "../utils/toVoidHandler";
import "./NotificationsView.css";

type NotificationItem = {
  id: string;
  title?: string;
  body?: string;
  createdAt?: { toDate?: () => Date } | null;
  readAt?: { toDate?: () => Date } | null;
  data?: {
    firingId?: string;
    kilnName?: string | null;
    firingType?: string | null;
  };
};

type Props = {
  user: User;
  notifications: NotificationItem[];
  loading: boolean;
  error: string;
  onOpenFirings: () => void;
};

function coerceDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value === "object") {
    const maybe = value as { toDate?: () => Date };
    if (typeof maybe.toDate === "function") return maybe.toDate();
  }
  return null;
}

export default function NotificationsView({
  user,
  notifications,
  loading,
  error,
  onOpenFirings,
}: Props) {
  const [markingId, setMarkingId] = useState<string | null>(null);

  const unreadCount = useMemo(
    () => notifications.filter((item) => !item.readAt).length,
    [notifications]
  );

  const handleMarkRead = async (notificationId: string) => {
    if (!user || markingId) return;
    setMarkingId(notificationId);
    try {
      const ref = doc(db, "users", user.uid, "notifications", notificationId);
      await updateDoc(ref, { readAt: serverTimestamp() });
    } finally {
      setMarkingId(null);
    }
  };

  return (
    <div className="page notifications-page">
      <div className="page-header">
        <div>
          <h1>Notifications</h1>
          <p className="page-subtitle">
            Firing updates, studio notices, and anything that needs your attention.
          </p>
        </div>
        <div className="notifications-header-meta">
          <span className="pill subtle">
            {unreadCount > 0 ? `${unreadCount} unread` : "All caught up"}
          </span>
        </div>
      </div>

      {loading ? (
        <div className="loading">
          <span />
          Loading notifications
        </div>
      ) : null}

      {error ? <div className="card card-3d alert">{error}</div> : null}

      <div className="notifications-list">
        {notifications.length === 0 ? (
          <div className="card card-3d empty-state">No notifications yet.</div>
        ) : (
          notifications.map((item) => {
            const createdAt = coerceDate(item.createdAt);
            const readAt = coerceDate(item.readAt);
            const firingLabel =
              item.data?.kilnName || item.data?.firingType ? (
                <span className="chip subtle">
                  {item.data?.kilnName ?? "Kiln"} ·{" "}
                  {item.data?.firingType ? `${item.data.firingType} firing` : "firing"}
                </span>
              ) : null;

            return (
              <article
                key={item.id}
                className={`card card-3d notification-card ${readAt ? "read" : "unread"}`}
              >
                <div className="notification-body">
                  <div className="notification-title">{item.title ?? "Studio update"}</div>
                  {item.body ? <div className="notification-text">{item.body}</div> : null}
                  <div className="notification-meta">
                    {createdAt ? formatDateTime(createdAt) : "Just now"}
                    {firingLabel ? <span className="meta-chip">{firingLabel}</span> : null}
                  </div>
                </div>
                <div className="notification-actions">
                  <button className="btn btn-ghost" onClick={onOpenFirings}>
                    View firings
                  </button>
                  {!readAt ? (
                    <button
                      className="btn btn-secondary"
                      disabled={markingId === item.id}
                      onClick={toVoidHandler(() => handleMarkRead(item.id))}
                    >
                      {markingId === item.id ? "Marking..." : "Mark read"}
                    </button>
                  ) : (
                    <span className="pill subtle">Read</span>
                  )}
                </div>
              </article>
            );
          })
        )}
      </div>
    </div>
  );
}
