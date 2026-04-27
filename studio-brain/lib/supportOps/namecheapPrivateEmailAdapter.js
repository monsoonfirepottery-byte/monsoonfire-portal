"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.NamecheapPrivateEmailSupportMailboxAdapter = void 0;
const node_crypto_1 = require("node:crypto");
const imapflow_1 = require("imapflow");
const nodemailer_1 = __importDefault(require("nodemailer"));
const { simpleParser } = require("mailparser");
const UID_CURSOR_PREFIX = "uid:";
function clean(value) {
    return String(value ?? "").trim();
}
function truncateText(value, maxLength) {
    const normalized = clean(value);
    if (normalized.length <= maxLength)
        return normalized;
    return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}
function encodeThreadFallback(input) {
    return `email-thread-${(0, node_crypto_1.createHash)("sha256").update(JSON.stringify(input)).digest("hex").slice(0, 24)}`;
}
function normalizeReferences(value) {
    if (Array.isArray(value)) {
        return value.map((entry) => clean(entry)).filter(Boolean);
    }
    return clean(value)
        .split(/\s+/g)
        .map((entry) => entry.trim())
        .filter(Boolean);
}
function extractLinkDomains(text) {
    const matches = text.matchAll(/https?:\/\/([^/\s?#]+)/gi);
    const seen = new Set();
    const output = [];
    for (const match of matches) {
        const domain = clean(match[1]).toLowerCase();
        if (!domain || seen.has(domain))
            continue;
        seen.add(domain);
        output.push(domain);
    }
    return output;
}
function extractRawHeaders(parsed) {
    const headers = {};
    const headerLines = Array.isArray(parsed.headerLines) ? parsed.headerLines : [];
    for (const header of headerLines) {
        const name = clean(header.key).toLowerCase();
        const line = clean(header.line);
        if (!name || !line)
            continue;
        const separatorIndex = line.indexOf(":");
        headers[name] = separatorIndex >= 0 ? line.slice(separatorIndex + 1).trim() : line;
    }
    return headers;
}
function parseUidCursor(cursor) {
    const raw = clean(cursor);
    if (!raw)
        return null;
    if (raw.startsWith(UID_CURSOR_PREFIX)) {
        const parsed = Number.parseInt(raw.slice(UID_CURSOR_PREFIX.length), 10);
        return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
    }
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}
function formatUidCursor(uid) {
    if (!uid || !Number.isFinite(uid) || uid < 1)
        return null;
    return `${UID_CURSOR_PREFIX}${uid}`;
}
function deriveThreadId(input) {
    const serverThreadId = clean(input.serverThreadId);
    if (serverThreadId)
        return serverThreadId;
    const references = (input.references ?? []).map((entry) => clean(entry)).filter(Boolean);
    if (references.length > 0)
        return references[0];
    const inReplyTo = clean(input.inReplyTo);
    if (inReplyTo)
        return inReplyTo;
    const rfcMessageId = clean(input.rfcMessageId);
    if (rfcMessageId)
        return rfcMessageId;
    return encodeThreadFallback({
        subject: clean(input.subject) || null,
        senderEmail: clean(input.senderEmail).toLowerCase() || null,
        receivedAt: clean(input.receivedAt) || null,
    });
}
function normalizeSender(parsed) {
    const first = parsed.from?.value?.[0];
    return {
        senderEmail: clean(first?.address).toLowerCase() || null,
        senderName: clean(first?.name) || null,
    };
}
function buildMailboxMessage(input) {
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
            size: typeof attachment.size === "number"
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
async function parseFetchedMessage(input) {
    if (!Buffer.isBuffer(input.fetchMessage.source) || typeof input.fetchMessage.uid !== "number") {
        return null;
    }
    const parsed = await simpleParser(input.fetchMessage.source);
    const providerMessageId = `imap-${input.uidValidity.toString()}-${input.fetchMessage.uid}`;
    const receivedAt = input.fetchMessage.internalDate instanceof Date
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
class NamecheapPrivateEmailSupportMailboxAdapter {
    username;
    password;
    mailboxFolder;
    imapHost;
    imapPort;
    imapSecure;
    smtpHost;
    smtpPort;
    smtpSecure;
    ignoreTlsErrors;
    fromName;
    transporter;
    constructor(options) {
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
        this.transporter = nodemailer_1.default.createTransport({
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
    async withImapClient(run) {
        const client = new imapflow_1.ImapFlow({
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
        }
        finally {
            try {
                await client.logout();
            }
            catch {
                // Best-effort cleanup only.
            }
        }
    }
    async listMessages(input) {
        const maxMessages = Math.max(1, Math.min(input.maxMessages, 100));
        return this.withImapClient(async (client) => {
            const lock = await client.getMailboxLock(this.mailboxFolder, { readOnly: true });
            try {
                const uidCursor = parseUidCursor(input.cursor);
                const mailboxState = client.mailbox;
                if (!mailboxState) {
                    throw new Error(`Failed to open IMAP mailbox ${this.mailboxFolder}.`);
                }
                const searchResult = await client.search(uidCursor
                    ? { uid: `${uidCursor + 1}:*` }
                    : { all: true }, { uid: true });
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
                const parsedMessages = [];
                for await (const fetchMessage of client.fetch(selectedUids, {
                    uid: true,
                    flags: true,
                    internalDate: true,
                    envelope: true,
                    source: true,
                    threadId: true,
                }, { uid: true })) {
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
            }
            finally {
                lock.release();
            }
        });
    }
    async sendReply(input) {
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
exports.NamecheapPrivateEmailSupportMailboxAdapter = NamecheapPrivateEmailSupportMailboxAdapter;
