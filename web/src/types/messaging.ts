export type LiveUser = {
  id: string;
  displayName?: string;
  email?: string;
  role?: string;
  isActive?: boolean;
  [key: string]: unknown;
};

export type DirectMessageThread = {
  id: string;
  subject?: string;
  kind?: string;
  participantUids?: string[];
  lastMessagePreview?: string;
  lastMessageId?: string;
  lastMessageAt?: unknown;
  lastSenderName?: string;
  lastSenderEmail?: string | null;
  lastReadAtByUid?: Record<string, unknown>;
  references?: string[];
  [key: string]: unknown;
};

export type DirectMessage = {
  id: string;
  messageId?: string;
  subject?: string;
  body?: string;
  fromUid?: string;
  fromName?: string;
  fromEmail?: string | null;
  replyToEmail?: string | null;
  toUids?: string[];
  toEmails?: string[];
  sentAt?: unknown;
  inReplyTo?: string;
  references?: string[];
  [key: string]: unknown;
};

export type Announcement = {
  id: string;
  title?: string;
  body?: string;
  type?: string;
  createdAt?: unknown;
  pinned?: boolean;
  readBy?: string[];
  ctaLabel?: string;
  ctaUrl?: string;
  [key: string]: unknown;
};
