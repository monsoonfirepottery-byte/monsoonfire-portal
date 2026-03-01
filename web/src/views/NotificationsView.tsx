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

function isAuthRelatedError(error: unknown): boolean {
  const text = String(error instanceof Error ? error.message : error ?? "").toLowerCase();
  if (
    text.includes("unauthenticated") ||
    text.includes("auth/id-token-expired") ||
    text.includes("auth/id-token-revoked") ||
    text.includes("token expired") ||
    text.includes("session expired")
  ) {
    return true;
  }

  if (!error || typeof error !== "object") return false;
  const payload = error as { code?: unknown; message?: unknown };
  const code = typeof payload.code === "string" ? payload.code.toLowerCase() : "";
  const message = typeof payload.message === "string" ? payload.message.toLowerCase() : "";
  return (
    code.includes("unauthenticated") ||
    message.includes("unauthenticated") ||
    message.includes("token expired") ||
    message.includes("session expired")
  );
}

function isGenericMarkReadFailure(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("we could not complete that request") ||
    normalized.includes("contact support with this code") ||
    normalized.includes("try again")
  );
}

function isRouteResolutionError(error: unknown): boolean {
  const text = String(error instanceof Error ? error.message : error ?? "").toLowerCase();
  if (text.includes("unknown route") || text.includes("route_not_found") || text.includes("http 404")) {
    return true;
  }

  if (!error || typeof error !== "object") return false;
  const payload = error as { statusCode?: unknown; status?: unknown; code?: unknown };
  const statusCode = typeof payload.statusCode === "number"
    ? payload.statusCode
    : typeof payload.status === "number"
      ? payload.status
      : null;
  const code = typeof payload.code === "string" ? payload.code.toLowerCase() : "";
  return statusCode === 404 || code.includes("not_found") || code.includes("route_not_found");
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
      const payload = {
        notificationId,
        ownerUid: user.uid,
      };
      const routeCandidates = [
        "apiV1/v1/notifications.markRead",
        "v1/notifications.markRead",
      ] as const;

      let fallbackError: unknown = null;
      for (const route of routeCandidates) {
        try {
          await client.postJson(route, payload);
          return;
        } catch (error: unknown) {
          fallbackError = error;
          if (isRouteResolutionError(error)) {
            continue;
          }
          throw error;
        }
      }

      throw fallbackError ?? new Error("notifications.markRead fallback failed");
    },
    [client, user.uid]
  );

  const markReadViaFirestore = useCallback(
    async (notificationId: string, forceRefreshToken = false) => {
      if (forceRefreshToken) {
        await user.getIdToken(true);
      }
      const ref = doc(db, "users", user.uid, "notifications", notificationId);
      await updateDoc(ref, { readAt: Timestamp.now(), updatedAt: Timestamp.now() });
    },
    [user]
  );

  const handleMarkRead = async (notificationId: string) => {
    if (!user || markingId || optimisticReadSet.has(notificationId)) return;
    setMarkingId(notificationId);
    let primaryErrorMessage = "";
    try {
      await markReadViaFirestore(notificationId);
      applyMarkedReadState(notificationId);
    } catch (error: unknown) {
      primaryErrorMessage = getErrorMessage(error);
      if (isPermissionDeniedError(error) || isAuthRelatedError(error)) {
        try {
          await markReadViaFirestore(notificationId, true);
          applyMarkedReadState(notificationId);
          return;
        } catch (retryError: unknown) {
          primaryErrorMessage = getErrorMessage(retryError);
        }
      }

      try {
        await markReadViaApi(notificationId);
        applyMarkedReadState(notificationId);
        return;
      } catch (fallbackError: unknown) {
        const fallbackMessage = getErrorMessage(fallbackError);
        const usePrimaryMessage =
          primaryErrorMessage &&
          isGenericMarkReadFailure(fallbackMessage) &&
          !isGenericMarkReadFailure(primaryErrorMessage);

        if (usePrimaryMessage) {
          setMarkStatus({
            tone: "alert",
            message: `Mark read failed: ${primaryErrorMessage}`,
          });
          return;
        }
        setMarkStatus({
          tone: "alert",
          message: `Mark read failed: ${fallbackMessage}`,
        });
        return;
      }

      setMarkStatus({
        tone: "alert",
        message: `Mark read failed: ${primaryErrorMessage || getErrorMessage(error)}`,
      });
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
