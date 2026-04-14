import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, resolve } from "node:path";

const STUDIO_BRAIN_ROOT = resolve(__dirname, "..", "..");
const REPO_ROOT = resolve(STUDIO_BRAIN_ROOT, "..");

type PortalAgentStaffCredentials = {
  email: string;
  password: string;
  refreshToken: string;
  tokens?: Record<string, unknown>;
};

function clean(value: unknown): string {
  return String(value ?? "").trim();
}

function parseJsonObject(raw: string): Record<string, unknown> | null {
  if (!raw.trim()) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function resolveConfiguredPath(configuredPath: string, baseDir: string): string {
  const raw = clean(configuredPath);
  if (!raw) return "";
  return isAbsolute(raw) ? raw : resolve(baseDir, raw);
}

function hydrateEnvFromFile(filePath: string, env: Record<string, string>): void {
  if (!filePath || !existsSync(filePath)) return;
  const text = readFileSync(filePath, "utf8");
  for (const rawLine of text.split(/\r?\n/g)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim();
    if (!key || clean(env[key])) continue;
    let value = line.slice(separator + 1).trim();
    if (
      (value.startsWith("\"") && value.endsWith("\""))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
}

function resolvePortalEnvPath(configuredPath: string, env: Record<string, string>): string {
  const explicit = resolveConfiguredPath(configuredPath, REPO_ROOT);
  const candidates = [
    explicit,
    resolveConfiguredPath(clean(env.PORTAL_AUTOMATION_ENV_PATH), REPO_ROOT),
    resolve(REPO_ROOT, "secrets", "portal", "portal-automation.env"),
    resolve(homedir(), "secrets", "portal", "portal-automation.env"),
  ].filter(Boolean);
  return candidates.find((candidate) => existsSync(candidate)) ?? explicit ?? "";
}

function resolvePortalCredentialsPath(configuredPath: string, env: Record<string, string>): string {
  const explicit = resolveConfiguredPath(configuredPath, REPO_ROOT);
  const configuredFromEnv = resolveConfiguredPath(clean(env.PORTAL_AGENT_STAFF_CREDENTIALS), REPO_ROOT);
  const candidates = [
    explicit,
    configuredFromEnv,
    resolve(REPO_ROOT, "secrets", "portal", "portal-agent-staff.json"),
    resolve(homedir(), "secrets", "portal", "portal-agent-staff.json"),
    resolve(homedir(), ".ssh", "portal-agent-staff.json"),
  ].filter(Boolean);
  return candidates.find((candidate) => existsSync(candidate)) ?? explicit ?? configuredFromEnv ?? "";
}

function normalizePortalCredentials(raw: Record<string, unknown> | null): PortalAgentStaffCredentials | null {
  if (!raw) return null;
  const tokens =
    raw.tokens && typeof raw.tokens === "object"
      ? (raw.tokens as Record<string, unknown>)
      : undefined;
  return {
    email: clean(raw.email ?? raw.staffEmail),
    password: clean(raw.password ?? raw.staffPassword),
    refreshToken: clean(raw.refreshToken ?? tokens?.refresh_token),
    tokens,
  };
}

function loadPortalCredentials(filePath: string): PortalAgentStaffCredentials | null {
  if (!filePath || !existsSync(filePath)) return null;
  const parsed = parseJsonObject(readFileSync(filePath, "utf8"));
  return normalizePortalCredentials(parsed);
}

function dedupeNonEmpty(values: string[]): string[] {
  return [...new Set(values.map((value) => clean(value)).filter(Boolean))];
}

async function exchangeRefreshToken(apiKey: string, refreshToken: string): Promise<string | null> {
  if (!apiKey || !refreshToken) return null;
  const response = await fetch(`https://securetoken.googleapis.com/v1/token?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });
  if (!response.ok) return null;
  const payload = await response.json().catch(() => null);
  const idToken = clean(payload?.id_token);
  return idToken || null;
}

async function signInWithPassword(apiKey: string, email: string, password: string): Promise<string | null> {
  if (!apiKey || !email || !password) return null;
  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        email,
        password,
        returnSecureToken: true,
      }),
    }
  );
  if (!response.ok) return null;
  const payload = await response.json().catch(() => null);
  const idToken = clean(payload?.idToken);
  return idToken || null;
}

export async function mintSupportIngestBearerFromPortal(options?: {
  env?: NodeJS.ProcessEnv;
  portalEnvPath?: string;
  portalCredentialsPath?: string;
}): Promise<string> {
  const mergedEnv = Object.fromEntries(
    Object.entries(options?.env ?? process.env).map(([key, value]) => [key, clean(value)])
  );

  const portalEnvPath = resolvePortalEnvPath(options?.portalEnvPath ?? "", mergedEnv);
  hydrateEnvFromFile(portalEnvPath, mergedEnv);

  const apiKey = clean(mergedEnv.PORTAL_FIREBASE_API_KEY || mergedEnv.FIREBASE_WEB_API_KEY);
  if (!apiKey) {
    throw new Error("Support ingest auth requires PORTAL_FIREBASE_API_KEY or FIREBASE_WEB_API_KEY.");
  }

  const credentialsPath = resolvePortalCredentialsPath(options?.portalCredentialsPath ?? "", mergedEnv);
  const credentials = loadPortalCredentials(credentialsPath);
  const refreshCandidates = dedupeNonEmpty([
    mergedEnv.PORTAL_STAFF_REFRESH_TOKEN,
    credentials?.refreshToken ?? "",
    clean(credentials?.tokens?.refresh_token),
  ]);

  for (const refreshToken of refreshCandidates) {
    const idToken = await exchangeRefreshToken(apiKey, refreshToken);
    if (idToken) return idToken;
  }

  const email = clean(mergedEnv.PORTAL_STAFF_EMAIL || credentials?.email);
  const password = clean(mergedEnv.PORTAL_STAFF_PASSWORD || credentials?.password);
  const passwordToken = await signInWithPassword(apiKey, email, password);
  if (passwordToken) return passwordToken;

  throw new Error(
    "Support ingest auth could not mint a Firebase staff ID token from the portal automation credential sources."
  );
}
