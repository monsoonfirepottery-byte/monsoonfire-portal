#!/usr/bin/env node

import { createSign } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const artifactsDir = resolve(repoRoot, "artifacts", "auth");
const defaultServiceAccountPath = resolve(
  repoRoot,
  "secrets",
  "portal",
  "firebase-service-account-monsoonfire-portal-github-action.json"
);
const defaultPortalAutomationEnvPath = resolve(repoRoot, "secrets", "portal", "portal-automation.env");
const homePortalAutomationEnvPath = resolve(homedir(), "secrets", "portal", "portal-automation.env");
const DEFAULT_REQUIRED_PROVIDERS = ["google.com", "microsoft.com", "apple.com", "facebook.com"];
const SERVICE_ACCOUNT_ENV_KEYS = [
  "GOOGLE_APPLICATION_CREDENTIALS",
  "FIREBASE_SERVICE_ACCOUNT_PATH",
  "PORTAL_FIREBASE_SERVICE_ACCOUNT",
  "FIREBASE_SERVICE_ACCOUNT_JSON",
];

loadPortalAutomationEnv();

function normalizeProviderId(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function parseArgs(argv) {
  const envCredentialPath =
    process.env.GOOGLE_APPLICATION_CREDENTIALS ||
    process.env.FIREBASE_SERVICE_ACCOUNT_PATH ||
    process.env.PORTAL_FIREBASE_SERVICE_ACCOUNT ||
    "";
  const out = {
    projectId: process.env.FIREBASE_PROJECT_ID || "monsoonfire-portal",
    serviceAccountPath: envCredentialPath
      ? resolve(process.cwd(), envCredentialPath)
      : defaultServiceAccountPath,
    requiredProviders: null,
    skipProviders: [],
    strict: false,
    json: false,
    credentialCheck: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--strict") out.strict = true;
    else if (arg === "--json") out.json = true;
    else if (arg === "--credential-check") out.credentialCheck = true;
    else if ((arg === "--project" || arg === "-p") && argv[index + 1]) {
      out.projectId = String(argv[index + 1]).trim() || out.projectId;
      index += 1;
    } else if ((arg === "--service-account" || arg === "-s") && argv[index + 1]) {
      out.serviceAccountPath = resolve(process.cwd(), String(argv[index + 1]).trim());
      index += 1;
    } else if (arg === "--required-providers" && argv[index + 1]) {
      out.requiredProviders = String(argv[index + 1])
        .split(",")
        .map((entry) => normalizeProviderId(entry))
        .filter(Boolean);
      index += 1;
    } else if (arg === "--require-provider" && argv[index + 1]) {
      const normalized = normalizeProviderId(argv[index + 1]);
      if (!out.requiredProviders) out.requiredProviders = [];
      if (normalized) out.requiredProviders.push(normalized);
      index += 1;
    } else if (arg === "--skip-provider" && argv[index + 1]) {
      const normalized = normalizeProviderId(argv[index + 1]);
      if (normalized) out.skipProviders.push(normalized);
      index += 1;
    }
  }

  if (Array.isArray(out.requiredProviders) && out.requiredProviders.length > 0) {
    out.requiredProviders = Array.from(new Set(out.requiredProviders));
  } else {
    out.requiredProviders = [...DEFAULT_REQUIRED_PROVIDERS];
  }
  out.skipProviders = Array.from(new Set(out.skipProviders));

  return out;
}

function loadPortalAutomationEnv() {
  const configuredPath = String(process.env.PORTAL_AUTOMATION_ENV_PATH || "").trim();
  const envPath =
    configuredPath ||
    (existsSync(defaultPortalAutomationEnvPath) ? defaultPortalAutomationEnvPath : homePortalAutomationEnvPath);
  if (!envPath || !existsSync(envPath)) return;

  const raw = readFileSync(envPath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex <= 0) continue;
    const key = trimmed.slice(0, separatorIndex).trim();
    if (!SERVICE_ACCOUNT_ENV_KEYS.includes(key)) continue;
    if (String(process.env[key] || "").trim()) continue;
    let value = trimmed.slice(separatorIndex + 1).trim();
    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

function describeCredentialSources(options) {
  const rows = [];
  for (const key of SERVICE_ACCOUNT_ENV_KEYS) {
    const value = String(process.env[key] || "").trim();
    if (value && key !== "FIREBASE_SERVICE_ACCOUNT_JSON") {
      rows.push({ source: key, path: resolve(process.cwd(), value), exists: existsSync(resolve(process.cwd(), value)) });
    } else if (value && key === "FIREBASE_SERVICE_ACCOUNT_JSON") {
      rows.push({ source: key, path: "(inline JSON redacted)", exists: true });
    }
  }
  rows.push({
    source: "default",
    path: defaultServiceAccountPath,
    exists: existsSync(defaultServiceAccountPath),
  });
  if (options.serviceAccountPath !== defaultServiceAccountPath && !rows.some((row) => row.path === options.serviceAccountPath)) {
    rows.unshift({
      source: "--service-account",
      path: options.serviceAccountPath,
      exists: existsSync(options.serviceAccountPath),
    });
  }
  return rows;
}

function base64url(value) {
  return Buffer.from(value)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

async function mintAccessToken(serviceAccount) {
  const credentialType = String(serviceAccount?.type || "").trim();
  if (credentialType === "authorized_user" || serviceAccount?.refresh_token) {
    return mintAuthorizedUserAccessToken(serviceAccount);
  }
  return mintServiceAccountAccessToken(serviceAccount);
}

async function mintAuthorizedUserAccessToken(credential) {
  const clientId = String(credential?.client_id || "").trim();
  const clientSecret = String(credential?.client_secret || "").trim();
  const refreshToken = String(credential?.refresh_token || "").trim();
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error("Authorized-user ADC credential is missing client_id, client_secret, or refresh_token.");
  }

  const resp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`OAuth refresh request failed (${resp.status}): ${text.slice(0, 400)}`);
  }
  const tokenPayload = await resp.json();
  const accessToken = String(tokenPayload.access_token || "");
  if (!accessToken) {
    throw new Error("OAuth refresh response did not include access_token.");
  }
  return accessToken;
}

async function mintServiceAccountAccessToken(serviceAccount) {
  const clientEmail = String(serviceAccount?.client_email || "").trim();
  const privateKey = String(serviceAccount?.private_key || "").trim();
  if (!clientEmail || !privateKey) {
    throw new Error("Service-account credential is missing client_email or private_key.");
  }

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iss: clientEmail,
    scope: "https://www.googleapis.com/auth/cloud-platform",
    aud: serviceAccount.token_uri || "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };
  const unsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  const signature = signer.sign(privateKey, "base64url");
  const assertion = `${unsigned}.${signature}`;

  const resp = await fetch(serviceAccount.token_uri || "https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`OAuth token request failed (${resp.status}): ${text.slice(0, 400)}`);
  }
  const tokenPayload = await resp.json();
  const accessToken = String(tokenPayload.access_token || "");
  if (!accessToken) {
    throw new Error("OAuth token response did not include access_token.");
  }
  return accessToken;
}

function credentialQuotaProject(credential) {
  return String(process.env.GOOGLE_CLOUD_QUOTA_PROJECT || credential?.quota_project_id || "").trim();
}

async function fetchProviderConfigs(projectId, accessToken, quotaProject = "") {
  const headers = {
    Authorization: `Bearer ${accessToken}`,
  };
  if (quotaProject) {
    headers["x-goog-user-project"] = quotaProject;
  }

  const response = await fetch(
    `https://identitytoolkit.googleapis.com/admin/v2/projects/${projectId}/defaultSupportedIdpConfigs?pageSize=200`,
    {
      headers,
    }
  );
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Provider config request failed (${response.status}): ${text.slice(0, 400)}`);
  }
  const payload = await response.json();
  return Array.isArray(payload.defaultSupportedIdpConfigs) ? payload.defaultSupportedIdpConfigs : [];
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const credentialSources = describeCredentialSources(options);
  if (options.credentialCheck) {
    const report = {
      ok: existsSync(options.serviceAccountPath) || Boolean(String(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || "").trim()),
      command: "prod-auth-provider-config-credential-check",
      generatedAtIso: new Date().toISOString(),
      projectId: options.projectId,
      serviceAccountPath: options.serviceAccountPath,
      credentialSources,
      setupHint:
        "Set GOOGLE_APPLICATION_CREDENTIALS, FIREBASE_SERVICE_ACCOUNT_PATH, PORTAL_FIREBASE_SERVICE_ACCOUNT, or pass --service-account. Local portal env is loaded from secrets/portal/portal-automation.env when present.",
    };
    if (options.json) {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    } else {
      process.stdout.write(`credential check: ${report.ok ? "ok" : "missing"}\n`);
      process.stdout.write(`${report.setupHint}\n`);
    }
    if (options.strict && !report.ok) process.exitCode = 1;
    return;
  }
  const inlineServiceAccountJson = String(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || "").trim();
  if (!existsSync(options.serviceAccountPath) && !inlineServiceAccountJson) {
    throw new Error(
      [
        `Service account file not found: ${options.serviceAccountPath}`,
        "Checked credential sources:",
        ...credentialSources.map((row) => `- ${row.source}: ${row.path} (${row.exists ? "found" : "missing"})`),
        "Set GOOGLE_APPLICATION_CREDENTIALS, FIREBASE_SERVICE_ACCOUNT_PATH, PORTAL_FIREBASE_SERVICE_ACCOUNT, or pass --service-account.",
        "Local portal env is loaded from secrets/portal/portal-automation.env when present.",
      ].join("\n")
    );
  }
  const serviceAccount = inlineServiceAccountJson
    ? JSON.parse(inlineServiceAccountJson)
    : JSON.parse(await readFile(options.serviceAccountPath, "utf8"));
  const accessToken = await mintAccessToken(serviceAccount);
  const providerConfigs = await fetchProviderConfigs(options.projectId, accessToken, credentialQuotaProject(serviceAccount));

  const indexByProviderId = new Map();
  for (const row of providerConfigs) {
    const providerId = normalizeProviderId(row?.providerId || row?.name?.split("/").pop() || "");
    if (!providerId) continue;
    indexByProviderId.set(providerId, row);
  }

  const skipSet = new Set(options.skipProviders);
  const effectiveProviders = options.requiredProviders.filter((providerId) => !skipSet.has(providerId));
  if (effectiveProviders.length === 0) {
    throw new Error("No effective providers left after skip-provider filtering.");
  }

  const readiness = effectiveProviders.map((providerId) => {
    const row = indexByProviderId.get(providerId) || null;
    return {
      providerId,
      found: Boolean(row),
      enabled: row?.enabled === true,
      clientIdConfigured: Boolean(String(row?.clientId || "").trim()),
    };
  });
  const missingOrDisabled = readiness.filter(
    (entry) => !entry.found || !entry.enabled || !entry.clientIdConfigured
  );
  const report = {
    ok: missingOrDisabled.length === 0,
    command: "prod-auth-provider-config-check",
    generatedAtIso: new Date().toISOString(),
    projectId: options.projectId,
    requiredProviders: effectiveProviders,
    skippedProviders: options.skipProviders,
    readiness,
    unresolved: missingOrDisabled,
  };

  await mkdir(artifactsDir, { recursive: true });
  const runId = report.generatedAtIso.replace(/[-:]/g, "").replace(/\./g, "").replace("Z", "Z");
  const jsonPath = join(artifactsDir, `auth-provider-config-${runId}.json`);
  const latestPath = join(artifactsDir, "auth-provider-config-latest.json");
  await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(latestPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  if (options.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(
      [
        "Production auth provider configuration check completed",
        `- projectId: ${report.projectId}`,
        `- unresolved providers: ${report.unresolved.length}`,
        `- artifact: ${jsonPath}`,
      ].join("\n") + "\n"
    );
  }

  if (options.strict && !report.ok) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
