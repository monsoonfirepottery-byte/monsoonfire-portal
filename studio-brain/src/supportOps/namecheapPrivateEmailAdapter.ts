import { createHash } from "node:crypto";
import { ImapFlow, type FetchMessageObject } from "imapflow";
import nodemailer from "nodemailer";
import type {
  SupportMailboxAdapter,
  SupportMailboxMessage,
  SupportMailboxReader,
  SupportMailboxSyncResult,
  SupportReplySender,
} from "./types";

type MailparserHeaderLine = {
  key?: string;
  line?: string;
};

type MailparserAddress = {
  address?: string;
  name?: string;
};

type MailparserAddressObject = {
  value?: MailparserAddress[];
  text?: string;
};

type MailparserAttachment = {
  filename?: string;
  contentType?: string;
  size?: number;
  content?: Buffer;
};

type ParsedMailLike = {
  subject?: string;
  text?: string;
  html?: string | false;
  from?: MailparserAddressObject;
  date?: Date;
  messageId?: string;
  inReplyTo?: string | string[];
  references?: string | string[];
  attachments?: MailparserAttachment[];
  headerLines?: MailparserHeaderLine[];
};

const { simpleParser } = require("mailparser") as {
  simpleParser: (input: Buffer) => Promise<ParsedMailLike>;
};

type NamecheapPrivateEmailAdapterOptions = {
  username: string;
  password: string;
  mailboxFolder?: string;
  imapHost?: string;
  imapPort?: number;
  imapSecure?: boolean;
  smtpHost?: string;
  smtpPort?: number;
  smtpSecure?: boolean;
  ignoreTlsErrors?: boolean;
  fromName?: string;
};

const UID_CURSOR_PREFIX = "uid:";

function clean(value: unknown): string {
  return String(value ?? "").trim();
}

function truncateText(value: string | null | undefined, maxLength: number): string {
  const normalized = clean(value);
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function encodeThreadFallback(input: Record<string, string | null>): string {
  return `email-thread-${createHash("sha256").update(JSON.stringify(input)).digest("hex").slice(0, 24)}`;
}

function normalizeReferences(value: string | string[] | null | undefined): string[] {
  if (Array.isArray(value)) {
    return value.map((entry) => clean(entry)).filter(Boolean);
  }
  return clean(value)
    .split(/\s+/g)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function extractLinkDomains(text: string): string[] {
  const matches = text.matchAll(/https?:\/\/([^/\s?#]+)/gi);
  const seen = new Set<string>();
  const output: string[] = [];
  for (const match of matches) {
    const domain = clean(match[1]).toLowerCase();
    if (!domain || seen.has(domain)) continue;
    seen.add(domain);
    output.push(domain);
  }
  return output;
}

function extractRawHeaders(parsed: ParsedMailLike): Record<string, string> {
  const headers: Record<string, string> = {};
  const headerLines = Array.isArray(parsed.headerLines) ? parsed.headerLines : [];
  for (const header of headerLines) {
    const name = clean(header.key).toLowerCase();
    const line = clean(header.line);
    if (!name || !line) continue;
    const separatorIndex = line.indexOf(":");
    headers[name] = separatorIndex >= 0 ? line.slice(separatorIndex + 1).trim() : line;
  }
  return headers;
}

function parseUidCursor(cursor: string | null): number | null {
  const raw = clean(cursor);
  if (!raw) return null;
  if (raw.startsWith(UID_CURSOR_PREFIX)) {
    const parsed = Number.parseInt(raw.slice(UID_CURSOR_PREFIX.length), 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function formatUidCursor(uid: number | null | undefined): string | null {
  if (!uid || !Number.isFinite(uid) || uid < 1) return null;
  return `${UID_CURSOR_PREFIX}${uid}`;
}

function deriveThreadId(input: {
  serverThreadId?: string | null;
  rfcMessageId?: string | null;
  inReplyTo?: string | null;
  references?: string[];
  subject?: string | null;
  senderEmail?: string | null;
  receivedAt?: string | null;
}): string {
  const serverThreadId = clean(input.serverThreadId);
  if (serverThreadId) return serverThreadId;
  const references = (input.references ?? []).map((entry) => clean(entry)).filter(Boolean);
  if (references.length > 0) return references[0]!;
  const inReplyTo = clean(input.inReplyTo);
  if (inReplyTo) return inReplyTo;
  const rfcMessageId = clean(input.rfcMessageId);
  if (rfcMessageId) return rfcMessageId;
  return encodeThreadFallback({
    subject: clean(input.subject) || null,
    senderEmail: clean(input.senderEmail).toLowerCase() || null,
    receivedAt: clean(input.receivedAt) || null,
  });
}

function normalizeSender(parsed: ParsedMailLike): { senderEmail: string | null; senderName: string | null } {
  const first = parsed.from?.value?.[0];
  return {
    senderEmail: clean(first?.address).toLowerCase() || null,
    senderName: clean(first?.name) || null,
  };
}

function buildMailboxMessage(input: {
  mailbox: string;
  providerMessageId: string;
  uid: number;
  serverThreadId?: string | null;
  receivedAt: string;
  flags: string[];
  parsed: ParsedMailLike;
}): SupportMailboxMessage {
  const rawHeaders = extractRawHeaders(input.parsed);
  const sender = normalizeSender(input.parsed);
  const references = normalizeReferences(input.parsed.references ?? rawHeaders.references ?? "");
  const rfcMessageId = clean(input.parsed.messageId ?? rawHeaders["message-id"]) || null;
  const inReplyTo = clean(input.parsed.inReplyTo ?? rawHeaders["in-reply-to"]) || null;
  const bodyText = clean(input.parsed.text)
    || truncateText(clean(typeof input.parsed.html === "string" ? input.parsed.html : ""), 12_000);
  const subject = clean(input.parsed.subject) || clean(rawHeaders.subject) || "(no subject)";
  return {
    provider: "namecheap_private_email",
    mailbox: input.mailbox,
    messageId: input.providerMessageId,
    rfcMessageId,
    threadId: deriveThreadId({
      serverThreadId: input.serverThreadId,
      rfcMessageId,
      inReplyTo,
      references,
      subject,
      senderEmail: sender.senderEmail,
      receivedAt: input.receivedAt,
    }),
    historyId: String(input.uid),
    subject,
    snippet: truncateText(bodyText || subject, 240),
    bodyText,
    senderEmail: sender.senderEmail,
    senderName: sender.senderName,
    receivedAt: input.receivedAt,
    references,
    inReplyTo,
    attachments: (input.parsed.attachments ?? []).map((attachment) => ({
      filename: clean(attachment.filename) || "attachment",
      mimeType: clean(attachment.contentType) || "application/octet-stream",
      size:
        typeof attachment.size === "number"
          ? attachment.size
          : Buffer.isBuffer(attachment.content)
            ? attachment.content.length
            : null,
    })),
    linkDomains: extractLinkDomains(bodyText),
    labels: [...input.flags].sort((left, right) => left.localeCompare(right)),
    rawHeaders,
  };
}

async function parseFetchedMessage(input: {
  mailbox: string;
  fetchMessage: FetchMessageObject;
  uidValidity: bigint;
}): Promise<SupportMailboxMessage | null> {
  if (!Buffer.isBuffer(input.fetchMessage.source) || typeof input.fetchMessage.uid !== "number") {
    return null;
  }
  const parsed = await simpleParser(input.fetchMessage.source);
  const providerMessageId = `imap-${input.uidValidity.toString()}-${input.fetchMessage.uid}`;
  const receivedAt =
    input.fetchMessage.internalDate instanceof Date
      ? input.fetchMessage.internalDate.toISOString()
      : parsed.date instanceof Date
        ? parsed.date.toISOString()
        : new Date().toISOString();
  return buildMailboxMessage({
    mailbox: input.mailbox,
    providerMessageId,
    uid: input.fetchMessage.uid,
    serverThreadId: typeof input.fetchMessage.threadId === "string" ? input.fetchMessage.threadId : null,
    receivedAt,
    flags: [...(input.fetchMessage.flags ?? [])].map((entry) => String(entry)),
    parsed,
  });
}

export class NamecheapPrivateEmailSupportMailboxAdapter
implements SupportMailboxAdapter, SupportMailboxReader, SupportReplySender {
  private readonly username: string;
  private readonly password: string;
  private readonly mailboxFolder: string;
  private readonly imapHost: string;
  private readonly imapPort: number;
  private readonly imapSecure: boolean;
  private readonly smtpHost: string;
  private readonly smtpPort: number;
  private readonly smtpSecure: boolean;
  private readonly ignoreTlsErrors: boolean;
  private readonly fromName: string | null;
  private readonly transporter: nodemailer.Transporter;

  constructor(options: NamecheapPrivateEmailAdapterOptions) {
    this.username = clean(options.username);
    this.password = clean(options.password);
    this.mailboxFolder = clean(options.mailboxFolder) || "INBOX";
    this.imapHost = clean(options.imapHost) || "mail.privateemail.com";
    this.imapPort = Number.isFinite(options.imapPort) ? Number(options.imapPort) : 993;
    this.imapSecure = options.imapSecure ?? true;
    this.smtpHost = clean(options.smtpHost) || "mail.privateemail.com";
    this.smtpPort = Number.isFinite(options.smtpPort) ? Number(options.smtpPort) : 465;
    this.smtpSecure = options.smtpSecure ?? true;
    this.ignoreTlsErrors = options.ignoreTlsErrors ?? false;
    this.fromName = clean(options.fromName) || null;

    if (!this.username || !this.password) {
      throw new Error("Namecheap Private Email support adapter requires a username and password.");
    }

    this.transporter = nodemailer.createTransport({
      host: this.smtpHost,
      port: this.smtpPort,
      secure: this.smtpSecure,
      auth: {
        user: this.username,
        pass: this.password,
      },
      tls: {
        rejectUnauthorized: !this.ignoreTlsErrors,
      },
    });
  }

  private async withImapClient<T>(run: (client: ImapFlow) => Promise<T>): Promise<T> {
    const client = new ImapFlow({
      host: this.imapHost,
      port: this.imapPort,
      secure: this.imapSecure,
      auth: {
        user: this.username,
        pass: this.password,
      },
      tls: {
        rejectUnauthorized: !this.ignoreTlsErrors,
      },
      logger: false,
      disableAutoIdle: true,
    });
    await client.connect();
    try {
      return await run(client);
    } finally {
      try {
        await client.logout();
      } catch {
        // Best-effort cleanup only.
      }
    }
  }

  async listMessages(input: {
    mailbox: string;
    cursor: string | null;
    maxMessages: number;
    query?: string;
    labelIds?: string[];
  }): Promise<SupportMailboxSyncResult> {
    const maxMessages = Math.max(1, Math.min(input.maxMessages, 100));
    return this.withImapClient(async (client) => {
      const lock = await client.getMailboxLock(this.mailboxFolder, { readOnly: true });
      try {
        const uidCursor = parseUidCursor(input.cursor);
        const mailboxState = client.mailbox;
        if (!mailboxState) {
          throw new Error(`Failed to open IMAP mailbox ${this.mailboxFolder}.`);
        }
        const searchResult = await client.search(
          uidCursor
            ? { uid: `${uidCursor + 1}:*` }
            : { all: true },
          { uid: true },
        );
        const allUids = Array.isArray(searchResult) ? searchResult.filter((uid) => Number.isFinite(uid) && uid > 0) : [];
        const selectedUids = uidCursor ? allUids.slice(0, maxMessages) : allUids.slice(-maxMessages);
        if (selectedUids.length === 0) {
          const fallbackCursor = uidCursor ?? Math.max(0, (mailboxState?.uidNext ?? 1) - 1);
          return {
            messages: [],
            nextCursor: formatUidCursor(fallbackCursor),
            latestCursor: formatUidCursor(fallbackCursor),
          };
        }

        const parsedMessages: SupportMailboxMessage[] = [];
        for await (const fetchMessage of client.fetch(
          selectedUids,
          {
            uid: true,
            flags: true,
            internalDate: true,
            envelope: true,
            source: true,
            threadId: true,
          },
          { uid: true },
        )) {
          const parsed = await parseFetchedMessage({
            mailbox: input.mailbox,
            fetchMessage,
            uidValidity: mailboxState.uidValidity,
          });
          if (parsed) {
            parsedMessages.push(parsed);
          }
        }

        const latestUid = selectedUids[selectedUids.length - 1] ?? uidCursor ?? null;
        parsedMessages.sort((left, right) => left.receivedAt.localeCompare(right.receivedAt));
        return {
          messages: parsedMessages,
          nextCursor: formatUidCursor(latestUid),
          latestCursor: formatUidCursor(latestUid),
        };
      } finally {
        lock.release();
      }
    });
  }

  async sendReply(input: {
    mailbox: string;
    threadId: string;
    to: string;
    subject: string;
    body: string;
    inReplyTo?: string | null;
    references?: string[];
  }): Promise<{ messageId: string | null }> {
    const info = await this.transporter.sendMail({
      from: this.fromName ? `"${this.fromName}" <${this.username}>` : this.username,
      to: input.to,
      subject: input.subject,
      text: input.body,
      inReplyTo: clean(input.inReplyTo) || undefined,
      references: (input.references ?? []).filter(Boolean),
    });
    return {
      messageId: typeof info.messageId === "string" ? info.messageId : null,
    };
  }
}
