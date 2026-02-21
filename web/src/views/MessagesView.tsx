import { useEffect, useMemo, useRef, useState } from "react";
import type { User } from "firebase/auth";
import {
  arrayUnion,
  collection,
  doc,
  limit,
  orderBy,
  query,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "../firebase";
import type { Announcement, DirectMessage, DirectMessageThread, LiveUser } from "../types/messaging";
import { toVoidHandler } from "../utils/toVoidHandler";
import RevealCard from "../components/RevealCard";
import { useUiSettings } from "../context/UiSettingsContext";
import { trackedAddDoc, trackedGetDocs, trackedSetDoc, trackedUpdateDoc } from "../lib/firestoreTelemetry";

const SUPPORT_THREAD_PREFIX = "support_";
const DEFAULT_MESSAGE_FETCH_LIMIT = 50;
const MAX_MESSAGE_FETCH_LIMIT = 200;

type MessagesTab = "inbox" | "studio";

type Props = {
  user: User;
  supportEmail: string;
  threads: DirectMessageThread[];
  threadsLoading: boolean;
  threadsError: string;
  liveUsers: LiveUser[];
  liveUsersLoading: boolean;
  liveUsersError: string;
  announcements: Announcement[];
  announcementsLoading: boolean;
  announcementsError: string;
  unreadAnnouncements: number;
};

function getDisplayName(user: User) {
  return user.displayName || user.email || "Member";
}

function getLiveUserLabel(user: LiveUser) {
  return user.displayName || user.email || user.id;
}

function createMessageId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `<${crypto.randomUUID()}@monsoonfire.local>`;
  }
  return `<mf-${Math.random().toString(36).slice(2)}@monsoonfire.local>`;
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

type TimestampWithMillis = { toMillis?: () => number };

function isAfterTimestamp(a?: unknown, b?: unknown) {
  if (!a || !b) return false;
  const aValue = a as TimestampWithMillis;
  const bValue = b as TimestampWithMillis;
  const aMillis = typeof aValue.toMillis === "function" ? aValue.toMillis() : null;
  const bMillis = typeof bValue.toMillis === "function" ? bValue.toMillis() : null;
  if (aMillis === null || bMillis === null) return false;
  return aMillis > bMillis;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isPermissionError(message: string) {
  return message.toLowerCase().includes("missing or insufficient permissions");
}

function isDirectMessageUnread(thread: DirectMessageThread, uid: string) {
  if (!thread.lastMessageAt) return false;
  const lastRead = thread.lastReadAtByUid?.[uid];
  if (!lastRead) return true;
  return isAfterTimestamp(thread.lastMessageAt, lastRead);
}

function isAnnouncementUnread(announcement: Announcement, uid: string) {
  if (!announcement.readBy || !Array.isArray(announcement.readBy)) return true;
  return !announcement.readBy.includes(uid);
}

function isLegacyRecipientLabel(value: string) {
  const text = value
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/:/g, "")
    .trim();

  return text === "cc" || text === "bcc";
}

function useDirectMessageMessages(threadId: string | null, fetchLimit: number) {
  const [messages, setMessages] = useState<DirectMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!threadId) {
      setMessages([]);
      return;
    }

    setLoading(true);
    setError("");

    const load = async () => {
      try {
        const messagesQuery = query(
          collection(db, "directMessages", threadId, "messages"),
          orderBy("sentAt", "desc"),
          limit(fetchLimit)
        );
        const snap = await trackedGetDocs("messages:thread", messagesQuery);
        const rows: DirectMessage[] = snap.docs.map((docSnap) => ({
          id: docSnap.id,
          ...(docSnap.data() as Partial<DirectMessage>),
        }));
        rows.sort((a, b) => {
          const aAt = (a.sentAt as { toMillis?: () => number } | undefined)?.toMillis?.() ?? 0;
          const bAt = (b.sentAt as { toMillis?: () => number } | undefined)?.toMillis?.() ?? 0;
          return aAt - bAt;
        });
        setMessages(rows);
      } catch (error: unknown) {
        setError(`Messages failed: ${getErrorMessage(error)}`);
      } finally {
        setLoading(false);
      }
    };

    void load();
  }, [fetchLimit, threadId]);

  return { messages, loading, error };
}

export default function MessagesView({
  user,
  supportEmail,
  threads,
  threadsLoading,
  threadsError,
  liveUsers,
  liveUsersLoading,
  liveUsersError,
  announcements,
  announcementsLoading,
  announcementsError,
  unreadAnnouncements,
}: Props) {
  const { themeName, portalMotion } = useUiSettings();
  const motionEnabled = themeName === "memoria" && portalMotion === "enhanced";
  const [messagesTab, setMessagesTab] = useState<MessagesTab>("inbox");
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(threads[0]?.id || null);
  const [composerText, setComposerText] = useState("");
  const [composerBusy, setComposerBusy] = useState(false);
  const [newThreadOpen, setNewThreadOpen] = useState(false);
  const [newSubject, setNewSubject] = useState("");
  const [newToUid, setNewToUid] = useState("");
  const [newBody, setNewBody] = useState("");
  const [selectedAnnouncementId, setSelectedAnnouncementId] = useState<string | null>(null);
  const [sendError, setSendError] = useState("");
  const [sendStatus, setSendStatus] = useState("");
  const [messageFetchLimit, setMessageFetchLimit] = useState(DEFAULT_MESSAGE_FETCH_LIMIT);
  const newThreadFormRef = useRef<HTMLDivElement>(null);

  const { messages, loading, error } = useDirectMessageMessages(selectedThreadId, messageFetchLimit);

  useEffect(() => {
    if (!selectedThreadId && threads.length > 0) {
      setSelectedThreadId(threads[0].id);
    }
  }, [threads, selectedThreadId]);

  useEffect(() => {
    setMessageFetchLimit(DEFAULT_MESSAGE_FETCH_LIMIT);
  }, [selectedThreadId]);

  useEffect(() => {
    if (!selectedThreadId) return;
    const threadRef = doc(db, "directMessages", selectedThreadId);
    trackedUpdateDoc("messages:readState", threadRef, {
      [`lastReadAtByUid.${user.uid}`]: serverTimestamp(),
    }).catch(() => null);
  }, [selectedThreadId, user.uid]);

  useEffect(() => {
    if (!sendStatus) return;
    const timer = window.setTimeout(() => setSendStatus(""), 5000);
    return () => window.clearTimeout(timer);
  }, [sendStatus]);

  useEffect(() => {
    if (!newThreadOpen) return;
    const form = newThreadFormRef.current;
    if (!form) return;

    const removeLegacyNode = (node: Element | null) => {
      if (!node || !form.contains(node)) return;
      const target = node.closest("label, div, section, fieldset") ?? node;
      target.remove();
    };

    const pruneLegacyFieldsFromControl = (control: Element) => {
      const props = [
        control.getAttribute("name") ?? "",
        control.id,
        control.getAttribute("aria-label") ?? "",
        control.getAttribute("placeholder") ?? "",
        control.getAttribute("title") ?? "",
      ];

      if (props.some(isLegacyRecipientLabel)) {
        removeLegacyNode(control);
        return;
      }

      if (control.tagName === "SELECT" && control.hasAttribute("multiple")) {
        removeLegacyNode(control);
      }
    };

    const pruneLegacyFields = () => {
      const multipleSelects = Array.from(form.querySelectorAll("select[multiple]"));
      for (const control of multipleSelects) {
        removeLegacyNode(control);
      }

      const labels = Array.from(form.querySelectorAll("label"));
      for (const label of labels) {
        if (isLegacyRecipientLabel(label.textContent ?? "")) {
          removeLegacyNode(label);
          continue;
        }

        const control = label.control;
        if (control) {
          pruneLegacyFieldsFromControl(control);
        }
      }

      const controls = Array.from(form.querySelectorAll("input, select, textarea"));
      for (const control of controls) {
        pruneLegacyFieldsFromControl(control);

        const options = Array.from(control.querySelectorAll("option"));
        for (const option of options) {
          if (isLegacyRecipientLabel(option.textContent ?? "")) {
            removeLegacyNode(control);
          }
        }
      }

      const shortTextElements = Array.from(form.querySelectorAll("*"));
      for (const element of shortTextElements) {
        const text = element.textContent ?? "";
        if (isLegacyRecipientLabel(text) && text.trim().length <= 3) {
          removeLegacyNode(element);
        }
      }
    };

    pruneLegacyFields();
    const observer = new MutationObserver(() => pruneLegacyFields());
    observer.observe(form, { childList: true, subtree: true });
    const sanitizerTimer = window.setInterval(() => pruneLegacyFields(), 80);
    return () => {
      observer.disconnect();
      window.clearInterval(sanitizerTimer);
    };
  }, [newThreadOpen]);

  const selectedThread = useMemo(() => {
    if (!selectedThreadId) return null;
    return threads.find((thread) => thread.id === selectedThreadId) || null;
  }, [threads, selectedThreadId]);

  const shouldExpandAnnouncements = useMemo(() => messagesTab === "studio", [messagesTab]);

  async function handleSendMessage() {
    if (!selectedThreadId || composerBusy) return;
    if (!composerText.trim()) {
      setSendError("Message body is required.");
      setSendStatus("Message body is required.");
      return;
    }

    setComposerBusy(true);
    setSendError("");
    setSendStatus("Sending message...");

    try {
      const messageId = createMessageId();
      const threadRef = doc(db, "directMessages", selectedThreadId);
      const toUids = selectedThread?.participantUids?.filter((uid) => uid !== user.uid) ?? [];
      const toEmails = liveUsers
        .filter((liveUser) => toUids.includes(liveUser.id))
        .map((liveUser) => liveUser.email)
        .filter(Boolean) as string[];
      const fromEmail = user.email || null;
      const previousMessageId = selectedThread?.lastMessageId || null;
      const references = selectedThread?.references || [];

      await trackedAddDoc("messages:send", collection(threadRef, "messages"), {
        messageId,
        subject: selectedThread?.subject || "(no subject)",
        body: composerText,
        fromUid: user.uid,
        fromName: getDisplayName(user),
        fromEmail,
        replyToEmail: fromEmail,
        toUids,
        toEmails,
        sentAt: serverTimestamp(),
        inReplyTo: previousMessageId || null,
        references,
      });

      await trackedUpdateDoc("messages:send", threadRef, {
        lastMessagePreview: composerText.slice(0, 180),
        lastMessageAt: serverTimestamp(),
        lastMessageId: messageId,
        lastSenderName: getDisplayName(user),
        lastSenderEmail: fromEmail || null,
        updatedAt: serverTimestamp(),
        references,
        [`lastReadAtByUid.${user.uid}`]: serverTimestamp(),
      });

      setComposerText("");
      setSendStatus("Reply sent.");
    } catch (error: unknown) {
      setSendError(`Send failed: ${getErrorMessage(error)}`);
      setSendStatus("Send failed. Check permissions and connectivity.");
    } finally {
      setComposerBusy(false);
    }
  }

  async function handleCreateThread() {
    if (composerBusy) return;
    if (!newBody.trim()) {
      setSendError("Message body is required.");
      setSendStatus("Message body is required.");
      return;
    }

    setComposerBusy(true);
    setSendError("");
    setSendStatus("Sending message...");

    try {
      const subject = newSubject.trim() || "(no subject)";
      const toUid = newToUid.trim();
      const messageId = createMessageId();
      const fromEmail = user.email || null;

      if (!toUid) {
        const supportId = `${SUPPORT_THREAD_PREFIX}${user.uid}`;
        const supportRef = doc(db, "directMessages", supportId);

        await trackedSetDoc(
          "messages:newThread",
          supportRef,
          {
            subject,
            kind: "support",
            participantUids: [user.uid],
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );

        await trackedAddDoc("messages:newThread", collection(supportRef, "messages"), {
          messageId,
          subject,
          body: newBody.trim(),
          fromUid: user.uid,
          fromName: getDisplayName(user),
          fromEmail,
          replyToEmail: fromEmail,
          toEmails: [supportEmail],
          sentAt: serverTimestamp(),
          inReplyTo: null,
          references: [],
        });

        await trackedUpdateDoc("messages:newThread", supportRef, {
          lastMessagePreview: newBody.trim().slice(0, 180),
          lastMessageAt: serverTimestamp(),
          lastMessageId: messageId,
          lastSenderName: getDisplayName(user),
          lastSenderEmail: fromEmail || null,
          updatedAt: serverTimestamp(),
          references: [],
          [`lastReadAtByUid.${user.uid}`]: serverTimestamp(),
        });

        setSelectedThreadId(supportId);
      } else {
        const toUser = liveUsers.find((liveUser) => liveUser.id === toUid);
        const toEmails = toUser?.email ? [toUser.email] : [];

        const participantUids = Array.from(new Set([user.uid, toUid]));

        const payload: Record<string, unknown> = {
          subject,
          kind: "direct",
          participantUids,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        };

        const newThreadRef = await trackedAddDoc("messages:newThread", collection(db, "directMessages"), payload);

        await trackedAddDoc("messages:newThread", collection(newThreadRef, "messages"), {
          messageId,
          subject,
          body: newBody.trim(),
          fromUid: user.uid,
          fromName: getDisplayName(user),
          fromEmail,
          replyToEmail: fromEmail,
          toUids: [toUid],
          toEmails,
          sentAt: serverTimestamp(),
          inReplyTo: null,
          references: [],
        });

        await trackedUpdateDoc("messages:newThread", newThreadRef, {
          lastMessagePreview: newBody.trim().slice(0, 180),
          lastMessageAt: serverTimestamp(),
          lastMessageId: messageId,
          lastSenderName: getDisplayName(user),
          lastSenderEmail: fromEmail || null,
          references: [],
          updatedAt: serverTimestamp(),
          [`lastReadAtByUid.${user.uid}`]: serverTimestamp(),
        });

        setSelectedThreadId(newThreadRef.id);
      }

      setNewThreadOpen(false);
      setMessagesTab("inbox");
      setNewSubject("");
      setNewToUid("");
      setNewBody("");
      setSendStatus("Message sent.");
    } catch (error: unknown) {
      setSendError(`Send failed: ${getErrorMessage(error)}`);
      setSendStatus("Send failed. Check permissions and connectivity.");
    } finally {
      setComposerBusy(false);
    }
  }

  async function handleSelectAnnouncement(announcement: Announcement) {
    setSelectedAnnouncementId(announcement.id);
    setMessagesTab("studio");

    if (!announcement.readBy?.includes(user.uid)) {
      const annRef = doc(db, "announcements", announcement.id);
      trackedUpdateDoc("messages:announcement", annRef, { readBy: arrayUnion(user.uid) }).catch(() => null);
    }
  }

  const canLoadOlder =
    Boolean(selectedThread) &&
    !loading &&
    messageFetchLimit < MAX_MESSAGE_FETCH_LIMIT &&
    messages.length >= messageFetchLimit;

  return (
    <div className="page">
      <div className="page-header">
        <h1>Messages</h1>
        <p className="page-subtitle">
          We're excited to be your partner. Use this space for studio support and updates, or email us at {supportEmail}.
        </p>
      </div>

      {sendStatus ? <div className="status-line">{sendStatus}</div> : null}

      <div className="segmented">
        <button
          className={messagesTab === "inbox" ? "active" : ""}
          onClick={() => setMessagesTab("inbox")}
        >
          Direct messages
        </button>
        <button
          className={messagesTab === "studio" ? "active" : ""}
          onClick={() => setMessagesTab("studio")}
        >
          Studio updates
          {unreadAnnouncements > 0 ? (
            <span className="segmented-count">{unreadAnnouncements}</span>
          ) : null}
        </button>
      </div>

      {sendError ? <div className="card card-3d alert">{sendError}</div> : null}
      {threadsError ? <div className="card card-3d alert">{threadsError}</div> : null}
      {liveUsersError ? <div className="card card-3d alert">{liveUsersError}</div> : null}
      {announcementsError ? <div className="card card-3d alert">{announcementsError}</div> : null}

      <div className="messages-layout">
        <RevealCard className="card card-3d thread-pane" index={0} enabled={motionEnabled}>
          <div className="card-title-row">
            <div className="card-title">Direct messages</div>
            <button className="btn btn-ghost" onClick={() => setNewThreadOpen((prev) => !prev)}>
              {newThreadOpen ? "Cancel new message" : "Start new message"}
            </button>
          </div>

          {newThreadOpen ? (
            <div className="new-thread" ref={newThreadFormRef}>
              <label>
                Subject
                <input
                  type="text"
                  placeholder="Studio question, glazing help, pickup"
                  value={newSubject}
                  onChange={(event) => setNewSubject(event.target.value)}
                />
              </label>
              <label>
                To
                <select
                  value={newToUid}
                  onChange={(event) => setNewToUid(event.target.value)}
                  disabled={liveUsersLoading}
                >
                  <option value="">Studio Support</option>
                  {liveUsers.map((liveUser) => (
                    <option key={liveUser.id} value={liveUser.id}>
                      {getLiveUserLabel(liveUser)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Message
                <textarea
                  placeholder="Write your message..."
                  value={newBody}
                  onChange={(event) => setNewBody(event.target.value)}
                />
              </label>
              {liveUsersLoading ? <div className="empty-state">Loading live users...</div> : null}
              {liveUsers.length === 0 && !liveUsersLoading ? (
                <div className="empty-state">No live users are available yet.</div>
              ) : null}
              <button className="btn btn-primary" onClick={toVoidHandler(handleCreateThread)} disabled={composerBusy}>
                {composerBusy ? "Starting..." : "Send new message"}
              </button>
            </div>
          ) : null}

          {threadsLoading ? (
            <div className="empty-state">Loading direct messages...</div>
          ) : threads.length === 0 ? (
            <div className="empty-state">No direct messages yet. Start a new thread with Studio Support for any questions.</div>
          ) : (
            <div className="thread-list">
              {threads.map((thread) => {
                const isUnread = isDirectMessageUnread(thread, user.uid);
                return (
                  <button
                    className={`thread-item ${selectedThreadId === thread.id ? "active" : ""} ${
                      isUnread ? "unread" : ""
                    }`}
                    key={thread.id}
                    onClick={() => setSelectedThreadId(thread.id)}
                  >
                    <div className="thread-title">{thread.subject || "(no subject)"}</div>
                    <div className="thread-meta">
                      <span>{thread.lastSenderName || thread.lastSenderEmail || "Studio"}</span>
                      <span>{formatMaybeTimestamp(thread.lastMessageAt)}</span>
                    </div>
                    <div className="thread-preview">
                      {thread.lastMessagePreview || "Start the conversation."}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </RevealCard>

        <RevealCard className="card card-3d conversation-pane" index={1} enabled={motionEnabled}>
          <div className="card-title">
            {selectedThread ? selectedThread.subject || "(no subject)" : "Select a direct message"}
          </div>

          {selectedThread ? (
            <div className="conversation">
              <div className="email-meta">
                <div>Subject: {selectedThread.subject || "(no subject)"}</div>
                {selectedThread.lastSenderEmail ? (
                  <div>Last from: {selectedThread.lastSenderEmail}</div>
                ) : null}
              </div>
              {loading ? (
                <div className="empty-state">Loading messages...</div>
              ) : error && !isPermissionError(error) ? (
                <div className="alert inline-alert">{error}</div>
              ) : error ? (
                <div className="empty-state">Messages are unavailable right now.</div>
              ) : messages.length === 0 ? (
                <div className="empty-state">No messages yet. Send your first note below and we'll follow up.</div>
              ) : (
                <>
                  <div className="piece-meta">
                    Showing {Math.min(messages.length, messageFetchLimit)} most recent messages
                    {messageFetchLimit >= MAX_MESSAGE_FETCH_LIMIT ? ` (max ${MAX_MESSAGE_FETCH_LIMIT})` : ""}.
                  </div>
                  <div className="message-list">
                    {messages.map((msg) => (
                      <div className={`bubble ${msg.fromUid === user.uid ? "me" : ""}`} key={msg.id}>
                        <div className="bubble-meta">
                          <span>{msg.fromName || msg.fromEmail || "Studio"}</span>
                          <span>{formatMaybeTimestamp(msg.sentAt)}</span>
                        </div>
                        <div className="bubble-subject">{msg.subject || "(no subject)"}</div>
                        <div className="bubble-body">{msg.body || ""}</div>
                        {msg.inReplyTo ? (
                          <div className="bubble-reply">In-Reply-To: {msg.inReplyTo}</div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                  {canLoadOlder ? (
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={() =>
                        setMessageFetchLimit((prev) => Math.min(MAX_MESSAGE_FETCH_LIMIT, prev + 50))
                      }
                    >
                      Load older messages (next 50)
                    </button>
                  ) : null}
                </>
              )}

              <div className="composer">
                <div className="composer-subject">Subject: {selectedThread.subject || "(no subject)"}</div>
                <textarea
                  placeholder="Write a reply..."
                  value={composerText}
                  onChange={(event) => setComposerText(event.target.value)}
                />
                <button className="btn btn-primary" onClick={toVoidHandler(handleSendMessage)} disabled={composerBusy}>
                  {composerBusy ? "Sending..." : "Send reply"}
                </button>
              </div>
            </div>
          ) : (
            <div className="empty-state">Choose a direct message to read and reply.</div>
          )}
        </RevealCard>
      </div>

      <RevealCard
        className={`card card-3d announcements-strip ${shouldExpandAnnouncements ? "expanded" : ""}`}
        index={2}
        enabled={motionEnabled}
      >
        <div className="card-title">Studio announcements</div>
        {announcementsLoading ? (
          <div className="empty-state">Loading announcements...</div>
        ) : announcements.length === 0 ? (
          <div className="empty-state">No announcements yet.</div>
        ) : (
          <div className="announcements-list">
            {announcements.map((announcement) => {
              const unread = isAnnouncementUnread(announcement, user.uid);
              const isSelected = selectedAnnouncementId === announcement.id;
              return (
                <button
                  key={announcement.id}
                  className={`announcement-card ${unread ? "unread" : ""} ${
                    isSelected ? "active" : ""
                  }`}
                  onClick={toVoidHandler(() => handleSelectAnnouncement(announcement))}
                >
                  <div className="announcement-header">
                    <div>
                      <div className="announcement-title">{announcement.title || "Studio update"}</div>
                      <div className="announcement-meta">
                        {formatMaybeTimestamp(announcement.createdAt)}
                      </div>
                    </div>
                    {unread ? <span className="notif-dot" /> : null}
                  </div>
                  <div className="announcement-body">{announcement.body || "Details coming soon."}</div>
                  {isSelected && announcement.ctaLabel ? (
                    <div className="announcement-cta">{announcement.ctaLabel}</div>
                  ) : null}
                </button>
              );
            })}
          </div>
        )}
      </RevealCard>
    </div>
  );
}
