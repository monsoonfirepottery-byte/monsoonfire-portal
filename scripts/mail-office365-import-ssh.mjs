#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { parseCliArgs, readBoolFlag, readNumberFlag, readStringFlag } from "./lib/pst-memory-utils.mjs";

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

function runNodeScript(scriptPath, args = []) {
  const result = spawnSync(process.execPath, [resolve(REPO_ROOT, scriptPath), ...args], {
    cwd: REPO_ROOT,
    env: process.env,
    stdio: "inherit",
  });
  return result.status ?? 1;
}

function usage() {
  process.stdout.write(
    [
      "Office365 OAuth import helper (SSH)",
      "",
      "Usage:",
      "  node ./scripts/mail-office365-import-ssh.mjs --run-id mail-office365-100 --max-items 100 --chunk-size 100",
      "",
      "What it does:",
      "  1) Runs Office365 preflight gate",
      "  2) Runs Outlook OAuth auth flow",
      "  3) Imports mail into Open Memory",
      "",
      "Options:",
      "  --flow device|browser (default: device)",
      "  --run-id <id>",
      "  --max-items <n> (default: 100)",
      "  --chunk-size <n> (default: 100)",
      "  --disable-run-burst-limit true|false (default: true)",
      "  --outlook-user <email> (optional; defaults from env)",
      "  --outlook-client-secret <value> (optional; bypass env file for this run)",
      "  --outlook-attachment-mode none|metadata|text (default: text)",
      "  --token-output <path> (optional)",
      "  --base-url <url> (optional)",
      "  --skip-secret-probe true|false (default: false)",
    ].join("\n")
  );
}

function main() {
  const { flags } = parseCliArgs(process.argv.slice(2));
  if (readBoolFlag(flags, "help", false) || readBoolFlag(flags, "h", false)) {
    usage();
    return;
  }

  const flow = readStringFlag(flags, "flow", "device").toLowerCase();
  if (!["device", "browser"].includes(flow)) {
    throw new Error("Invalid --flow value. Use --flow device or --flow browser.");
  }

  const loadEnvFileFlag = readBoolFlag(flags, "load-env-file", true);
  const envFilePath = resolve(readStringFlag(flags, "env-file", "secrets/studio-brain/open-memory-mail-import.env"));
  const loadPortalEnvFileFlag = readBoolFlag(flags, "load-portal-env-file", true);
  const portalEnvFilePath = resolve(readStringFlag(flags, "portal-env-file", "secrets/portal/portal-automation.env"));
  const skipSecretProbe = readBoolFlag(flags, "skip-secret-probe", false);

  if (loadEnvFileFlag) {
    loadEnvFile(envFilePath);
  }
  if (loadPortalEnvFileFlag) {
    loadEnvFile(portalEnvFilePath);
  }

  const runId = readStringFlag(flags, "run-id", `mail-office365-${Date.now()}`);
  const maxItems = readNumberFlag(flags, "max-items", 100, { min: 1, max: 100000 });
  const chunkSize = readNumberFlag(flags, "chunk-size", 100, { min: 1, max: 500 });
  const disableRunBurstLimit = readBoolFlag(flags, "disable-run-burst-limit", true);
  const baseUrl = readStringFlag(flags, "base-url", process.env.STUDIO_BRAIN_BASE_URL || "");
  const outlookUser = readStringFlag(flags, "outlook-user", process.env.MAIL_IMPORT_OUTLOOK_USER || "");
  const tokenOutput = readStringFlag(flags, "token-output", process.env.MAIL_IMPORT_OUTLOOK_TOKEN_FILE || "");
  const outlookClientSecret = readStringFlag(
    flags,
    "outlook-client-secret",
    readStringFlag(flags, "client-secret", "")
  );
  if (outlookClientSecret) {
    process.env.MAIL_IMPORT_OUTLOOK_CLIENT_SECRET = outlookClientSecret;
  }
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

  const preflightArgs = [
    "--provider",
    "office365",
    "--load-env-file",
    "true",
    "--env-file",
    envFilePath,
    "--load-portal-env-file",
    "true",
    "--portal-env-file",
    portalEnvFilePath,
    "--skip-secret-probe",
    String(skipSecretProbe),
  ];
  const preflightStatus = runNodeScript("./scripts/mail-office-preflight-ssh.mjs", preflightArgs);
  if (preflightStatus !== 0) {
    process.stderr.write("Office365 preflight failed. Fix the checks above, then rerun this command.\n");
    process.exit(preflightStatus || 1);
  }

  const authImportArgs = [
    "--flow",
    flow,
    "--run-import",
    "true",
    "--run-id",
    runId,
    "--max-items",
    String(maxItems),
    "--chunk-size",
    String(chunkSize),
    "--outlook-attachment-mode",
    outlookAttachmentMode,
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
  ];

  if (outlookUser) {
    authImportArgs.push("--outlook-user", outlookUser);
  }
  if (outlookAttachmentAllowMime) {
    authImportArgs.push("--outlook-attachment-allow-mime", outlookAttachmentAllowMime);
  }
  if (tokenOutput) {
    authImportArgs.push("--token-output", tokenOutput);
  }
  if (baseUrl) {
    authImportArgs.push("--base-url", baseUrl);
  }
  if (disableRunBurstLimit) {
    authImportArgs.push("--disable-run-burst-limit", "true");
  }

  const status = runNodeScript("./scripts/outlook-device-auth.mjs", authImportArgs);
  if (status !== 0) {
    process.exit(status || 1);
  }
}

try {
  main();
} catch (error) {
  process.stderr.write(`mail-office365-import failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
