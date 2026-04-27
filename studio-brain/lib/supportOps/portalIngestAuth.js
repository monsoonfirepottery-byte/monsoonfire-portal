"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.mintSupportIngestBearerFromPortal = mintSupportIngestBearerFromPortal;
const node_fs_1 = require("node:fs");
const node_os_1 = require("node:os");
const node_path_1 = require("node:path");
const STUDIO_BRAIN_ROOT = (0, node_path_1.resolve)(__dirname, "..", "..");
const REPO_ROOT = (0, node_path_1.resolve)(STUDIO_BRAIN_ROOT, "..");
function clean(value) {
    return String(value ?? "").trim();
}
function parseJsonObject(raw) {
    if (!raw.trim())
        return null;
    try {
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === "object" ? parsed : null;
    }
    catch {
        return null;
    }
}
function resolveConfiguredPath(configuredPath, baseDir) {
    const raw = clean(configuredPath);
    if (!raw)
        return "";
    return (0, node_path_1.isAbsolute)(raw) ? raw : (0, node_path_1.resolve)(baseDir, raw);
}
function hydrateEnvFromFile(filePath, env) {
    if (!filePath || !(0, node_fs_1.existsSync)(filePath))
        return;
    const text = (0, node_fs_1.readFileSync)(filePath, "utf8");
    for (const rawLine of text.split(/\r?\n/g)) {
        const line = rawLine.trim();
        if (!line || line.startsWith("#"))
            continue;
        const separator = line.indexOf("=");
        if (separator <= 0)
            continue;
        const key = line.slice(0, separator).trim();
        if (!key || clean(env[key]))
            continue;
        let value = line.slice(separator + 1).trim();
        if ((value.startsWith("\"") && value.endsWith("\""))
            || (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
        }
        env[key] = value;
    }
}
function resolvePortalEnvPath(configuredPath, env) {
    const explicit = resolveConfiguredPath(configuredPath, REPO_ROOT);
    const candidates = [
        explicit,
        resolveConfiguredPath(clean(env.PORTAL_AUTOMATION_ENV_PATH), REPO_ROOT),
        (0, node_path_1.resolve)(REPO_ROOT, "secrets", "portal", "portal-automation.env"),
        (0, node_path_1.resolve)((0, node_os_1.homedir)(), "secrets", "portal", "portal-automation.env"),
    ].filter(Boolean);
    return candidates.find((candidate) => (0, node_fs_1.existsSync)(candidate)) ?? explicit ?? "";
}
function resolvePortalCredentialsPath(configuredPath, env) {
    const explicit = resolveConfiguredPath(configuredPath, REPO_ROOT);
    const configuredFromEnv = resolveConfiguredPath(clean(env.PORTAL_AGENT_STAFF_CREDENTIALS), REPO_ROOT);
    const candidates = [
        explicit,
        configuredFromEnv,
        (0, node_path_1.resolve)(REPO_ROOT, "secrets", "portal", "portal-agent-staff.json"),
        (0, node_path_1.resolve)((0, node_os_1.homedir)(), "secrets", "portal", "portal-agent-staff.json"),
        (0, node_path_1.resolve)((0, node_os_1.homedir)(), ".ssh", "portal-agent-staff.json"),
    ].filter(Boolean);
    return candidates.find((candidate) => (0, node_fs_1.existsSync)(candidate)) ?? explicit ?? configuredFromEnv ?? "";
}
function normalizePortalCredentials(raw) {
    if (!raw)
        return null;
    const tokens = raw.tokens && typeof raw.tokens === "object"
        ? raw.tokens
        : undefined;
    return {
        email: clean(raw.email ?? raw.staffEmail),
        password: clean(raw.password ?? raw.staffPassword),
        refreshToken: clean(raw.refreshToken ?? tokens?.refresh_token),
        tokens,
    };
}
function loadPortalCredentials(filePath) {
    if (!filePath || !(0, node_fs_1.existsSync)(filePath))
        return null;
    const parsed = parseJsonObject((0, node_fs_1.readFileSync)(filePath, "utf8"));
    return normalizePortalCredentials(parsed);
}
function dedupeNonEmpty(values) {
    return [...new Set(values.map((value) => clean(value)).filter(Boolean))];
}
async function exchangeRefreshToken(apiKey, refreshToken) {
    if (!apiKey || !refreshToken)
        return null;
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
    if (!response.ok)
        return null;
    const payload = await response.json().catch(() => null);
    const idToken = clean(payload?.id_token);
    return idToken || null;
}
async function signInWithPassword(apiKey, email, password) {
    if (!apiKey || !email || !password)
        return null;
    const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(apiKey)}`, {
        method: "POST",
        headers: {
            "content-type": "application/json",
        },
        body: JSON.stringify({
            email,
            password,
            returnSecureToken: true,
        }),
    });
    if (!response.ok)
        return null;
    const payload = await response.json().catch(() => null);
    const idToken = clean(payload?.idToken);
    return idToken || null;
}
async function mintSupportIngestBearerFromPortal(options) {
    const mergedEnv = Object.fromEntries(Object.entries(options?.env ?? process.env).map(([key, value]) => [key, clean(value)]));
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
        if (idToken)
            return idToken;
    }
    const email = clean(mergedEnv.PORTAL_STAFF_EMAIL || credentials?.email);
    const password = clean(mergedEnv.PORTAL_STAFF_PASSWORD || credentials?.password);
    const passwordToken = await signInWithPassword(apiKey, email, password);
    if (passwordToken)
        return passwordToken;
    throw new Error("Support ingest auth could not mint a Firebase staff ID token from the portal automation credential sources.");
}
