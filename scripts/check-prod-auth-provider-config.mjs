#!/usr/bin/env node

import { createSign } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
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
const DEFAULT_REQUIRED_PROVIDERS = ["google.com", "microsoft.com", "apple.com", "facebook.com"];

function normalizeProviderId(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function parseArgs(argv) {
  const out = {
    projectId: process.env.FIREBASE_PROJECT_ID || "monsoonfire-portal",
    serviceAccountPath: process.env.GOOGLE_APPLICATION_CREDENTIALS
      ? resolve(process.cwd(), process.env.GOOGLE_APPLICATION_CREDENTIALS)
      : defaultServiceAccountPath,
    requiredProviders: null,
    skipProviders: [],
    strict: false,
    json: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--strict") out.strict = true;
    else if (arg === "--json") out.json = true;
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

function base64url(value) {
  return Buffer.from(value)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

async function mintAccessToken(serviceAccount) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iss: serviceAccount.client_email,
    scope: "https://www.googleapis.com/auth/cloud-platform",
    aud: serviceAccount.token_uri || "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };
  const unsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  const signature = signer.sign(serviceAccount.private_key, "base64url");
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

async function fetchProviderConfigs(projectId, accessToken) {
  const response = await fetch(
    `https://identitytoolkit.googleapis.com/admin/v2/projects/${projectId}/defaultSupportedIdpConfigs?pageSize=200`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
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
  if (!existsSync(options.serviceAccountPath)) {
    throw new Error(`Service account file not found: ${options.serviceAccountPath}`);
  }
  const serviceAccount = JSON.parse(await readFile(options.serviceAccountPath, "utf8"));
  const accessToken = await mintAccessToken(serviceAccount);
  const providerConfigs = await fetchProviderConfigs(options.projectId, accessToken);

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
