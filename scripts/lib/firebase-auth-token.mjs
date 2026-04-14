import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..", "..");
const HOME_ROOT = homedir();

function clean(value) {
  return String(value ?? "").trim();
}

function parseJsonSafely(raw) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(String(raw));
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function resolvePreferredSecretPath(...parts) {
  const homePath = resolve(HOME_ROOT, ...parts);
  if (existsSync(homePath)) return homePath;
  return resolve(REPO_ROOT, ...parts);
}

function resolveCredentialPath(filePath, { baseDir = HOME_ROOT } = {}) {
  const raw = clean(filePath);
  return raw ? resolve(baseDir, raw) : "";
}

function dedupeNonEmpty(values) {
  return Array.from(
    new Set(
      values
        .map((value) => clean(value))
        .filter(Boolean)
    )
  );
}

export function normalizeBearer(token) {
  const raw = clean(token);
  if (!raw) return "";
  return /^bearer\s+/i.test(raw) ? raw : `Bearer ${raw}`;
}

function normalizePortalAgentStaffCredentials(raw) {
  if (!raw || typeof raw !== "object") return null;
  return {
    email: clean(raw.email || raw.staffEmail),
    uid: clean(raw.uid),
    refreshToken: clean(raw.refreshToken || raw.tokens?.refresh_token),
    password: clean(raw.password || raw.staffPassword),
    tokens: raw.tokens && typeof raw.tokens === "object" ? raw.tokens : undefined,
    raw,
  };
}

export function resolvePortalAgentStaffCredentials({
  env = process.env,
  credentialsJson = "",
  credentialsPath = "",
  defaultCredentialsPath = resolvePreferredSecretPath("secrets", "portal", "portal-agent-staff.json"),
} = {}) {
  const inlinePayload = clean(credentialsJson || env.PORTAL_AGENT_STAFF_CREDENTIALS_JSON);
  if (inlinePayload) {
    const parsed = parseJsonSafely(inlinePayload);
    if (!parsed || typeof parsed !== "object") {
      throw new Error("PORTAL_AGENT_STAFF_CREDENTIALS_JSON is not valid JSON.");
    }
    return {
      ...normalizePortalAgentStaffCredentials(parsed),
      source: "env_json",
      path: "",
    };
  }

  const configuredPath = clean(credentialsPath || env.PORTAL_AGENT_STAFF_CREDENTIALS || defaultCredentialsPath);
  const resolvedPath = isAbsolute(configuredPath)
    ? configuredPath
    : resolveCredentialPath(configuredPath);
  if (!resolvedPath || !existsSync(resolvedPath)) {
    return null;
  }
  const parsed = parseJsonSafely(readFileSync(resolvedPath, "utf8"));
  if (!parsed || typeof parsed !== "object") {
    throw new Error(`Portal agent staff credential file is not valid JSON: ${resolvedPath}`);
  }
  return {
    ...normalizePortalAgentStaffCredentials(parsed),
    source: "file",
    path: resolvedPath,
  };
}

async function exchangeRefreshToken(apiKey, refreshToken) {
  const token = clean(refreshToken);
  if (!apiKey || !token) {
    return { ok: false, reason: "missing-refresh-token", token: "", refreshToken: "" };
  }
  try {
    const response = await fetch(`https://securetoken.googleapis.com/v1/token?key=${encodeURIComponent(apiKey)}`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: token,
      }),
    });
    if (!response.ok) {
      return {
        ok: false,
        reason: `securetoken-http-${response.status}`,
        token: "",
        refreshToken: "",
      };
    }
    const payload = await response.json().catch(() => null);
    const idToken = clean(payload?.id_token);
    if (!idToken) {
      return {
        ok: false,
        reason: "securetoken-missing-id-token",
        token: "",
        refreshToken: "",
      };
    }
    return {
      ok: true,
      reason: "",
      token: idToken,
      refreshToken: clean(payload?.refresh_token),
    };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : String(error),
      token: "",
      refreshToken: "",
    };
  }
}

async function signInWithPassword(apiKey, email, password) {
  if (!apiKey || !email || !password) {
    return { ok: false, reason: "missing-password-credentials", token: "", refreshToken: "" };
  }
  try {
    const response = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email,
          password,
          returnSecureToken: true,
        }),
      }
    );
    if (!response.ok) {
      return {
        ok: false,
        reason: `identitytoolkit-http-${response.status}`,
        token: "",
        refreshToken: "",
      };
    }
    const payload = await response.json().catch(() => null);
    const idToken = clean(payload?.idToken);
    if (!idToken) {
      return {
        ok: false,
        reason: "identitytoolkit-missing-id-token",
        token: "",
        refreshToken: "",
      };
    }
    return {
      ok: true,
      reason: "",
      token: idToken,
      refreshToken: clean(payload?.refreshToken),
    };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : String(error),
      token: "",
      refreshToken: "",
    };
  }
}

export async function mintStaffIdTokenFromPortalEnv({
  env = process.env,
  defaultCredentialsPath = resolvePreferredSecretPath("secrets", "portal", "portal-agent-staff.json"),
  preferRefreshToken = true,
} = {}) {
  const apiKey = clean(env.PORTAL_FIREBASE_API_KEY || env.FIREBASE_WEB_API_KEY);
  if (!apiKey) {
    return { ok: false, reason: "missing-portal-api-key", token: "", source: null };
  }

  const credentials = resolvePortalAgentStaffCredentials({ env, defaultCredentialsPath });
  const refreshCandidates = dedupeNonEmpty([
    env.PORTAL_STAFF_REFRESH_TOKEN,
    credentials?.refreshToken,
    credentials?.tokens?.refresh_token,
  ]);

  if (preferRefreshToken && refreshCandidates.length > 0) {
    for (const candidate of refreshCandidates) {
      const refreshed = await exchangeRefreshToken(apiKey, candidate);
      if (refreshed.ok && refreshed.token) {
        if (refreshed.refreshToken) {
          env.PORTAL_STAFF_REFRESH_TOKEN = refreshed.refreshToken;
        }
        return {
          ok: true,
          reason: "",
          token: refreshed.token,
          source: "refresh-token",
        };
      }
    }
  }

  const email = clean(env.PORTAL_STAFF_EMAIL || credentials?.email);
  const password = clean(env.PORTAL_STAFF_PASSWORD || credentials?.password);
  const minted = await signInWithPassword(apiKey, email, password);
  if (minted.ok && minted.token) {
    if (minted.refreshToken) {
      env.PORTAL_STAFF_REFRESH_TOKEN = minted.refreshToken;
    }
    return {
      ok: true,
      reason: "",
      token: minted.token,
      source: "password-signin",
    };
  }

  const reason = preferRefreshToken && refreshCandidates.length > 0 ? `refresh-token-and-password-failed:${minted.reason}` : minted.reason;
  return {
    ok: false,
    reason: reason || "missing-portal-credentials",
    token: "",
    source: null,
  };
}

