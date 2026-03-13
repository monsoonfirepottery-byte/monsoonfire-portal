#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { parseCliArgs, readBoolFlag, readNumberFlag, readStringFlag } from "./lib/pst-memory-utils.mjs";

const REPO_ROOT = resolve(process.cwd(), ".");
const GRAPH_AUDIENCES = new Set([
  "https://graph.microsoft.com",
  "00000003-0000-0000-c000-000000000000",
]);

function loadEnvFile(filePath) {
  if (!existsSync(filePath)) {
    return;
  }
  const raw = readFileSync(filePath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const normalized = String(line || "").trim();
    if (!normalized || normalized.startsWith("#")) {
      continue;
    }
    const assignment = normalized.startsWith("export ") ? normalized.slice(7).trim() : normalized;
    const separator = assignment.indexOf("=");
    if (separator <= 0) {
      continue;
    }
    const key = assignment.slice(0, separator).trim();
    let value = assignment.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!key) {
      continue;
    }
    process.env[key] = value;
  }
}

function decodeJwtPayload(token) {
  const raw = String(token || "").trim();
  const parts = raw.split(".");
  if (parts.length < 2) return null;
  try {
    const payloadSegment = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = payloadSegment.padEnd(Math.ceil(payloadSegment.length / 4) * 4, "=");
    const decoded = Buffer.from(padded, "base64").toString("utf8");
    const parsed = JSON.parse(decoded);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch (_error) {
    return null;
  }
}

function hasMailReadScope(scopeClaim) {
  if (!scopeClaim) return false;
  const tokens = String(scopeClaim)
    .split(/\s+/)
    .map((entry) => String(entry || "").trim().toLowerCase())
    .filter(Boolean);
  return tokens.includes("mail.read");
}

function isOffice365ImapHost(host) {
  const normalized = String(host || "").trim().toLowerCase();
  if (!normalized) return false;
  return normalized === "outlook.office365.com" || normalized.endsWith(".outlook.office365.com");
}

function parseOutlookTokenFileToken(tokenFilePath) {
  if (!tokenFilePath || !existsSync(tokenFilePath)) {
    return { token: "", reason: "token-file-missing" };
  }

  try {
    const raw = readFileSync(tokenFilePath, "utf8");
    const parsed = JSON.parse(raw);
    const token = String(parsed?.accessToken || parsed?.access_token || "").trim();
    if (!token) return { token: "", reason: "token-missing" };

    const jwtPayload = decodeJwtPayload(token);
    if (!jwtPayload) {
      return { token: "", reason: "token-not-jwt" };
    }

    const audience = String(jwtPayload?.aud || "").trim();
    if (!GRAPH_AUDIENCES.has(audience)) {
      return { token: "", reason: `token-audience-invalid:${audience || "missing"}` };
    }
    if (jwtPayload?.scp && !hasMailReadScope(jwtPayload.scp)) {
      return { token: "", reason: "token-scope-missing-mail-read" };
    }

    const nowMs = Date.now();
    const expiryFromJwtMs = Number(jwtPayload?.exp) * 1000;
    if (Number.isFinite(expiryFromJwtMs) && expiryFromJwtMs > 0 && nowMs >= expiryFromJwtMs - 60_000) {
      return { token: "", reason: "token-expired" };
    }

    const acquiredAt = Date.parse(String(parsed?.acquiredAt || parsed?.acquired_at || "").trim());
    const expiresIn = Number(parsed?.expiresIn || parsed?.expires_in || 0);
    if (Number.isFinite(acquiredAt) && Number.isFinite(expiresIn) && expiresIn > 0) {
      const staleAtMs = acquiredAt + expiresIn * 1000 - 60_000;
      if (Number.isFinite(staleAtMs) && nowMs >= staleAtMs) {
        return { token: "", reason: "token-expired" };
      }
    }

    return { token, reason: "ok" };
  } catch (_error) {
    return { token: "", reason: "token-file-invalid-json" };
  }
}

function runNodeScript(scriptPath, args = []) {
  const result = spawnSync(process.execPath, [resolve(REPO_ROOT, scriptPath), ...args], {
    cwd: REPO_ROOT,
    env: process.env,
    stdio: "inherit",
  });
  return result.status ?? 1;
}

function runOutlookImportFromToken({
  importRunId,
  outlookTokenFile,
  outlookUser,
  maxItems,
  chunkSize,
  disableRunBurstLimit,
  envFilePath,
  portalEnvFilePath,
  baseUrl,
  outlookAttachmentMode,
  outlookAttachmentMaxItemsPerMessage,
  outlookAttachmentMaxBytes,
  outlookAttachmentMaxTextChars,
  outlookAttachmentAllowMime,
  outlookAttachmentIncludeInline,
}) {
  const args = [
    "--mode",
    "outlook",
    "--run-id",
    importRunId,
    "--outlook-user",
    outlookUser,
    "--outlook-token-file",
    outlookTokenFile,
    "--load-env-file",
    "true",
    "--load-portal-env-file",
    "true",
    "--env-file",
    envFilePath,
    "--portal-env-file",
    portalEnvFilePath,
    "--max-items",
    String(maxItems),
    "--chunk-size",
    String(chunkSize),
    "--outlook-attachment-mode",
    String(outlookAttachmentMode || "none"),
    "--outlook-attachment-max-items-per-message",
    String(outlookAttachmentMaxItemsPerMessage),
    "--outlook-attachment-max-bytes",
    String(outlookAttachmentMaxBytes),
    "--outlook-attachment-max-text-chars",
    String(outlookAttachmentMaxTextChars),
    "--outlook-attachment-include-inline",
    String(Boolean(outlookAttachmentIncludeInline)),
    "--base-url",
    baseUrl,
  ];
  if (outlookAttachmentAllowMime) {
    args.push("--outlook-attachment-allow-mime", outlookAttachmentAllowMime);
  }

  if (disableRunBurstLimit) {
    args.push("--disable-run-burst-limit", "true");
  }

  return runNodeScript("./scripts/open-memory-mail-import.mjs", args);
}

function runOutlookDeviceImport({
  runId,
  maxItems,
  chunkSize,
  disableRunBurstLimit,
  envFilePath,
  portalEnvFilePath,
  baseUrl,
  outlookAttachmentMode,
  outlookAttachmentMaxItemsPerMessage,
  outlookAttachmentMaxBytes,
  outlookAttachmentMaxTextChars,
  outlookAttachmentAllowMime,
  outlookAttachmentIncludeInline,
}) {
  const args = [
    "--flow",
    "device",
    "--run-import",
    "true",
    "--run-id",
    runId,
    "--max-items",
    String(maxItems),
    "--chunk-size",
    String(chunkSize),
    "--outlook-attachment-mode",
    String(outlookAttachmentMode || "none"),
    "--outlook-attachment-max-items-per-message",
    String(outlookAttachmentMaxItemsPerMessage),
    "--outlook-attachment-max-bytes",
    String(outlookAttachmentMaxBytes),
    "--outlook-attachment-max-text-chars",
    String(outlookAttachmentMaxTextChars),
    "--outlook-attachment-include-inline",
    String(Boolean(outlookAttachmentIncludeInline)),
    "--load-env-file",
    "true",
    "--env-file",
    envFilePath,
    "--load-portal-env-file",
    "true",
    "--portal-env-file",
    portalEnvFilePath,
    "--base-url",
    baseUrl,
  ];
  if (outlookAttachmentAllowMime) {
    args.push("--outlook-attachment-allow-mime", outlookAttachmentAllowMime);
  }

  if (disableRunBurstLimit) {
    args.push("--disable-run-burst-limit", "true");
  }

  return runNodeScript("./scripts/outlook-device-auth.mjs", args);
}

function runImapImport({
  runId,
  imapHost,
  imapPort,
  imapUser,
  imapPassword,
  imapMailbox,
  imapSearch,
  imapUnseen,
  imapSecure,
  imapIgnoreCert,
  maxItems,
  chunkSize,
  disableRunBurstLimit,
  envFilePath,
  portalEnvFilePath,
  baseUrl,
}) {
  const args = [
    "--run-id",
    runId,
    "--imap-host",
    imapHost,
    "--imap-port",
    String(imapPort),
    "--imap-user",
    imapUser,
    "--imap-password",
    imapPassword,
    "--imap-mailbox",
    imapMailbox,
    "--imap-unseen",
    String(imapUnseen),
    "--max-items",
    String(maxItems),
    "--chunk-size",
    String(chunkSize),
    "--load-env-file",
    "true",
    "--env-file",
    envFilePath,
    "--load-portal-env-file",
    "true",
    "--portal-env-file",
    portalEnvFilePath,
    "--base-url",
    baseUrl,
  ];

  if (imapSearch) {
    args.push("--imap-search", imapSearch);
  }
  if (imapSecure === false) {
    args.push("--imap-secure", "false");
  }
  if (imapIgnoreCert) {
    args.push("--imap-ignore-cert", "true");
  }
  if (disableRunBurstLimit) {
    args.push("--disable-run-burst-limit", "true");
  }

  return runNodeScript("./scripts/run-office-imap-import.mjs", args);
}

function usage() {
  process.stdout.write(
    [
      "Office import auto-orchestrator (SSH helper)",
      "",
      "Usage:",
      "  node ./scripts/mail-office-import-ssh.mjs --mode auto --provider office365 --run-id ...",
      "",
      "Modes:",
      "  --mode auto  (default): try Outlook token/device first, then IMAP fallback",
      "  --mode outlook: force Outlook path",
      "  --mode imap: force IMAP path",
      "",
      "Provider controls:",
      "  --provider office365|imap-generic (default: office365)",
      "  --allow-basic-imap true|false (default: false for office365, true for imap-generic)",
      "",
      "Options:",
      "  --run-id <id>",
      "  --max-items <n>      (default: 100)",
      "  --chunk-size <n>     (default: 100)",
      "  --disable-run-burst-limit true|false (default: true)",
      "  --base-url <url>     Studio Brain base URL",
      "",
      "Office365 defaults avoid password IMAP fallback unless explicitly allowed.",
      "If no live token file is present, Outlook mode uses device auth and requires",
      "MAIL_IMPORT_OUTLOOK_CLIENT_SECRET (or MS_CLIENT_SECRET) when this app is confidential.",
    ].join("\n")
  );
}

function main() {
  const { flags } = parseCliArgs(process.argv.slice(2));
  if (readBoolFlag(flags, "help", false) || readBoolFlag(flags, "h", false)) {
    usage();
    return;
  }

  const loadEnvFileFlag = readBoolFlag(flags, "load-env-file", true);
  const envFilePath = resolve(readStringFlag(flags, "env-file", "secrets/studio-brain/open-memory-mail-import.env"));
  const loadPortalEnvFileFlag = readBoolFlag(flags, "load-portal-env-file", true);
  const portalEnvFilePath = resolve(
    readStringFlag(flags, "portal-env-file", "secrets/portal/portal-automation.env")
  );

  if (loadEnvFileFlag) {
    loadEnvFile(envFilePath);
  }
  if (loadPortalEnvFileFlag) {
    loadEnvFile(portalEnvFilePath);
  }

  const mode = readStringFlag(flags, "mode", "auto").toLowerCase().trim() || "auto";
  const provider = readStringFlag(flags, "provider", "office365").toLowerCase().trim() || "office365";
  const allowBasicImap = readBoolFlag(flags, "allow-basic-imap", provider === "imap-generic");
  const runId = readStringFlag(flags, "run-id", `mail-office-auto-${Date.now()}`);
  const maxItems = readNumberFlag(flags, "max-items", 100, { min: 1, max: 100000 });
  const chunkSize = readNumberFlag(flags, "chunk-size", 100, { min: 1, max: 500 });
  const disableRunBurstLimit = readBoolFlag(flags, "disable-run-burst-limit", true);
  const baseUrl = readStringFlag(flags, "base-url", process.env.STUDIO_BRAIN_BASE_URL || "http://192.168.1.226:8787");
  const defaultOutlookAttachmentMode = provider === "office365" ? "text" : "none";
  const outlookAttachmentMode = readStringFlag(
    flags,
    "outlook-attachment-mode",
    process.env.MAIL_IMPORT_OUTLOOK_ATTACHMENT_MODE || defaultOutlookAttachmentMode
  )
    .trim()
    .toLowerCase();
  if (!["none", "metadata", "text"].includes(outlookAttachmentMode)) {
    throw new Error(
      `Unsupported --outlook-attachment-mode "${outlookAttachmentMode}". Use none, metadata, or text.`
    );
  }
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

  const tenantId = readStringFlag(flags, "tenant-id", process.env.MAIL_IMPORT_OUTLOOK_TENANT_ID || "");
  const clientId = readStringFlag(flags, "client-id", process.env.MAIL_IMPORT_OUTLOOK_CLIENT_ID || "");
  const outlookUser = readStringFlag(flags, "outlook-user", process.env.MAIL_IMPORT_OUTLOOK_USER || "");
  const outlookTokenFile = resolve(
    readStringFlag(flags, "outlook-token-file", process.env.MAIL_IMPORT_OUTLOOK_TOKEN_FILE || "secrets/studio-brain/outlook-oauth-session.json")
  );
  const outlookSecret = String(process.env.MAIL_IMPORT_OUTLOOK_CLIENT_SECRET || process.env.MS_CLIENT_SECRET || "");

  const imapHost = readStringFlag(flags, "imap-host", process.env.MAIL_IMPORT_IMAP_HOST || "");
  const imapPort = readNumberFlag(flags, "imap-port", Number(process.env.MAIL_IMPORT_IMAP_PORT || "993") || 993, {
    min: 1,
    max: 65535,
  });
  const imapUser = readStringFlag(flags, "imap-user", process.env.MAIL_IMPORT_IMAP_USER || "");
  const imapPassword = readStringFlag(flags, "imap-password", process.env.MAIL_IMPORT_IMAP_PASSWORD || "");
  const imapMailbox = readStringFlag(flags, "imap-mailbox", process.env.MAIL_IMPORT_IMAP_MAILBOX || "INBOX");
  const imapSearch = readStringFlag(flags, "imap-search", process.env.MAIL_IMPORT_IMAP_SEARCH || "");
  const imapUnseen = readBoolFlag(flags, "imap-unseen", false);
  const imapSecure = readBoolFlag(flags, "imap-secure", true);
  const imapIgnoreCert = readBoolFlag(flags, "imap-ignore-cert", false);

  if (!["auto", "outlook", "imap"].includes(mode)) {
    throw new Error(`Invalid --mode "${mode}". Use auto, outlook, or imap.`);
  }
  if (!["office365", "imap-generic"].includes(provider)) {
    throw new Error(`Invalid --provider "${provider}". Use office365 or imap-generic.`);
  }

  const canRunOutlook = Boolean(tenantId && clientId && outlookUser);
  const canRunOutlookTokenImport = Boolean(outlookUser);
  const tokenState = canRunOutlookTokenImport
    ? parseOutlookTokenFileToken(outlookTokenFile)
    : { token: "", reason: "outlook-user-missing" };
  const hasOutlookToken = Boolean(tokenState.token);
  const canRunImap = Boolean(imapHost && imapUser && imapPassword);
  const hasOutlookSecret = Boolean(outlookSecret);
  const office365ImapHost = isOffice365ImapHost(imapHost);
  const isOffice365MailboxContext = provider === "office365" || office365ImapHost;

  let lastStatus = 1;

  if (mode === "imap") {
    if (isOffice365MailboxContext && !allowBasicImap) {
      throw new Error(
        "IMAP basic login is disabled by default for Office 365. Use OAuth import path, or pass --allow-basic-imap true to force IMAP."
      );
    }
    if (!canRunImap) {
      throw new Error(
        "imap mode requires --imap-host, --imap-user, and --imap-password (or matching env vars in open-memory-mail-import.env)."
      );
    }
    lastStatus = runImapImport({
      runId,
      imapHost,
      imapPort,
      imapUser,
      imapPassword,
      imapMailbox,
      imapSearch,
      imapUnseen,
      imapSecure,
      imapIgnoreCert,
      maxItems,
      chunkSize,
      disableRunBurstLimit,
      envFilePath,
      portalEnvFilePath,
      baseUrl,
    });
    if (lastStatus !== 0) {
      process.stderr.write("mail:office-import auto-run failed during IMAP path.\n");
      process.exit(lastStatus || 1);
    }
    return;
  }

  if (mode === "outlook" || mode === "auto") {
    if (canRunOutlookTokenImport && !hasOutlookToken && tokenState.reason && tokenState.reason !== "token-file-missing") {
      process.stdout.write(
        `Ignoring cached Outlook token from ${outlookTokenFile}: ${tokenState.reason}. Will attempt live OAuth path.\n`
      );
    }

    if (hasOutlookToken) {
      lastStatus = runOutlookImportFromToken({
        importRunId: runId,
        outlookTokenFile,
        outlookUser,
        maxItems,
        chunkSize,
        disableRunBurstLimit,
        envFilePath,
        portalEnvFilePath,
        baseUrl,
        outlookAttachmentMode,
        outlookAttachmentMaxItemsPerMessage,
        outlookAttachmentMaxBytes,
        outlookAttachmentMaxTextChars,
        outlookAttachmentAllowMime,
        outlookAttachmentIncludeInline,
      });
      if (lastStatus === 0) {
        return;
      }
      process.stderr.write(
        "Outlook import from token file failed. Falling back to live auth when mode=auto, else retrying will use the same token path.\n"
      );
      if (mode === "outlook") {
        process.exit(lastStatus || 1);
      }
    }

    if (mode === "outlook" && !canRunOutlook) {
      throw new Error("outlook mode requires tenant-id, client-id, and outlook-user (or env defaults).");
    }

    if (canRunOutlook && hasOutlookSecret) {
      lastStatus = runOutlookDeviceImport({
        runId,
        maxItems,
        chunkSize,
        disableRunBurstLimit,
        envFilePath,
        portalEnvFilePath,
        baseUrl,
        outlookAttachmentMode,
        outlookAttachmentMaxItemsPerMessage,
        outlookAttachmentMaxBytes,
        outlookAttachmentMaxTextChars,
        outlookAttachmentAllowMime,
        outlookAttachmentIncludeInline,
      });
      if (lastStatus === 0) {
        return;
      }
      if (mode !== "auto") {
        process.stderr.write("Outlook device auth path failed.\n");
        process.exit(lastStatus || 1);
      }
      if (isOffice365MailboxContext && !allowBasicImap) {
        process.stderr.write(
          "Outlook device auth failed and Office 365 IMAP fallback is disabled. Provide a valid Outlook client secret/token instead of retrying password IMAP.\n"
        );
        process.exit(lastStatus || 1);
      }
      process.stderr.write(
        "Outlook device auth failed. Falling back to IMAP because mode=auto.\n"
      );
    } else if (mode === "outlook") {
      const needSecretMessage = hasOutlookSecret
        ? ""
        : "Set MAIL_IMPORT_OUTLOOK_CLIENT_SECRET (or MS_CLIENT_SECRET) for confidential app auth.";
      throw new Error(`outlook mode could not complete. Missing valid app auth path for this run.${needSecretMessage}`);
    } else if (!hasOutlookSecret) {
      if (isOffice365MailboxContext && !allowBasicImap) {
        throw new Error(
          "No Outlook client secret found, and Office 365 IMAP fallback is disabled by default. Configure MAIL_IMPORT_OUTLOOK_CLIENT_SECRET (or MS_CLIENT_SECRET), or explicitly pass --allow-basic-imap true."
        );
      }
      process.stdout.write(
        "No Outlook client secret found. This app registration likely requires a confidential-client secret. Trying IMAP next.\n"
      );
    }
  }

  if (mode === "auto") {
    if (isOffice365MailboxContext && !allowBasicImap) {
      throw new Error(
        "Auto mode cannot use Office 365 IMAP fallback without --allow-basic-imap true. OAuth preconditions were not met."
      );
    }
    if (!canRunImap) {
      throw new Error(
        "auto mode fell back to IMAP, but --imap-host, --imap-user, and --imap-password are missing."
      );
    }
    lastStatus = runImapImport({
      runId,
      imapHost,
      imapPort,
      imapUser,
      imapPassword,
      imapMailbox,
      imapSearch,
      imapUnseen,
      imapSecure,
      imapIgnoreCert,
      maxItems,
      chunkSize,
      disableRunBurstLimit,
      envFilePath,
      portalEnvFilePath,
      baseUrl,
    });
    if (lastStatus !== 0) {
      process.stderr.write(
        "Auto-run exhausted all configured paths (Outlook token/device and IMAP).\n"
      );
      process.exit(lastStatus || 1);
    }
  }
}

main();
