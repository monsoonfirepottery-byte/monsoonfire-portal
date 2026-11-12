#!/usr/bin/env node

/* eslint-disable no-console */

import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { inspectPortalRules } from "./lib/firestore-rules-release.mjs";
import { resolve } from "node:path";
import {
  exchangePortalRulesRefreshToken,
  looksLikeRefreshToken,
  loadGoogleAuthorizedUserCredentials,
} from "./lib/google-oauth-refresh.mjs";

const DEFAULT_PROJECT_ID = "monsoonfire-portal";
const LEGACY_RELEASE_ID = "cloud.firestore";
const DEFAULT_DB_RELEASE_ID = "cloud.firestore/default";
const DEFAULT_GCLOUD_ADC_PATH = process.env.APPDATA
  ? resolve(process.env.APPDATA, "gcloud", "application_default_credentials.json")
  : resolve(homedir(), ".config", "gcloud", "application_default_credentials.json");

function parseArgs(argv) {
  const options = {
    projectId: process.env.FIREBASE_PROJECT || DEFAULT_PROJECT_ID,
    accessToken:
      process.env.FIREBASE_RULES_API_TOKEN ||
      process.env.FIREBASE_ACCESS_TOKEN ||
      "",
    checkOnly: false,
    asJson: false,
    softFailPermissionDenied:
      String(process.env.FIREBASE_RULES_SOFT_FAIL_PERMISSION_DENIED || "").toLowerCase() === "true",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg || !arg.startsWith("--")) continue;

    if (arg === "--project") {
      const next = argv[index + 1];
      if (!next || next.startsWith("--")) {
        throw new Error("Missing value for --project");
      }
      options.projectId = String(next).trim();
      index += 1;
      continue;
    }

    if (arg === "--check") {
      options.checkOnly = true;
      continue;
    }

    if (arg === "--access-token") {
      const next = argv[index + 1];
      if (!next || next.startsWith("--")) {
        throw new Error("Missing value for --access-token");
      }
      options.accessToken = String(next).trim();
      index += 1;
      continue;
    }

    if (arg === "--json") {
      options.asJson = true;
      continue;
    }

    if (arg === "--soft-fail-permission-denied") {
      options.softFailPermissionDenied = true;
      continue;
    }
  }

  return options;
}

async function loadFirebaseCliToken() {
  const configPath = resolve(homedir(), ".config", "configstore", "firebase-tools.json");
  const raw = await readFile(configPath, "utf8");
  const parsed = JSON.parse(raw);
  const accessToken = parsed?.tokens?.access_token;
  const refreshToken = parsed?.tokens?.refresh_token;
  const expiresAtMs =
    typeof parsed?.tokens?.expires_at === "number" ? parsed.tokens.expires_at : Number.NaN;

  if (
    (!accessToken || typeof accessToken !== "string") &&
    (!refreshToken || typeof refreshToken !== "string")
  ) {
    throw new Error("Missing firebase-tools credentials. Run `firebase login` and retry.");
  }

  return {
    configPath,
    accessToken,
    refreshToken,
    expiresAtMs,
    source: "firebase-tools-config",
  };
}

async function resolveAccessToken(options) {
  const adcCredentials = await loadGoogleAuthorizedUserCredentials({
    explicitPath: String(process.env.GOOGLE_APPLICATION_CREDENTIALS || "").trim() || DEFAULT_GCLOUD_ADC_PATH,
  });
  const directToken = String(options.accessToken || "").trim();
  if (directToken) {
    if (looksLikeRefreshToken(directToken)) {
      try {
        const exchanged = await exchangePortalRulesRefreshToken(directToken, {
          source: "env-refresh-token",
          adcCredentials,
          adcResultSource: "env-refresh-token-adc-client",
        });
        return {
          configPath: adcCredentials?.configPath || null,
          accessToken: exchanged.accessToken,
          expiresAtMs: exchanged.expiresAtMs,
          source: exchanged.source,
        };
      } catch (error) {
        const cliToken = await loadFirebaseCliToken().catch(() => null);
        if (cliToken?.accessToken && typeof cliToken.accessToken === "string") {
          return {
            ...cliToken,
            source: "env-refresh-token-fallback-access",
          };
        }
        throw error;
      }
    }

    if (adcCredentials?.refreshToken) {
      try {
        const exchanged = await exchangePortalRulesRefreshToken(adcCredentials.refreshToken, {
          source: adcCredentials.source,
          adcCredentials,
          adcResultSource: "google-application-default-credentials-refresh-token",
        });
        return {
          configPath: adcCredentials.configPath,
          accessToken: exchanged.accessToken,
          expiresAtMs: exchanged.expiresAtMs,
          source: exchanged.source,
        };
      } catch {
        // Fall through to direct access token handling below.
      }
    }

    return {
      configPath: null,
      accessToken: directToken,
      expiresAtMs: Number.NaN,
      source: "env-or-arg",
    };
  }

  if (adcCredentials?.refreshToken) {
    try {
      const exchanged = await exchangePortalRulesRefreshToken(adcCredentials.refreshToken, {
        source: adcCredentials.source,
        adcCredentials,
        adcResultSource: "google-application-default-credentials-refresh-token",
      });
      return {
        configPath: adcCredentials.configPath,
        accessToken: exchanged.accessToken,
        expiresAtMs: exchanged.expiresAtMs,
        source: exchanged.source,
      };
    } catch {
      // Fall through to firebase-tools config if ADC exchange fails.
    }
  }

  const cliToken = await loadFirebaseCliToken();
  if (typeof cliToken.refreshToken === "string" && cliToken.refreshToken) {
    try {
      const exchanged = await exchangePortalRulesRefreshToken(cliToken.refreshToken, {
        source: "firebase-tools-config",
        adcCredentials,
        adcResultSource: "firebase-tools-refresh-token",
      });
      return {
        configPath: cliToken.configPath,
        accessToken: exchanged.accessToken,
        expiresAtMs: exchanged.expiresAtMs,
        source: exchanged.source,
      };
    } catch (error) {
      if (cliToken.accessToken && typeof cliToken.accessToken === "string") {
        return {
          ...cliToken,
          source: "firebase-tools-config-access-fallback",
        };
      }
      throw error;
    }
  }

  return cliToken;
}

async function requestRulesApi({ accessToken, path, method = "GET", body = null }) {
  const resp = await fetch(`https://firebaserules.googleapis.com/v1/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  const text = await resp.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text.slice(0, 600) };
  }

  return { ok: resp.ok, status: resp.status, json };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const config = JSON.parse(await readFile(resolve(process.cwd(), "firebase.json"), "utf8"));
  const targets = Array.isArray(config.firestore) ? config.firestore : [config.firestore];
  const rulesPath = targets.length === 1 && typeof targets[0]?.rules === "string" ? targets[0].rules : "";
  const rulesSource = rulesPath ? await readFile(resolve(process.cwd(), rulesPath), "utf8") : "";
  const tokenInfo = await resolveAccessToken(options);
  const result = await inspectPortalRules({
    projectId: options.projectId, config, rulesSource,
    request: (path) => requestRulesApi({ accessToken: tokenInfo.accessToken, path }),
  });
  const output = { projectId: options.projectId, ...result, tokenSource: tokenInfo.source };
  if (options.asJson) process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  else process.stdout.write(`${output.status}: ${output.message}\n`);
  if (result.status === "permission_denied" && options.softFailPermissionDenied) return;
  if (result.status !== "in_sync") process.exitCode = result.status === "drift_detected" ? 2 : 1;
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`sync-firestore-rules-releases failed: ${message}`);
  process.exitCode = 1;
});
