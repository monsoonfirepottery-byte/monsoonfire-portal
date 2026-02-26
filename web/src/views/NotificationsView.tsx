import { useCallback, useEffect, useMemo, useState } from "react";
import type { User } from "firebase/auth";
import { Timestamp, doc, updateDoc } from "firebase/firestore";
import { db } from "../firebase";
import { createFunctionsClient } from "../api/functionsClient";
import { resolveFunctionsBaseUrl } from "../utils/functionsBaseUrl";
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

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isPermissionDeniedError(error: unknown): boolean {
  const text = String(error instanceof Error ? error.message : error ?? "").toLowerCase();
  if (
    text.includes("permission-denied") ||
    text.includes("permission denied") ||
    text.includes("missing or insufficient permissions")
  ) {
    return true;
  }

  if (!error || typeof error !== "object") return false;
  const payload = error as { code?: unknown; message?: unknown };
  const code = typeof payload.code === "string" ? payload.code.toLowerCase() : "";
  const message = typeof payload.message === "string" ? payload.message.toLowerCase() : "";
  return code.includes("permission-denied") || message.includes("missing or insufficient permissions");
}

export default function NotificationsView({
  user,
  notifications,
  loading,
  error,
  onOpenFirings,
}: Props) {
  const [markingId, setMarkingId] = useState<string | null>(null);
  const [optimisticReadIds, setOptimisticReadIds] = useState<string[]>([]);
  const [lastMarkedId, setLastMarkedId] = useState<string | null>(null);
  const [markStatus, setMarkStatus] = useState<{ tone: "notice" | "alert"; message: string } | null>(
    null
  );
  const functionsBaseUrl = useMemo(() => resolveFunctionsBaseUrl(), []);
  const client = useMemo(
    () =>
      createFunctionsClient({
        baseUrl: functionsBaseUrl,
        getIdToken: async () => await user.getIdToken(),
      }),
    [functionsBaseUrl, user]
  );

  const optimisticReadSet = useMemo(() => new Set(optimisticReadIds), [optimisticReadIds]);

  const unreadCount = useMemo(
    () => notifications.filter((item) => !item.readAt && !optimisticReadSet.has(item.id)).length,
    [notifications, optimisticReadSet]
  );

  useEffect(() => {
    if (!lastMarkedId) return;
    const timeoutId = window.setTimeout(() => {
      setLastMarkedId((current) => (current === lastMarkedId ? null : current));
    }, 2600);
    return () => window.clearTimeout(timeoutId);
  }, [lastMarkedId]);

  const applyMarkedReadState = useCallback((notificationId: string) => {
    setOptimisticReadIds((current) =>
      current.includes(notificationId) ? current : [...current, notificationId]
    );
    setLastMarkedId(notificationId);
    setMarkStatus({ tone: "notice", message: "Notification marked as read." });
  }, []);

  const markReadViaApi = useCallback(
    async (notificationId: string) => {
      await client.postJson("apiV1/v1/notifications.markRead", {
        notificationId,
      });
    },
    [client]
  );

  const handleMarkRead = async (notificationId: string) => {
    if (!user || markingId || optimisticReadSet.has(notificationId)) return;
    setMarkingId(notificationId);
    try {
      const ref = doc(db, "users", user.uid, "notifications", notificationId);
      await updateDoc(ref, { readAt: Timestamp.now() });
      applyMarkedReadState(notificationId);
    } catch (error: unknown) {
      if (isPermissionDeniedError(error)) {
        try {
          await markReadViaApi(notificationId);
          applyMarkedReadState(notificationId);
          return;
        } catch (fallbackError: unknown) {
          setMarkStatus({
            tone: "alert",
            message: `Mark read failed: ${getErrorMessage(fallbackError)}`,
          });
          return;
        }
      }
      setMarkStatus({ tone: "alert", message: `Mark read failed: ${getErrorMessage(error)}` });
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
      {markStatus ? (
        <div
          className={`inline-alert notification-status ${markStatus.tone}`}
          role={markStatus.tone === "alert" ? "alert" : "status"}
          aria-live="polite"
        >
          {markStatus.message}
        </div>
      ) : null}

      <div className="notifications-list">
        {notifications.length === 0 ? (
          <div className="card card-3d empty-state">No notifications yet.</div>
        ) : (
          notifications.map((item) => {
            const createdAt = coerceDate(item.createdAt);
            const readAt = coerceDate(item.readAt);
            const isRead = Boolean(readAt) || optimisticReadSet.has(item.id);
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
                className={`card card-3d notification-card ${isRead ? "read" : "unread"} ${
                  lastMarkedId === item.id ? "read-recent" : ""
                }`}
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
                  {!isRead ? (
                    <button
                      className="btn btn-secondary"
                      disabled={markingId === item.id}
                      onClick={toVoidHandler(() => handleMarkRead(item.id))}
                    >
                      {markingId === item.id ? "Marking..." : "Mark read"}
                    </button>
                  ) : (
                    <span className="pill subtle">{lastMarkedId === item.id ? "Marked just now" : "Read"}</span>
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
