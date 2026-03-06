#!/usr/bin/env node

import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { parseCliArgs, readBoolFlag, readNumberFlag, readStringFlag } from "./lib/pst-memory-utils.mjs";

const REPO_ROOT = resolve(process.cwd(), ".");
const SCRIPT_START = process.hrtime.bigint();
const DEFAULT_CLIENT_ID = process.env.MAIL_IMPORT_OUTLOOK_CLIENT_ID || "";
const DEFAULT_TOKEN_OUTPUT = resolve(process.cwd(), "secrets/studio-brain/outlook-oauth-session.json");
const DEFAULT_BROWSER_REDIRECT_PORT = 8765;
const DEFAULT_BROWSER_REDIRECT_PATH = "/callback";
const GRAPH_AUDIENCES = new Set([
  "https://graph.microsoft.com",
  "00000003-0000-0000-c000-000000000000",
]);

function toBase64Url(value) {
  return Buffer.from(value)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function buildPkceVerifier(length = 64) {
  return toBase64Url(randomBytes(length));
}

function buildPkceChallenge(verifier) {
  return toBase64Url(createHash("sha256").update(String(verifier)).digest());
}

function parseBrowserQuery(rawUrl) {
  const parsed = new URL(rawUrl);
  return {
    code: parsed.searchParams.get("code") || "",
    state: parsed.searchParams.get("state") || "",
    error: parsed.searchParams.get("error") || "",
    errorDescription: parsed.searchParams.get("error_description") || "",
  };
}

function usage() {
  process.stdout.write(
    [
      "Outlook OAuth device-login helper",
      "",
      "Usage:",
      "  node ./scripts/outlook-device-auth.mjs --client-id <id> --outlook-user <user>",
      "  node ./scripts/outlook-device-auth.mjs --client-id <id> --outlook-user <user> --run-import true",
      "",
      "What it does:",
      "  --flow device: requests a Microsoft OAuth device code",
      "  --flow browser: builds a browser auth request and waits for localhost callback code",
      "  1) Prints a browser sign-in URL",
      "  2) Waits for OAuth callback or manual completion",
      "  3) Exchanges auth code/device response for the access token",
      "  4) Optionally runs open-memory mail import (mode outlook) using the token",
      "",
      "Notes:",
      "  - Modern Microsoft accounts usually block plain username+password IMAP auth.",
      "  - Use --client-id from an app registration or your own Azure app registration.",
      "  - You can also reuse this as a pure token grabber for --outlook-access-token.",
      "",
      "Options:",
      "  --flow <device|browser>           OAuth flow to use (default: device)",
      "  --tenant-id <tenant>              Tenant id (default: common)",
      "  --client-id <id>                  OAuth client id (required unless MAIL_IMPORT_OUTLOOK_CLIENT_ID is set)",
      "  --outlook-client-secret <secret>   OAuth client secret (if this app is confidential)",
      "  --outlook-client-secret-env <name> Use env var for client secret",
      "  --scopes <scope list>             Scopes to request (default: \"https://graph.microsoft.com/Mail.Read offline_access\")",
      "  --timeout-seconds <seconds>       Max seconds to wait for auth (default: 900)",
      "  --interval-override <seconds>      Poll interval override",
      "  --redirect-port <port>            Callback port for browser flow (default: 8765)",
      "  --redirect-path <path>            Callback path for browser flow (default: /callback)",
      "  --login-hint <email>              Optional login_hint for browser flow",
      "  --json                            Print token payload JSON to stdout only",
      "",
      "  --outlook-user <user>            Mailbox to ingest (required when --run-import true)",
      "  --run-import true|false           Execute open-memory mail import after token is acquired (default: false)",
      "  --run-id <id>                    Import run id",
      "  --outlook-folder <name>           Mail folder (default: Inbox)",
      "  --max-items <n>                  Max source rows for this import (default: 1200)",
      "  --chunk-size <n>                 Import chunk size (default: 300)",
      "  --disable-run-burst-limit true|false Disable run-write burst limiter (default: false)",
      "  --load-env-file true|false        Load local automation env file (default: true)",
      "  --env-file <path>                Env file path (default: ./secrets/studio-brain/open-memory-mail-import.env)",
      "  --load-portal-env-file true|false Load portal automation env file (default: true)",
      "  --portal-env-file <path>          Portal env file path (default: ./secrets/portal/portal-automation.env)",
      "  --token-output <path>             Write token JSON to file (optional)",
      "  --base-url <url>                  Optional explicit Studio Brain base URL to pass to import",
      "  --import-script <path>            Import script path (default: ./scripts/open-memory-mail-import.mjs)",
      "",
      "Examples:",
      "  node ./scripts/outlook-device-auth.mjs --client-id <my-app-id> --outlook-user you@example.com --run-import true",
      "  node ./scripts/outlook-device-auth.mjs --outlook-user you@example.com --run-import true --run-id mail-live --max-items 2000 --chunk-size 300",
      "  node ./scripts/outlook-device-auth.mjs --flow browser --client-id <my-app-id> --outlook-user you@example.com --run-import true",
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
    if (!key) continue;
    process.env[key] = value;
    keysLoaded += 1;
  }
  return {
    attempted: true,
    loaded: keysLoaded > 0,
    filePath,
    keysLoaded,
  };
}

function splitScopes(rawScopes) {
  if (!rawScopes) return ["https://graph.microsoft.com/Mail.Read", "offline_access"];
  return String(rawScopes)
    .split(/\s+/)
    .map((value) => String(value || "").trim())
    .filter(Boolean);
}

function parseAadstsCode(errorDescription) {
  const match = String(errorDescription || "").match(/AADSTS(\d{5,})/i);
  return match ? match[1] : "";
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

function hasMailReadClaim(payload) {
  const scopeTokens = String(payload?.scp || "")
    .split(/\s+/)
    .map((entry) => String(entry || "").trim().toLowerCase())
    .filter(Boolean);
  if (scopeTokens.length > 0) {
    return scopeTokens.includes("mail.read");
  }

  if (Array.isArray(payload?.roles)) {
    const roleTokens = payload.roles
      .map((entry) => String(entry || "").trim().toLowerCase())
      .filter(Boolean);
    if (roleTokens.length > 0) {
      return roleTokens.includes("mail.read");
    }
  }
  return true;
}

function validateGraphAccessToken(rawToken) {
  const token = String(rawToken || "").trim();
  if (!token) {
    return { ok: false, reason: "missing-token", payload: null };
  }

  const payload = decodeJwtPayload(token);
  if (!payload) {
    return { ok: false, reason: "token-not-jwt", payload: null };
  }

  const audience = String(payload?.aud || "").trim();
  if (!GRAPH_AUDIENCES.has(audience)) {
    return { ok: false, reason: `token-audience-invalid:${audience || "missing"}`, payload };
  }
  if (!hasMailReadClaim(payload)) {
    return { ok: false, reason: "token-missing-mail-read", payload };
  }

  const expiryMs = Number(payload?.exp) * 1000;
  if (Number.isFinite(expiryMs) && expiryMs > 0 && Date.now() >= expiryMs - 60_000) {
    return { ok: false, reason: "token-expired", payload };
  }

  return { ok: true, reason: "ok", payload };
}

function buildTokenExchangeHint({ error, errorDescription, hasClientSecret }) {
  if (!error) {
    return "";
  }
  const aadCode = parseAadstsCode(errorDescription);
  if (error === "invalid_client" || aadCode === "7000218") {
    const details = [
      "OAuth token exchange failed with invalid_client.",
      errorDescription || "",
      "This app appears to require a confidential client secret.",
      hasClientSecret
        ? "The secret value supplied may be wrong or expired."
        : "No secret was supplied, so this flow will fail for confidential apps.",
      "A permission value like e1fe6dd8-... is NOT a client secret.",
      "Create/use a real secret in Azure Portal -> App registrations -> [app] -> Certificates & secrets.",
      "Store it in MAIL_IMPORT_OUTLOOK_CLIENT_SECRET or pass --outlook-client-secret.",
    ];
    return details.join(" ");
  }
  if (error === "invalid_scope" || aadCode === "70011") {
    return `OAuth token exchange failed (invalid_scope): ${errorDescription || "check app-scoped permissions and requested scopes."}`;
  }
  if (error === "invalid_request" && aadCode === "50059") {
    return "OAuth token exchange failed: tenant information is missing. Use a concrete tenant GUID/domain instead of an empty/invalid tenant value.";
  }
  return "";
}

function buildTokenExchangeFailureError(errorPayload, hasClientSecret) {
  const error = String(errorPayload?.error || "").trim();
  if (!error) {
    return null;
  }
  const errorDescription = String(errorPayload?.error_description || "").trim();
  const hint = buildTokenExchangeHint({ error, errorDescription, hasClientSecret });
  if (!hint) {
    return null;
  }
  return hint;
}

function normalizeRedirectPath(rawPath) {
  const normalized = String(rawPath || DEFAULT_BROWSER_REDIRECT_PATH).trim() || DEFAULT_BROWSER_REDIRECT_PATH;
  return normalized.startsWith("/") ? normalized : `/${normalized}`;
}

function buildBrowserAuthRequest({ tenantId, clientId, scopes, redirectUri, loginHint, state, codeChallenge }) {
  const authorizeUrl = new URL(
    `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/authorize`
  );
  authorizeUrl.searchParams.set("client_id", clientId);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("response_mode", "query");
  authorizeUrl.searchParams.set("redirect_uri", redirectUri);
  authorizeUrl.searchParams.set("scope", scopes.join(" "));
  authorizeUrl.searchParams.set("state", state);
  authorizeUrl.searchParams.set("code_challenge", codeChallenge);
  authorizeUrl.searchParams.set("code_challenge_method", "S256");
  if (loginHint) authorizeUrl.searchParams.set("login_hint", loginHint);
  authorizeUrl.searchParams.set("prompt", "select_account");
  return authorizeUrl.toString();
}

async function requestBrowserAuthCode({
  tenantId,
  clientId,
  clientSecret,
  scopes,
  redirectPort,
  redirectPath,
  loginHint,
  timeoutSeconds,
}) {
  const codeVerifier = buildPkceVerifier();
  const codeChallenge = buildPkceChallenge(codeVerifier);
  const state = buildPkceVerifier(24);
  const redirectUri = `http://127.0.0.1:${redirectPort}${redirectPath}`;
  const authUrl = buildBrowserAuthRequest({
    tenantId,
    clientId,
    scopes,
    redirectUri,
    loginHint,
    state,
    codeChallenge,
  });
  process.stdout.write("Microsoft OAuth browser login required.\n");
  process.stdout.write(`Open in browser: ${authUrl}\n`);
  if (loginHint) {
    process.stdout.write(`Login hint: ${loginHint}\n`);
  }
  process.stdout.write(`Callback expected at: ${redirectUri}\n`);

  const code = await waitForBrowserAuthCode({
    redirectPort,
    redirectPath,
    expectedState: state,
    timeoutSeconds,
  });

  const tokenEndpoint = `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`;
  const tokenBody = {
    client_id: clientId,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
    code,
    code_verifier: codeVerifier,
    scope: scopes.join(" "),
  };
  if (clientSecret) {
    tokenBody.client_secret = clientSecret;
  }
  const response = await fetch(tokenEndpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(tokenBody).toString(),
  });
  const raw = await response.text();
  if (!response.ok) {
    let payload = {};
    try {
      payload = JSON.parse(raw);
    } catch (_error) {}
    const exchangeError = buildTokenExchangeFailureError(payload, Boolean(clientSecret));
    if (exchangeError) {
      throw new Error(exchangeError);
    }
    throw new Error(`authorization_code token exchange failed (${response.status}): ${raw}`);
  }
  const payload = JSON.parse(raw);
  if (!payload?.access_token) {
    throw new Error(`token response missing access_token: ${raw}`);
  }
  return payload;
}

async function waitForBrowserAuthCode({ redirectPort, redirectPath, expectedState, timeoutSeconds }) {
  let timeoutHandle;

  return new Promise((resolveWait, rejectWait) => {
    const server = createServer((request, response) => {
      try {
        if (!request.url) {
          response.statusCode = 400;
          response.end("Invalid callback request.");
          return;
        }
        const requestUrl = new URL(`http://127.0.0.1:${redirectPort}${request.url}`);
        if (requestUrl.pathname !== redirectPath) {
          response.statusCode = 404;
          response.end("Unknown callback endpoint.");
          return;
        }
        const payload = parseBrowserQuery(requestUrl.toString());
        if (payload.error) {
          response.statusCode = 400;
          response.end(`OAuth error: ${payload.error}${payload.errorDescription ? `: ${payload.errorDescription}` : ""}`);
          server.close(() => {
            clearTimeout(timeoutHandle);
            rejectWait(new Error(`OAuth browser flow failed: ${payload.error} ${payload.errorDescription}`.trim()));
          });
          return;
        }
        if (payload.state !== expectedState) {
          response.statusCode = 400;
          response.end("OAuth state mismatch.");
          server.close(() => {
            clearTimeout(timeoutHandle);
            rejectWait(new Error("OAuth state mismatch"));
          });
          return;
        }
        if (!payload.code) {
          response.statusCode = 400;
          response.end("Authorization code missing.");
          server.close(() => {
            clearTimeout(timeoutHandle);
            rejectWait(new Error("Missing authorization code"));
          });
          return;
        }
        response.statusCode = 200;
        response.end("Microsoft OAuth completed. You may close this tab.");
        server.close(() => {
          clearTimeout(timeoutHandle);
          resolveWait(payload.code);
        });
      } catch (error) {
        response.statusCode = 500;
        response.end("OAuth callback handling failed.");
        server.close(() => {
          clearTimeout(timeoutHandle);
          rejectWait(error instanceof Error ? error : new Error(String(error)));
        });
      }
    });

    server.listen(redirectPort, "127.0.0.1", () => {
      process.stdout.write(`Listening for callback on 127.0.0.1:${redirectPort}${redirectPath}...\n`);
    });

    timeoutHandle = setTimeout(() => {
      server.close(() => {});
      rejectWait(new Error("OAuth browser flow timed out."));
    }, Math.max(30, timeoutSeconds || 900) * 1000);

    server.on("error", (error) => {
      clearTimeout(timeoutHandle);
      rejectWait(error);
    });
  });
}

async function requestDeviceCode({ tenantId, clientId, scopes }) {
  const scopeParam = scopes.join(" ");
  const response = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/devicecode`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      scope: scopeParam,
    }).toString(),
  });
  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`device-code request failed (${response.status}): ${raw}`);
  }
  const payload = JSON.parse(raw);
  if (!payload?.device_code || !payload?.user_code || !(payload?.verification_uri || payload?.verification_uri_complete)) {
    throw new Error(`device-code response missing required fields: ${raw}`);
  }
  return {
    ...payload,
    scope: payload.scope || scopeParam,
  };
}

async function pollAccessToken({
  tenantId,
  clientId,
  clientSecret,
  deviceCode,
  scopes,
  timeoutSeconds,
  intervalSeconds,
}) {
  const tokenEndpoint = `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`;
  const startedAt = Date.now();
  let interval = Math.max(1, Math.floor(intervalSeconds || 5));
  const timeoutAt = startedAt + Math.max(30, timeoutSeconds || 900) * 1000;

  while (Date.now() < timeoutAt) {
    const body = {
      client_id: clientId,
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      device_code: deviceCode,
      scope: scopes.join(" "),
    };
    if (clientSecret) {
      body.client_secret = clientSecret;
    }
    const response = await fetch(tokenEndpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(body).toString(),
    });

    const raw = await response.text();
    let payload = {};
    try {
      payload = JSON.parse(raw);
    } catch (error) {
      throw new Error(`token endpoint returned non-JSON response (${response.status}): ${raw}`);
    }

    if (response.ok && payload?.access_token) {
      return payload;
    }

    if (payload?.error === "authorization_pending" || payload?.error === "slow_down") {
      if (payload?.error === "slow_down") interval += 5;
      await new Promise((resolveWait) => setTimeout(resolveWait, interval * 1000));
      continue;
    }

    const exchangeError = buildTokenExchangeFailureError(payload, Boolean(clientSecret));
    if (exchangeError) {
      throw new Error(exchangeError);
    }

    if (payload?.error === "authorization_declined" || payload?.error === "expired_token" || payload?.error === "access_denied") {
      throw new Error(`OAuth device login failed: ${payload.error} ${payload.error_description || ""}`.trim());
    }

    if (payload?.error === "invalid_grant") {
      throw new Error(`OAuth device login failed (invalid_grant): ${payload.error_description || "waiting may continue, retrying"}`.trim());
    }

    throw new Error(`OAuth token exchange failed: ${payload.error || response.status} ${payload.error_description || ""}`.trim());
  }

  throw new Error("OAuth device login timed out");
}

function toInt(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
}

function readCachedOutlookToken(tokenFilePath, expectedClientId = "") {
  if (!tokenFilePath || !existsSync(tokenFilePath)) {
    return null;
  }

  try {
    const raw = readFileSync(tokenFilePath, "utf8");
    const parsed = JSON.parse(raw);
    const accessToken = String(parsed?.accessToken || parsed?.access_token || "").trim();
    if (!accessToken) {
      return null;
    }
    const tokenValidation = validateGraphAccessToken(accessToken);
    if (!tokenValidation.ok) {
      return null;
    }

    if (expectedClientId && parsed?.clientId && String(parsed.clientId) !== String(expectedClientId)) {
      return null;
    }

    const acquiredAtRaw = String(parsed?.acquiredAt || "").trim();
    const acquiredAtMs = acquiredAtRaw ? Date.parse(acquiredAtRaw) : NaN;
    const expiresIn = toInt(parsed?.expiresIn, 0);
    const expiresAtRaw = String(parsed?.expiresAt || parsed?.expires_at || "").trim();
    const expiresAtMs = expiresAtRaw ? Date.parse(expiresAtRaw) : NaN;
    const now = Date.now();
    const safetyWindowMs = 60_000;

    if (Number.isFinite(expiresAtMs) && expiresAtMs > 0 && now >= expiresAtMs - safetyWindowMs) {
      return null;
    }
    if (Number.isFinite(acquiredAtMs) && acquiredAtMs > 0 && expiresIn > 0 && now >= acquiredAtMs + expiresIn * 1000 - safetyWindowMs) {
      return null;
    }

    return {
      access_token: accessToken,
      token_type: String(parsed?.tokenType || "Bearer").trim(),
      refresh_token: String(parsed?.refreshToken || parsed?.refresh_token || "").trim(),
      scope: String(parsed?.scope || "").trim(),
      expires_in: expiresIn || 0,
      acquired_at: acquiredAtRaw,
    };
  } catch {
    return null;
  }
}

function runOutlookImport({
  importScript,
  importRunId,
  outlookUser,
  accessToken,
  outlookFolder,
  importMaxItems,
  importChunkSize,
  importDisableRunBurstLimit,
  loadEnvFileFlag,
  envFilePath,
  loadPortalEnvFileFlag,
  portalEnvFilePath,
  baseUrl,
  outlookTokenFile,
  outlookAttachmentMode,
  outlookAttachmentMaxItemsPerMessage,
  outlookAttachmentMaxBytes,
  outlookAttachmentMaxTextChars,
  outlookAttachmentAllowMime,
  outlookAttachmentIncludeInline,
}) {
  const commandArgs = [
    "--mode",
    "outlook",
    "--run-id",
    importRunId,
    "--outlook-user",
    outlookUser,
    "--outlook-folder",
    outlookFolder,
    "--outlook-access-token",
    accessToken,
    "--load-env-file",
    String(loadEnvFileFlag),
    "--env-file",
    envFilePath,
    "--load-portal-env-file",
    String(loadPortalEnvFileFlag),
    "--portal-env-file",
    portalEnvFilePath,
    "--max-items",
    String(importMaxItems),
    "--chunk-size",
    String(importChunkSize),
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
  ];
  if (outlookAttachmentAllowMime) {
    commandArgs.push("--outlook-attachment-allow-mime", outlookAttachmentAllowMime);
  }
  if (outlookTokenFile) {
    commandArgs.push("--outlook-token-file", outlookTokenFile);
  }
  if (baseUrl) {
    commandArgs.push("--base-url", baseUrl);
  }
  if (importDisableRunBurstLimit) {
    commandArgs.push("--disable-run-burst-limit", "true");
  }

  const importRun = spawnSync(process.execPath, [importScript, ...commandArgs], {
    cwd: REPO_ROOT,
    env: process.env,
    encoding: "utf8",
    stdio: "inherit",
  });
  if (importRun.status !== 0) {
    throw new Error(`open-memory mail import failed (status ${importRun.status})`);
  }
}

function main() {
  const { flags } = parseCliArgs(process.argv.slice(2));
  if (readBoolFlag(flags, "help", false) || readBoolFlag(flags, "h", false)) {
    usage();
    return;
  }

  let tenantId = readStringFlag(flags, "tenant-id", "");
  let clientId = readStringFlag(flags, "client-id", DEFAULT_CLIENT_ID);
  const flow = readStringFlag(flags, "flow", "device");
  if (!["device", "browser"].includes(flow)) {
    throw new Error("Invalid --flow value. Use --flow device or --flow browser.");
  }

  const scopes = splitScopes(readStringFlag(flags, "scopes", "https://graph.microsoft.com/Mail.Read offline_access"));
  const timeoutSeconds = readNumberFlag(flags, "timeout-seconds", 900, { min: 30, max: 3600 });
  const intervalOverride = readNumberFlag(flags, "interval-override", 5, { min: 2, max: 120 });
  const printJson = readBoolFlag(flags, "json", false);

  const runImport = readBoolFlag(flags, "run-import", false);
  const runId = readStringFlag(flags, "run-id", `mail-outlook-oauth-${Date.now()}`);
  let outlookUser = readStringFlag(flags, "outlook-user", "");
  const outlookFolder = readStringFlag(flags, "outlook-folder", "Inbox");
  let clientSecret = (() => {
    const explicit = readStringFlag(flags, "outlook-client-secret", "");
    if (explicit) return explicit;
    const envName = readStringFlag(flags, "outlook-client-secret-env", "");
    if (envName && process.env[envName]) return String(process.env[envName]);
    return process.env.MAIL_IMPORT_OUTLOOK_CLIENT_SECRET || process.env.MS_CLIENT_SECRET || "";
  })();
  const importMaxItems = readNumberFlag(flags, "max-items", 1200, { min: 1, max: 100000 });
  const importChunkSize = readNumberFlag(flags, "chunk-size", 300, { min: 1, max: 500 });
  const disableRunBurstLimit = readBoolFlag(flags, "disable-run-burst-limit", false);
  const importScript = readStringFlag(flags, "import-script", "./scripts/open-memory-mail-import.mjs");
  const baseUrl = readStringFlag(flags, "base-url", "");
  const outlookAttachmentMode = readStringFlag(
    flags,
    "outlook-attachment-mode",
    process.env.MAIL_IMPORT_OUTLOOK_ATTACHMENT_MODE || "none"
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

  const loadEnvFileFlag = readBoolFlag(flags, "load-env-file", true);
  const envFilePath = resolve(readStringFlag(flags, "env-file", "./secrets/studio-brain/open-memory-mail-import.env"));
  const loadPortalEnvFileFlag = readBoolFlag(flags, "load-portal-env-file", true);
  const portalEnvFilePath = resolve(readStringFlag(flags, "portal-env-file", "./secrets/portal/portal-automation.env"));
  let tokenOutputPath = readStringFlag(flags, "token-output", DEFAULT_TOKEN_OUTPUT);
  const redirectPort = readNumberFlag(flags, "redirect-port", DEFAULT_BROWSER_REDIRECT_PORT, {
    min: 1024,
    max: 65535,
  });
  const redirectPath = normalizeRedirectPath(readStringFlag(flags, "redirect-path", DEFAULT_BROWSER_REDIRECT_PATH));
  const loginHint = readStringFlag(flags, "login-hint", outlookUser || "");

  if (loadEnvFileFlag) {
    loadEnvFile(envFilePath);
  }
  if (loadPortalEnvFileFlag) {
    loadEnvFile(portalEnvFilePath);
  }
  if (!tenantId) {
    tenantId = process.env.MAIL_IMPORT_OUTLOOK_TENANT_ID || process.env.MAIL_IMPORT_TENANT_ID || "common";
  }
  if (!clientId) {
    clientId = process.env.MAIL_IMPORT_OUTLOOK_CLIENT_ID || "";
  }
  if (!outlookUser) {
    outlookUser = process.env.MAIL_IMPORT_OUTLOOK_USER || process.env.OUTLOOK_USER || "";
  }
  if (runImport && !outlookUser) {
    throw new Error("--outlook-user is required when --run-import true. Add it as --outlook-user or set MAIL_IMPORT_OUTLOOK_USER in env.");
  }
  if (!clientSecret) {
    const envName = readStringFlag(flags, "outlook-client-secret-env", "");
    if (envName && process.env[envName]) {
      clientSecret = String(process.env[envName]);
    }
    if (!clientSecret) {
      clientSecret = process.env.MAIL_IMPORT_OUTLOOK_CLIENT_SECRET || process.env.MS_CLIENT_SECRET || "";
    }
  }
  if (!clientId) {
    throw new Error("Missing client-id. Set --client-id or MAIL_IMPORT_OUTLOOK_CLIENT_ID.");
  }
  if (!clientSecret) {
    process.stdout.write(
      "No Microsoft app client secret detected. Attempting public-client token flow (no client_secret).\n"
    );
    process.stdout.write(
      "If Azure returns invalid_client with this app, re-run with a real client secret from Certificates & secrets.\n"
    );
  }
  if (!tokenOutputPath) {
    tokenOutputPath = process.env.MAIL_IMPORT_OUTLOOK_TOKEN_FILE || DEFAULT_TOKEN_OUTPUT;
  }

  const cachedToken = readCachedOutlookToken(tokenOutputPath, clientId);
  if (cachedToken?.access_token) {
    const remainingMinutes = cachedToken.expires_in > 0 ? Math.max(0, Math.floor((cachedToken.expires_in || 0) / 60) - 1) : "unknown";
    process.stdout.write(
      `Using cached Outlook token from ${tokenOutputPath} (expires in ~${remainingMinutes} min).\n`
    );
  }

  const authPromise = cachedToken?.access_token
    ? Promise.resolve(cachedToken)
    : flow === "browser"
    ? requestBrowserAuthCode({
        tenantId,
        clientId,
        clientSecret,
        scopes,
        redirectPort,
        redirectPath,
        loginHint,
        timeoutSeconds,
      })
    : requestDeviceCode({ tenantId, clientId, scopes }).then(async (devicePayload) => {
        const verificationUrl = devicePayload.verification_uri_complete || devicePayload.verification_uri;
        const expiresIn = Number(devicePayload.expires_in || 900);
        const computedTimeout = Math.min(timeoutSeconds, expiresIn || timeoutSeconds);
        const clickThrough = devicePayload.verification_uri_complete || verificationUrl;
        process.stdout.write("Microsoft OAuth login required.\n");
        process.stdout.write(`Open in browser: ${clickThrough}\n`);
        process.stdout.write(`Code (if page only asks): ${devicePayload.user_code}\n`);
        process.stdout.write(
          `If not using a browser shortcut, open ${verificationUrl} and enter the code above.\n`
        );
        process.stdout.write(`Expires in: ${expiresIn || 900} seconds\n`);

        return pollAccessToken({
          tenantId,
          clientId,
          deviceCode: devicePayload.device_code,
          scopes,
          clientSecret,
          timeoutSeconds: computedTimeout,
          intervalSeconds: Math.max(5, intervalOverride || Number(devicePayload.interval || 5)),
        });
      });

  authPromise
    .then((tokenPayload) => {
      const accessToken = String(tokenPayload.access_token || "").trim();
      if (!accessToken) {
        throw new Error("OAuth succeeded but access_token was missing.");
      }
      const tokenValidation = validateGraphAccessToken(accessToken);
      if (!tokenValidation.ok) {
        throw new Error(`OAuth succeeded but token validation failed: ${tokenValidation.reason}`);
      }

      const result = {
        tenantId,
        clientId,
        flow,
        scopes: scopes,
        accessToken,
        refreshToken: tokenPayload.refresh_token || "",
        tokenType: tokenPayload.token_type || "Bearer",
        expiresIn: Number(tokenPayload.expires_in || 0),
        acquiredAt: new Date().toISOString(),
      };

      if (tokenOutputPath) {
        writeFileSync(tokenOutputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
      }

      if (printJson) {
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      } else {
        process.stdout.write(`Outlook token acquired via ${flow} flow.\n`);
        process.stdout.write(`Access token (first 20 chars): ${accessToken.slice(0, 20)}...\n`);
      }

      if (runImport) {
        runOutlookImport({
          importScript,
          importRunId: runId,
          outlookUser,
          accessToken,
          outlookFolder,
          importMaxItems,
          importChunkSize,
          importDisableRunBurstLimit: disableRunBurstLimit,
          loadEnvFileFlag,
          envFilePath,
          loadPortalEnvFileFlag,
          portalEnvFilePath,
          baseUrl,
          outlookTokenFile: tokenOutputPath,
          outlookAttachmentMode,
          outlookAttachmentMaxItemsPerMessage,
          outlookAttachmentMaxBytes,
          outlookAttachmentMaxTextChars,
          outlookAttachmentAllowMime,
          outlookAttachmentIncludeInline,
        });
      }
    })
    .catch((error) => {
      process.stderr.write(`outlook-device-auth failed: ${error instanceof Error ? error.message : String(error)}\n`);
      process.exit(1);
    });
}

main();
