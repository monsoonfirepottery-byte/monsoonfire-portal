import React, { useEffect, useMemo, useState } from "react";
import type { User } from "firebase/auth";
import {
  addDoc,
  arrayUnion,
  collection,
  doc,
  limit,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import { db } from "../firebase";
import type { Announcement, DirectMessage, DirectMessageThread, LiveUser } from "../types/messaging";

const SUPPORT_THREAD_PREFIX = "support_";

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

function isAfterTimestamp(a?: any, b?: any) {
  if (!a || !b) return false;
  const aMillis = typeof a.toMillis === "function" ? a.toMillis() : null;
  const bMillis = typeof b.toMillis === "function" ? b.toMillis() : null;
  if (aMillis === null || bMillis === null) return false;
  return aMillis > bMillis;
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

function useDirectMessageMessages(threadId: string | null) {
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
          orderBy("sentAt", "asc"),
          limit(200)
        );
        const snap = await getDocs(messagesQuery);
        const rows: DirectMessage[] = snap.docs.map((docSnap) => ({
          id: docSnap.id,
          ...(docSnap.data() as any),
        }));
        setMessages(rows);
      } catch (err: any) {
        setError(`Messages failed: ${err?.message || String(err)}`);
      } finally {
        setLoading(false);
      }
    };

    void load();
  }, [threadId]);

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
  const [messagesTab, setMessagesTab] = useState<MessagesTab>("inbox");
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(threads[0]?.id || null);
  const [composerText, setComposerText] = useState("");
  const [composerBusy, setComposerBusy] = useState(false);
  const [newThreadOpen, setNewThreadOpen] = useState(false);
  const [newSubject, setNewSubject] = useState("");
  const [newToUid, setNewToUid] = useState("");
  const [newCcUids, setNewCcUids] = useState<string[]>([]);
  const [newBccUids, setNewBccUids] = useState<string[]>([]);
  const [newBody, setNewBody] = useState("");
  const [selectedAnnouncementId, setSelectedAnnouncementId] = useState<string | null>(null);
  const [sendError, setSendError] = useState("");
  const [sendStatus, setSendStatus] = useState("");

  const { messages, loading, error } = useDirectMessageMessages(selectedThreadId);

  useEffect(() => {
    if (!selectedThreadId && threads.length > 0) {
      setSelectedThreadId(threads[0].id);
    }
  }, [threads, selectedThreadId]);

  useEffect(() => {
    if (!selectedThreadId) return;
    const threadRef = doc(db, "directMessages", selectedThreadId);
    updateDoc(threadRef, {
      [`lastReadAtByUid.${user.uid}`]: serverTimestamp(),
    }).catch(() => null);
  }, [selectedThreadId, user.uid]);

  useEffect(() => {
    if (!sendStatus) return;
    const timer = window.setTimeout(() => setSendStatus(""), 5000);
    return () => window.clearTimeout(timer);
  }, [sendStatus]);

  const selectedThread = useMemo(() => {
    if (!selectedThreadId) return null;
    return threads.find((thread) => thread.id === selectedThreadId) || null;
  }, [threads, selectedThreadId]);

  const shouldExpandAnnouncements = useMemo(() => messagesTab === "studio", [messagesTab]);

  function handleMultiSelect(
    event: React.ChangeEvent<HTMLSelectElement>,
    setter: (next: string[]) => void
  ) {
    const next = Array.from(event.target.selectedOptions).map((opt) => opt.value);
    setter(next);
  }

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

      await addDoc(collection(threadRef, "messages"), {
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

      await updateDoc(threadRef, {
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
    } catch (err: any) {
      setSendError(`Send failed: ${err?.message || String(err)}`);
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
      const ccUids = newCcUids;
      const bccUids = newBccUids;
      const ccEmails = liveUsers
        .filter((liveUser) => ccUids.includes(liveUser.id))
        .map((liveUser) => liveUser.email)
        .filter(Boolean) as string[];
      const bccEmails = liveUsers
        .filter((liveUser) => bccUids.includes(liveUser.id))
        .map((liveUser) => liveUser.email)
        .filter(Boolean) as string[];

      if (!toUid) {
        const supportId = `${SUPPORT_THREAD_PREFIX}${user.uid}`;
        const supportRef = doc(db, "directMessages", supportId);

        await setDoc(
          supportRef,
          {
            subject,
            kind: "support",
            participantUids: [user.uid],
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );

        await addDoc(collection(supportRef, "messages"), {
          messageId,
          subject,
          body: newBody.trim(),
          fromUid: user.uid,
          fromName: getDisplayName(user),
          fromEmail,
          replyToEmail: fromEmail,
          toEmails: [supportEmail],
          ccUids,
          ccEmails,
          bccUids,
          bccEmails,
          sentAt: serverTimestamp(),
          inReplyTo: null,
          references: [],
        });

        await updateDoc(supportRef, {
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

        const newThreadRef = await addDoc(collection(db, "directMessages"), payload);

        await addDoc(collection(newThreadRef, "messages"), {
          messageId,
          subject,
          body: newBody.trim(),
          fromUid: user.uid,
          fromName: getDisplayName(user),
          fromEmail,
          replyToEmail: fromEmail,
          toUids: [toUid],
          toEmails,
          ccUids,
          ccEmails,
          bccUids,
          bccEmails,
          sentAt: serverTimestamp(),
          inReplyTo: null,
          references: [],
        });

        await updateDoc(newThreadRef, {
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
      setNewCcUids([]);
      setNewBccUids([]);
      setNewBody("");
      setSendStatus("Message sent.");
    } catch (err: any) {
      setSendError(`Send failed: ${err?.message || String(err)}`);
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
      updateDoc(annRef, { readBy: arrayUnion(user.uid) }).catch(() => null);
    }
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1>Messages</h1>
        <p className="page-subtitle">
          Keep conversations with the studio in one place. Messaging is coming online here.
        </p>
      </div>

      {sendStatus ? <div className="status-line">{sendStatus}</div> : null}

      <div className="segmented">
        <button
          className={messagesTab === "inbox" ? "active" : ""}
          onClick={() => setMessagesTab("inbox")}
        >
          Inbox
        </button>
        <button
          className={messagesTab === "studio" ? "active" : ""}
          onClick={() => setMessagesTab("studio")}
        >
          Studio
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
        <div className="card card-3d thread-pane">
          <div className="card-title-row">
            <div className="card-title">Direct messages</div>
            <button className="btn btn-ghost" onClick={() => setNewThreadOpen((prev) => !prev)}>
              {newThreadOpen ? "Cancel" : "New message"}
            </button>
          </div>

          {newThreadOpen ? (
            <div className="new-thread">
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
                Cc
                <select
                  multiple
                  value={newCcUids}
                  onChange={(event) => handleMultiSelect(event, setNewCcUids)}
                  disabled={liveUsersLoading}
                >
                  {liveUsers.map((liveUser) => (
                    <option key={liveUser.id} value={liveUser.id}>
                      {getLiveUserLabel(liveUser)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Bcc
                <select
                  multiple
                  value={newBccUids}
                  onChange={(event) => handleMultiSelect(event, setNewBccUids)}
                  disabled={liveUsersLoading}
                >
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
              <button className="btn btn-primary" onClick={handleCreateThread} disabled={composerBusy}>
                {composerBusy ? "Starting..." : "Send message"}
              </button>
            </div>
          ) : null}

          {threadsLoading ? (
            <div className="empty-state">Loading direct messages...</div>
          ) : threads.length === 0 ? (
            <div className="empty-state">No direct messages yet.</div>
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
        </div>

        <div className="card card-3d conversation-pane">
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
                <div className="empty-state">No messages yet. Send the first note below.</div>
              ) : (
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
              )}

              <div className="composer">
                <div className="composer-subject">Subject: {selectedThread.subject || "(no subject)"}</div>
                <textarea
                  placeholder="Write a reply..."
                  value={composerText}
                  onChange={(event) => setComposerText(event.target.value)}
                />
                <button className="btn btn-primary" onClick={handleSendMessage} disabled={composerBusy}>
                  {composerBusy ? "Sending..." : "Reply"}
                </button>
              </div>
            </div>
          ) : (
            <div className="empty-state">Choose a direct message to read and reply.</div>
          )}
        </div>
      </div>

      <div className={`card card-3d announcements-strip ${shouldExpandAnnouncements ? "expanded" : ""}`}>
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
                  onClick={() => handleSelectAnnouncement(announcement)}
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
      </div>
    </div>
  );
}
