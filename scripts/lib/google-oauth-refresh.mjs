import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";

export const GOOGLE_OAUTH_TOKEN_ENDPOINT = "https://www.googleapis.com/oauth2/v3/token";
export const FIREBASE_CLI_OAUTH_CLIENT_ID =
  "563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com";
export const FIREBASE_CLI_OAUTH_CLIENT_SECRET = String(
  process.env.FIREBASE_CLI_OAUTH_CLIENT_SECRET || ""
).trim();

const DEFAULT_GCLOUD_ADC_PATH = process.env.APPDATA
  ? resolve(process.env.APPDATA, "gcloud", "application_default_credentials.json")
  : resolve(homedir(), ".config", "gcloud", "application_default_credentials.json");

export function looksLikeRefreshToken(token) {
  return String(token || "").trim().startsWith("1//");
}

export async function loadGoogleAuthorizedUserCredentials({
  explicitPath = process.env.GOOGLE_APPLICATION_CREDENTIALS,
  readFileImpl = readFile,
} = {}) {
  const candidatePaths = [String(explicitPath || "").trim(), DEFAULT_GCLOUD_ADC_PATH].filter(Boolean);

  for (const configPath of candidatePaths) {
    try {
      const raw = await readFileImpl(configPath, "utf8");
      const parsed = JSON.parse(raw);
      const refreshToken = String(parsed?.refresh_token || "").trim();
      const clientId = String(parsed?.client_id || "").trim();
      const clientSecret = String(parsed?.client_secret || "").trim();
      if (
        String(parsed?.type || "").trim() === "authorized_user" &&
        refreshToken &&
        clientId &&
        clientSecret
      ) {
        return {
          configPath,
          refreshToken,
          clientId,
          clientSecret,
          source: "google-application-default-credentials",
        };
      }
    } catch {
      // Ignore missing or unreadable ADC candidates and keep searching.
    }
  }

  return null;
}

export async function exchangeRefreshToken(
  refreshToken,
  {
    source = "refresh-token",
    clientId = FIREBASE_CLI_OAUTH_CLIENT_ID,
    clientSecret = FIREBASE_CLI_OAUTH_CLIENT_SECRET,
    fetchImpl = fetch,
  } = {}
) {
  const form = new URLSearchParams({
    refresh_token: String(refreshToken || "").trim(),
    client_id: String(clientId || "").trim(),
    grant_type: "refresh_token",
  });
  if (String(clientSecret || "").trim()) {
    form.set("client_secret", String(clientSecret || "").trim());
  }

  const response = await fetchImpl(GOOGLE_OAUTH_TOKEN_ENDPOINT, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
    },
    body: form.toString(),
  });

  const text = await response.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = { raw: text.slice(0, 600) };
  }

  const expiresInSec =
    typeof parsed?.expires_in === "number"
      ? parsed.expires_in
      : typeof parsed?.expires_in === "string"
        ? Number.parseInt(parsed.expires_in, 10)
        : Number.NaN;

  if (!response.ok || typeof parsed?.access_token !== "string") {
    const details =
      typeof parsed?.error_description === "string"
        ? parsed.error_description
        : typeof parsed?.error === "string"
          ? parsed.error
          : typeof parsed?.message === "string"
            ? parsed.message
            : "token exchange failed";
    throw new Error(`Unable to exchange refresh token (${source}): ${details}`);
  }

  return {
    accessToken: String(parsed.access_token).trim(),
    expiresAtMs: Number.isFinite(expiresInSec) ? Date.now() + expiresInSec * 1000 : Number.NaN,
    source,
  };
}

export async function exchangeRefreshTokenWithCandidates(
  refreshToken,
  candidates,
  { fetchImpl = fetch } = {}
) {
  let lastError = null;
  for (const candidate of candidates) {
    try {
      const exchanged = await exchangeRefreshToken(refreshToken, {
        source: candidate.source,
        clientId: candidate.clientId,
        clientSecret: candidate.clientSecret,
        fetchImpl,
      });
      return {
        ...exchanged,
        source: candidate.resultSource || candidate.source,
      };
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error("token exchange failed");
}

export async function exchangePortalRulesRefreshToken(
  refreshToken,
  {
    source = "refresh-token",
    adcCredentials = null,
    adcResultSource = `${source}_adc_client`,
    fetchImpl = fetch,
  } = {}
) {
  const candidates = [
    {
      source,
      resultSource: source,
      clientId: FIREBASE_CLI_OAUTH_CLIENT_ID,
      clientSecret: FIREBASE_CLI_OAUTH_CLIENT_SECRET,
    },
  ];

  const adcClientId = String(adcCredentials?.clientId || "").trim();
  const adcClientSecret = String(adcCredentials?.clientSecret || "").trim();
  const isDistinctAdcClient =
    adcClientId &&
    (adcClientId !== FIREBASE_CLI_OAUTH_CLIENT_ID ||
      adcClientSecret !== FIREBASE_CLI_OAUTH_CLIENT_SECRET);

  if (isDistinctAdcClient) {
    candidates.push({
      source: `${source} (adc-client)`,
      resultSource: adcResultSource,
      clientId: adcClientId,
      clientSecret: adcClientSecret,
    });
  }

  return exchangeRefreshTokenWithCandidates(refreshToken, candidates, { fetchImpl });
}
