import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, resolve } from "node:path";
import { google, gmail_v1 } from "googleapis";
import type {
  SupportMailboxAdapter,
  SupportMailboxMessage,
  SupportMailboxSyncResult,
  SupportReplySender,
  SupportMailboxReader,
} from "./types";

type GmailSupportMailboxAdapterOptions = {
  oauthSource?: "env" | "application_default";
  clientId?: string;
  clientSecret?: string;
  refreshToken?: string;
  credentialsPath?: string;
  userId: string;
};

type GmailAuthorizedUserCredentials = {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
};

const GMAIL_SCOPE_REAUTH_HINT =
  "Use your own Google Cloud OAuth client for Gmail access, then run `gcloud auth application-default login --client-id-file=YOUR_CLIENT_SECRET_JSON --scopes=https://www.googleapis.com/auth/cloud-platform,https://www.googleapis.com/auth/gmail.readonly,https://www.googleapis.com/auth/gmail.send,https://www.googleapis.com/auth/userinfo.email` or provide explicit STUDIO_BRAIN_SUPPORT_EMAIL_GMAIL_* credentials.";

function decodeBase64Url(value: string | null | undefined): string {
  if (!value) return "";
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(normalized, "base64").toString("utf8");
}

function encodeBase64Url(value: string): string {
  return Buffer.from(value, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function flattenParts(payload: gmail_v1.Schema$MessagePart | undefined): gmail_v1.Schema$MessagePart[] {
  if (!payload) return [];
  const nested = payload.parts?.flatMap((part: gmail_v1.Schema$MessagePart) => flattenParts(part)) ?? [];
  return [payload, ...nested];
}

function extractBodyText(payload: gmail_v1.Schema$MessagePart | undefined): string {
  const parts = flattenParts(payload);
  const preferred = parts.find((part) => part.mimeType === "text/plain" && part.body?.data)
    ?? parts.find((part) => part.mimeType === "text/html" && part.body?.data)
    ?? parts.find((part) => part.body?.data);
  return decodeBase64Url(preferred?.body?.data);
}

function extractHeaders(payload: gmail_v1.Schema$MessagePart | undefined): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const header of payload?.headers ?? []) {
    const name = String(header.name ?? "").trim();
    if (!name) continue;
    headers[name.toLowerCase()] = String(header.value ?? "").trim();
  }
  return headers;
}

function extractAttachments(payload: gmail_v1.Schema$MessagePart | undefined) {
  return flattenParts(payload)
    .filter((part) => typeof part.filename === "string" && part.filename.trim().length > 0)
    .map((part) => ({
      filename: String(part.filename ?? "").trim(),
      mimeType: String(part.mimeType ?? "application/octet-stream"),
      size: typeof part.body?.size === "number" ? part.body.size : null,
    }));
}

function extractLinkDomains(text: string): string[] {
  const matches = text.matchAll(/https?:\/\/([^/\s?#]+)/gi);
  const seen = new Set<string>();
  const output: string[] = [];
  for (const match of matches) {
    const domain = String(match[1] ?? "").trim().toLowerCase();
    if (!domain || seen.has(domain)) continue;
    seen.add(domain);
    output.push(domain);
  }
  return output;
}

function parseSender(fromHeader: string): { senderEmail: string | null; senderName: string | null } {
  const raw = fromHeader.trim();
  if (!raw) return { senderEmail: null, senderName: null };
  const emailMatch = raw.match(/<([^>]+)>/);
  if (emailMatch) {
    const senderEmail = emailMatch[1]?.trim().toLowerCase() ?? null;
    const senderName = raw.replace(emailMatch[0], "").replace(/"/g, "").trim() || null;
    return { senderEmail, senderName };
  }
  if (raw.includes("@")) {
    return { senderEmail: raw.toLowerCase(), senderName: null };
  }
  return { senderEmail: null, senderName: raw || null };
}

function clean(value: unknown): string {
  return String(value ?? "").trim();
}

function resolveApplicationDefaultCredentialsPath(configuredPath: string | undefined): string {
  const raw = clean(configuredPath);
  if (raw) {
    return isAbsolute(raw) ? raw : resolve(process.cwd(), raw);
  }
  const appData = clean(process.env.APPDATA);
  if (appData) {
    return resolve(appData, "gcloud", "application_default_credentials.json");
  }
  return resolve(homedir(), ".config", "gcloud", "application_default_credentials.json");
}

function loadAuthorizedUserCredentials(configuredPath: string | undefined): GmailAuthorizedUserCredentials {
  const filePath = resolveApplicationDefaultCredentialsPath(configuredPath);
  if (!existsSync(filePath)) {
    throw new Error(`Gmail application-default OAuth credentials were not found at ${filePath}.`);
  }
  const parsed = JSON.parse(readFileSync(filePath, "utf8")) as Record<string, unknown>;
  const clientId = clean(parsed.client_id);
  const clientSecret = clean(parsed.client_secret);
  const refreshToken = clean(parsed.refresh_token);
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error(`Gmail application-default OAuth credentials are incomplete at ${filePath}.`);
  }
  return {
    clientId,
    clientSecret,
    refreshToken,
  };
}

function normalizeGoogleApiError(error: unknown, action: string): Error {
  const status = typeof (error as { response?: { status?: unknown } })?.response?.status === "number"
    ? Number((error as { response: { status: number } }).response.status)
    : null;
  const details = (error as {
    response?: { data?: { error?: { details?: Array<{ reason?: unknown }> } } };
  })?.response?.data?.error?.details;
  const detailReason = Array.isArray(details) ? clean(details[0]?.reason) : "";
  const message = error instanceof Error ? error.message : String(error);
  if (
    status === 403
    && (/insufficient authentication scopes/i.test(message) || detailReason === "ACCESS_TOKEN_SCOPE_INSUFFICIENT")
  ) {
    return new Error(`${action} failed because Gmail OAuth is missing required Gmail scopes. ${GMAIL_SCOPE_REAUTH_HINT}`);
  }
  return error instanceof Error ? error : new Error(`${action} failed: ${message}`);
}

function parseMessage(message: gmail_v1.Schema$Message, mailbox: string): SupportMailboxMessage {
  const payload = message.payload;
  const headers = extractHeaders(payload);
  const bodyText = extractBodyText(payload);
  const sender = parseSender(headers.from ?? "");
  const references = (headers.references ?? "")
    .split(/\s+/g)
    .map((entry) => entry.trim())
    .filter(Boolean);
  return {
    provider: "gmail",
    mailbox,
    messageId: String(message.id ?? ""),
    rfcMessageId: headers["message-id"] ?? null,
    threadId: String(message.threadId ?? ""),
    historyId: message.historyId ? String(message.historyId) : null,
    subject: headers.subject ?? "(no subject)",
    snippet: String(message.snippet ?? ""),
    bodyText,
    senderEmail: sender.senderEmail,
    senderName: sender.senderName,
    receivedAt: message.internalDate ? new Date(Number(message.internalDate)).toISOString() : new Date().toISOString(),
    references,
    inReplyTo: headers["in-reply-to"] ?? null,
    attachments: extractAttachments(payload),
    linkDomains: extractLinkDomains(`${bodyText}\n${headers["list-unsubscribe"] ?? ""}`),
    labels: (message.labelIds ?? []).map((entry) => String(entry)),
    rawHeaders: headers,
  };
}

export class GmailSupportMailboxAdapter implements SupportMailboxAdapter, SupportMailboxReader, SupportReplySender {
  private readonly gmail: gmail_v1.Gmail;
  private readonly userId: string;

  constructor(options: GmailSupportMailboxAdapterOptions) {
    const credentialSource = options.oauthSource ?? "env";
    const credentials =
      credentialSource === "application_default"
        ? loadAuthorizedUserCredentials(options.credentialsPath)
        : {
            clientId: clean(options.clientId),
            clientSecret: clean(options.clientSecret),
            refreshToken: clean(options.refreshToken),
          };
    if (!credentials.clientId || !credentials.clientSecret || !credentials.refreshToken) {
      throw new Error("Gmail support mailbox adapter requires a client ID, client secret, and refresh token.");
    }
    const auth = new google.auth.OAuth2(credentials.clientId, credentials.clientSecret);
    auth.setCredentials({ refresh_token: credentials.refreshToken });
    this.gmail = google.gmail({ version: "v1", auth });
    this.userId = options.userId;
  }

  private async fetchMessagesByIds(ids: string[], mailbox: string): Promise<SupportMailboxMessage[]> {
    const uniqueIds = [...new Set(ids.filter(Boolean))];
    const rows = await Promise.all(uniqueIds.map(async (id) => {
      try {
        const response = await this.gmail.users.messages.get({
          userId: this.userId,
          id,
          format: "full",
        });
        return parseMessage(response.data, mailbox);
      } catch (error) {
        throw normalizeGoogleApiError(error, "Fetching Gmail support messages");
      }
    }));
    return rows.sort((left, right) => left.receivedAt.localeCompare(right.receivedAt));
  }

  async listMessages(input: {
    mailbox: string;
    cursor: string | null;
    maxMessages: number;
    query?: string;
    labelIds?: string[];
  }): Promise<SupportMailboxSyncResult> {
    const maxMessages = Math.max(1, Math.min(input.maxMessages, 100));
    let ids: string[] = [];
    let latestCursor: string | null = input.cursor;

    if (input.cursor) {
      try {
        const history = await this.gmail.users.history.list({
          userId: this.userId,
          startHistoryId: input.cursor,
          historyTypes: ["messageAdded"],
          maxResults: maxMessages,
          labelId: input.labelIds?.[0],
        });
        latestCursor = history.data.historyId ? String(history.data.historyId) : input.cursor;
        ids = (history.data.history ?? [])
          .flatMap((entry: gmail_v1.Schema$History) => entry.messagesAdded ?? [])
          .map((entry: gmail_v1.Schema$HistoryMessageAdded) => String(entry.message?.id ?? ""))
          .filter(Boolean);
      } catch {
        ids = [];
      }
    }

    if (ids.length === 0) {
      let response: gmail_v1.Schema$ListMessagesResponse;
      try {
        const apiResponse = await this.gmail.users.messages.list({
          userId: this.userId,
          maxResults: maxMessages,
          q: input.query,
          labelIds: input.labelIds,
        });
        response = apiResponse.data;
      } catch (error) {
        throw normalizeGoogleApiError(error, "Listing Gmail support messages");
      }
      ids = (response.messages ?? [])
        .map((message: gmail_v1.Schema$Message) => String(message.id ?? ""))
        .filter(Boolean);
    }

    let messages: SupportMailboxMessage[];
    try {
      messages = await this.fetchMessagesByIds(ids, input.mailbox);
    } catch (error) {
      throw normalizeGoogleApiError(error, "Listing Gmail support messages");
    }
    const messageCursor = messages.reduce<string | null>((current, message) => {
      if (!message.historyId) return current;
      if (!current) return message.historyId;
      return BigInt(message.historyId) > BigInt(current) ? message.historyId : current;
    }, latestCursor);

    return {
      messages,
      nextCursor: messageCursor,
      latestCursor: messageCursor,
    };
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
    const headers = [
      `To: ${input.to}`,
      `Subject: ${input.subject}`,
      "Content-Type: text/plain; charset=UTF-8",
      "MIME-Version: 1.0",
    ];
    if (input.inReplyTo) headers.push(`In-Reply-To: ${input.inReplyTo}`);
    if (input.references && input.references.length > 0) {
      headers.push(`References: ${input.references.join(" ")}`);
    }

    const raw = encodeBase64Url(`${headers.join("\r\n")}\r\n\r\n${input.body}`);
    let response: gmail_v1.Schema$Message;
    try {
      const apiResponse = await this.gmail.users.messages.send({
        userId: this.userId,
        requestBody: {
          raw,
          threadId: input.threadId,
        },
      });
      response = apiResponse.data;
    } catch (error) {
      throw normalizeGoogleApiError(error, "Sending Gmail support replies");
    }
    return {
      messageId: response.id ? String(response.id) : null,
    };
  }
}
