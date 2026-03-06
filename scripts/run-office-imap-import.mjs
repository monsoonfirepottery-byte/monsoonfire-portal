#!/usr/bin/env node

import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { parseCliArgs, readBoolFlag, readNumberFlag, readStringFlag } from "./lib/pst-memory-utils.mjs";

const REPO_ROOT = resolve(process.cwd(), ".");

function main() {
  const { flags } = parseCliArgs(process.argv.slice(2));
  const runId = readStringFlag(flags, "run-id", `mail-office-imap-${Date.now()}`);
  const maxItems = readNumberFlag(flags, "max-items", 5000, { min: 1, max: 100000 });
  const chunkSize = readNumberFlag(flags, "chunk-size", 300, { min: 1, max: 500 });
  const disableBurstLimit = readBoolFlag(flags, "disable-run-burst-limit", true);
  const baseUrl = readStringFlag(flags, "base-url", process.env.STUDIO_BRAIN_BASE_URL || "http://192.168.1.226:8787");
  const imapHost = readStringFlag(flags, "imap-host", process.env.MAIL_IMPORT_IMAP_HOST || "outlook.office365.com");
  const imapPort = readNumberFlag(flags, "imap-port", 993);
  const imapUser = readStringFlag(flags, "imap-user", process.env.MAIL_IMPORT_IMAP_USER || "");
  const imapPassword = readStringFlag(flags, "imap-password", process.env.MAIL_IMPORT_IMAP_PASSWORD || "");
  const imapAuthMethod = readStringFlag(flags, "imap-auth-method", process.env.MAIL_IMPORT_IMAP_AUTH_METHOD || "login");
  const imapOauthAccessToken = readStringFlag(
    flags,
    "imap-oauth-access-token",
    process.env.MAIL_IMPORT_IMAP_ACCESS_TOKEN || process.env.MAIL_IMPORT_OUTLOOK_ACCESS_TOKEN || ""
  );
  const imapOauthTokenFile = readStringFlag(
    flags,
    "imap-oauth-token-file",
    process.env.MAIL_IMPORT_IMAP_TOKEN_FILE || process.env.MAIL_IMPORT_OUTLOOK_TOKEN_FILE || ""
  );
  const imapSecure = readBoolFlag(flags, "imap-secure", true);
  const imapIgnoreCert = readBoolFlag(flags, "imap-ignore-cert", false);
  const imapMailbox = readStringFlag(flags, "imap-mailbox", process.env.MAIL_IMPORT_IMAP_MAILBOX || "INBOX");
  const imapSearch = readStringFlag(flags, "imap-search", process.env.MAIL_IMPORT_IMAP_SEARCH || "UNSEEN");
  const imapUnseen = readBoolFlag(flags, "imap-unseen", false);
  const loadEnvFile = readBoolFlag(flags, "load-env-file", true);
  const envFile = resolve(
    REPO_ROOT,
    readStringFlag(flags, "env-file", process.env.MAIL_IMPORT_ENV_FILE || "secrets/studio-brain/open-memory-mail-import.env")
  );
  const loadPortalEnvFile = readBoolFlag(flags, "load-portal-env-file", true);
  const portalEnvFile = resolve(
    REPO_ROOT,
    readStringFlag(flags, "portal-env-file", process.env.MAIL_IMPORT_PORTAL_ENV_FILE || "secrets/portal/portal-automation.env")
  );

  const commandArgs = [
    "--mode",
    "imap",
    "--run-id",
    runId,
    "--load-env-file",
    String(loadEnvFile),
    "--load-portal-env-file",
    String(loadPortalEnvFile),
    "--env-file",
    envFile,
    "--portal-env-file",
    portalEnvFile,
    "--imap-host",
    imapHost,
    "--imap-port",
    String(imapPort),
    "--imap-user",
    imapUser,
    "--imap-password",
    imapPassword,
    "--imap-auth-method",
    imapAuthMethod,
    "--imap-mailbox",
    imapMailbox,
    "--imap-unseen",
    String(imapUnseen),
    "--max-items",
    String(maxItems),
    "--chunk-size",
    String(chunkSize),
    "--base-url",
    baseUrl,
  ];

  if (imapSearch) {
    commandArgs.push("--imap-search", imapSearch);
  }
  if (imapOauthAccessToken) {
    commandArgs.push("--imap-oauth-access-token", imapOauthAccessToken);
  }
  if (imapOauthTokenFile) {
    commandArgs.push("--imap-oauth-token-file", imapOauthTokenFile);
  }
  if (imapSecure === false) {
    commandArgs.push("--imap-secure", "false");
  }
  if (imapIgnoreCert) {
    commandArgs.push("--imap-ignore-cert", "true");
  }

  if (disableBurstLimit) {
    commandArgs.push("--disable-run-burst-limit", "true");
  }

  const result = spawnSync(process.execPath, [resolve(REPO_ROOT, "scripts/open-memory-mail-import.mjs"), ...commandArgs], {
    cwd: REPO_ROOT,
    env: process.env,
    stdio: "inherit",
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

main();
