#!/usr/bin/env node

import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { parseCliArgs, readBoolFlag, readNumberFlag, readStringFlag, isoNow } from "./lib/pst-memory-utils.mjs";

const REPO_ROOT = resolve(process.cwd(), ".");

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

function sanitizeToken(raw) {
  return String(raw || "").replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
}

function pickLatestFolderIndex(runRoot) {
  const entries = readdirSync(runRoot, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.startsWith("mail-office365-folder-index-") && entry.name.endsWith(".json"))
    .map((entry) => entry.name)
    .sort((a, b) => b.localeCompare(a));
  if (entries.length === 0) {
    return "";
  }
  return resolve(runRoot, entries[0]);
}

function usage() {
  process.stdout.write(
    [
      "Office365 deep folder importer (SSH helper)",
      "",
      "Usage:",
      "  node ./scripts/mail-office365-deep-import.mjs",
      "",
      "Defaults:",
      "  - imports all non-empty folders from latest folder index JSON",
      "  - uses folder IDs (robust to duplicate display names)",
      "  - continues on per-folder failures and writes progress JSONL",
      "",
      "Options:",
      "  --folder-index <path>               Folder index JSON path (default: latest under imports/mail/runs)",
      "  --run-id <id>                       Deep run id (default: mail-office365-deep-<timestamp>)",
      "  --max-folders <n>                   Max folders to process (default: all)",
      "  --min-items <n>                     Skip folders under this item count (default: 1)",
      "  --max-items-per-folder <n>          Cap per-folder extraction (default: unlimited)",
      "  --sort-by-items true|false          Sort descending by totalItemCount (default: true)",
      "  --dry-run true|false                Print selected folders only (default: false)",
      "  --disable-run-burst-limit true|false (default: true)",
    ].join("\n")
  );
}

function runOutlookFolderImport({
  folderId,
  folderPath,
  runId,
  maxItems,
  chunkSize,
  pageSize,
  disableRunBurstLimit,
  importConcurrencyCap,
  openMemoryTimeoutMs,
  openMemoryRequestRetries,
  openMemoryRequestRetryBaseMs,
  stageMode,
  postChunkSleepMs,
  envFilePath,
  portalEnvFilePath,
  tenantId,
  clientId,
  outlookUser,
  baseUrl,
  outlookFilter,
  outlookAttachmentMode,
  outlookAttachmentMaxItemsPerMessage,
  outlookAttachmentMaxBytes,
  outlookAttachmentMaxTextChars,
  outlookAttachmentAllowMime,
  outlookAttachmentIncludeInline,
}) {
  const args = [
    resolve(REPO_ROOT, "scripts/open-memory-mail-import.mjs"),
    "--mode",
    "outlook",
    "--run-id",
    runId,
    "--source",
    "mail:outlook",
    "--outlook-user",
    outlookUser,
    "--outlook-tenant-id",
    tenantId,
    "--outlook-client-id",
    clientId,
    "--outlook-folder",
    folderId,
    "--outlook-filter",
    String(outlookFilter || ""),
    "--outlook-page-size",
    String(pageSize),
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
    "--max-items",
    String(maxItems),
    "--chunk-size",
    String(chunkSize),
    "--import-concurrency-cap",
    String(importConcurrencyCap),
    "--open-memory-timeout-ms",
    String(openMemoryTimeoutMs),
    "--open-memory-request-retries",
    String(openMemoryRequestRetries),
    "--open-memory-request-retry-base-ms",
    String(openMemoryRequestRetryBaseMs),
    "--stage-mode",
    String(stageMode || "both"),
    "--post-chunk-sleep-ms",
    String(postChunkSleepMs),
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

  const result = spawnSync(process.execPath, args, {
    cwd: REPO_ROOT,
    env: process.env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  const reportPath = resolve(REPO_ROOT, `imports/mail/runs/${runId}/mail-import-report.json`);
  let report = null;
  if (existsSync(reportPath)) {
    try {
      report = JSON.parse(readFileSync(reportPath, "utf8"));
    } catch {
      report = null;
    }
  }

  return {
    ok: result.status === 0,
    status: result.status ?? 1,
    stdout: String(result.stdout || "").trim(),
    stderr: String(result.stderr || "").trim(),
    reportPath,
    report,
    folderPath,
  };
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
  const portalEnvFilePath = resolve(readStringFlag(flags, "portal-env-file", "secrets/portal/portal-automation.env"));
  if (loadEnvFileFlag) {
    loadEnvFile(envFilePath);
  }
  if (loadPortalEnvFileFlag) {
    loadEnvFile(portalEnvFilePath);
  }

  const tenantId = readStringFlag(flags, "outlook-tenant-id", process.env.MAIL_IMPORT_OUTLOOK_TENANT_ID || "");
  const clientId = readStringFlag(flags, "outlook-client-id", process.env.MAIL_IMPORT_OUTLOOK_CLIENT_ID || "");
  const clientSecret = readStringFlag(
    flags,
    "outlook-client-secret",
    process.env.MAIL_IMPORT_OUTLOOK_CLIENT_SECRET || process.env.MS_CLIENT_SECRET || ""
  );
  const outlookUser = readStringFlag(flags, "outlook-user", process.env.MAIL_IMPORT_OUTLOOK_USER || "");
  const baseUrl = readStringFlag(flags, "base-url", process.env.STUDIO_BRAIN_BASE_URL || "http://192.168.1.226:8787");

  if (!tenantId || !clientId || !clientSecret || !outlookUser) {
    throw new Error(
      "Missing Outlook auth config. Ensure tenant/client/secret/user are available via args or env."
    );
  }
  process.env.MAIL_IMPORT_OUTLOOK_CLIENT_SECRET = clientSecret;

  const runRoot = resolve(REPO_ROOT, "imports/mail/runs");
  const folderIndexPath = resolve(
    readStringFlag(flags, "folder-index", "") || pickLatestFolderIndex(runRoot)
  );
  if (!folderIndexPath || !existsSync(folderIndexPath)) {
    throw new Error("Folder index JSON not found. Generate it first with the folder index exporter.");
  }

  const folderIndexRaw = JSON.parse(readFileSync(folderIndexPath, "utf8"));
  const rows = Array.isArray(folderIndexRaw?.rows) ? folderIndexRaw.rows : [];
  const minItems = readNumberFlag(flags, "min-items", 1, { min: 0, max: 10000000 });
  const maxFolders = readNumberFlag(flags, "max-folders", 0, { min: 0, max: 1000000 });
  const maxItemsPerFolder = readNumberFlag(flags, "max-items-per-folder", 0, { min: 0, max: 1000000 });
  const sortByItems = readBoolFlag(flags, "sort-by-items", true);
  const dryRun = readBoolFlag(flags, "dry-run", false);
  const disableRunBurstLimit = readBoolFlag(flags, "disable-run-burst-limit", false);
  const outlookFilter = readStringFlag(
    flags,
    "outlook-filter",
    process.env.MAIL_IMPORT_OUTLOOK_FILTER || ""
  );
  const outlookAttachmentMode = readStringFlag(
    flags,
    "outlook-attachment-mode",
    process.env.MAIL_IMPORT_OUTLOOK_ATTACHMENT_MODE || "text"
  )
    .trim()
    .toLowerCase();
  if (!["none", "metadata", "text"].includes(outlookAttachmentMode)) {
    throw new Error(
      `Unsupported --outlook-attachment-mode "${outlookAttachmentMode}". Use none, metadata, or text.`
    );
  }
  const attachmentHeavyMode = outlookAttachmentMode === "text";
  const chunkSize = readNumberFlag(flags, "chunk-size", attachmentHeavyMode ? 50 : 300, { min: 1, max: 500 });
  const pageSize = readNumberFlag(flags, "outlook-page-size", 200, { min: 1, max: 200 });
  const importConcurrencyCap = readNumberFlag(flags, "import-concurrency-cap", attachmentHeavyMode ? 1 : 3, {
    min: 1,
    max: 64,
  });
  const openMemoryTimeoutMs = readNumberFlag(
    flags,
    "open-memory-timeout-ms",
    attachmentHeavyMode ? 120000 : 30000,
    { min: 1000, max: 300000 }
  );
  const openMemoryRequestRetries = readNumberFlag(
    flags,
    "open-memory-request-retries",
    attachmentHeavyMode ? 3 : 2,
    { min: 0, max: 10 }
  );
  const openMemoryRequestRetryBaseMs = readNumberFlag(
    flags,
    "open-memory-request-retry-base-ms",
    attachmentHeavyMode ? 1200 : 400,
    {
      min: 50,
      max: 10000,
    }
  );
  const stageMode = readStringFlag(flags, "stage-mode", "both");
  const postChunkSleepMs = readNumberFlag(flags, "post-chunk-sleep-ms", attachmentHeavyMode ? 600 : 150, {
    min: 0,
    max: 10000,
  });
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

  const runId =
    readStringFlag(flags, "run-id", "") ||
    `mail-office365-deep-${isoNow().replace(/[:.]/g, "-")}`;

  let candidates = rows
    .map((row) => ({
      id: String(row?.id || "").trim(),
      path: String(row?.path || row?.displayName || "").trim(),
      totalItemCount: Number(row?.totalItemCount || 0),
    }))
    .filter((row) => row.id && row.path && row.totalItemCount >= minItems);

  if (sortByItems) {
    candidates = candidates.sort((a, b) => b.totalItemCount - a.totalItemCount);
  }
  if (maxFolders > 0) {
    candidates = candidates.slice(0, maxFolders);
  }

  const deepRunDir = resolve(runRoot, runId);
  mkdirSync(deepRunDir, { recursive: true });
  const progressPath = resolve(deepRunDir, "deep-import-progress.jsonl");
  const summaryPath = resolve(deepRunDir, "deep-import-summary.json");

  const startedAt = isoNow();
  const summary = {
    runId,
    startedAt,
    folderIndexPath,
    selectedFolders: candidates.length,
    imported: 0,
    failed: 0,
    foldersSucceeded: 0,
    foldersFailed: 0,
    progressPath,
  };

  if (dryRun) {
    process.stdout.write(
      `${JSON.stringify(
        {
          ...summary,
          dryRun: true,
          sample: candidates.slice(0, 25),
        },
        null,
        2
      )}\n`
    );
    return;
  }

  process.stdout.write(`Starting deep Office365 import run ${runId}\n`);
  process.stdout.write(`Folder index: ${folderIndexPath}\n`);
  process.stdout.write(`Folders selected: ${candidates.length}\n`);
  process.stdout.write(`Progress file: ${progressPath}\n`);

  for (let index = 0; index < candidates.length; index += 1) {
    const folder = candidates[index];
    const safePath = sanitizeToken(folder.path) || `folder-${index + 1}`;
    const folderRunId = `${runId}-f${String(index + 1).padStart(4, "0")}-${safePath.slice(0, 48)}`;
    const folderMaxItems = maxItemsPerFolder > 0 ? Math.min(folder.totalItemCount, maxItemsPerFolder) : folder.totalItemCount;

    const result = runOutlookFolderImport({
      folderId: folder.id,
      folderPath: folder.path,
      runId: folderRunId,
      maxItems: Math.max(1, folderMaxItems),
      chunkSize,
      pageSize,
      disableRunBurstLimit,
      importConcurrencyCap,
      openMemoryTimeoutMs,
      openMemoryRequestRetries,
      openMemoryRequestRetryBaseMs,
      stageMode,
      postChunkSleepMs,
      envFilePath,
      portalEnvFilePath,
      tenantId,
      clientId,
      outlookUser,
      baseUrl,
      outlookFilter,
      outlookAttachmentMode,
      outlookAttachmentMaxItemsPerMessage,
      outlookAttachmentMaxBytes,
      outlookAttachmentMaxTextChars,
      outlookAttachmentAllowMime,
      outlookAttachmentIncludeInline,
    });

    const imported = Number(result.report?.totals?.imported || 0);
    const failed = Number(result.report?.totals?.failed || 0);
    summary.imported += imported;
    summary.failed += failed;
    if (result.ok && failed === 0) {
      summary.foldersSucceeded += 1;
    } else {
      summary.foldersFailed += 1;
    }

    const progressRow = {
      ts: isoNow(),
      index: index + 1,
      totalFolders: candidates.length,
      folderId: folder.id,
      folderPath: folder.path,
      folderTotalItemCount: folder.totalItemCount,
      folderRunId,
      imported,
      failed,
      ok: result.ok && failed === 0,
      status: result.status,
      reportPath: result.reportPath,
      error: result.ok ? null : result.stderr || result.stdout || "folder import failed",
    };
    appendFileSync(progressPath, `${JSON.stringify(progressRow)}\n`, "utf8");

    process.stdout.write(
      `[${String(index + 1).padStart(4, "0")}/${String(candidates.length).padStart(4, "0")}] ` +
        `${progressRow.ok ? "OK" : "WARN"} | ${folder.path} | imported=${imported} failed=${failed}\n`
    );
  }

  const completedAt = isoNow();
  const finalSummary = {
    ...summary,
    completedAt,
    durationSeconds: Math.max(1, Math.round((Date.parse(completedAt) - Date.parse(startedAt)) / 1000)),
    summaryPath,
  };
  writeFileSync(summaryPath, `${JSON.stringify(finalSummary, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify(finalSummary, null, 2)}\n`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`mail-office365-deep-import failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
