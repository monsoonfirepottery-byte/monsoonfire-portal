#!/usr/bin/env node

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  appendJsonl,
  fileHasContent,
  parseCliArgs,
  readBoolFlag,
  readJson,
  readJsonl,
  readJsonlWithRaw,
  readNumberFlag,
  readStringFlag,
  runCommand,
  stableHash,
  writeJson,
  writeJsonl,
  isoNow,
} from "./lib/pst-memory-utils.mjs";
import { mintStaffIdTokenFromPortalEnv } from "./lib/firebase-auth-token.mjs";
import { resolveStudioBrainBaseUrlFromEnv } from "./studio-brain-url-resolution.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..");

function resolveHomeOrRepoDefault(...relativeCandidates) {
  for (const relativePath of relativeCandidates) {
    const homePath = resolve(homedir(), relativePath);
    if (existsSync(homePath)) return homePath;
    const repoPath = resolve(REPO_ROOT, relativePath);
    if (existsSync(repoPath)) return repoPath;
  }
  return resolve(homedir(), relativeCandidates[0]);
}
const MAX_MEMORY_CONTENT_CHARS = 20_000;
const MAX_CLIENT_REQUEST_ID_CHARS = 128;
const MAX_IMPORT_METADATA_JSON_CHARS = 48_000;
const MAX_IMPORT_TAGS = 24;
const MAX_IMPORT_TAG_CHARS = 64;
const MAX_ATTACHMENT_SUMMARY_ITEMS = 24;
const RETRYABLE_HTTP_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);
const MAX_RETRY_BACKOFF_MS = 120_000;
const OUTLOOK_TEXT_ATTACHMENT_EXTENSIONS = new Set([
  ".txt",
  ".md",
  ".csv",
  ".tsv",
  ".json",
  ".xml",
  ".yaml",
  ".yml",
  ".html",
  ".htm",
  ".log",
  ".ini",
  ".conf",
  ".sql",
  ".ics",
  ".eml",
]);

function usage() {
  process.stdout.write(
    [
      "Open Memory Mail Import",
      "",
      "Usage:",
      "  node ./scripts/open-memory-mail-import.mjs --mode outlook --run-id mail-...",
      "  node ./scripts/open-memory-mail-import.mjs --mode imap --run-id mail-...",
      "",
      "Common options:",
      "  --mode <outlook|imap>               Source connector mode (default: outlook)",
      "  --run-id <id>                        Import run id (default: mail-<timestamp>)",
      "  --run-root <path>                    Working folder (default: ./imports/mail/runs/<run-id>)",
      "  --source <string>                    Source tag stored in memory rows (default: mail:<mode>)",
      "  --tenant-id <id>",
      "  --agent-id <id>",
      "  --run-scope <id>                     Optional suffix appended to source rows for replay-friendly reruns",
      "  --inject-run-id true|false            Override each row runId with scoped run id (default: true)",
      "  --open-memory-script <path>           open-memory CLI script path (default: ./scripts/open-memory.mjs)",
      "  --stage-mode <both|extract-only|ingest-only>  Pipeline stage mode (default: both)",
      "  --chunk-size <n>                     Import chunk size 1..500 (default: 300)",
      "  --content-max-chars <n>              Max chars per memory content before import (default: 20000)",
      "  --max-items <n>                      Max source rows to fetch per run (default: 1200)",
      "  --import-concurrency-cap <n>         Max concurrent /api/memory/import calls across workers (default: 3)",
      "  --post-chunk-sleep-ms <n>            Sleep after successful chunk import (default: 150)",
      "  --open-memory-timeout-ms <n>         Timeout per /api/memory/import request (default: 30000)",
      "  --open-memory-command-timeout-ms <n> Timeout for each open-memory CLI subprocess",
      "  --open-memory-request-retries <n>    Retry attempts in open-memory HTTP client (default: 2)",
      "  --open-memory-request-retry-base-ms <n>  Base retry delay in open-memory HTTP client (default: 400)",
      "  --max-retries <n>                    Per-chunk retry attempts (default: 3)",
      "  --continue-on-error <t/f>            Continue after failed chunks (default: true)",
      "  --disable-run-burst-limit true|false  Disable run-write burst limiter for this import run",
      "  --base-url <url>                     Studio Brain base URL (defaults to STUDIO_BRAIN_BASE_URL / network profile)",
      "  --mint-staff-token true|false         Mint token via portal creds when STUDIO_BRAIN_AUTH_TOKEN missing (default: true)",
      "  --checkpoint <path>                  Resumable checkpoint path",
      "  --ledger <path>                      Chunk result ledger JSONL",
      "  --dead-letter <path>                 Failed-row dead-letter JSONL",
      "  --snapshot <path>                    Source JSONL snapshot path",
      "  --report <path>                      Final report JSON path",
      "  --load-env-file true|false            Load ./secrets/studio-brain/studio-brain-automation.env (default: true)",
      "  --load-portal-env-file true|false     Load ./secrets/portal/portal-automation.env (default: true)",
      "  --portal-env-file <path>              Override portal automation env path",
      "  --env-file <path>                    Override env path",
      "  --force-reextract true|false          Re-fetch source and ignore existing snapshot/checkpoint",
      "  --json                               Print final report JSON",
      "",
      "Outlook options:",
      "  --outlook-user <userPrincipalName>   Microsoft mailbox to read (required for app auth)",
      "  --outlook-tenant-id <tenant>",
      "  --outlook-client-id <id>",
      "  --outlook-client-secret <secret>",
      "  --outlook-client-secret-env <name>",
      "  --outlook-access-token <jwt>         Direct access token for Graph API",
      "  --outlook-token-file <path>          JSON file that contains access token (for imported sessions)",
      "  --outlook-folder <name>              Mail folder (default: Inbox)",
      "  --outlook-folder-id <id>             Outlook Graph folder id (preferred for breadth sweeps)",
      "  --outlook-since <ISO8601>            Fetch messages since this time (receivedDateTime)",
      "  --outlook-before <ISO8601>           Fetch messages before this time",
      "  --outlook-filter <odata-filter>       Extra Graph filter condition",
      "  --outlook-page-size <n>              Graph page size (default: 80)",
      "  --outlook-graph-max-retries <n>      Retries for Graph list throttles/errors (default: 12)",
      "  --outlook-attachment-mode <none|metadata|text>  Attachment handling mode (default: none)",
      "  --outlook-attachment-max-items-per-message <n>  Attachment records kept per message (default: 8)",
      "  --outlook-attachment-max-bytes <n>   Max bytes for text extraction candidate (default: 1048576)",
      "  --outlook-attachment-max-text-chars <n>  Max extracted text chars per attachment (default: 6000)",
      "  --outlook-attachment-allow-mime <csv> Optional MIME allowlist for text extraction",
      "  --outlook-attachment-include-inline true|false  Include inline attachments (default: false)",
      "",
      "IMAP options:",
      "  --imap-host <host>                   IMAP host",
      "  --imap-port <port>                   IMAP port (default: 993)",
      "  --imap-user <user>                   IMAP username",
      "  --imap-password <password>            IMAP password",
      "  --imap-auth-method <login|xoauth2>   IMAP auth mode (default: login)",
      "  --imap-oauth-access-token <token>     OAuth bearer token for XOAUTH2 auth",
      "  --imap-oauth-token-file <path>        JSON file with access token for XOAUTH2 auth",
      "  --imap-mailbox <name>                Mailbox/folder (default: INBOX)",
      "  --imap-secure true|false              Use TLS/SSL (default: true)",
      "  --imap-unseen true|false              Only fetch unseen messages",
      "  --imap-since <YYYY-MM-DD>            Imap SINCE date filter",
      "  --imap-before <YYYY-MM-DD>           Imap BEFORE date filter",
      "  --imap-search <criteria>              Extra IMAP search tokens (repeatable)",
      "  --imap-ignore-cert true|false          Skip TLS cert validation",
      "",
      "Examples:",
      "  # Microsoft Graph mailbox sync",
      "  node ./scripts/open-memory-mail-import.mjs --mode outlook --run-id outlook-main-2026-03-03 \\",
      "    --outlook-user support@monsoonfire.com --outlook-tenant-id ... --outlook-client-id ... \\",
      "    --outlook-client-secret ... --disable-run-burst-limit true",
      "",
      "  # Namecheap IMAP mailbox sync",
      "  node ./scripts/open-memory-mail-import.mjs --mode imap --run-id namecheap-main \\",
      "    --imap-host imap.privateemail.com --imap-user postmaster@monsoonfire.com \\",
      "    --imap-password ... --imap-search UNSEEN --disable-run-burst-limit true",
    ].join("\n")
  );
}

function loadEnvFile(filePath) {
  if (!existsSync(filePath)) {
    return { attempted: false, loaded: false, filePath, keysLoaded: 0 };
  }
  const raw = readFileSync(filePath, "utf8");
  const lines = raw.split(/\r?\n/);
  let keysLoaded = 0;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const normalized = trimmed.startsWith("export ") ? trimmed.slice("export ".length).trim() : trimmed;
    const separator = normalized.indexOf("=");
    if (separator <= 0) continue;
    const key = normalized.slice(0, separator).trim();
    let value = normalized.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!key || process.env[key]) continue;
    process.env[key] = value;
    keysLoaded += 1;
  }
  return { attempted: true, loaded: keysLoaded > 0, filePath, keysLoaded };
}

function normalizeBearerToken(rawToken) {
  const token = String(rawToken || "").trim();
  if (!token) return "";
  return /^bearer\s+/i.test(token) ? token : `Bearer ${token}`;
}

function normalizeRawToken(rawToken) {
  const token = String(rawToken || "").trim();
  if (!token) return "";
  return /^bearer\s+/i.test(token) ? token.replace(/^bearer\s+/i, "").trim() : token;
}

function normalizeStudioBrainBearer(rawToken) {
  const token = String(rawToken || "").trim();
  if (!token) return "";
  return /^bearer\s+/i.test(token) ? token : `Bearer ${token}`;
}

function splitSearchTokens(value) {
  if (!value) return [];
  return String(value)
    .split(",")
    .flatMap((part) => String(part).trim().split(/\s+/g))
    .map((token) => String(token).trim())
    .filter((token) => token.length > 0);
}

function collectArgValues(rawArgs, flag) {
  const target = `--${flag}`;
  const collected = [];
  for (let index = 0; index < rawArgs.length; index += 1) {
    const token = String(rawArgs[index] ?? "").trim();
    if (!token) continue;
    if (token === target) {
      const value = rawArgs[index + 1];
      if (!value || String(value).startsWith("--")) {
        continue;
      }
      collected.push(String(value));
      index += 1;
      continue;
    }
    if (token.startsWith(`${target}=`)) {
      collected.push(token.slice(target.length + 1));
    }
  }
  return collected;
}

function stableHash32(value) {
  return createHash("sha256").update(String(value ?? "")).digest("hex").slice(0, 24);
}

function buildClientRequestId(prefix, ...parts) {
  const normalizedPrefix = String(prefix || "import").trim() || "import";
  const normalizedParts = parts
    .map((entry) => String(entry || "").trim())
    .filter(Boolean);
  const preferredCore = normalizedParts[0] || stableHash32(normalizedParts.join("|") || normalizedPrefix);
  const preferred = `${normalizedPrefix}-${preferredCore}`;
  if (preferred.length <= MAX_CLIENT_REQUEST_ID_CHARS) {
    return preferred;
  }
  const safePrefix = normalizedPrefix.replace(/[^a-zA-Z0-9:_-]/g, "-").slice(0, 64) || "import";
  const hash = stableHash32(normalizedParts.join("|") || preferred);
  return `${safePrefix}-${hash}`.slice(0, MAX_CLIENT_REQUEST_ID_CHARS);
}

function resolveRunArtifactPath(runRoot, providedPath, fallbackRelative) {
  const provided = String(providedPath || "").trim();
  if (!provided) return resolve(runRoot, fallbackRelative);
  return resolve(REPO_ROOT, provided);
}

function stripHtml(value) {
  return String(value || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function clipText(value, maxChars = MAX_MEMORY_CONTENT_CHARS) {
  const normalized = String(value || "").trim();
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, maxChars - 1).trimEnd()}…`;
}

function cleanBoundedString(value, maxChars) {
  const normalized = String(value || "").trim();
  if (!normalized) return "";
  if (normalized.length <= maxChars) return normalized;
  return normalized.slice(0, maxChars).trim();
}

function splitCsvValues(value) {
  if (!value) return [];
  return String(value)
    .split(",")
    .map((entry) => String(entry || "").trim())
    .filter(Boolean);
}

function normalizeMimeAllowList(value) {
  return new Set(
    splitCsvValues(value)
      .map((entry) => String(entry || "").trim().toLowerCase())
      .filter(Boolean)
  );
}

function getAttachmentExtension(value) {
  const name = String(value || "").trim().toLowerCase();
  if (!name) return "";
  const idx = name.lastIndexOf(".");
  if (idx < 0) return "";
  return name.slice(idx);
}

function toMimeTag(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return normalized ? `mime-${normalized}`.slice(0, MAX_IMPORT_TAG_CHARS) : "";
}

function shouldExtractOutlookAttachmentText({
  attachmentName,
  mimeType,
  sizeBytes,
  maxBytes,
  allowMimeSet,
}) {
  const normalizedMime = String(mimeType || "").trim().toLowerCase();
  const extension = getAttachmentExtension(attachmentName);
  const numericSize = Number(sizeBytes || 0);
  if (!Number.isFinite(numericSize) || numericSize <= 0) {
    return { ok: false, reason: "empty_or_unknown_size" };
  }
  if (numericSize > maxBytes) {
    return { ok: false, reason: "too_large" };
  }
  if (allowMimeSet.size > 0 && (!normalizedMime || !allowMimeSet.has(normalizedMime))) {
    return { ok: false, reason: "mime_not_allowlisted" };
  }
  const textLikeMime =
    normalizedMime.startsWith("text/") ||
    normalizedMime.includes("json") ||
    normalizedMime.includes("xml") ||
    normalizedMime.includes("csv") ||
    normalizedMime.includes("yaml") ||
    normalizedMime.includes("javascript");
  const textLikeExtension = OUTLOOK_TEXT_ATTACHMENT_EXTENSIONS.has(extension);
  if (!textLikeMime && !textLikeExtension) {
    return { ok: false, reason: "not_text_like" };
  }
  return { ok: true, reason: "extract" };
}

function decodeOutlookAttachmentText({ contentBytes, mimeType, maxTextChars }) {
  const raw = String(contentBytes || "").trim();
  if (!raw) {
    return { ok: false, reason: "missing_content_bytes", text: "", sizeBytes: 0, sha256: "" };
  }

  let bytes;
  try {
    bytes = Buffer.from(raw, "base64");
  } catch {
    return { ok: false, reason: "base64_decode_failed", text: "", sizeBytes: 0, sha256: "" };
  }
  if (!bytes || bytes.length === 0) {
    return { ok: false, reason: "empty_decoded_payload", text: "", sizeBytes: 0, sha256: "" };
  }

  const sample = bytes.subarray(0, Math.min(bytes.length, 2048));
  let nonTextBytes = 0;
  for (const byte of sample) {
    const printable =
      (byte >= 32 && byte <= 126) ||
      byte === 9 ||
      byte === 10 ||
      byte === 13 ||
      byte >= 160;
    if (!printable) nonTextBytes += 1;
  }
  if (sample.length > 0 && nonTextBytes / sample.length > 0.35) {
    return {
      ok: false,
      reason: "binary_like_payload",
      text: "",
      sizeBytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
  }

  let text = bytes.toString("utf8");
  if (String(mimeType || "").toLowerCase().includes("html")) {
    text = stripHtml(text);
  }
  text = clipText(text, maxTextChars);
  if (!text) {
    return {
      ok: false,
      reason: "empty_text_after_decode",
      text: "",
      sizeBytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
  }

  return {
    ok: true,
    reason: "ok",
    text,
    sizeBytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

async function fetchOutlookAttachmentList({
  mailboxPath,
  messageId,
  headers,
  graphMaxRetries,
  source,
}) {
  const query = new URLSearchParams({
    "$select": "id,name,contentType,size,isInline,lastModifiedDateTime",
    "$top": "50",
  });
  let nextUrl = `https://graph.microsoft.com/v1.0/${mailboxPath}/messages/${encodeURIComponent(messageId)}/attachments?${query.toString()}`;
  const rows = [];
  while (nextUrl) {
    const response = await fetchWithRetry(
      nextUrl,
      { headers },
      `outlook attachment list ${source}`,
      graphMaxRetries
    );
    if (!response.ok) {
      throw new Error(`Graph attachment list failed: HTTP ${response.status}`);
    }
    let payload;
    try {
      payload = JSON.parse(response.raw || "{}");
    } catch (error) {
      throw new Error(
        `Graph attachment list returned invalid payload: ${error instanceof Error ? error.message : String(error)}`
      );
    }
    const values = Array.isArray(payload?.value) ? payload.value : [];
    for (const value of values) {
      rows.push(value);
    }
    nextUrl = typeof payload["@odata.nextLink"] === "string" ? payload["@odata.nextLink"] : "";
  }
  return rows;
}

async function fetchOutlookAttachmentPayload({
  mailboxPath,
  messageId,
  attachmentId,
  headers,
  graphMaxRetries,
  source,
}) {
  const query = new URLSearchParams({
    "$select": "id,name,contentType,size,isInline,lastModifiedDateTime,contentBytes",
  });
  const url = `https://graph.microsoft.com/v1.0/${mailboxPath}/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}?${query.toString()}`;
  const response = await fetchWithRetry(
    url,
    { headers },
    `outlook attachment payload ${source}`,
    graphMaxRetries
  );
  if (!response.ok) {
    return {
      ok: false,
      error: `http_${response.status}`,
      status: response.status,
      payload: null,
    };
  }
  try {
    return {
      ok: true,
      error: "",
      status: response.status,
      payload: JSON.parse(response.raw || "{}"),
    };
  } catch (error) {
    return {
      ok: false,
      error: `invalid_json_payload_${error instanceof Error ? error.message : String(error)}`,
      status: response.status,
      payload: null,
    };
  }
}

function buildOutlookAttachmentMemoryRow({
  baseSource,
  runId,
  tenantId,
  agentId,
  mailbox,
  parentMessage,
  attachment,
  extractionStatus,
  extractionReason,
  extractedText,
  decodedSizeBytes,
  contentHash,
}) {
  const parentReceivedAt = toIso8601(parentMessage.receivedDateTime || parentMessage.sentDateTime);
  const parentSentAt = toIso8601(parentMessage.sentDateTime || parentMessage.receivedDateTime);
  const parentRawMessageId = cleanBoundedString(parentMessage.id || "", 240);
  const parentMessageId = cleanBoundedString(parentMessage.internetMessageId || parentMessage.id || "", 300);
  const attachmentName = cleanBoundedString(attachment.name || "", 240) || "(unnamed attachment)";
  const mimeType =
    cleanBoundedString(String(attachment.contentType || "").toLowerCase(), 180) || "application/octet-stream";
  const sizeBytes = Number(attachment.size || 0);
  const attachmentId = cleanBoundedString(attachment.id || "", 240);
  const attachmentStableId = stableHash32(
    `${parentRawMessageId}|${parentMessageId}|${attachmentId}|${attachmentName}|${sizeBytes}`
  );
  const source = `${baseSource}:attachment`;
  const lines = [
    `Mailbox: ${baseSource}`,
    `Parent-Subject: ${String(parentMessage.subject || "(no subject)")}`,
    `Parent-From: ${parentMessage.from?.emailAddress?.address || "(unknown sender)"}`,
    `Parent-Message-Date: ${parentReceivedAt || "(unknown)"}`,
    `Parent-Internet-Message-Id: ${parentMessage.internetMessageId || "(none)"}`,
    `Attachment-Id: ${attachmentId || "(none)"}`,
    `Attachment-Name: ${attachmentName}`,
    `Attachment-Mime: ${mimeType}`,
    `Attachment-Size-Bytes: ${Number.isFinite(sizeBytes) ? sizeBytes : 0}`,
    `Attachment-Is-Inline: ${Boolean(attachment.isInline)}`,
    `Attachment-Extraction-Status: ${extractionStatus}`,
    extractionReason ? `Attachment-Extraction-Reason: ${extractionReason}` : "",
    contentHash ? `Attachment-Content-Sha256: ${contentHash}` : "",
    "",
    extractedText
      ? extractedText
      : "(No attachment text extracted; metadata captured for context and downstream processing.)",
  ].filter(Boolean);

  const mimeTag = toMimeTag(mimeType);
  return {
    id: `${source}:${attachmentStableId}`,
    content: clipText(lines.join("\n"), MAX_MEMORY_CONTENT_CHARS - 50),
    source,
    tags: [
      "mail",
      "outlook",
      "graph",
      "attachment",
      extractedText ? "attachment-text" : "attachment-metadata",
      mimeTag,
    ].filter(Boolean),
    tenantId: tenantId || undefined,
    agentId: agentId || "agent:import",
    runId,
    clientRequestId: buildClientRequestId(source, parentRawMessageId || parentMessageId, attachmentId || attachmentStableId),
    occurredAt: parentReceivedAt || parentSentAt || undefined,
    memoryType: "artifact",
    importance: extractedText ? 0.62 : 0.44,
    sourceConfidence: extractedText ? 0.64 : 0.46,
    metadata: {
      connector: "outlook-graph",
      provider: "outlook",
      sourceMode: "outlook-attachment",
      mailbox: mailbox || "",
      parentRawMessageId,
      parentMessageId,
      parentConversationId: cleanBoundedString(parentMessage.conversationId || "", 240) || null,
      parentSubject: cleanBoundedString(parentMessage.subject || "", 300) || null,
      parentFrom: cleanBoundedString(parentMessage.from?.emailAddress?.address || "", 240) || null,
      parentReceivedAt: parentReceivedAt || null,
      parentSentAt: parentSentAt || null,
      attachmentId: attachmentId || null,
      attachmentName,
      attachmentMimeType: mimeType,
      attachmentSizeBytes: Number.isFinite(sizeBytes) ? sizeBytes : 0,
      attachmentIsInline: Boolean(attachment.isInline),
      attachmentType: cleanBoundedString(attachment["@odata.type"] || "", 120) || null,
      attachmentLastModifiedAt: toIso8601(attachment.lastModifiedDateTime) || null,
      attachmentExtractionStatus: extractionStatus,
      attachmentExtractionReason: extractionReason || null,
      attachmentDecodedSizeBytes: decodedSizeBytes || null,
      attachmentContentSha256: contentHash || null,
      attachmentTextChars: extractedText ? extractedText.length : 0,
    },
  };
}

async function extractOutlookAttachmentRowsForMessage({
  message,
  source,
  runId,
  tenantId,
  agentId,
  mailbox,
  mailboxPath,
  headers,
  graphMaxRetries,
  mode,
  maxItemsPerMessage,
  maxBytes,
  maxTextChars,
  includeInline,
  allowMimeSet,
}) {
  const attachmentRows = [];
  const summary = {
    attachmentProcessingMode: mode,
    attachmentCount: 0,
    attachmentInlineCount: 0,
    attachmentExtractedCount: 0,
    attachmentMetadataOnlyCount: 0,
    attachmentSkippedCount: 0,
    attachmentFetchErrorCount: 0,
    attachmentTextCharCount: 0,
    attachmentNames: [],
    attachmentMimeTypes: [],
    attachmentTruncated: false,
  };
  const messageId = cleanBoundedString(message?.id || "", 240);
  if (!messageId) {
    return { rows: attachmentRows, summary };
  }

  const attachmentList = await fetchOutlookAttachmentList({
    mailboxPath,
    messageId,
    headers,
    graphMaxRetries,
    source,
  });

  const seenMimes = new Set();
  for (const attachment of attachmentList) {
    if (attachmentRows.length >= maxItemsPerMessage) {
      summary.attachmentTruncated = true;
      break;
    }
    const isInline = Boolean(attachment?.isInline);
    if (isInline) {
      summary.attachmentInlineCount += 1;
    }
    if (isInline && !includeInline) {
      summary.attachmentSkippedCount += 1;
      continue;
    }

    const attachmentName = cleanBoundedString(attachment?.name || "", 240) || "(unnamed attachment)";
    const mimeType =
      cleanBoundedString(String(attachment?.contentType || "").toLowerCase(), 180) || "application/octet-stream";
    const sizeBytes = Number(attachment?.size || 0);
    if (summary.attachmentNames.length < MAX_ATTACHMENT_SUMMARY_ITEMS) {
      summary.attachmentNames.push(attachmentName);
    }
    if (!seenMimes.has(mimeType) && summary.attachmentMimeTypes.length < MAX_ATTACHMENT_SUMMARY_ITEMS) {
      seenMimes.add(mimeType);
      summary.attachmentMimeTypes.push(mimeType);
    }

    let extractionStatus = "metadata_only";
    let extractionReason = "";
    let extractedText = "";
    let decodedSizeBytes = 0;
    let contentHash = "";
    if (mode === "text") {
      const extractCheck = shouldExtractOutlookAttachmentText({
        attachmentName,
        mimeType,
        sizeBytes,
        maxBytes,
        allowMimeSet,
      });
      if (!extractCheck.ok) {
        extractionStatus = "text_skipped";
        extractionReason = extractCheck.reason;
      } else {
        const payloadResponse = await fetchOutlookAttachmentPayload({
          mailboxPath,
          messageId,
          attachmentId: cleanBoundedString(attachment?.id || "", 240),
          headers,
          graphMaxRetries,
          source,
        });
        if (!payloadResponse.ok || !payloadResponse.payload) {
          extractionStatus = "text_fetch_failed";
          extractionReason = payloadResponse.error || "payload_fetch_failed";
          summary.attachmentFetchErrorCount += 1;
        } else {
          const decoded = decodeOutlookAttachmentText({
            contentBytes: payloadResponse.payload.contentBytes || "",
            mimeType,
            maxTextChars,
          });
          if (!decoded.ok) {
            extractionStatus = "text_decode_failed";
            extractionReason = decoded.reason;
            decodedSizeBytes = Number(decoded.sizeBytes || 0);
            contentHash = decoded.sha256 || "";
          } else {
            extractionStatus = "text_extracted";
            extractedText = decoded.text;
            decodedSizeBytes = Number(decoded.sizeBytes || 0);
            contentHash = decoded.sha256 || "";
          }
        }
      }
    }

    const row = buildOutlookAttachmentMemoryRow({
      baseSource: source,
      runId,
      tenantId,
      agentId,
      mailbox,
      parentMessage: message,
      attachment,
      extractionStatus,
      extractionReason,
      extractedText,
      decodedSizeBytes,
      contentHash,
    });
    attachmentRows.push(row);
    summary.attachmentCount += 1;
    if (extractionStatus === "text_extracted") {
      summary.attachmentExtractedCount += 1;
      summary.attachmentTextCharCount += extractedText.length;
    } else {
      summary.attachmentMetadataOnlyCount += 1;
      if (extractionReason) {
        summary.attachmentSkippedCount += 1;
      }
    }
  }

  summary.attachmentNames = summary.attachmentNames.slice(0, MAX_ATTACHMENT_SUMMARY_ITEMS);
  summary.attachmentMimeTypes = summary.attachmentMimeTypes.slice(0, MAX_ATTACHMENT_SUMMARY_ITEMS);
  return {
    rows: attachmentRows,
    summary,
  };
}

function sanitizeTags(rawTags, sourceHint) {
  const values = Array.isArray(rawTags) ? rawTags : [];
  const out = [];
  const seen = new Set();
  const sourceTokens = String(sourceHint || "")
    .split(/[:/\s]+/g)
    .map((token) => cleanBoundedString(token, MAX_IMPORT_TAG_CHARS).toLowerCase())
    .filter(Boolean);

  for (const seed of ["mail", "import", ...sourceTokens]) {
    if (!seed || seen.has(seed)) continue;
    seen.add(seed);
    out.push(seed);
  }

  for (const value of values) {
    const normalized = cleanBoundedString(value, MAX_IMPORT_TAG_CHARS).toLowerCase();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
    if (out.length >= MAX_IMPORT_TAGS) break;
  }

  return out.slice(0, MAX_IMPORT_TAGS);
}

function sanitizeMetadataValue(value, depth = 0) {
  if (depth > 5) return undefined;
  if (value === null) return null;
  if (value === undefined) return undefined;

  if (typeof value === "string") {
    return cleanBoundedString(value, 4000);
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "bigint") {
    return cleanBoundedString(String(value), 128);
  }
  if (value instanceof Date) {
    const iso = value.toISOString?.();
    return iso || undefined;
  }
  if (Array.isArray(value)) {
    const items = [];
    for (const item of value.slice(0, 64)) {
      const next = sanitizeMetadataValue(item, depth + 1);
      if (next !== undefined) items.push(next);
    }
    return items;
  }
  if (typeof value === "object") {
    const out = {};
    const entries = Object.entries(value).slice(0, 128);
    for (const [rawKey, rawValue] of entries) {
      const key = cleanBoundedString(rawKey, 128).replace(/\s+/g, "_");
      if (!key) continue;
      const next = sanitizeMetadataValue(rawValue, depth + 1);
      if (next !== undefined) {
        out[key] = next;
      }
    }
    return out;
  }

  return undefined;
}

function sanitizeMetadata(rawMetadata) {
  const normalized = sanitizeMetadataValue(rawMetadata, 0);
  const base = normalized && typeof normalized === "object" && !Array.isArray(normalized) ? normalized : {};
  const encoded = JSON.stringify(base);
  if (!encoded || encoded.length <= MAX_IMPORT_METADATA_JSON_CHARS) {
    return base;
  }

  const fallback = {};
  for (const key of [
    "connector",
    "provider",
    "sourceMode",
    "mailbox",
    "providerFolder",
    "messageId",
    "rawMessageId",
    "conversationId",
    "subject",
    "from",
    "receivedAt",
    "sentAt",
    "threadKey",
    "loopClusterKey",
  ]) {
    const value = sanitizeMetadataValue(base[key], 0);
    if (value !== undefined) fallback[key] = value;
  }
  fallback._truncated = true;
  fallback._originalKeyCount = Object.keys(base).length;
  return fallback;
}

function sanitizeImportRow({
  row,
  rowIndex,
  source,
  runId,
  runScope,
  injectRunId,
  tenantId,
  agentId,
  contentMaxChars,
  seenIds,
  seenClientRequestIds,
}) {
  if (!row || typeof row !== "object") {
    return { ok: false, reason: "row_not_object" };
  }

  const content = clipText(row.content, Math.max(200, contentMaxChars - 200));
  if (!content) {
    return { ok: false, reason: "empty_content_after_clip" };
  }

  const normalizedSource = cleanBoundedString(row.source || source, 128) || source;
  if (!normalizedSource) {
    return { ok: false, reason: "missing_source" };
  }

  const baseId = cleanBoundedString(row.id, 256);
  const derivedId = `${normalizedSource}:${stableHash32(`${rowIndex}|${row.clientRequestId || ""}|${content.slice(0, 256)}`)}`;
  const normalizedId = baseId || derivedId;
  if (seenIds.has(normalizedId)) {
    return { ok: false, reason: "duplicate_id", id: normalizedId };
  }

  const rawClientRequestId = cleanBoundedString(row.clientRequestId, MAX_CLIENT_REQUEST_ID_CHARS);
  const normalizedClientRequestId =
    rawClientRequestId || buildClientRequestId(normalizedSource, normalizedId, String(rowIndex));
  if (seenClientRequestIds.has(normalizedClientRequestId)) {
    return { ok: false, reason: "duplicate_client_request_id", clientRequestId: normalizedClientRequestId };
  }

  let occurredAt;
  if (row.occurredAt !== undefined) {
    const iso = toIso8601(row.occurredAt);
    if (iso) {
      occurredAt = iso;
    }
  }

  const normalizedRunId = (() => {
    const rowRunId = cleanBoundedString(row.runId || runId, 128) || runId;
    if (!injectRunId) return rowRunId;
    return runScope ? `${runScope}-${rowRunId}` : rowRunId;
  })();

  const normalizedTags = sanitizeTags(row.tags, normalizedSource);
  const normalizedMetadata = sanitizeMetadata(row.metadata);

  seenIds.add(normalizedId);
  seenClientRequestIds.add(normalizedClientRequestId);

  return {
    ok: true,
    row: {
      ...row,
      id: normalizedId,
      source: normalizedSource,
      runId: normalizedRunId,
      tenantId: tenantId || row.tenantId || undefined,
      agentId: agentId || row.agentId || "agent:import",
      clientRequestId: normalizedClientRequestId,
      content,
      tags: normalizedTags,
      metadata: normalizedMetadata,
      ...(occurredAt ? { occurredAt } : {}),
    },
  };
}

function buildContextFallbackRow({ row, source, rowIndex, failureReason }) {
  const fallbackSource = cleanBoundedString(`${source}:fallback`, 128) || "mail:fallback";
  const metadata = sanitizeMetadata(row?.metadata);
  const subject = cleanBoundedString(metadata.subject || row?.subject || "", 300);
  const from = cleanBoundedString(metadata.from || "", 240);
  const mailbox = cleanBoundedString(metadata.mailbox || "", 240);
  const threadKey = cleanBoundedString(metadata.threadKey || "", 240);
  const conversationId = cleanBoundedString(metadata.conversationId || "", 240);
  const receivedAt = toIso8601(row?.occurredAt || metadata.receivedAt || metadata.sentAt || "");
  const contentSnippet = clipText(stripHtml(row?.content || ""), 1400);
  const lines = [
    "Context fallback capture for a problematic mail row.",
    subject ? `Subject: ${subject}` : "",
    from ? `From: ${from}` : "",
    mailbox ? `Mailbox: ${mailbox}` : "",
    receivedAt ? `OccurredAt: ${receivedAt}` : "",
    threadKey ? `Thread: ${threadKey}` : "",
    conversationId ? `Conversation: ${conversationId}` : "",
    failureReason ? `PrimaryImportFailure: ${cleanBoundedString(failureReason, 500)}` : "",
    "",
    contentSnippet || "(no content snippet)",
  ].filter(Boolean);

  const normalizedId = cleanBoundedString(row?.id, 256);
  const normalizedClientRequestId = cleanBoundedString(row?.clientRequestId, MAX_CLIENT_REQUEST_ID_CHARS);
  const fallbackId = `${fallbackSource}:${stableHash32(`${normalizedId}|${normalizedClientRequestId}|${rowIndex}`)}`;

  return {
    id: fallbackId,
    source: fallbackSource,
    tags: sanitizeTags([...(Array.isArray(row?.tags) ? row.tags : []), "fallback", "context-only"], fallbackSource),
    tenantId: row?.tenantId,
    agentId: row?.agentId || "agent:import",
    runId: row?.runId,
    clientRequestId: buildClientRequestId(
      `${fallbackSource}-ctx`,
      normalizedClientRequestId || normalizedId || String(rowIndex),
      String(rowIndex)
    ),
    occurredAt: receivedAt || undefined,
    content: clipText(lines.join("\n"), 5000),
    metadata: {
      connector: metadata.connector || null,
      provider: metadata.provider || null,
      sourceMode: metadata.sourceMode || null,
      mailbox: mailbox || null,
      subject: subject || null,
      from: from || null,
      threadKey: threadKey || null,
      conversationId: conversationId || null,
      originalMemoryId: normalizedId || null,
      originalClientRequestId: normalizedClientRequestId || null,
      fallback: true,
      fallbackReason: cleanBoundedString(failureReason || "primary_item_import_failed", 500),
      fallbackCapturedAt: isoNow(),
    },
  };
}

function toIso8601(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString();
}

function parseImportResponse(rawStdout) {
  const text = String(rawStdout || "").trim();
  if (!text) return null;
  const parseCandidates = (() => {
    const candidates = [text];
    const lines = text
      .split(/\r?\n/g)
      .map((line) => String(line || "").trim())
      .filter(Boolean);
    for (let idx = lines.length - 1; idx >= 0; idx -= 1) {
      const line = lines[idx];
      if ((line.startsWith("{") && line.endsWith("}")) || (line.startsWith("[") && line.endsWith("]"))) {
        candidates.push(line);
      }
      if (candidates.length >= 24) break;
    }
    return Array.from(new Set(candidates));
  })();

  let parsed = null;
  for (const candidate of parseCandidates) {
    try {
      parsed = JSON.parse(candidate);
      break;
    } catch {
      // try next candidate
    }
  }
  if (!parsed || typeof parsed !== "object") return null;
  const queue = [parsed];
  while (queue.length > 0) {
    const next = queue.shift();
    if (!next || typeof next !== "object") continue;
    const imported = Number(next.imported);
    const failed = Number(next.failed);
    const total = Number(next.total);
    if (Number.isFinite(imported) && Number.isFinite(failed)) {
      const { sampleError, failedIndexes, failedErrorByIndex } = (() => {
        const sampleContainers = [next, parsed];
        const failedIndexes = [];
        const failedErrorByIndex = {};
        let sampleError = "";
        for (const container of sampleContainers) {
          if (!container || typeof container !== "object") continue;
          const results = Array.isArray(container.results) ? container.results : [];
          for (const result of results) {
            const index = Number(result?.index);
            const ok = result?.ok === true;
            const value = String(result?.error || "").trim();
            if (!ok && Number.isFinite(index) && index >= 0) {
              failedIndexes.push(index);
              if (value) {
                failedErrorByIndex[String(index)] = value;
              }
            }
            if (!sampleError && value) {
              sampleError = value;
            }
          }
        }
        return {
          sampleError,
          failedIndexes: Array.from(new Set(failedIndexes)).sort((left, right) => left - right),
          failedErrorByIndex,
        };
      })();
      return {
        imported,
        failed,
        total: Number.isFinite(total) ? total : imported + failed,
        sampleError,
        failedIndexes,
        failedErrorByIndex,
      };
    }
    for (const nested of Object.values(next)) {
      if (nested && typeof nested === "object") {
        queue.push(nested);
      }
    }
  }
  return null;
}

function sleep(ms) {
  return new Promise((resolvePromise) => {
    setTimeout(resolvePromise, Math.max(0, ms));
  });
}

function parseRetryAfterMs(value) {
  const raw = String(value || "").trim();
  if (!raw) return 0;
  const numeric = Number(raw);
  if (Number.isFinite(numeric) && numeric > 0) {
    return Math.round(numeric * 1000);
  }
  const ts = Date.parse(raw);
  if (!Number.isFinite(ts)) return 0;
  const delta = ts - Date.now();
  return delta > 0 ? delta : 0;
}

function computeRetryDelayMs({ attempt, status, retryAfterHeader }) {
  const retryAfterMs = parseRetryAfterMs(retryAfterHeader);
  const baseMs = status === 429 ? 1200 : 350;
  const exponentialMs = Math.min(MAX_RETRY_BACKOFF_MS, Math.round(baseMs * 2 ** Math.max(0, attempt - 1)));
  const jitterMs = Math.floor(Math.random() * 900);
  return Math.max(retryAfterMs, exponentialMs + jitterMs);
}

function buildOpenMemoryInvocation(openMemoryScript, args) {
  const script = String(openMemoryScript || "").trim();
  if (/\.(mjs|cjs|js)$/i.test(script)) {
    return {
      command: process.execPath,
      commandArgs: [script, ...args],
    };
  }
  return {
    command: script || process.execPath,
    commandArgs: script ? args : ["./scripts/open-memory.mjs", ...args],
  };
}

async function fetchWithRetry(url, options, label, maxRetries = 3) {
  let attempt = 0;
  let lastError = "";
  while (attempt <= maxRetries) {
    attempt += 1;
    try {
      const response = await fetch(url, options);
      const raw = await response.text();
      if (response.ok) {
        return {
          ok: true,
          status: response.status,
          response,
          raw,
        };
      }

      if (RETRYABLE_HTTP_STATUSES.has(response.status) && attempt <= maxRetries) {
        const retryAfter = response.headers?.get?.("retry-after") || "";
        const delayMs = computeRetryDelayMs({
          attempt,
          status: response.status,
          retryAfterHeader: retryAfter,
        });
        lastError = `HTTP ${response.status} for ${label}`;
        await sleep(delayMs);
        continue;
      }

      return {
        ok: false,
        status: response.status,
        response,
        raw,
      };
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      if (attempt > maxRetries) {
        throw new Error(`${label} failed: ${lastError}`);
      }
      await sleep(computeRetryDelayMs({ attempt, status: 503, retryAfterHeader: "" }));
    }
  }

  throw new Error(`${label} failed after ${maxRetries} retries: ${lastError}`);
}

async function getOutlookAccessToken({ tenantId, clientId, clientSecret, accessToken }) {
  if (accessToken) return normalizeRawToken(accessToken);
  if (!tenantId || !clientId || !clientSecret) {
    throw new Error(
      "outlook mode requires --outlook-access-token or --outlook-tenant-id + --outlook-client-id + --outlook-client-secret."
    );
  }

  const tokenUrl = `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    scope: "https://graph.microsoft.com/.default",
    grant_type: "client_credentials",
  });

  const tokenResult = await fetchWithRetry(
    tokenUrl,
    {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
      },
      body,
    },
    `outlook token call for tenant ${tenantId}`
  );

  if (!tokenResult.ok) {
    throw new Error(`token request failed with HTTP ${tokenResult.status}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(tokenResult.raw);
  } catch {
    throw new Error("token response was not valid JSON");
  }
  const token = String(parsed?.access_token || "").trim();
  if (!token) {
    throw new Error("token response did not include access_token");
  }
  return token;
}

function toMailboxContent({ item, source, provider }) {
  const subject = String(item.subject || "(no subject)");
  const from = item.from?.emailAddress?.address || "(unknown sender)";
  const toRecipients = Array.isArray(item.toRecipients)
    ? item.toRecipients.map((entry) => entry?.emailAddress?.address).filter(Boolean)
    : [];
  const ccRecipients = Array.isArray(item.ccRecipients)
    ? item.ccRecipients.map((entry) => entry?.emailAddress?.address).filter(Boolean)
    : [];
  const bccRecipients = extractOutlookHeader(item, "Bcc")
    .split(/[;,]/g)
    .map((value) => String(value || "").trim())
    .filter(Boolean);
  const received = toIso8601(item.receivedDateTime || item.sentDateTime);
  const body = item.body?.content || item.bodyPreview || "";
  const textBody = String(item.body?.contentType || "").toLowerCase() === "html" ? stripHtml(body) : String(body);
  const text = clipText(
    [
      `Mailbox: ${source}`,
      `From: ${from}`,
      `To: ${toRecipients.join(", ") || "(no recipients)"}`,
      `Subject: ${subject}`,
      `Message-Date: ${received || "(unknown)"}`,
      `Internet-Message-Id: ${item.internetMessageId || "(none)"}`,
      `Conversation: ${item.conversationId || "(none)"}`,
      "",
      textBody || "(No body text available)",
    ].join("\n"),
    MAX_MEMORY_CONTENT_CHARS - 50
  );

  return {
    subject,
    from,
    to: toRecipients,
    cc: ccRecipients,
    bcc: bccRecipients,
    bodyText: text,
    receivedAt: received,
    sentAt: toIso8601(item.sentDateTime),
    internetMessageId: String(item.internetMessageId || "").trim(),
    messageId: String(item.internetMessageId || item.id || "").trim(),
    rawMessageId: String(item.id || "").trim(),
    inReplyTo: String(item.inReplyTo || extractOutlookHeader(item, "In-Reply-To") || "").trim(),
    references: String(item.references || extractOutlookHeader(item, "References") || "").trim(),
    conversationId: String(item.conversationId || "").trim(),
    provider,
    providerFolder: String(item.mailFolder || "").trim(),
    mailbox: String(item.mailbox || item.user || source || "").trim(),
    metadataSubject: item.subject || "",
    hasAttachments: Boolean(item.hasAttachments),
  };
}

function extractOutlookHeader(item, name) {
  const headers = Array.isArray(item?.internetMessageHeaders) ? item.internetMessageHeaders : [];
  const needle = String(name || "").trim().toLowerCase();
  if (!needle) return "";
  for (const header of headers) {
    const headerName = String(header?.name || "").trim().toLowerCase();
    if (headerName === needle) {
      return String(header?.value || "").trim();
    }
  }
  return "";
}

function normalizeMessageId(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return "";
  const bracketed = raw.match(/<[^>]+>/g);
  if (Array.isArray(bracketed) && bracketed.length > 0) {
    return String(bracketed[0]).trim();
  }
  return raw.replace(/\s+/g, "");
}

function parseReferenceMessageIds(value) {
  const raw = String(value || "").trim();
  if (!raw) return [];
  const bracketed = raw.match(/<[^>]+>/g);
  const candidates = Array.isArray(bracketed) && bracketed.length > 0 ? bracketed : raw.split(/[,\s]+/);
  const out = [];
  const seen = new Set();
  for (const candidate of candidates) {
    const normalized = normalizeMessageId(candidate);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out.slice(0, 24);
}

function normalizeSubjectKey(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const normalized = raw
    .replace(/^((re|fw|fwd)\s*:\s*)+/gi, "")
    .replace(/\[[^\]]+\]/g, " ")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
  return normalized.slice(0, 140);
}

function extractEmails(value) {
  const values = Array.isArray(value) ? value : [value];
  const out = [];
  const seen = new Set();
  for (const entry of values) {
    const raw = String(entry || "").trim();
    if (!raw) continue;
    const matches = raw.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi);
    const candidates = Array.isArray(matches) && matches.length > 0 ? matches : [raw];
    for (const candidate of candidates) {
      const normalized = String(candidate || "").trim().toLowerCase();
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      out.push(normalized);
    }
  }
  return out;
}

function toParticipantKey({ from, to, cc, bcc }) {
  const participants = [
    ...extractEmails(from),
    ...extractEmails(to),
    ...extractEmails(cc),
    ...extractEmails(bcc),
  ];
  const unique = Array.from(new Set(participants)).sort();
  return unique.slice(0, 24).join("|").slice(0, 240);
}

function extractDomainsFromParticipants(participantKey) {
  const parts = String(participantKey || "")
    .split("|")
    .map((entry) => String(entry || "").trim().toLowerCase())
    .filter(Boolean);
  const domains = new Set();
  for (const value of parts) {
    const [, domain] = value.split("@");
    if (domain) domains.add(domain);
  }
  return Array.from(domains).slice(0, 24);
}

function toTemporalBuckets(isoDateTime) {
  const ts = Date.parse(String(isoDateTime || ""));
  if (!Number.isFinite(ts)) return [];
  const date = new Date(ts);
  const day = date.toISOString().slice(0, 10);
  const hour = `${day}T${String(date.getUTCHours()).padStart(2, "0")}`;
  const weekStart = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const weekday = weekStart.getUTCDay();
  const delta = (weekday + 6) % 7;
  weekStart.setUTCDate(weekStart.getUTCDate() - delta);
  const week = weekStart.toISOString().slice(0, 10);
  return [`day:${day}`, `hour:${hour}`, `week:${week}`];
}

function computeLoopClusterKey({ threadKey, subjectKey, participantKey, mentionedTickets }) {
  const ticket = Array.isArray(mentionedTickets) ? String(mentionedTickets[0] || "").trim().toUpperCase() : "";
  if (ticket) return `ticket:${ticket}`;
  const normalizedThread = String(threadKey || "").trim().slice(0, 120);
  if (normalizedThread) return `thread:${normalizedThread}`;
  const normalizedSubject = String(subjectKey || "").trim();
  const normalizedParticipants = String(participantKey || "").trim();
  if (normalizedSubject && normalizedParticipants) {
    return `sp:${stableHash32(`${normalizedSubject}|${normalizedParticipants}`)}`;
  }
  if (normalizedSubject) {
    return `subject:${normalizedSubject.slice(0, 120)}`;
  }
  if (normalizedParticipants) {
    return `participants:${stableHash32(normalizedParticipants)}`;
  }
  return "";
}

function computeMailContextSignals({ subject, bodyText, hasAttachments }) {
  const haystack = `${String(subject || "")}\n${String(bodyText || "")}`.toLowerCase();
  const decisionLike = /\b(decision|decided|approved|approval|final|confirmed|go\/no-go|go-no-go)\b/.test(haystack);
  const actionLike = /\b(action item|todo|next step|follow up|follow-up|please|can you|could you|owner)\b/.test(haystack);
  const blockerLike = /\b(blocker|blocked|incident|outage|failure|error|risk|escalat|urgent)\b/.test(haystack);
  const deadlineLike = /\b(deadline|due|eta|today|tomorrow|eod|eow|this week|\bby\b)\b/.test(haystack);
  const numericLike = /\b\d{1,4}([:/.-]\d{1,4})?\b/.test(haystack);
  const urgentLike = /\b(urgent|asap|immediately|priority|p0|p1|sev1|sev2|critical)\b/.test(haystack);
  const reopenedLike = /\b(reopen|re-open|opened again|back again|regression|issue returned|still broken)\b/.test(haystack);
  const correctionLike = /\b(correction|clarify|clarification|ignore previous|supersede|superseded|latest update)\b/.test(haystack);

  const flags = {
    decisionLike,
    actionLike,
    blockerLike,
    deadlineLike,
    numericLike,
    urgentLike,
    reopenedLike,
    correctionLike,
    hasAttachments: Boolean(hasAttachments),
  };

  let importance = 0.22;
  if (decisionLike) importance += 0.24;
  if (actionLike) importance += 0.18;
  if (blockerLike) importance += 0.22;
  if (deadlineLike) importance += 0.14;
  if (numericLike) importance += 0.06;
  if (urgentLike) importance += 0.18;
  if (reopenedLike) importance += 0.1;
  if (correctionLike) importance += 0.08;
  if (hasAttachments) importance += 0.04;
  importance = Math.max(0.12, Math.min(0.95, importance));

  let sourceConfidence = 0.28;
  if (decisionLike) sourceConfidence += 0.10;
  if (actionLike) sourceConfidence += 0.06;
  if (blockerLike) sourceConfidence += 0.10;
  if (urgentLike) sourceConfidence += 0.08;
  if (correctionLike) sourceConfidence += 0.06;
  sourceConfidence = Math.max(0.22, Math.min(0.65, sourceConfidence));

  return {
    flags,
    importance,
    sourceConfidence,
  };
}

function enrichMailRows(rows, providerTag) {
  const messageIdToMemoryId = new Map();
  const threadBuckets = new Map();

  for (const row of rows) {
    const metadata = row.metadata || {};
    const messageId = normalizeMessageId(metadata.messageId || metadata.rawMessageId || "");
    if (messageId && !messageIdToMemoryId.has(messageId)) {
      messageIdToMemoryId.set(messageId, row.id);
    }
    const threadKey = String(metadata.threadKey || "").trim();
    if (threadKey) {
      const bucket = threadBuckets.get(threadKey) || [];
      bucket.push(row.id);
      threadBuckets.set(threadKey, bucket);
    }
  }

  return rows.map((row) => {
    const metadata = row.metadata || {};
    const subjectKey = normalizeSubjectKey(metadata.subject || "");
    const participantKey = toParticipantKey({
      from: metadata.from,
      to: metadata.to,
      cc: metadata.cc,
      bcc: metadata.bcc,
    });
    const participantDomains = extractDomainsFromParticipants(participantKey);
    const threadKey =
      String(metadata.threadKey || "").trim() ||
      (subjectKey ? `${providerTag}:subject:${subjectKey}` : "");
    const normalizedMessageId = normalizeMessageId(metadata.messageId || metadata.rawMessageId || "");
    const referenceMessageIds = parseReferenceMessageIds(metadata.references || "");
    const relatedMemoryIds = new Set();
    const inReplyTo = normalizeMessageId(metadata.inReplyTo || "");
    if (inReplyTo && messageIdToMemoryId.has(inReplyTo)) {
      relatedMemoryIds.add(messageIdToMemoryId.get(inReplyTo));
    }
    for (const referenceId of referenceMessageIds) {
      const linked = messageIdToMemoryId.get(referenceId);
      if (linked && linked !== row.id) relatedMemoryIds.add(linked);
    }
    const siblings = threadBuckets.get(threadKey) || [];
    for (const siblingId of siblings) {
      if (siblingId !== row.id && relatedMemoryIds.size < 12) {
        relatedMemoryIds.add(siblingId);
      }
    }

    const signals = computeMailContextSignals({
      subject: metadata.subject,
      bodyText: row.content,
      hasAttachments: metadata.hasAttachments,
    });
    const threadDepthEstimate = Math.min(24, referenceMessageIds.length + (inReplyTo ? 1 : 0));
    const messageStructure = {
      hasThreadKey: Boolean(threadKey),
      hasMessageId: Boolean(normalizedMessageId),
      hasReferences: referenceMessageIds.length > 0,
      hasReplyTo: Boolean(inReplyTo),
      hasParticipants: Boolean(participantKey),
      hasReceivedAt: Boolean(metadata.receivedAt || metadata.sentAt),
    };
    const structureSignalCount = Object.values(messageStructure).filter(Boolean).length;
    const structureConfidenceBoost = Math.min(0.18, structureSignalCount * 0.03);
    const adjustedSourceConfidence = Math.max(0.22, Math.min(0.82, signals.sourceConfidence + structureConfidenceBoost));
    const mentionedTickets = Array.from(
      new Set((String(row.content || "").match(/\b(?:[A-Z]{2,10}-\d{1,8}|INC\d{4,10}|SR-\d{3,10}|BUG-\d{3,10}|#\d{2,8})\b/g) || []).map((value) => String(value)))
    ).slice(0, 24);
    const mentionedUrls = Array.from(
      new Set((String(row.content || "").match(/\bhttps?:\/\/[^\s)>"']+/gi) || []).map((value) => String(value).toLowerCase()))
    ).slice(0, 24);
    const topicTokens = Array.from(
      new Set(
        String(subjectKey || "")
          .split(/\s+/g)
          .map((token) => token.trim().toLowerCase())
          .filter((token) => token.length >= 4)
      )
    ).slice(0, 24);
    const loopClusterKey = computeLoopClusterKey({
      threadKey,
      subjectKey,
      participantKey,
      mentionedTickets,
    });
    const patternHints = [];
    if (signals.flags.decisionLike) patternHints.push("intent:decision");
    if (signals.flags.actionLike) patternHints.push("intent:action");
    if (signals.flags.blockerLike) patternHints.push("intent:blocker");
    if (signals.flags.deadlineLike) patternHints.push("intent:deadline");
    if (signals.flags.numericLike) patternHints.push("intent:numeric");
    if (signals.flags.urgentLike) patternHints.push("priority:urgent");
    if (signals.flags.reopenedLike) patternHints.push("state:reopened");
    if (signals.flags.correctionLike) patternHints.push("state:superseded");
    if (signals.flags.hasAttachments) patternHints.push("intent:attachments");
    const openLoopLike = (signals.flags.actionLike || signals.flags.blockerLike) && !signals.flags.decisionLike;
    if (openLoopLike) patternHints.push("state:open-loop");
    if (signals.flags.decisionLike && !signals.flags.blockerLike) patternHints.push("state:resolved");
    const loopState = signals.flags.reopenedLike
      ? "reopened"
      : signals.flags.correctionLike
        ? "superseded"
        : openLoopLike
          ? "open-loop"
          : signals.flags.decisionLike && !signals.flags.blockerLike
            ? "resolved"
            : null;
    if (threadKey) patternHints.push(`thread:${threadKey.slice(0, 120)}`);
    if (threadDepthEstimate >= 6) patternHints.push("thread:deep");
    else if (threadDepthEstimate >= 2) patternHints.push("thread:mid");
    else patternHints.push("thread:shallow");
    if (loopClusterKey) patternHints.push(`loop:${loopClusterKey.slice(0, 140)}`);
    if (subjectKey) patternHints.push(`topic:${subjectKey.slice(0, 120)}`);
    for (const token of String(subjectKey || "")
      .split(/\s+/g)
      .map((entry) => String(entry || "").trim().toLowerCase())
      .filter((entry) => entry.length >= 4)
      .slice(0, 8)) {
      patternHints.push(`topic:${token}`);
    }
    const temporalBuckets = toTemporalBuckets(metadata.receivedAt || metadata.sentAt || "");
    const normalizedRelatedMemoryIds = Array.from(relatedMemoryIds).filter(Boolean).slice(0, 12);
    const resolvesMemoryIds = loopState === "resolved" ? normalizedRelatedMemoryIds.slice(0, 6) : [];
    const reopensMemoryIds = loopState === "reopened" || loopState === "open-loop" ? normalizedRelatedMemoryIds.slice(0, 6) : [];
    const supersedesMemoryIds = loopState === "superseded" ? normalizedRelatedMemoryIds.slice(0, 6) : [];

    return {
      ...row,
      memoryType: "episodic",
      importance: signals.importance,
      sourceConfidence: adjustedSourceConfidence,
      metadata: {
        ...metadata,
        threadKey: threadKey || null,
        loopClusterKey: loopClusterKey || null,
        loopState,
        subjectKey: subjectKey || null,
        participantKey: participantKey || null,
        participantDomains,
        normalizedMessageId: normalizedMessageId || null,
        threadDepthEstimate,
        referenceMessageIds,
        relatedMemoryIds: normalizedRelatedMemoryIds,
        resolvesMemoryIds,
        reopensMemoryIds,
        supersedesMemoryIds,
        mentionedTickets,
        mentionedUrls,
        topicTokens,
        patternHints: Array.from(new Set(patternHints)).slice(0, 24),
        temporalBuckets,
        messageStructure,
        structureSignalCount,
        contextSignals: signals.flags,
      },
    };
  });
}

function toOutlookMemoryRows({
  items,
  runId,
  tenantId,
  agentId,
  baseSource,
  mailbox,
  attachmentSummaryByRawMessageId = new Map(),
}) {
  const baseRows = items
    .map((item) => {
      const parsed = toMailboxContent({
        item,
        source: baseSource,
        provider: "outlook-graph",
      });
      if (!parsed.messageId && !parsed.rawMessageId) {
        return null;
      }
      const attachmentSummary =
        attachmentSummaryByRawMessageId instanceof Map
          ? attachmentSummaryByRawMessageId.get(parsed.rawMessageId || "")
          : null;
      const deterministicId = stableHash32(`${parsed.rawMessageId}|${parsed.messageId}|${parsed.receivedAt}`);
      const occurredAt = parsed.receivedAt || parsed.sentAt;
      return {
        id: `${baseSource}:${deterministicId}`,
        content: parsed.bodyText,
        source: baseSource,
        tags: ["mail", "outlook", "graph"],
        tenantId: tenantId || undefined,
        agentId: agentId || "agent:import",
        runId: runId,
        clientRequestId: buildClientRequestId(
          baseSource,
          parsed.rawMessageId || parsed.messageId || deterministicId,
          parsed.receivedAt || ""
        ),
        occurredAt: occurredAt || undefined,
        metadata: {
          connector: "outlook-graph",
          provider: "outlook",
          sourceMode: "outlook",
          providerFolder: parsed.providerFolder,
          mailbox: mailbox || parsed.mailbox || "",
          rawMessageId: parsed.rawMessageId,
          messageId: parsed.messageId,
          inReplyTo: parsed.inReplyTo,
          references: parsed.references,
          conversationId: parsed.conversationId,
          hasAttachments: parsed.hasAttachments,
          to: parsed.to,
          cc: parsed.cc,
          bcc: parsed.bcc,
          from: parsed.from,
          subject: parsed.metadataSubject,
          sentAt: parsed.sentAt,
          receivedAt: parsed.receivedAt,
          ...(attachmentSummary
            ? {
                attachmentProcessingMode: attachmentSummary.attachmentProcessingMode,
                attachmentCount: attachmentSummary.attachmentCount,
                attachmentInlineCount: attachmentSummary.attachmentInlineCount,
                attachmentExtractedCount: attachmentSummary.attachmentExtractedCount,
                attachmentMetadataOnlyCount: attachmentSummary.attachmentMetadataOnlyCount,
                attachmentSkippedCount: attachmentSummary.attachmentSkippedCount,
                attachmentFetchErrorCount: attachmentSummary.attachmentFetchErrorCount,
                attachmentTextCharCount: attachmentSummary.attachmentTextCharCount,
                attachmentNames: attachmentSummary.attachmentNames,
                attachmentMimeTypes: attachmentSummary.attachmentMimeTypes,
                attachmentTruncated: attachmentSummary.attachmentTruncated,
              }
            : {}),
        },
      };
    })
    .filter((row) => row && row.content.length > 0);
  return enrichMailRows(baseRows, "outlook");
}

function toImapMemoryRows({ rows, runId, tenantId, agentId, baseSource }) {
  const baseRows = rows
    .map((row) => {
      const provider = "imap";
      const subject = String(row.subject || "(no subject)");
      const from = String(row.from || "(unknown sender)");
      const toRecipients = Array.isArray(row.to) ? row.to.filter(Boolean) : [];
      const receivedAt = toIso8601(row.receivedDate || row.date || row.sentDate);
      const uid = String(row.uid || "").trim();
      const messageId = String(row.messageId || row.id || uid || "").trim();
      const bodyText = clipText(
        [
          `Mailbox: ${baseSource}`,
          `Host: ${row.host || "(unknown)"}`,
          `Folder: ${row.mailbox || "INBOX"}`,
          `From: ${from}`,
          `To: ${(toRecipients.length > 0 ? toRecipients.join(", ") : "(no recipients)")}`,
          `Date: ${receivedAt || "(unknown)"}`,
          `Message-Id: ${messageId || "(none)"}`,
          `UID: ${uid || "(none)"}`,
          `\n${String(row.bodyText || "").trim() || "(No body text available)"}`,
        ].join("\n"),
        MAX_MEMORY_CONTENT_CHARS - 50
      );

      if (!bodyText) {
        return null;
      }

      return {
        id: `${baseSource}:${stableHash32(`${uid}|${messageId}|${receivedAt}`)}`,
        content: bodyText,
        source: baseSource,
        tags: ["mail", provider, String(row.provider || "").toLowerCase()],
        tenantId: tenantId || undefined,
        agentId: agentId || "agent:import",
        runId: runId,
        clientRequestId: buildClientRequestId(
          baseSource,
          uid || messageId || stableHash32(subject),
          receivedAt || ""
        ),
        occurredAt: receivedAt || undefined,
        metadata: {
          connector: `imap:${row.provider || "generic"}`,
          provider,
          sourceMode: "imap",
          host: row.host,
          mailbox: row.mailbox,
          threadKey: normalizeSubjectKey(subject) ? `imap:subject:${normalizeSubjectKey(subject)}` : null,
          uid,
          rawMessageId: messageId,
          messageId,
          subject,
          from,
          to: toRecipients,
          cc: row.cc || [],
          bcc: row.bcc || [],
          inReplyTo: row.inReplyTo,
          references: row.references,
          sentDate: toIso8601(row.sentDate),
          receivedDate: toIso8601(row.receivedDate),
        },
      };
    })
    .filter((row) => row && row.content.length > 0);
  return enrichMailRows(baseRows, "imap");
}

function formatODataDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString();
}

async function extractOutlookRows({
  source,
  runId,
  tenantId,
  agentId,
  maxItems,
  pageSize,
  graphMaxRetries,
  sinceIso,
  beforeIso,
  customFilter,
  user,
  folder,
  folderId,
  auth,
  attachmentOptions,
}) {
  const token = await getOutlookAccessToken(auth);
  const headers = {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
  };

  const mailboxPath = user ? `users/${encodeURIComponent(user)}` : "me";
  const resolvedFolder = String(folderId || folder || "Inbox").trim();
  const folderPath = `${mailboxPath}/mailFolders/${encodeURIComponent(resolvedFolder)}/messages`;
  const filterParts = [];
  if (sinceIso) filterParts.push(`receivedDateTime ge ${formatODataDate(sinceIso)}`);
  if (beforeIso) filterParts.push(`receivedDateTime le ${formatODataDate(beforeIso)}`);
  if (customFilter) filterParts.push(`(${customFilter})`);

  const query = new URLSearchParams({
    "$select": [
      "id",
      "subject",
      "receivedDateTime",
      "sentDateTime",
      "from",
      "toRecipients",
      "ccRecipients",
      "conversationId",
      "bodyPreview",
      "body",
      "internetMessageId",
      "hasAttachments",
    ].join(","),
    "$top": String(Math.min(200, Math.max(1, pageSize))),
  });
  const effectiveFilter = filterParts.length > 0 ? filterParts.join(" and ") : "";
  if (effectiveFilter) {
    query.set("$filter", effectiveFilter);
  }
  const safeToOrderByReceivedDate = (() => {
    if (!effectiveFilter) return true;
    const normalized = String(effectiveFilter).toLowerCase();
    return normalized.includes("receiveddatetime");
  })();
  if (safeToOrderByReceivedDate) {
    query.set("$orderby", "receivedDateTime asc");
  }

  let nextUrl = `https://graph.microsoft.com/v1.0/${folderPath}?${query.toString()}`;
  const rows = [];
  while (nextUrl && rows.length < maxItems) {
    const response = await fetchWithRetry(
      nextUrl,
      { headers },
      `outlook list ${source}`,
      graphMaxRetries
    );
    if (!response.ok) {
      let graphMessage = "";
      try {
        const parsed = JSON.parse(response.raw || "{}");
        graphMessage = cleanBoundedString(
          parsed?.error?.message || parsed?.error_description || parsed?.message || "",
          320
        );
      } catch {
        graphMessage = cleanBoundedString(response.raw || "", 320);
      }
      const suffix = graphMessage ? ` (${graphMessage})` : "";
      throw new Error(`Graph list failed: HTTP ${response.status}${suffix}`);
    }
    let payload;
    try {
      payload = JSON.parse(response.raw || "{}");
    } catch (error) {
      throw new Error(`Graph list returned invalid payload: ${error instanceof Error ? error.message : String(error)}`);
    }
    const values = Array.isArray(payload?.value) ? payload.value : [];
    for (const item of values) {
      if (rows.length >= maxItems) break;
      rows.push(item);
    }
    nextUrl = typeof payload["@odata.nextLink"] === "string" ? payload["@odata.nextLink"] : null;
  }

  const normalizedAttachmentMode = (() => {
    const raw = String(attachmentOptions?.mode || "none")
      .trim()
      .toLowerCase();
    if (raw === "metadata" || raw === "text") return raw;
    return "none";
  })();
  const attachmentSummaryByRawMessageId = new Map();
  const attachmentRows = [];
  if (normalizedAttachmentMode !== "none") {
    const allowMimeSet =
      attachmentOptions?.allowMimeSet instanceof Set ? attachmentOptions.allowMimeSet : normalizeMimeAllowList("");
    const includeInline = Boolean(attachmentOptions?.includeInline);
    const maxAttachmentRowsPerMessage = Math.max(1, Number(attachmentOptions?.maxItemsPerMessage || 8));
    const maxAttachmentBytes = Math.max(1024, Number(attachmentOptions?.maxBytes || 1_048_576));
    const maxAttachmentTextChars = Math.max(200, Number(attachmentOptions?.maxTextChars || 6000));
    for (const item of rows) {
      if (!item || !item.id || !item.hasAttachments) continue;
      try {
        const attachmentResult = await extractOutlookAttachmentRowsForMessage({
          message: item,
          source,
          runId,
          tenantId,
          agentId,
          mailbox: user,
          mailboxPath,
          headers,
          graphMaxRetries,
          mode: normalizedAttachmentMode,
          maxItemsPerMessage: maxAttachmentRowsPerMessage,
          maxBytes: maxAttachmentBytes,
          maxTextChars: maxAttachmentTextChars,
          includeInline,
          allowMimeSet,
        });
        attachmentSummaryByRawMessageId.set(String(item.id), attachmentResult.summary);
        for (const row of attachmentResult.rows) {
          attachmentRows.push(row);
        }
      } catch (error) {
        const errorMessage = cleanBoundedString(error instanceof Error ? error.message : String(error), 500) || "attachment_list_failed";
        attachmentSummaryByRawMessageId.set(String(item.id), {
          attachmentProcessingMode: normalizedAttachmentMode,
          attachmentCount: 0,
          attachmentInlineCount: 0,
          attachmentExtractedCount: 0,
          attachmentMetadataOnlyCount: 1,
          attachmentSkippedCount: 1,
          attachmentFetchErrorCount: 1,
          attachmentTextCharCount: 0,
          attachmentNames: [],
          attachmentMimeTypes: [],
          attachmentTruncated: false,
          attachmentError: errorMessage,
        });
        attachmentRows.push(
          buildOutlookAttachmentMemoryRow({
            baseSource: source,
            runId,
            tenantId,
            agentId,
            mailbox: user,
            parentMessage: item,
            attachment: {
              id: `list-error-${stableHash32(`${item.id}|${errorMessage}`)}`,
              name: "(attachment-list-fetch-failed)",
              contentType: "application/x-import-error",
              size: 0,
              isInline: false,
              "@odata.type": "#microsoft.graph.fileAttachment",
            },
            extractionStatus: "attachment_list_failed",
            extractionReason: errorMessage,
            extractedText: "",
            decodedSizeBytes: 0,
            contentHash: "",
          })
        );
      }
    }
  }

  const messageRows = toOutlookMemoryRows({
    items: rows,
    runId,
    tenantId,
    agentId,
    baseSource: source,
    mailbox: user,
    attachmentSummaryByRawMessageId,
  });
  const messageIdToMemoryId = new Map();
  for (const row of messageRows) {
    const rawMessageId = cleanBoundedString(row?.metadata?.rawMessageId || "", 240);
    if (rawMessageId && !messageIdToMemoryId.has(rawMessageId)) {
      messageIdToMemoryId.set(rawMessageId, row.id);
    }
  }
  for (const attachmentRow of attachmentRows) {
    const parentRawMessageId = cleanBoundedString(attachmentRow?.metadata?.parentRawMessageId || "", 240);
    const parentMemoryId = parentRawMessageId ? messageIdToMemoryId.get(parentRawMessageId) || null : null;
    attachmentRow.metadata = {
      ...(attachmentRow.metadata || {}),
      parentMemoryId,
      relatedMemoryIds: parentMemoryId ? [parentMemoryId] : [],
    };
  }
  const outRows = [...messageRows, ...attachmentRows];

  return {
    rows: outRows,
    totalRowsFetched: rows.length,
    totalRowsAccepted: outRows.length,
    totalMessageRowsAccepted: messageRows.length,
    totalAttachmentRowsAccepted: attachmentRows.length,
    source,
    rawSample: rows.slice(0, 3),
  };
}

function buildPythonCommandCode({ host, port, user, password, mailbox, secure, ignoreCert, search, sinceDate, beforeDate, maxItems, output }) {
  return `
import imaplib
import email
from email.header import decode_header
from email.utils import parsedate_to_datetime
import json
import re
import sys

cfg = json.loads(sys.argv[1])

host = cfg["host"]
port = int(cfg["port"])
user = cfg["user"]
password = cfg["password"]
auth_method = str(cfg.get("authMethod", "login") or "login").lower()
oauth_access_token = str(cfg.get("oauthAccessToken") or "")
mailbox = cfg.get("mailbox", "INBOX")
secure = bool(cfg.get("secure", True))
ignore_cert = bool(cfg.get("ignoreCert", False))
since_date = cfg.get("sinceDate")
before_date = cfg.get("beforeDate")
search = cfg.get("search", [])
max_items = int(cfg.get("maxItems", 0))
output = cfg["output"]


def decode_header_value(value):
    if value is None:
        return ""
    parts = decode_header(str(value))
    output_value = []
    for part, charset in parts:
        if isinstance(part, bytes):
            try:
                output_value.append(part.decode(charset or "utf-8", errors="replace"))
            except Exception:
                output_value.append(part.decode("utf-8", errors="replace"))
        else:
            output_value.append(str(part))
    return "".join(output_value)


def strip_html(value):
    value = str(value or "")
    value = re.sub(r"<script[\s\S]*?</script>", " ", value, flags=re.IGNORECASE)
    value = re.sub(r"<style[\s\S]*?</style>", " ", value, flags=re.IGNORECASE)
    value = re.sub(r"<[^>]*>", " ", value)
    return re.sub(r"\s+", " ", value).strip()


def parse_address_values(raw):
    if not raw:
        return []
    try:
        return [entry for entry in re.split(r',(?=(?:[^\"]*\"[^\"]*\")*[^\"]*$)', str(raw)) if entry.strip()]
    except Exception:
        return []


def extract_text_from_message(msg):
    plain = ""
    html = ""
    if msg.is_multipart():
        for part in msg.walk():
            if part.get_content_type() == "text/plain" and not part.get("Content-Disposition", "").lower().startswith("attachment"):
                payload = part.get_payload(decode=True)
                if isinstance(payload, bytes):
                    charset = part.get_content_charset() or "utf-8"
                    try:
                        plain = payload.decode(charset, errors="replace")
                    except Exception:
                        plain = payload.decode("utf-8", errors="replace")
                    break
    if not plain:
        for part in msg.walk() if msg.is_multipart() else [msg]:
            if part.get_content_type() == "text/html" and not part.get("Content-Disposition", "").lower().startswith("attachment"):
                payload = part.get_payload(decode=True)
                if isinstance(payload, bytes):
                    charset = part.get_content_charset() or "utf-8"
                    try:
                        html = strip_html(payload.decode(charset, errors="replace"))
                    except Exception:
                        html = strip_html(payload.decode("utf-8", errors="replace"))
                    break
    if plain:
        return plain
    return html


ssl_context = None
if not secure:
    conn = imaplib.IMAP4(host, port)
else:
    if ignore_cert:
        import ssl

        ssl_context = ssl._create_unverified_context()
        conn = imaplib.IMAP4_SSL(host, port, ssl_context=ssl_context)
    else:
        conn = imaplib.IMAP4_SSL(host, port)

try:
    if auth_method == "xoauth2":
        if not oauth_access_token:
            raise RuntimeError("xoauth2 selected but no oauth access token was provided")
        auth_string = f"user={user}\\x01auth=Bearer {oauth_access_token}\\x01\\x01"
        code, _ = conn.authenticate("XOAUTH2", lambda _: auth_string.encode("utf-8"))
        if code != "OK":
            raise RuntimeError(f"xoauth2 auth failed: {code}")
    else:
        conn.login(user, password)
    code, _ = conn.select(mailbox)
    if code != "OK":
        raise RuntimeError(f"failed to open mailbox {mailbox}: {code}")

    criteria = list(search)
    if not criteria:
        criteria = ["ALL"]
    if since_date:
        criteria.append(f"SINCE {since_date}")
    if before_date:
        criteria.append(f"BEFORE {before_date}")

    code, data = conn.search(None, *criteria)
    if code != "OK":
        raise RuntimeError("search failed")

    raw_search_ids = data[0] if data and data[0] else b""
    if isinstance(raw_search_ids, bytes):
        raw_search_ids = raw_search_ids.decode("utf-8", errors="replace")
    else:
        raw_search_ids = str(raw_search_ids)
    ids = []
    for value in str(raw_search_ids).split():
        token = value.strip()
        if token.isdigit():
            ids.append(int(token))
    ids.sort()

    with open(output, "w", encoding="utf-8") as out:
        processed = 0
        for num in ids:
            if max_items > 0 and processed >= max_items:
                break
            _, raw = conn.fetch(str(num), "(RFC822)")
            raw_msg = None
            for chunk in raw:
                if not isinstance(chunk, tuple):
                    continue
                candidate = chunk[1]
                if isinstance(candidate, bytes):
                    raw_msg = candidate
                    break
            if raw_msg is None:
                continue
            msg = email.message_from_bytes(raw_msg)
            body = extract_text_from_message(msg)
            row = {
                "provider": "imap-namecheap",
                "host": host,
                "mailbox": mailbox,
                "uid": num,
                "messageId": decode_header_value(msg.get("Message-ID")),
                "subject": decode_header_value(msg.get("Subject")),
                "from": decode_header_value(msg.get("From")),
                "to": parse_address_values(msg.get("To")),
                "cc": parse_address_values(msg.get("Cc")),
                "bcc": parse_address_values(msg.get("Bcc")),
                "inReplyTo": decode_header_value(msg.get("In-Reply-To")),
                "references": decode_header_value(msg.get("References")),
                "sentDate": msg.get("Date"),
                "receivedDate": None,
                "bodyText": body,
            }
            try:
                parsed_date = parsedate_to_datetime(msg.get("Date")) if msg.get("Date") else None
                if parsed_date:
                    row["sentDate"] = parsed_date.isoformat()
                    row["receivedDate"] = parsed_date.isoformat()
            except Exception:
                pass

            out.write(json.dumps(row, ensure_ascii=False) + "\\n")
            processed += 1

    print(json.dumps({"fetched": processed}))
finally:
    try:
        conn.logout()
    except Exception:
        pass
  `;
}

async function extractImapRows({
  source,
  runId,
  tenantId,
  agentId,
  host,
  port,
  user,
  password,
  authMethod,
  oauthAccessToken,
  mailbox,
  secure,
  ignoreCert,
  unseen,
  since,
  before,
  searchQueries,
  maxItems,
  snapshotPath,
}) {
  const criteria = [];
  if (unseen) {
    criteria.push("UNSEEN");
  }
  if (Array.isArray(searchQueries)) {
    for (const query of searchQueries) {
      const trimmed = String(query || "").trim();
      if (!trimmed) continue;
      const split = trimmed.split(/\s+/);
      criteria.push(...split);
    }
  }

  const pythonConfig = {
    host,
    port,
    user,
    password,
    authMethod,
    oauthAccessToken,
    mailbox,
    secure,
    ignoreCert,
    search: criteria,
    sinceDate: since || null,
    beforeDate: before || null,
    maxItems,
    output: snapshotPath,
  };

  const pythonCode = buildPythonCommandCode(pythonConfig);
  const pythonExecutable = (() => {
    const python3 = runCommand("python3", ["-V"], { allowFailure: true });
    if (python3.ok) return "python3";
    const python = runCommand("python", ["-V"], { allowFailure: true });
    if (python.ok) return "python";
    throw new Error("python3/python not found. Python is required for IMAP mode in this importer.");
  })();

  const result = runCommand(
    pythonExecutable,
    ["-c", pythonCode, JSON.stringify(pythonConfig)],
    {
      cwd: REPO_ROOT,
      allowFailure: true,
      maxBuffer: 1024 * 1024 * 64,
    }
  );

  if (!result.ok) {
    throw new Error(`imap extraction failed (${result.status}): ${String(result.stderr || result.stdout || "unknown").trim()}`);
  }

  const extractedRows = readJsonl(snapshotPath);
  const rows = extractedRows.map((row) => ({
    ...row,
    source,
    host,
    mailbox,
  }));
  const outRows = toImapMemoryRows({
    rows,
    runId,
    tenantId,
    agentId,
    baseSource: source,
  });

  const summary = parseImportResponse(result.stdout) || { imported: outRows.length, failed: 0, total: outRows.length };
  return {
    rows: outRows,
    totalRowsFetched: summary.total,
    totalRowsAccepted: outRows.length,
    source,
    rawSample: rows.slice(0, 3),
  };
}

function readCheckpoint(path, runId, runRoot, mode, source, chunkSize) {
  const checkpoint = readJson(path, null);
  if (
    checkpoint &&
    typeof checkpoint === "object" &&
    checkpoint.schema === "mail-memory-import-checkpoint.v1" &&
    checkpoint.runId === runId
  ) {
    return checkpoint;
  }
  return {
    schema: "mail-memory-import-checkpoint.v1",
    runId,
    runRoot,
    mode,
    source,
    createdAt: isoNow(),
    updatedAt: isoNow(),
    nextIndex: 0,
    chunkSize,
    totals: {
      imported: 0,
      failed: 0,
      chunksSucceeded: 0,
      chunksFailed: 0,
    },
    totalRows: 0,
    status: "running",
  };
}

async function run() {
  const rawArgs = process.argv.slice(2);
  const { flags } = parseCliArgs(rawArgs);
  if (readBoolFlag(flags, "help", false) || readBoolFlag(flags, "h", false)) {
    usage();
    return;
  }

  const mode = readStringFlag(flags, "mode", "outlook").toLowerCase();
  const runId = readStringFlag(flags, "run-id", `mail-import-${isoNow().replace(/[:.]/g, "-")}`);
  if (mode !== "outlook" && mode !== "imap") {
    throw new Error(`Unsupported mode: ${mode}. Use "outlook" or "imap".`);
  }
  const outlookAttachmentModeHint = readStringFlag(
    flags,
    "outlook-attachment-mode",
    process.env.MAIL_IMPORT_OUTLOOK_ATTACHMENT_MODE || "none"
  )
    .trim()
    .toLowerCase();
  if (!["none", "metadata", "text"].includes(outlookAttachmentModeHint)) {
    throw new Error(
      `Unsupported --outlook-attachment-mode "${outlookAttachmentModeHint}". Use none, metadata, or text.`
    );
  }
  const attachmentHeavyImportMode = mode === "outlook" && outlookAttachmentModeHint === "text";
  const stageMode = readStringFlag(flags, "stage-mode", "both").toLowerCase();
  if (!["both", "extract-only", "ingest-only"].includes(stageMode)) {
    throw new Error(`Unsupported stage mode: ${stageMode}. Use "both", "extract-only", or "ingest-only".`);
  }
  const shouldExtract = stageMode !== "ingest-only";
  const shouldImport = stageMode !== "extract-only";
  const runRoot = resolve(REPO_ROOT, readStringFlag(flags, "run-root", `./imports/mail/runs/${runId}`));
  mkdirSync(runRoot, { recursive: true });
  const source = readStringFlag(flags, "source", `mail:${mode}`);
  const sourceTenantId = readStringFlag(flags, "tenant-id", "");
  const sourceAgentId = readStringFlag(flags, "agent-id", "agent:import");
  const injectRunId = readBoolFlag(flags, "inject-run-id", true);
  const runScope = readStringFlag(flags, "run-scope", "");
  const snapshotPath = resolveRunArtifactPath(runRoot, readStringFlag(flags, "snapshot", ""), `mail-memory-${mode}-snapshot.jsonl`);
  const checkpointPath = resolveRunArtifactPath(runRoot, readStringFlag(flags, "checkpoint", ""), `mail-import-checkpoint.json`);
  const ledgerPath = resolveRunArtifactPath(runRoot, readStringFlag(flags, "ledger", ""), `mail-import-ledger.jsonl`);
  const deadLetterPath = resolveRunArtifactPath(runRoot, readStringFlag(flags, "dead-letter", ""), `mail-import-dead-letter.jsonl`);
  const reportPath = resolveRunArtifactPath(runRoot, readStringFlag(flags, "report", ""), `mail-import-report.json`);
  const forceReextract = readBoolFlag(flags, "force-reextract", false);
  const chunkSize = readNumberFlag(flags, "chunk-size", attachmentHeavyImportMode ? 50 : 300, { min: 1, max: 500 });
  const contentMaxChars = readNumberFlag(flags, "content-max-chars", MAX_MEMORY_CONTENT_CHARS, {
    min: 200,
    max: MAX_MEMORY_CONTENT_CHARS,
  });
  const maxItems = readNumberFlag(flags, "max-items", 1200, { min: 1, max: 100000 });
  const importConcurrencyCap = readNumberFlag(flags, "import-concurrency-cap", attachmentHeavyImportMode ? 1 : 3, {
    min: 1,
    max: 64,
  });
  const postChunkSleepMs = readNumberFlag(flags, "post-chunk-sleep-ms", attachmentHeavyImportMode ? 600 : 150, {
    min: 0,
    max: 10000,
  });
  const openMemoryTimeoutMs = readNumberFlag(
    flags,
    "open-memory-timeout-ms",
    attachmentHeavyImportMode ? 120000 : 30000,
    { min: 1000, max: 300000 }
  );
  const openMemoryRequestRetries = readNumberFlag(
    flags,
    "open-memory-request-retries",
    attachmentHeavyImportMode ? 3 : 2,
    { min: 0, max: 10 }
  );
  const openMemoryRequestRetryBaseMs = readNumberFlag(
    flags,
    "open-memory-request-retry-base-ms",
    attachmentHeavyImportMode ? 1200 : 400,
    {
    min: 50,
    max: 10000,
    }
  );
  const openMemoryCommandTimeoutMs = readNumberFlag(
    flags,
    "open-memory-command-timeout-ms",
    Math.min(900000, Math.max(60000, openMemoryTimeoutMs * Math.max(2, openMemoryRequestRetries + 2))),
    {
      min: 1000,
      max: 3600000,
    }
  );
  const maxRetries = readNumberFlag(flags, "max-retries", attachmentHeavyImportMode ? 5 : 3, { min: 0, max: 20 });
  const continueOnError = readBoolFlag(flags, "continue-on-error", true);
  const printJson = readBoolFlag(flags, "json", false);
  const disableRunBurstLimit = readBoolFlag(flags, "disable-run-burst-limit", false);
  const openMemoryScript = readStringFlag(flags, "open-memory-script", "./scripts/open-memory.mjs");

  const loadEnvFileFlag = readBoolFlag(flags, "load-env-file", true);
  const envFilePath = resolve(
    REPO_ROOT,
    readStringFlag(
      flags,
      "env-file",
      resolveHomeOrRepoDefault("secrets/studio-brain/studio-brain-automation.env", "secrets/studio-brain/studio-brain-mcp.env")
    )
  );
  const loadPortalEnvFileFlag = readBoolFlag(flags, "load-portal-env-file", true);
  const portalEnvFilePath = resolve(
    REPO_ROOT,
    readStringFlag(flags, "portal-env-file", resolveHomeOrRepoDefault("secrets/portal/portal-automation.env"))
  );
  const mintStaffTokenFlag = readBoolFlag(flags, "mint-staff-token", true);
  const envState = {
    loadEnvFile: loadEnvFileFlag,
    envFilePath,
    envFileLoaded: false,
    envFileKeysLoaded: 0,
    loadPortalEnvFile: loadPortalEnvFileFlag,
    portalEnvFilePath,
    portalEnvFileLoaded: false,
    portalEnvFileKeysLoaded: 0,
    baseUrlResolved: false,
    authTokenSource: "",
    mintStaffTokenAttempted: false,
    mintStaffTokenOk: false,
    mintStaffTokenReason: "",
  };
  if (loadEnvFileFlag) {
    const loaded = loadEnvFile(envFilePath);
    envState.envFileLoaded = loaded.loaded;
    envState.envFileKeysLoaded = loaded.keysLoaded;
  }
  if (loadPortalEnvFileFlag) {
    const loaded = loadEnvFile(portalEnvFilePath);
    envState.portalEnvFileLoaded = loaded.loaded;
    envState.portalEnvFileKeysLoaded = loaded.keysLoaded;
  }

  const studioBaseUrlInput = readStringFlag(flags, "base-url", String(process.env.STUDIO_BRAIN_BASE_URL || "").trim());
  const studioBaseUrl = studioBaseUrlInput
    ? String(studioBaseUrlInput).trim()
    : String(resolveStudioBrainBaseUrlFromEnv({ env: process.env })).trim();
  if (!studioBaseUrlInput && studioBaseUrl) {
    envState.baseUrlResolved = true;
  }
  if (!studioBaseUrl) {
    throw new Error("STUDIO_BRAIN_BASE_URL is required for import.");
  }
  process.env.STUDIO_BRAIN_BASE_URL = studioBaseUrl;

  let studioAuthToken = normalizeStudioBrainBearer(
    process.env.STUDIO_BRAIN_AUTH_TOKEN || process.env.STUDIO_BRAIN_ID_TOKEN || ""
  );
  if (!studioAuthToken && mintStaffTokenFlag) {
    envState.mintStaffTokenAttempted = true;
    const minted = await mintStaffIdTokenFromPortalEnv({
      env: process.env,
      defaultCredentialsPath: resolveHomeOrRepoDefault("secrets/portal/portal-agent-staff.json"),
      preferRefreshToken: true,
    });
    envState.mintStaffTokenOk = minted.ok;
    envState.mintStaffTokenReason = minted.reason;
    if (minted.ok && minted.token) {
      studioAuthToken = normalizeStudioBrainBearer(minted.token);
      process.env.STUDIO_BRAIN_ID_TOKEN = minted.token;
      envState.authTokenSource = "portal-staff-token";
      process.env.STUDIO_BRAIN_AUTH_TOKEN = studioAuthToken;
    }
  }
  if (!envState.authTokenSource && studioAuthToken) {
    envState.authTokenSource = process.env.STUDIO_BRAIN_AUTH_TOKEN ? "provided-auth-token" : "derived-from-id-token";
  }
  if (!studioAuthToken && process.env.STUDIO_BRAIN_ID_TOKEN) {
    studioAuthToken = normalizeStudioBrainBearer(process.env.STUDIO_BRAIN_ID_TOKEN);
    envState.authTokenSource = "derived-from-id-token";
  }
  if (!studioAuthToken) {
    throw new Error("STUDIO_BRAIN_AUTH_TOKEN (or STUDIO_BRAIN_ID_TOKEN) is required for import.");
  }
  process.env.STUDIO_BRAIN_AUTH_TOKEN = studioAuthToken;

  const checkpoint = readCheckpoint(
    checkpointPath,
    runId,
    runRoot,
    mode,
    source,
    chunkSize
  );

  let outRows = [];
  const sourceSummary = {
    mode,
    source,
    extractedAt: isoNow(),
    userProvided: false,
    sourceCount: 0,
    acceptedCount: 0,
  };

  const canResumeSnapshot =
    !forceReextract &&
    fileHasContent(snapshotPath) &&
    (checkpoint.mode === undefined || checkpoint.mode === mode) &&
    (checkpoint.source === undefined || checkpoint.source === source) &&
    ["running", "running_with_failures", "failed", "completed_with_failures", "completed"].includes(
      String(checkpoint.status || "")
    );
  if (!shouldExtract && !fileHasContent(snapshotPath)) {
    throw new Error(`ingest-only mode requires existing snapshot at ${snapshotPath}`);
  }
  const shouldReuseSnapshot = shouldExtract ? canResumeSnapshot : fileHasContent(snapshotPath);

  if (shouldReuseSnapshot) {
    const existing = readJsonl(snapshotPath);
    outRows = existing;
    if (outRows.length > 0) {
      sourceSummary.sourceCount = outRows.length;
      sourceSummary.acceptedCount = outRows.length;
    }
  } else {
    if (mode === "outlook") {
      const tenant = readStringFlag(flags, "outlook-tenant-id", process.env.MAIL_IMPORT_OUTLOOK_TENANT_ID || "");
      const clientId = readStringFlag(flags, "outlook-client-id", process.env.MAIL_IMPORT_OUTLOOK_CLIENT_ID || "");
      const clientSecret = (() => {
        const explicit = readStringFlag(flags, "outlook-client-secret", "");
        if (explicit) return explicit;
        const envName = readStringFlag(flags, "outlook-client-secret-env", "");
        if (envName && process.env[envName]) return String(process.env[envName]);
        return process.env.MAIL_IMPORT_OUTLOOK_CLIENT_SECRET || process.env.MS_CLIENT_SECRET || "";
      })();
      const accessToken = readStringFlag(
        flags,
        "outlook-access-token",
        process.env.MAIL_IMPORT_OUTLOOK_ACCESS_TOKEN || ""
      );
      const accessTokenFile = readStringFlag(flags, "outlook-token-file", process.env.MAIL_IMPORT_OUTLOOK_TOKEN_FILE || "");
      const accessTokenFromFile = (() => {
        if (!accessTokenFile) return "";
        const cached = readJson(accessTokenFile, null);
        if (!cached || typeof cached !== "object") return "";
        return String(cached.accessToken || cached.access_token || "").trim();
      })();
      const resolvedAccessToken = accessToken || accessTokenFromFile;
      const mailboxUser = readStringFlag(flags, "outlook-user", process.env.MAIL_IMPORT_OUTLOOK_USER || "");
      const folder = readStringFlag(flags, "outlook-folder", process.env.MAIL_IMPORT_OUTLOOK_FOLDER || "Inbox");
      const folderId = readStringFlag(flags, "outlook-folder-id", process.env.MAIL_IMPORT_OUTLOOK_FOLDER_ID || "");
      const pageSize = readNumberFlag(flags, "outlook-page-size", 80, { min: 1, max: 200 });
      const graphMaxRetries = readNumberFlag(flags, "outlook-graph-max-retries", 12, { min: 0, max: 50 });
      const defaultOutlookAttachmentMode = outlookAttachmentModeHint;
      const defaultAttachmentIncludeInline = /^(1|true|yes|on)$/i.test(
        String(process.env.MAIL_IMPORT_OUTLOOK_ATTACHMENT_INCLUDE_INLINE || "")
      );
      const outlookAttachmentIncludeInline = readBoolFlag(
        flags,
        "outlook-attachment-include-inline",
        defaultAttachmentIncludeInline
      );
      const outlookAttachmentMaxItemsPerMessage = readNumberFlag(
        flags,
        "outlook-attachment-max-items-per-message",
        Number(process.env.MAIL_IMPORT_OUTLOOK_ATTACHMENT_MAX_ITEMS_PER_MESSAGE || "8") || 8,
        { min: 1, max: 200 }
      );
      const outlookAttachmentMaxBytes = readNumberFlag(
        flags,
        "outlook-attachment-max-bytes",
        Number(process.env.MAIL_IMPORT_OUTLOOK_ATTACHMENT_MAX_BYTES || "1048576") || 1_048_576,
        { min: 1024, max: 50 * 1024 * 1024 }
      );
      const outlookAttachmentMaxTextChars = readNumberFlag(
        flags,
        "outlook-attachment-max-text-chars",
        Number(process.env.MAIL_IMPORT_OUTLOOK_ATTACHMENT_MAX_TEXT_CHARS || "6000") || 6000,
        { min: 200, max: 100000 }
      );
      const outlookAttachmentAllowMime = readStringFlag(
        flags,
        "outlook-attachment-allow-mime",
        process.env.MAIL_IMPORT_OUTLOOK_ATTACHMENT_ALLOW_MIME || ""
      );
      if (!resolvedAccessToken && !mailboxUser) {
        throw new Error("outlook mode requires --outlook-user when using app credentials.");
      }

      sourceSummary.userProvided = Boolean(mailboxUser);
      const extraction = await extractOutlookRows({
        source,
        runId,
        tenantId: sourceTenantId || null,
        agentId: sourceAgentId,
        maxItems,
        pageSize,
        graphMaxRetries,
        sinceIso: readStringFlag(flags, "outlook-since", ""),
        beforeIso: readStringFlag(flags, "outlook-before", ""),
        customFilter: readStringFlag(flags, "outlook-filter", ""),
        user: mailboxUser,
        folder,
        folderId,
        auth: {
          tenantId: tenant,
          clientId,
          clientSecret,
          accessToken: resolvedAccessToken,
        },
        attachmentOptions: {
          mode: defaultOutlookAttachmentMode,
          maxItemsPerMessage: outlookAttachmentMaxItemsPerMessage,
          maxBytes: outlookAttachmentMaxBytes,
          maxTextChars: outlookAttachmentMaxTextChars,
          includeInline: outlookAttachmentIncludeInline,
          allowMimeSet: normalizeMimeAllowList(outlookAttachmentAllowMime),
        },
      });
      outRows = extraction.rows.map((row) => ({
        ...row,
        runId,
        tenantId: sourceTenantId || row.tenantId || undefined,
        agentId: sourceAgentId || row.agentId || "agent:import",
      }));
      sourceSummary.sourceCount = extraction.totalRowsFetched;
      sourceSummary.acceptedCount = extraction.totalRowsAccepted;
    }

    if (mode === "imap") {
      const host = readStringFlag(flags, "imap-host", process.env.MAIL_IMPORT_IMAP_HOST || "");
      const port = readNumberFlag(flags, "imap-port", Number(process.env.MAIL_IMPORT_IMAP_PORT || "993") || 993);
      const user = readStringFlag(flags, "imap-user", process.env.MAIL_IMPORT_IMAP_USER || "");
      const password = readStringFlag(flags, "imap-password", process.env.MAIL_IMPORT_IMAP_PASSWORD || "");
      const imapAuthMethod = readStringFlag(
        flags,
        "imap-auth-method",
        process.env.MAIL_IMPORT_IMAP_AUTH_METHOD || "login"
      ).toLowerCase();
      if (!["login", "xoauth2"].includes(imapAuthMethod)) {
        throw new Error(`Unsupported IMAP auth method: ${imapAuthMethod}. Use "login" or "xoauth2".`);
      }
      const imapOauthTokenFile = readStringFlag(
        flags,
        "imap-oauth-token-file",
        process.env.MAIL_IMPORT_IMAP_TOKEN_FILE || process.env.MAIL_IMPORT_OUTLOOK_TOKEN_FILE || ""
      );
      const imapOauthTokenFromFile = (() => {
        if (!imapOauthTokenFile) return "";
        const cached = readJson(imapOauthTokenFile, null);
        if (!cached || typeof cached !== "object") return "";
        return String(cached.accessToken || cached.access_token || "").trim();
      })();
      const imapOauthAccessToken =
        readStringFlag(
          flags,
          "imap-oauth-access-token",
          process.env.MAIL_IMPORT_IMAP_ACCESS_TOKEN || process.env.MAIL_IMPORT_OUTLOOK_ACCESS_TOKEN || ""
        ) || imapOauthTokenFromFile;
      if (!host || !user || (imapAuthMethod === "login" && !password)) {
        throw new Error("imap mode requires --imap-host and --imap-user, plus --imap-password when auth method is login.");
      }
      if (imapAuthMethod === "xoauth2" && !imapOauthAccessToken) {
        throw new Error("imap xoauth2 mode requires --imap-oauth-access-token or --imap-oauth-token-file.");
      }
      const searchQueries = [
        ...splitSearchTokens(process.env.MAIL_IMPORT_IMAP_SEARCH || ""),
        ...collectArgValues(rawArgs, "imap-search").flatMap((value) => splitSearchTokens(value)),
      ];

      const extraction = await extractImapRows({
        source,
        runId,
        tenantId: sourceTenantId || null,
        agentId: sourceAgentId,
        host,
        port,
        user,
        password,
        authMethod: imapAuthMethod,
        oauthAccessToken: normalizeRawToken(imapOauthAccessToken),
        mailbox: readStringFlag(flags, "imap-mailbox", process.env.MAIL_IMPORT_IMAP_MAILBOX || "INBOX"),
        secure: readBoolFlag(flags, "imap-secure", true),
        ignoreCert: readBoolFlag(flags, "imap-ignore-cert", false),
        unseen: readBoolFlag(flags, "imap-unseen", false),
        since: readStringFlag(flags, "imap-since", process.env.MAIL_IMPORT_IMAP_SINCE || ""),
        before: readStringFlag(flags, "imap-before", process.env.MAIL_IMPORT_IMAP_BEFORE || ""),
        searchQueries,
        maxItems,
        snapshotPath,
      });
      outRows = extraction.rows.map((row) => ({
        ...row,
        runId,
        tenantId: sourceTenantId || row.tenantId || undefined,
        agentId: sourceAgentId || row.agentId || "agent:import",
      }));
      sourceSummary.sourceCount = extraction.totalRowsFetched;
      sourceSummary.acceptedCount = extraction.totalRowsAccepted;
    }

    writeJsonl(snapshotPath, outRows);
    checkpoint.totalRows = outRows.length;
    checkpoint.nextIndex = 0;
    checkpoint.status = "running";
    checkpoint.source = source;
    checkpoint.mode = mode;
    checkpoint.updatedAt = isoNow();
    checkpoint.totals = {
      imported: 0,
      failed: 0,
      chunksSucceeded: 0,
      chunksFailed: 0,
    };
    writeJson(checkpointPath, checkpoint);
  }

  const effectiveInjectRunId = injectRunId;

  const entries = readJsonlWithRaw(snapshotPath);
  const validRows = [];
  const bootstrapDeadLetter = [];
  const preflightDeadLetter = [];
  const seenIds = new Set();
  const seenClientRequestIds = new Set();
  let preflightRejectedRows = 0;
  let preflightDuplicateIdRows = 0;
  let preflightDuplicateClientRequestRows = 0;
  let preflightFallbackQueuedRows = 0;
  let preflightFallbackRejectedRows = 0;
  for (const entry of entries) {
    if (!entry.ok || !entry.value || typeof entry.value !== "object") {
      bootstrapDeadLetter.push({
        stage: "snapshot",
        runId,
        source,
        mode,
        reason: "malformed_jsonl_row",
        raw: entry.value ? String(entry.value) : entry.raw,
      });
      continue;
    }
    if (typeof entry.value.content !== "string" || entry.value.content.trim().length === 0) {
      continue;
    }
    const sourceRowIndex = validRows.length + preflightRejectedRows + bootstrapDeadLetter.length + 1;
    const preflight = sanitizeImportRow({
      row: entry.value,
      rowIndex: sourceRowIndex,
      source,
      runId,
      runScope,
      injectRunId: effectiveInjectRunId,
      tenantId: sourceTenantId,
      agentId: sourceAgentId,
      contentMaxChars,
      seenIds,
      seenClientRequestIds,
    });
    if (!preflight.ok) {
      preflightRejectedRows += 1;
      if (preflight.reason === "duplicate_id") preflightDuplicateIdRows += 1;
      if (preflight.reason === "duplicate_client_request_id") preflightDuplicateClientRequestRows += 1;
      preflightDeadLetter.push({
        stage: "preflight",
        runId,
        source,
        mode,
        reason: preflight.reason || "preflight_rejected",
        row: entry.value,
      });

      const fallbackCandidate = buildContextFallbackRow({
        row: entry.value,
        source,
        rowIndex: sourceRowIndex,
        failureReason: `preflight_${preflight.reason || "rejected"}`,
      });
      const fallbackPreflight = sanitizeImportRow({
        row: fallbackCandidate,
        rowIndex: sourceRowIndex + 10000000,
        source: `${source}:fallback`,
        runId,
        runScope,
        injectRunId: effectiveInjectRunId,
        tenantId: sourceTenantId,
        agentId: sourceAgentId,
        contentMaxChars,
        seenIds,
        seenClientRequestIds,
      });
      if (fallbackPreflight.ok) {
        validRows.push(fallbackPreflight.row);
        preflightFallbackQueuedRows += 1;
      } else {
        preflightFallbackRejectedRows += 1;
        preflightDeadLetter.push({
          stage: "preflight-fallback",
          runId,
          source,
          mode,
          reason: fallbackPreflight.reason || "preflight_fallback_rejected",
          row: fallbackCandidate,
        });
      }
      continue;
    }
    validRows.push(preflight.row);
  }

  if (bootstrapDeadLetter.length > 0) {
    appendJsonl(deadLetterPath, bootstrapDeadLetter);
  }
  if (preflightDeadLetter.length > 0) {
    appendJsonl(deadLetterPath, preflightDeadLetter);
  }
  sourceSummary.acceptedCount = validRows.length;

  let nextIndex = Number.isFinite(Number(checkpoint.nextIndex)) ? Math.max(0, Math.trunc(Number(checkpoint.nextIndex))) : 0;
  nextIndex = Math.min(nextIndex, validRows.length);
  checkpoint.totalRows = validRows.length;
  checkpoint.nextIndex = nextIndex;
  checkpoint.status = nextIndex >= validRows.length ? "completed" : "running";
  checkpoint.updatedAt = isoNow();
  writeJson(checkpointPath, checkpoint);

  let stopReason = "";
  if (!shouldImport) {
    checkpoint.nextIndex = 0;
    checkpoint.status = "extracted";
    checkpoint.updatedAt = isoNow();
    writeJson(checkpointPath, checkpoint);
    nextIndex = validRows.length;
    stopReason = "extract_only";
  }
  const malformedRows = bootstrapDeadLetter.length;
  const importPermitDir = resolve(REPO_ROOT, "imports/mail/runs/_import-permits");
  const acquireImportPermit = async () => {
    mkdirSync(importPermitDir, { recursive: true });
    const token = `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const claimPath = resolve(importPermitDir, `${token}.lock`);
    while (true) {
      let activeClaims = 0;
      for (const claimName of readdirSync(importPermitDir).filter((name) => name.endsWith(".lock"))) {
        const pidToken = Number(claimName.split("-")[0]);
        if (Number.isFinite(pidToken) && pidToken > 0) {
          try {
            process.kill(pidToken, 0);
            activeClaims += 1;
            continue;
          } catch {
            try {
              unlinkSync(resolve(importPermitDir, claimName));
            } catch {
              // ignore stale lock cleanup failures
            }
            continue;
          }
        }
        activeClaims += 1;
      }
      if (activeClaims < importConcurrencyCap) {
        try {
          writeFileSync(claimPath, `${runId}\n`, { flag: "wx" });
          return () => {
            try {
              unlinkSync(claimPath);
            } catch {
              // ignore stale lock cleanup failures
            }
          };
        } catch {
          // lock race; retry
        }
      }
      await sleep(120 + Math.floor(Math.random() * 180));
    }
  };
  const isRetryableChunkError = (value) =>
    /\b408\b|\b425\b|\b429\b|\b500\b|\b502\b|\b503\b|\b504\b|timed out|timeout|\bECONNRESET\b|\bECONNREFUSED\b|\bETIMEDOUT\b|socket hang up|network|fetch failed|\bEHOSTUNREACH\b|\bENETUNREACH\b|\bEPIPE\b/i.test(
      String(value || "")
    );
  const isLikelyAuthError = (value) =>
    /\b401\b|unauthoriz|forbidden|invalid[_\s-]?token|token.*expir|id token|bearer|permission denied/i.test(
      String(value || "")
    );
  const computeChunkRetryDelayMs = (attempt, errorText) => {
    const normalized = String(errorText || "");
    const base = /\b429\b|too many requests|throttl/i.test(normalized) ? 1200 : 400;
    const exponential = Math.min(120000, Math.round(base * 2 ** Math.max(0, attempt - 1)));
    const jitter = Math.floor(Math.random() * 400);
    return exponential + jitter;
  };

  while (nextIndex < validRows.length) {
    const chunkStart = nextIndex;
    const chunkEnd = Math.min(validRows.length, chunkStart + chunkSize);
    const chunkRows = validRows.slice(chunkStart, chunkEnd);
    const chunkPayload = chunkRows.map((row) => ({
      ...row,
      source: String(row.source || source),
      runId: injectRunId ? runId : row.runId || runId,
      tenantId: sourceTenantId || row.tenantId || undefined,
      agentId: sourceAgentId || row.agentId || "agent:import",
      content: clipText(row.content, Math.max(200, contentMaxChars - 200)),
    }));
    const chunkHash = stableHash(
      `${runId}|${chunkStart}|${chunkEnd}|${chunkRows
        .map((row) => String(row.clientRequestId || row.id || row.content.slice(0, 40)))
        .join("|")}`
    );
    const chunkPath = `${snapshotPath}.chunk-${chunkStart}-${chunkEnd}-${chunkHash}.jsonl`;
    writeJsonl(chunkPath, chunkPayload);

    let imported = 0;
    let failed = 0;
    let chunkAttempt = 0;
    let chunkSucceeded = false;
    let chunkError = "";
    let chunkFailureSample = "";
    let chunkFailedIndexes = [];
    let chunkFailedErrorByIndex = {};
    let fallbackRecovered = 0;
    let fallbackAttempted = 0;
    let fallbackFailed = 0;

    try {
      while (chunkAttempt <= maxRetries && !chunkSucceeded) {
        chunkAttempt += 1;
        await sleep(100 + Math.floor(Math.random() * 201));
        const invocation = buildOpenMemoryInvocation(openMemoryScript, [
          "import",
          "--input",
          chunkPath,
          "--source",
          source,
          "--continue-on-error",
          continueOnError ? "true" : "false",
        ]);
        invocation.commandArgs.push(
          "--base-url",
          studioBaseUrl,
          "--timeout-ms",
          String(openMemoryTimeoutMs),
          "--retry-max",
          String(openMemoryRequestRetries),
          "--retry-base-ms",
          String(openMemoryRequestRetryBaseMs),
          "--post-import-briefing",
          "false"
        );
        if (disableRunBurstLimit) {
          invocation.commandArgs.push("--disable-run-burst-limit", "true");
        }
        const releaseImportPermit = await acquireImportPermit();
        let result;
        try {
          const childEnv = {
            ...process.env,
            STUDIO_BRAIN_AUTH_TOKEN: studioAuthToken,
          };
          result = runCommand(invocation.command, invocation.commandArgs, {
            cwd: REPO_ROOT,
            env: childEnv,
            allowFailure: true,
            timeoutMs: openMemoryCommandTimeoutMs,
          });
        } finally {
          releaseImportPermit();
        }

        const counts = parseImportResponse(result.stdout);
        if (counts) {
          imported = counts.imported;
          failed = counts.failed;
          chunkFailureSample = String(counts.sampleError || "").trim();
          chunkFailedIndexes = Array.isArray(counts.failedIndexes) ? counts.failedIndexes : [];
          chunkFailedErrorByIndex =
            counts.failedErrorByIndex && typeof counts.failedErrorByIndex === "object"
              ? counts.failedErrorByIndex
              : {};
        } else if (result.ok) {
          imported = chunkRows.length;
          failed = 0;
        }

        if (result.ok) {
          chunkSucceeded = true;
          break;
        }

        chunkError = String(result.stderr || result.stdout || result.error || `open-memory import failed`);
        if (result.timedOut && !/timed out/i.test(chunkError)) {
          chunkError = `open-memory import command timed out after ${openMemoryCommandTimeoutMs}ms`;
        }
        if (mintStaffTokenFlag && isLikelyAuthError(chunkError)) {
          try {
            const reminted = await mintStaffIdTokenFromPortalEnv({
              repoRoot: REPO_ROOT,
              portalEnvFile: portalEnvFilePath,
              portalStaffCredsPath: process.env.PORTAL_AGENT_STAFF_CREDENTIALS || "",
            });
            const refreshedToken = normalizeStudioBrainBearer(reminted?.idToken || reminted?.token || "");
            if (refreshedToken) {
              studioAuthToken = refreshedToken;
              process.env.STUDIO_BRAIN_AUTH_TOKEN = studioAuthToken;
              envState.authTokenSource = "minted-staff-token-refresh";
              envState.authTokenRefreshedAt = isoNow();
              if (chunkAttempt <= maxRetries) {
                await sleep(150 + Math.floor(Math.random() * 200));
                continue;
              }
            }
          } catch (refreshError) {
            const refreshMessage = refreshError instanceof Error ? refreshError.message : String(refreshError);
            chunkError = `${chunkError}\nToken refresh failed: ${refreshMessage}`;
          }
        }
        if (!isRetryableChunkError(chunkError)) {
          break;
        }
        if (chunkAttempt <= maxRetries) {
          await sleep(computeChunkRetryDelayMs(chunkAttempt, chunkError));
        }
      }

      if (chunkSucceeded && failed > 0) {
        const failedIndexCandidates =
          chunkFailedIndexes.length > 0
            ? chunkFailedIndexes
            : Array.from({ length: chunkRows.length }, (_, idx) => idx).slice(0, Math.min(failed, chunkRows.length));
        const failedIndexSet = Array.from(
          new Set(
            failedIndexCandidates
              .map((value) => Number(value))
              .filter((value) => Number.isFinite(value) && value >= 0 && value < chunkRows.length)
          )
        ).sort((left, right) => left - right);

        const failedRows = failedIndexSet.map((idx) => ({ idx, row: chunkRows[idx] })).filter((entry) => entry.row);
        fallbackAttempted = failedRows.length;

        if (fallbackAttempted > 0) {
          const fallbackRows = failedRows.map(({ idx, row }) =>
            buildContextFallbackRow({
              row,
              source,
              rowIndex: chunkStart + idx,
              failureReason: chunkFailedErrorByIndex[String(idx)] || chunkFailureSample || "item_import_failed",
            })
          );
          const fallbackHash = stableHash(
            `${runId}|fallback|${chunkStart}|${chunkEnd}|${fallbackRows.map((row) => row.id || row.clientRequestId).join("|")}`
          );
          const fallbackPath = `${snapshotPath}.fallback-${chunkStart}-${chunkEnd}-${fallbackHash}.jsonl`;
          writeJsonl(fallbackPath, fallbackRows);

          let fallbackError = "";
          try {
            const fallbackInvocation = buildOpenMemoryInvocation(openMemoryScript, [
              "import",
              "--input",
              fallbackPath,
              "--source",
              `${source}:fallback`,
              "--continue-on-error",
              "true",
            ]);
            fallbackInvocation.commandArgs.push(
              "--base-url",
              studioBaseUrl,
              "--timeout-ms",
              String(openMemoryTimeoutMs),
              "--retry-max",
              String(openMemoryRequestRetries),
              "--retry-base-ms",
              String(openMemoryRequestRetryBaseMs),
              "--post-import-briefing",
              "false"
            );
            if (disableRunBurstLimit) {
              fallbackInvocation.commandArgs.push("--disable-run-burst-limit", "true");
            }

            const releaseImportPermit = await acquireImportPermit();
            let fallbackResult;
            try {
              fallbackResult = runCommand(fallbackInvocation.command, fallbackInvocation.commandArgs, {
                cwd: REPO_ROOT,
                env: {
                  ...process.env,
                  STUDIO_BRAIN_AUTH_TOKEN: studioAuthToken,
                },
                allowFailure: true,
                timeoutMs: openMemoryCommandTimeoutMs,
              });
            } finally {
              releaseImportPermit();
            }

            if (fallbackResult.ok) {
              const fallbackCounts = parseImportResponse(fallbackResult.stdout);
              fallbackRecovered = fallbackCounts ? fallbackCounts.imported : fallbackRows.length;
              fallbackFailed = Math.max(0, fallbackAttempted - fallbackRecovered);
            } else {
              fallbackRecovered = 0;
              fallbackFailed = fallbackAttempted;
              fallbackError = String(
                fallbackResult.stderr || fallbackResult.stdout || fallbackResult.error || "fallback_context_import_failed"
              );
              appendJsonl(ledgerPath, [
                {
                  ts: isoNow(),
                  runId,
                  mode,
                  source,
                  phase: "fallback",
                  chunkStart,
                  chunkEnd,
                  chunkHash,
                  attempts: 1,
                  ok: false,
                  imported: 0,
                  failed: fallbackAttempted,
                  error: fallbackError,
                },
              ]);
            }
          } finally {
            try {
              unlinkSync(fallbackPath);
            } catch {
              // ignore
            }
          }

          if (fallbackRecovered > 0) {
            appendJsonl(ledgerPath, [
              {
                ts: isoNow(),
                runId,
                mode,
                source,
                phase: "fallback",
                chunkStart,
                chunkEnd,
                chunkHash,
                attempts: 1,
                ok: true,
                imported: fallbackRecovered,
                failed: fallbackFailed,
                error: fallbackFailed > 0 ? "partial_fallback_recovery" : null,
              },
            ]);
          }

          if (fallbackFailed > 0) {
            appendJsonl(
              deadLetterPath,
              failedRows.map(({ idx, row }) => ({
                stage: "fallback",
                runId,
                source,
                mode,
                reason: "item_import_failed_unrecovered",
                chunkStart,
                chunkEnd,
                rowIndex: chunkStart + idx,
                error: chunkFailedErrorByIndex[String(idx)] || chunkFailureSample || "item_import_failed",
                row,
              }))
            );
          }
        }
      }

      const ledgerRow = {
        ts: isoNow(),
        runId,
        mode,
        source,
        chunkStart,
        chunkEnd,
        chunkSize: chunkRows.length,
        chunkHash,
        attempts: chunkAttempt,
        ok: chunkSucceeded,
        imported,
        failed,
        fallbackAttempted,
        fallbackRecovered,
        fallbackFailed,
        error: chunkSucceeded ? (failed > 0 ? chunkFailureSample || "item_import_failed" : null) : chunkError || "chunk_import_failed",
      };
      appendJsonl(ledgerPath, [ledgerRow]);

      if (chunkSucceeded) {
        checkpoint.totals.imported = Number(checkpoint.totals.imported || 0) + imported;
        checkpoint.totals.failed = Number(checkpoint.totals.failed || 0) + failed;
        checkpoint.totals.chunksSucceeded = Number(checkpoint.totals.chunksSucceeded || 0) + 1;
        if (failed > 0) {
          appendJsonl(
            deadLetterPath,
            chunkRows.map((row) => ({
              stage: "import",
              runId,
              source,
              mode,
              reason: "item_import_failed",
              chunkStart,
              chunkEnd,
              error: chunkFailureSample || "item_import_failed",
              row,
            }))
          );
        }
        nextIndex = chunkEnd;
        checkpoint.nextIndex = nextIndex;
        checkpoint.status = nextIndex >= validRows.length ? "completed" : "running";
        checkpoint.updatedAt = isoNow();
        writeJson(checkpointPath, checkpoint);
        if (postChunkSleepMs > 0) {
          await sleep(postChunkSleepMs + Math.floor(Math.random() * 75));
        }
      } else {
        checkpoint.totals.failed = Number(checkpoint.totals.failed || 0) + failed;
        checkpoint.totals.chunksFailed = Number(checkpoint.totals.chunksFailed || 0) + 1;
        checkpoint.updatedAt = isoNow();
        checkpoint.status = "failed";
        writeJson(checkpointPath, checkpoint);
        appendJsonl(
          deadLetterPath,
          chunkRows.map((row) => ({
            stage: "import",
            runId,
            source,
            mode,
            reason: "chunk_import_failed",
            chunkStart,
            chunkEnd,
            error: chunkError || "unknown_error",
            row,
          }))
        );

        if (!continueOnError) {
          stopReason = "chunk_import_failed_and_continue_disabled";
          break;
        }

        nextIndex = chunkEnd;
        checkpoint.nextIndex = nextIndex;
        checkpoint.status = nextIndex >= validRows.length ? "completed_with_failures" : "running_with_failures";
        writeJson(checkpointPath, checkpoint);
      }
    } finally {
      try {
        // best effort cleanup
        unlinkSync(chunkPath);
      } catch {
        // ignore
      }
    }
  }

  const completed = nextIndex >= validRows.length;
  const report = {
    schema: "mail-memory-import-report.v1",
    generatedAt: isoNow(),
    runId,
    runScope,
    mode,
    source,
    runRoot,
    options: {
      chunkSize,
      maxItems,
      continueOnError,
      disableRunBurstLimit,
      maxRetries,
      injectRunId,
      forceReextract,
      sourceSummary,
      env: envState,
    },
    source: {
      extracted: sourceSummary.sourceCount,
      accepted: sourceSummary.acceptedCount,
      snapshotPath,
    },
    snapshot: {
      path: snapshotPath,
      malformedRows,
      preflightRejectedRows,
      preflightDuplicateIdRows,
      preflightDuplicateClientRequestRows,
      checkpointPath,
      ledgerPath,
      deadLetterPath,
    },
    totals: checkpoint.totals,
    progress: {
      nextIndex,
      totalRows: validRows.length,
      completed,
      completedAt: completed || null,
      stopReason: stopReason || null,
      status: checkpoint.status,
    },
  };

  const corpusExport = runCommand(
    process.execPath,
    [
      "./scripts/mail-memory-corpus-export.mjs",
      "--run-id",
      runId,
      "--snapshot",
      snapshotPath,
      "--run-root",
      runRoot,
      "--json",
    ],
    { cwd: REPO_ROOT, allowFailure: true }
  );
  if (corpusExport.ok) {
    report.canonicalCorpus = {
      manifestPath: resolve(runRoot, "canonical-corpus/manifest.json"),
      sqlitePath: resolve(runRoot, "canonical-corpus/corpus.sqlite"),
    };
  } else {
    report.warnings = [
      ...(Array.isArray(report.warnings) ? report.warnings : []),
      {
        artifact: "canonicalCorpus",
        error: String(corpusExport.stderr || corpusExport.stdout || "mail corpus export failed").trim(),
      },
    ];
  }

  writeJson(reportPath, report);

  if (printJson) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write("mail-memory import complete\n");
    process.stdout.write(`run-id: ${runId}\n`);
    process.stdout.write(`mode: ${mode}\n`);
    process.stdout.write(`source: ${source}\n`);
    process.stdout.write(`checkpoint: ${checkpointPath}\n`);
    process.stdout.write(`snapshot: ${snapshotPath}\n`);
    process.stdout.write(`progress: ${checkpoint.nextIndex}/${validRows.length}\n`);
    process.stdout.write(`preflight rejected: ${preflightRejectedRows}\n`);
    process.stdout.write(`totals: imported ${checkpoint.totals.imported || 0}, failed ${checkpoint.totals.failed || 0}\n`);
    process.stdout.write(`report: ${reportPath}\n`);
  }

  if (!completed && !continueOnError) {
    process.exitCode = 1;
  }
}

run().catch((error) => {
  process.stderr.write(`open-memory-mail-import failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
