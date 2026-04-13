#!/usr/bin/env node

/* eslint-disable no-console */

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  mintStaffIdTokenFromPortalEnv,
  resolvePortalAgentStaffCredentials,
} from "./lib/firebase-auth-token.mjs";
import {
  loadPortalAutomationEnv,
  resolvePortalAgentStaffCredentialsPath,
} from "./lib/runtime-secrets.mjs";

const __filename = fileURLToPath(import.meta.url);
const repoRoot = resolve(dirname(__filename), "..");

loadPortalAutomationEnv();

const DEFAULT_CREDENTIALS_PATH = resolvePortalAgentStaffCredentialsPath();

function clean(value) {
  return String(value ?? "").trim();
}

function decodeJwtExp(token) {
  try {
    const parts = String(token || "").split(".");
    if (parts.length < 2) return "";
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    const exp = Number(payload?.exp);
    return Number.isFinite(exp) ? new Date(exp * 1000).toISOString() : "";
  } catch {
    return "";
  }
}

function redactSecret(value, { prefix = 8, suffix = 6 } = {}) {
  const raw = clean(value);
  if (!raw) return "";
  if (raw.length <= prefix + suffix + 3) return `${raw.slice(0, Math.min(raw.length, prefix))}...`;
  return `${raw.slice(0, prefix)}...${raw.slice(-suffix)}`;
}

function buildSafeShellHints(summary) {
  const hints = [];
  if (summary.email) hints.push(`export PORTAL_STAFF_EMAIL="${summary.email}"`);
  if (summary.uid) hints.push(`export PORTAL_STAFF_UID="${summary.uid}"`);
  if (summary.authSource) hints.push(`export PORTAL_AUTH_SOURCE="${summary.authSource}"`);
  if (summary.authorizationPreview) hints.push(`export AUTHORIZATION_HEADER="${summary.authorizationPreview}"`);
  if (summary.adminTokenPreview) hints.push(`export X_ADMIN_TOKEN="${summary.adminTokenPreview}"`);
  return hints;
}

function parseArgs(argv) {
  const options = {
    asJson: false,
    credentialsPath: clean(process.env.PORTAL_AGENT_STAFF_CREDENTIALS || DEFAULT_CREDENTIALS_PATH),
    credentialsJson: clean(process.env.PORTAL_AGENT_STAFF_CREDENTIALS_JSON),
    staffEmail: clean(process.env.PORTAL_STAFF_EMAIL),
    staffPassword: clean(process.env.PORTAL_STAFF_PASSWORD),
    apiKey: clean(process.env.PORTAL_FIREBASE_API_KEY || process.env.FIREBASE_WEB_API_KEY),
    preferRefreshToken: true,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = String(argv[index] || "").trim();
    if (!arg) continue;

    if (arg === "--json") {
      options.asJson = true;
      continue;
    }
    if (arg === "--prefer-password") {
      options.preferRefreshToken = false;
      continue;
    }
    if (arg === "--prefer-refresh-token") {
      options.preferRefreshToken = true;
      continue;
    }

    const next = String(argv[index + 1] || "").trim();
    if (!next || next.startsWith("--")) {
      throw new Error(`Missing value for ${arg}`);
    }

    if (arg === "--credentials") {
      options.credentialsPath = resolve(process.cwd(), next);
      index += 1;
      continue;
    }
    if (arg === "--credentials-json") {
      options.credentialsJson = next;
      index += 1;
      continue;
    }
    if (arg === "--staff-email") {
      options.staffEmail = next;
      index += 1;
      continue;
    }
    if (arg === "--staff-password") {
      options.staffPassword = next;
      index += 1;
      continue;
    }
    if (arg === "--api-key") {
      options.apiKey = next;
      index += 1;
      continue;
    }
  }

  return options;
}

export async function runPortalAuthHelper(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const runtimeEnv = {
    ...process.env,
    ...(options.credentialsPath ? { PORTAL_AGENT_STAFF_CREDENTIALS: options.credentialsPath } : {}),
    ...(options.credentialsJson ? { PORTAL_AGENT_STAFF_CREDENTIALS_JSON: options.credentialsJson } : {}),
    ...(options.staffEmail ? { PORTAL_STAFF_EMAIL: options.staffEmail } : {}),
    ...(options.staffPassword ? { PORTAL_STAFF_PASSWORD: options.staffPassword } : {}),
    ...(options.apiKey ? { PORTAL_FIREBASE_API_KEY: options.apiKey, FIREBASE_WEB_API_KEY: options.apiKey } : {}),
  };

  let credentials = null;
  let credentialsError = "";
  try {
    credentials = resolvePortalAgentStaffCredentials({
      env: runtimeEnv,
      credentialsJson: options.credentialsJson,
      credentialsPath: options.credentialsPath,
    });
  } catch (error) {
    credentialsError = error instanceof Error ? error.message : String(error);
  }

  const minted = await mintStaffIdTokenFromPortalEnv({
    env: runtimeEnv,
    preferRefreshToken: options.preferRefreshToken,
  });
  const adminToken = clean(runtimeEnv.PORTAL_CANARY_ADMIN_TOKEN || runtimeEnv.PORTAL_ADMIN_TOKEN);

  const summary = {
    ok: minted.ok,
    repoRoot,
    email: clean(runtimeEnv.PORTAL_STAFF_EMAIL || credentials?.email),
    uid: clean(credentials?.uid),
    credentialsSource: clean(credentials?.source || (options.credentialsJson ? "env_json" : options.credentialsPath ? "file" : "")),
    credentialsPath: clean(credentials?.path || options.credentialsPath),
    credentialsError,
    hasRefreshToken: Boolean(clean(runtimeEnv.PORTAL_STAFF_REFRESH_TOKEN || credentials?.refreshToken)),
    hasPasswordFallback: Boolean(clean(runtimeEnv.PORTAL_STAFF_PASSWORD || credentials?.password)),
    apiKeyConfigured: Boolean(clean(runtimeEnv.PORTAL_FIREBASE_API_KEY || runtimeEnv.FIREBASE_WEB_API_KEY)),
    authSource: clean(minted.source),
    authReason: clean(minted.reason),
    idTokenExp: minted.ok ? decodeJwtExp(minted.token) : "",
    authorizationPreview: minted.ok ? `Bearer ${redactSecret(minted.token)}` : "",
    adminTokenPreview: adminToken ? redactSecret(adminToken) : "",
    adminTokenPolicy:
      adminToken
        ? "Admin token is present, but x-admin-token remains an emulator-only or explicit debug header and is separate from production bearer auth."
        : "No admin token is configured. Production bearer auth and emulator-only admin headers stay separate.",
  };

  summary.shellHints = buildSafeShellHints(summary);
  summary.curlPreview = summary.authorizationPreview
    ? `curl -H "Authorization: ${summary.authorizationPreview}" https://portal.monsoonfire.com`
    : "";

  if (options.asJson) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  } else {
    process.stdout.write(`status: ${summary.ok ? "passed" : "failed"}\n`);
    process.stdout.write(`email: ${summary.email || "<missing>"}\n`);
    process.stdout.write(`uid: ${summary.uid || "<missing>"}\n`);
    process.stdout.write(`credentials source: ${summary.credentialsSource || "<missing>"}\n`);
    if (summary.credentialsPath) {
      process.stdout.write(`credentials path: ${summary.credentialsPath}\n`);
    }
    if (summary.credentialsError) {
      process.stdout.write(`credentials error: ${summary.credentialsError}\n`);
    }
    process.stdout.write(`auth source: ${summary.authSource || "<unavailable>"}\n`);
    process.stdout.write(`auth expiry: ${summary.idTokenExp || "<unavailable>"}\n`);
    process.stdout.write(`authorization preview: ${summary.authorizationPreview || "<unavailable>"}\n`);
    process.stdout.write(`admin token preview: ${summary.adminTokenPreview || "<not configured>"}\n`);
    process.stdout.write(`admin token policy: ${summary.adminTokenPolicy}\n`);
    if (summary.authReason) {
      process.stdout.write(`auth note: ${summary.authReason}\n`);
    }
    if (summary.shellHints.length > 0) {
      process.stdout.write("safe shell hints:\n");
      for (const line of summary.shellHints) {
        process.stdout.write(`  ${line}\n`);
      }
    }
    if (summary.curlPreview) {
      process.stdout.write(`curl preview: ${summary.curlPreview}\n`);
    }
  }

  if (!summary.ok) {
    process.exitCode = 1;
  }

  return summary;
}

if (process.argv[1] && resolve(process.argv[1]) === __filename) {
  runPortalAuthHelper().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`portal-auth-helper failed: ${message}`);
    process.exit(1);
  });
}
