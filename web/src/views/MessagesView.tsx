import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import GuidedStateCard from "../components/GuidedStateCard";
import { useUiSettings } from "../context/UiSettingsContext";
import { trackedAddDoc, trackedGetDocs, trackedSetDoc, trackedUpdateDoc } from "../lib/firestoreTelemetry";

const SUPPORT_THREAD_PREFIX = "support_";
const DEFAULT_MESSAGE_FETCH_LIMIT = 50;
const MAX_MESSAGE_FETCH_LIMIT = 200;

type MessagesTab = "inbox" | "studio";
type ReadFilter = "inbox" | "all";

type Props = {
  user: User;
  supportEmail: string;
  initialThreadId?: string | null;
  onInitialThreadIdConsumed?: () => void;
  threads: DirectMessageThread[];
  threadsLoading: boolean;
  threadsError: string;
  liveUsers: LiveUser[];
  liveUsersLoading: boolean;
  liveUsersError: string;
  announcements: Announcement[];
  announcementsLoading: boolean;
  announcementsError: string;
  unreadAnnouncements?: number;
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

function isThreadRead(
  thread: DirectMessageThread,
  uid: string,
  optimisticReadThreadIds: ReadonlySet<string>
) {
  return optimisticReadThreadIds.has(thread.id) || !isDirectMessageUnread(thread, uid);
}

function isAnnouncementRead(
  announcement: Announcement,
  uid: string,
  optimisticReadAnnouncementIds: ReadonlySet<string>
) {
  return optimisticReadAnnouncementIds.has(announcement.id) || !isAnnouncementUnread(announcement, uid);
}

function isLegacyRecipientLabel(value: string) {
  const text = value
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/:/g, "")
    .trim();

  return text === "cc" || text === "bcc";
}

function resolveSelectedThreadId(
  threads: DirectMessageThread[],
  initialThreadId: string | null | undefined
): string | null {
  if (initialThreadId && threads.some((thread) => thread.id === initialThreadId)) {
    return initialThreadId;
  }
  return threads[0]?.id || null;
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
  initialThreadId = null,
  onInitialThreadIdConsumed,
  threads,
  threadsLoading,
  threadsError,
  liveUsers,
  liveUsersLoading,
  liveUsersError,
  announcements,
  announcementsLoading,
  announcementsError,
}: Props) {
  const { themeName, portalMotion } = useUiSettings();
  const motionEnabled = themeName === "memoria" && portalMotion === "enhanced";
  const [messagesTab, setMessagesTab] = useState<MessagesTab>("inbox");
  const [readFilter, setReadFilter] = useState<ReadFilter>("inbox");
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(() =>
    resolveSelectedThreadId(threads, initialThreadId)
  );
  const appliedInitialThreadRef = useRef<string | null>(null);
  const [optimisticReadThreadIds, setOptimisticReadThreadIds] = useState<string[]>([]);
  const [optimisticReadAnnouncementIds, setOptimisticReadAnnouncementIds] = useState<string[]>([]);
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
  const optimisticReadThreadSet = useMemo(
    () => new Set(optimisticReadThreadIds),
    [optimisticReadThreadIds]
  );
  const optimisticReadAnnouncementSet = useMemo(
    () => new Set(optimisticReadAnnouncementIds),
    [optimisticReadAnnouncementIds]
  );

  const { messages, loading, error } = useDirectMessageMessages(selectedThreadId, messageFetchLimit);

  useEffect(() => {
    if (!selectedThreadId && threads.length > 0) {
      setSelectedThreadId(resolveSelectedThreadId(threads, initialThreadId));
    }
  }, [initialThreadId, selectedThreadId, threads]);

  useEffect(() => {
    if (!initialThreadId) return;
    if (appliedInitialThreadRef.current === initialThreadId) return;
    if (!threads.some((thread) => thread.id === initialThreadId)) return;
    setSelectedThreadId((current) => (current === initialThreadId ? current : initialThreadId));
    appliedInitialThreadRef.current = initialThreadId;
    onInitialThreadIdConsumed?.();
  }, [initialThreadId, onInitialThreadIdConsumed, threads]);

  useEffect(() => {
    setMessageFetchLimit(DEFAULT_MESSAGE_FETCH_LIMIT);
  }, [selectedThreadId]);

  const applyThreadReadState = useCallback((threadId: string) => {
    setOptimisticReadThreadIds((current) =>
      current.includes(threadId) ? current : [...current, threadId]
    );
  }, []);

  const applyAnnouncementReadState = useCallback((announcementId: string) => {
    setOptimisticReadAnnouncementIds((current) =>
      current.includes(announcementId) ? current : [...current, announcementId]
    );
  }, []);

  useEffect(() => {
    if (!selectedThreadId) return;
    const thread = threads.find((entry) => entry.id === selectedThreadId);
    if (!thread) return;
    if (isThreadRead(thread, user.uid, optimisticReadThreadSet)) return;
    applyThreadReadState(selectedThreadId);
  }, [applyThreadReadState, optimisticReadThreadSet, selectedThreadId, threads, user.uid]);

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
  const selectedAnnouncement = useMemo(() => {
    if (!selectedAnnouncementId) return null;
    return announcements.find((announcement) => announcement.id === selectedAnnouncementId) || null;
  }, [announcements, selectedAnnouncementId]);
  const unreadThreadCount = useMemo(
    () => threads.filter((thread) => !isThreadRead(thread, user.uid, optimisticReadThreadSet)).length,
    [optimisticReadThreadSet, threads, user.uid]
  );
  const unreadAnnouncementCount = useMemo(
    () =>
      announcements.filter(
        (announcement) => !isAnnouncementRead(announcement, user.uid, optimisticReadAnnouncementSet)
      ).length,
    [announcements, optimisticReadAnnouncementSet, user.uid]
  );
  const visibleThreads = useMemo(
    () =>
      readFilter === "all"
        ? threads
        : threads.filter((thread) => !isThreadRead(thread, user.uid, optimisticReadThreadSet)),
    [optimisticReadThreadSet, readFilter, threads, user.uid]
  );
  const visibleAnnouncements = useMemo(
    () =>
      readFilter === "all"
        ? announcements
        : announcements.filter(
            (announcement) =>
              !isAnnouncementRead(announcement, user.uid, optimisticReadAnnouncementSet)
          ),
    [announcements, optimisticReadAnnouncementSet, readFilter, user.uid]
  );
  const selectedAnnouncementHiddenFromInbox = Boolean(
    selectedAnnouncement &&
      readFilter === "inbox" &&
      isAnnouncementRead(selectedAnnouncement, user.uid, optimisticReadAnnouncementSet)
  );

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
      let toEmails = liveUsers
        .filter((liveUser) => toUids.includes(liveUser.id))
        .map((liveUser) => liveUser.email)
        .filter(Boolean) as string[];
      const isSupportThread =
        selectedThreadId.startsWith(SUPPORT_THREAD_PREFIX) || selectedThread?.kind === "support";
      if (isSupportThread && toEmails.length === 0) {
        toEmails = [supportEmail];
      }
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

    if (!isAnnouncementRead(announcement, user.uid, optimisticReadAnnouncementSet)) {
      applyAnnouncementReadState(announcement.id);
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

      <div className="messages-controls">
        <div className="segmented">
          <button
            className={messagesTab === "inbox" ? "active" : ""}
            onClick={() => setMessagesTab("inbox")}
          >
            Direct messages
            {unreadThreadCount > 0 ? <span className="segmented-count">{unreadThreadCount}</span> : null}
          </button>
          <button
            className={messagesTab === "studio" ? "active" : ""}
            onClick={() => setMessagesTab("studio")}
          >
            Studio updates
            {unreadAnnouncementCount > 0 ? (
              <span className="segmented-count">{unreadAnnouncementCount}</span>
            ) : null}
          </button>
        </div>
        <div className="segmented" aria-label="Inbox filter">
          <button
            className={readFilter === "inbox" ? "active" : ""}
            onClick={() => setReadFilter("inbox")}
          >
            Inbox
          </button>
          <button
            className={readFilter === "all" ? "active" : ""}
            onClick={() => setReadFilter("all")}
          >
            All
          </button>
        </div>
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
          ) : visibleThreads.length === 0 ? (
            <div className="empty-state">
              {readFilter === "inbox"
                ? selectedThread
                  ? "Inbox cleared. You're still viewing the last conversation you opened."
                  : "You're caught up on direct messages. Switch to All to review earlier conversations."
                : "No direct messages yet. Start a new thread with Studio Support for any questions."}
            </div>
          ) : (
            <div className="thread-list" data-testid="messages-thread-list">
              {visibleThreads.map((thread) => {
                const isUnread = !isThreadRead(thread, user.uid, optimisticReadThreadSet);
                return (
                  <button
                    className={`thread-item ${selectedThreadId === thread.id ? "active" : ""} ${
                      isUnread ? "unread" : ""
                    }`}
                    data-testid={`thread-item-${thread.id}`}
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
                  <div className="message-list" data-testid="messages-message-list">
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
                      data-testid="messages-load-older"
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
        {selectedAnnouncementHiddenFromInbox && selectedAnnouncement ? (
          <article className="announcement-preview card card-3d" data-testid="selected-announcement-preview">
            <div className="announcement-title">{selectedAnnouncement.title || "Studio update"}</div>
            <div className="announcement-meta">{formatMaybeTimestamp(selectedAnnouncement.createdAt)}</div>
            <div className="announcement-body">
              {selectedAnnouncement.body ||
                "This notice was published without extra detail. Keep this thread open for direct follow-up if you need anything clarified."}
            </div>
            {selectedAnnouncement.ctaLabel ? (
              <div className="announcement-cta">{selectedAnnouncement.ctaLabel}</div>
            ) : null}
          </article>
        ) : null}
        {announcementsLoading ? (
          <GuidedStateCard
            eyebrow="Studio announcements"
            title="Loading studio announcements"
            body="We are pulling the latest studio-wide notices for this inbox."
            className="empty-state"
          />
        ) : announcements.length === 0 ? (
          <GuidedStateCard
            eyebrow="Studio announcements"
            title="No studio announcements yet"
            body="Keep using direct messages for one-to-one questions. Studio-wide notices will appear here when they are published."
            className="empty-state"
          />
        ) : visibleAnnouncements.length === 0 ? (
          <GuidedStateCard
            eyebrow="Studio announcements"
            title={
              readFilter === "inbox"
                ? selectedAnnouncementHiddenFromInbox
                  ? "Inbox cleared"
                  : "You are caught up on studio updates"
                : "No announcements yet"
            }
            body={
              readFilter === "inbox"
                ? selectedAnnouncementHiddenFromInbox
                  ? "You are reviewing a previously read studio update. Switch to All when you want to revisit the full announcement history."
                  : "Switch to All to review earlier posts, or stay in Inbox for only the updates that still need your attention."
                : "Studio-wide notices will appear here when they are published."
            }
            actions={
              readFilter === "inbox"
                ? [{ label: "Open all announcements", onClick: () => setReadFilter("all"), variant: "ghost" }]
                : []
            }
            className="empty-state"
          />
        ) : (
          <div className="announcements-list">
            {visibleAnnouncements.map((announcement) => {
              const unread = !isAnnouncementRead(
                announcement,
                user.uid,
                optimisticReadAnnouncementSet
              );
              const isSelected = selectedAnnouncementId === announcement.id;
              return (
                <button
                  key={announcement.id}
                  data-testid={`announcement-card-${announcement.id}`}
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
                  <div className="announcement-body">
                    {announcement.body ||
                      "Open this announcement for the full context and any follow-up direction from the studio."}
                  </div>
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
