#!/usr/bin/env node

import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

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
    if (separator <= 0) continue;
    const key = assignment.slice(0, separator).trim();
    let value = assignment.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!key) continue;
    process.env[key] = value;
  }
}

async function main() {
  const importEnvPath = resolve(REPO_ROOT, "secrets/studio-brain/open-memory-mail-import.env");
  const portalEnvPath = resolve(REPO_ROOT, "secrets/portal/portal-automation.env");

  loadEnvFile(importEnvPath);
  loadEnvFile(portalEnvPath);

  const helperPath = resolve(REPO_ROOT, "scripts/outlook-device-auth.mjs");
  const tokenOutput = process.env.MAIL_IMPORT_OUTLOOK_TOKEN_FILE || resolve(REPO_ROOT, "secrets/studio-brain/outlook-oauth-session.json");
  const tenantId = process.env.MAIL_IMPORT_OUTLOOK_TENANT_ID || process.env.MAIL_IMPORT_TENANT_ID || "";
  const clientId = process.env.MAIL_IMPORT_OUTLOOK_CLIENT_ID || "";
  const outlookUser = process.env.MAIL_IMPORT_OUTLOOK_USER || process.env.OUTLOOK_USER || "";
  const extraArgs = process.argv.slice(2);
  if (!process.env.MAIL_IMPORT_OUTLOOK_CLIENT_SECRET && !process.env.MS_CLIENT_SECRET) {
    process.stdout.write(
      "No MAIL_IMPORT_OUTLOOK_CLIENT_SECRET (or MS_CLIENT_SECRET) found in env. Running without a client secret (public-client mode).\n"
    );
  }

  if (!tenantId) {
    process.stderr.write(
      "Missing MAIL_IMPORT_OUTLOOK_TENANT_ID in secrets/studio-brain/open-memory-mail-import.env\n" +
        "Set it to your tenant GUID and rerun this command.\n"
    );
    process.exit(1);
  }
  if (!clientId) {
    process.stderr.write(
      "Missing MAIL_IMPORT_OUTLOOK_CLIENT_ID in secrets/studio-brain/open-memory-mail-import.env\n" +
        "Set it and rerun this command.\n"
    );
    process.exit(1);
  }
  if (!process.env.MAIL_IMPORT_OUTLOOK_CLIENT_SECRET && process.env.MS_CLIENT_SECRET) {
    process.env.MAIL_IMPORT_OUTLOOK_CLIENT_SECRET = process.env.MS_CLIENT_SECRET;
  }
  if (!process.env.MAIL_IMPORT_OUTLOOK_CLIENT_SECRET) {
    process.stdout.write(
      "No client secret detected. If token flow still fails with invalid_client, add a real app secret in Azure and retry.\n"
    );
  }

  const commandArgs = [
    helperPath,
    "--flow",
    "device",
    "--tenant-id",
    tenantId,
    "--client-id",
    clientId,
    "--outlook-user",
    outlookUser,
    "--run-import",
    "false",
    "--token-output",
    tokenOutput,
    "--load-env-file",
    "true",
    "--env-file",
    importEnvPath,
    "--load-portal-env-file",
    "true",
    "--portal-env-file",
    portalEnvPath,
    "--disable-run-burst-limit",
    "true",
    "--timeout-seconds",
    "1200",
  ];

  commandArgs.push(...extraArgs);

  const result = spawnSync(process.execPath, commandArgs, {
    cwd: REPO_ROOT,
    env: process.env,
    stdio: "inherit",
  });

  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

main().catch((error) => {
  process.stderr.write(`${String(error?.message || error)}\n`);
  process.exit(1);
});
