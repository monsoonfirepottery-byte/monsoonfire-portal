import { readFileSync, existsSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { mintStaffIdTokenFromPortalEnv } from "../scripts/lib/firebase-auth-token.mjs";
import {
  buildStartupContextSearchPayload,
  buildLocalBootstrapContext,
  buildThreadBootstrapQuery,
  compactionSettingsFromEnv,
  filterExpiredRows,
  parseRolloutEntries,
  rankBootstrapRows,
  readThreadHistoryLines,
  readThreadName,
  resolveStartupBootstrapPolicy,
  resolveCodexThreadContext,
  writeBootstrapArtifacts,
} from "../scripts/lib/codex-session-memory-utils.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const studioBrainMcpEnvPath = resolve(repoRoot, "secrets", "studio-brain", "studio-brain-mcp.env");
const studioBrainAutomationEnvPath = resolve(repoRoot, "secrets", "studio-brain", "studio-brain-automation.env");
const defaultPortalEnvPath = resolve(repoRoot, "secrets", "portal", "portal-automation.env");
const repoPortalCredentialsPath = resolve(repoRoot, "secrets", "portal", "portal-agent-staff.json");
const homePortalCredentialsPath = resolve(homedir(), ".ssh", "portal-agent-staff.json");

function clean(value) {
  return String(value ?? "").trim();
}

function normalizeBearer(value) {
  const token = clean(value);
  if (!token) return "";
  return /^bearer\s+/i.test(token) ? token : `Bearer ${token}`;
}

function resolveFromRepoRoot(candidate, fallbackRelativePath = "") {
  const raw = clean(candidate || fallbackRelativePath);
  return raw ? resolve(repoRoot, raw) : "";
}

function parseEnvFile(raw) {
  const result = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const equalsIndex = trimmed.indexOf("=");
    if (equalsIndex <= 0) continue;
    const key = trimmed.slice(0, equalsIndex).trim();
    let value = trimmed.slice(equalsIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

function loadOptionalEnvFile(path) {
  return path && existsSync(path) ? parseEnvFile(readFileSync(path, "utf8")) : {};
}

function buildEmptyBootstrapContext({ threadInfo, query, diagnostics } = {}) {
  return {
    schema: "codex-startup-bootstrap-context.v1",
    createdAt: new Date().toISOString(),
    threadId: clean(threadInfo?.threadId),
    query: clean(query),
    summary: "",
    items: [],
    diagnostics: diagnostics && typeof diagnostics === "object" ? diagnostics : {},
  };
}

function resolvePortalEnvPath(env) {
  return resolveFromRepoRoot(env.PORTAL_AUTOMATION_ENV_PATH, defaultPortalEnvPath);
}

function resolvePortalCredentialsPath(env) {
  const explicitPath = resolveFromRepoRoot(env.PORTAL_AGENT_STAFF_CREDENTIALS);
  const candidates = [explicitPath, repoPortalCredentialsPath, homePortalCredentialsPath].filter(Boolean);
  return candidates.find((candidate) => existsSync(candidate)) || "";
}

function hasPortalAuthInputs(env) {
  return Boolean(
    clean(env.PORTAL_FIREBASE_API_KEY || env.FIREBASE_WEB_API_KEY) ||
      clean(env.PORTAL_STAFF_EMAIL) ||
      clean(env.PORTAL_STAFF_PASSWORD) ||
      clean(env.PORTAL_STAFF_REFRESH_TOKEN) ||
      clean(env.PORTAL_AGENT_STAFF_CREDENTIALS_JSON) ||
      clean(env.PORTAL_AGENT_STAFF_CREDENTIALS)
  );
}

async function hydrateStartupAuth(env) {
  if (clean(env.STUDIO_BRAIN_MCP_ID_TOKEN || env.STUDIO_BRAIN_ID_TOKEN)) {
    return;
  }

  const credentialsPath = resolvePortalCredentialsPath(env);
  if (credentialsPath && !clean(env.PORTAL_AGENT_STAFF_CREDENTIALS)) {
    env.PORTAL_AGENT_STAFF_CREDENTIALS = credentialsPath;
  }

  if (!hasPortalAuthInputs(env)) {
    return;
  }

  const minted = await mintStaffIdTokenFromPortalEnv({
    env,
    defaultCredentialsPath: credentialsPath || repoPortalCredentialsPath,
    preferRefreshToken: true,
  });

  if (minted.ok && minted.token) {
    env.STUDIO_BRAIN_MCP_ID_TOKEN = minted.token;
    process.stderr.write(
      `[studio-brain-mcp] Minted Studio Brain MCP auth token at startup via ${minted.source || "portal-auth"}.\n`
    );
    return;
  }

  process.stderr.write(
    `[studio-brain-mcp] Warning: startup auth token mint failed (${minted.reason || "unknown-reason"}).\n`
  );
}

function extractContextEnvelope(payload) {
  const root = payload && typeof payload === "object" ? payload : {};
  const context =
    root.context && typeof root.context === "object"
      ? root.context
      : root.payload && typeof root.payload === "object"
        ? root.payload
        : root;
  const items = Array.isArray(context.items)
    ? context.items
    : Array.isArray(root.items)
      ? root.items
      : [];
  const summary = clean(context.summary || root.summary || "");
  const diagnostics =
    context.diagnostics && typeof context.diagnostics === "object"
      ? context.diagnostics
      : root.diagnostics && typeof root.diagnostics === "object"
        ? root.diagnostics
        : {};
  return { context, items, summary, diagnostics };
}

async function requestRemoteBootstrapContext({ env, query, threadInfo, timeoutMs, strictStartupAllowlist = true }) {
  const headers = {
    "content-type": "application/json",
    accept: "application/json",
  };
  const authHeader = normalizeBearer(env.STUDIO_BRAIN_MCP_ID_TOKEN || env.STUDIO_BRAIN_ID_TOKEN || "");
  if (authHeader) headers.authorization = authHeader;
  const adminToken = clean(env.STUDIO_BRAIN_MCP_ADMIN_TOKEN || env.STUDIO_BRAIN_ADMIN_TOKEN || "");
  if (adminToken) headers["x-studio-brain-admin-token"] = adminToken;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(new URL("/api/memory/context", env.STUDIO_BRAIN_MCP_BASE_URL), {
      method: "POST",
      headers,
      signal: controller.signal,
      body: JSON.stringify(buildStartupContextSearchPayload({ query, strictStartupAllowlist })),
    });
    const raw = await response.text();
    const payload = raw ? JSON.parse(raw) : {};
    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        error: clean(payload?.message || payload?.error?.message || raw || `HTTP ${response.status}`),
      };
    }

    const { items, summary, diagnostics } = extractContextEnvelope(payload);
    const rankedItems = rankBootstrapRows(filterExpiredRows(items), threadInfo).slice(0, 10);
    return {
      ok: rankedItems.length > 0,
      status: response.status,
      context: {
        schema: "codex-startup-bootstrap-context.v1",
        createdAt: new Date().toISOString(),
        threadId: clean(threadInfo?.threadId),
        query,
        summary: summary || rankedItems.map((row) => clean(row?.content).slice(0, 120)).filter(Boolean).slice(0, 4).join(" | "),
        items: rankedItems,
        diagnostics: {
          ...(diagnostics && typeof diagnostics === "object" ? diagnostics : {}),
          startupSourceBias: strictStartupAllowlist ? "preferred-startup-sources" : "startup-ranking-only",
          strictStartupAllowlist,
          fallbackUsed: false,
          fallbackStrategy: null,
        },
      },
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timer);
  }
}

async function bootstrapThreadContext(env) {
  const settings = compactionSettingsFromEnv(env);
  const policy = resolveStartupBootstrapPolicy(settings);
  const resolvedThread = resolveCodexThreadContext({
    threadId: env.CODEX_THREAD_ID,
    cwd: env.PWD || env.INIT_CWD || process.cwd(),
  });
  if (!resolvedThread) {
    return null;
  }

  const threadName = readThreadName(resolvedThread.threadId);
  const historyLines = readThreadHistoryLines(resolvedThread.threadId, { limit: 5 });
  const query = buildThreadBootstrapQuery({
    threadInfo: resolvedThread,
    threadName,
    historyLines,
  });
  const remote = policy.remoteEnabled
    ? await requestRemoteBootstrapContext({
        env,
        query,
        threadInfo: resolvedThread,
        timeoutMs: settings.bootstrapTimeoutMs,
        strictStartupAllowlist: policy.strictStartupAllowlist,
      })
    : {
        ok: false,
        status: 0,
        skipped: true,
        error: "",
      };

  let contextPayload = remote.ok ? remote.context : null;
  let satisfiedBy = remote.ok ? "studio-brain" : policy.remoteEnabled ? "studio-brain-unmet" : "bootstrap-disabled";
  if (
    policy.localFallbackEnabled &&
    (!contextPayload || !Array.isArray(contextPayload.items) || contextPayload.items.length === 0)
  ) {
    const rolloutEntries = parseRolloutEntries(resolvedThread.rolloutPath);
    contextPayload = buildLocalBootstrapContext({
      threadInfo: resolvedThread,
      threadName,
      historyLines,
      rolloutEntries,
      maxItems: 10,
      maxChars: 8000,
      strictStartupAllowlist: policy.strictStartupAllowlist,
    });
    satisfiedBy = policy.remoteEnabled ? "local-fallback" : "local-only";
  }
  if (!contextPayload || !Array.isArray(contextPayload.items) || contextPayload.items.length === 0) {
    contextPayload = buildEmptyBootstrapContext({
      threadInfo: resolvedThread,
      query,
      diagnostics: {
        startupSourceBias: policy.remoteEnabled
          ? policy.strictStartupAllowlist
            ? "preferred-startup-sources"
            : "startup-ranking-only"
          : "bootstrap-disabled",
        strictStartupAllowlist: policy.strictStartupAllowlist,
        fallbackUsed: false,
        fallbackStrategy: null,
        itemCount: 0,
      },
    });
    satisfiedBy = policy.remoteEnabled ? "unmet" : "disabled";
  }

  const paths = writeBootstrapArtifacts({
    threadId: resolvedThread.threadId,
    contextPayload,
    metadata: {
      schema: "codex-startup-bootstrap-metadata.v1",
      createdAt: new Date().toISOString(),
      threadId: resolvedThread.threadId,
      rolloutPath: resolvedThread.rolloutPath,
      cwd: resolvedThread.cwd,
      threadTitle: threadName || resolvedThread.title,
      firstUserMessage: resolvedThread.firstUserMessage,
      query,
      itemCount: Array.isArray(contextPayload?.items) ? contextPayload.items.length : 0,
      startupGateSatisfiedBy: satisfiedBy,
      startupGateMode: policy.bootstrapMode,
      startupGateFailureMode: policy.bootstrapFailureMode,
      remoteError: remote.ok || remote.skipped ? "" : clean(remote.error),
    },
  });

  return {
    threadInfo: resolvedThread,
    query,
    paths,
    satisfiedBy,
  };
}

const studioFileEnv = {
  ...loadOptionalEnvFile(studioBrainMcpEnvPath),
  ...loadOptionalEnvFile(studioBrainAutomationEnvPath),
};
const fileEnv = {
  ...studioFileEnv,
  ...loadOptionalEnvFile(resolvePortalEnvPath({ ...process.env, ...studioFileEnv })),
};
const mergedEnv = {
  ...process.env,
  ...fileEnv,
};

if (!clean(mergedEnv.STUDIO_BRAIN_MCP_BASE_URL) && clean(mergedEnv.STUDIO_BRAIN_BASE_URL)) {
  mergedEnv.STUDIO_BRAIN_MCP_BASE_URL = clean(mergedEnv.STUDIO_BRAIN_BASE_URL);
}
if (!clean(mergedEnv.STUDIO_BRAIN_MCP_ADMIN_TOKEN) && clean(mergedEnv.STUDIO_BRAIN_ADMIN_TOKEN)) {
  mergedEnv.STUDIO_BRAIN_MCP_ADMIN_TOKEN = clean(mergedEnv.STUDIO_BRAIN_ADMIN_TOKEN);
}
if (!clean(mergedEnv.STUDIO_BRAIN_MCP_ID_TOKEN) && clean(mergedEnv.STUDIO_BRAIN_ID_TOKEN)) {
  mergedEnv.STUDIO_BRAIN_MCP_ID_TOKEN = clean(mergedEnv.STUDIO_BRAIN_ID_TOKEN);
}
if (!clean(mergedEnv.STUDIO_BRAIN_MCP_BASE_URL)) {
  mergedEnv.STUDIO_BRAIN_MCP_BASE_URL = "http://192.168.1.226:8787";
}
if (!clean(mergedEnv.STUDIO_BRAIN_BOOTSTRAP_MODE)) {
  mergedEnv.STUDIO_BRAIN_BOOTSTRAP_MODE = "hard";
}
if (!clean(mergedEnv.STUDIO_BRAIN_BOOTSTRAP_TIMEOUT_MS)) {
  mergedEnv.STUDIO_BRAIN_BOOTSTRAP_TIMEOUT_MS = "8000";
}
if (!clean(mergedEnv.STUDIO_BRAIN_BOOTSTRAP_FAILURE_MODE)) {
  mergedEnv.STUDIO_BRAIN_BOOTSTRAP_FAILURE_MODE = "local-fallback";
}
if (!clean(mergedEnv.STUDIO_BRAIN_COMPACTION_WINDOW_BEFORE)) {
  mergedEnv.STUDIO_BRAIN_COMPACTION_WINDOW_BEFORE = "40";
}
if (!clean(mergedEnv.STUDIO_BRAIN_COMPACTION_WINDOW_AFTER)) {
  mergedEnv.STUDIO_BRAIN_COMPACTION_WINDOW_AFTER = "12";
}
if (!clean(mergedEnv.STUDIO_BRAIN_COMPACTION_CAPTURE_TOOL_OUTPUT)) {
  mergedEnv.STUDIO_BRAIN_COMPACTION_CAPTURE_TOOL_OUTPUT = "all";
}
if (!clean(mergedEnv.STUDIO_BRAIN_RAW_TTL_DAYS)) {
  mergedEnv.STUDIO_BRAIN_RAW_TTL_DAYS = "90";
}
if (!clean(mergedEnv.PORTAL_AUTOMATION_ENV_PATH)) {
  const portalEnvPath = resolvePortalEnvPath(mergedEnv);
  if (portalEnvPath && existsSync(portalEnvPath)) {
    mergedEnv.PORTAL_AUTOMATION_ENV_PATH = portalEnvPath;
  }
}
if (!clean(mergedEnv.PORTAL_AGENT_STAFF_CREDENTIALS)) {
  const credentialsPath = resolvePortalCredentialsPath(mergedEnv);
  if (credentialsPath) {
    mergedEnv.PORTAL_AGENT_STAFF_CREDENTIALS = credentialsPath;
  }
}

await hydrateStartupAuth(mergedEnv);
if (!clean(mergedEnv.STUDIO_BRAIN_ID_TOKEN) && clean(mergedEnv.STUDIO_BRAIN_MCP_ID_TOKEN)) {
  mergedEnv.STUDIO_BRAIN_ID_TOKEN = clean(mergedEnv.STUDIO_BRAIN_MCP_ID_TOKEN);
}
if (!clean(mergedEnv.STUDIO_BRAIN_AUTH_TOKEN) && clean(mergedEnv.STUDIO_BRAIN_ID_TOKEN)) {
  mergedEnv.STUDIO_BRAIN_AUTH_TOKEN = clean(mergedEnv.STUDIO_BRAIN_ID_TOKEN);
}
if (!clean(mergedEnv.STUDIO_BRAIN_ADMIN_TOKEN) && clean(mergedEnv.STUDIO_BRAIN_MCP_ADMIN_TOKEN)) {
  mergedEnv.STUDIO_BRAIN_ADMIN_TOKEN = clean(mergedEnv.STUDIO_BRAIN_MCP_ADMIN_TOKEN);
}

function ensureDependenciesInstalled() {
  const sdkPath = resolve(__dirname, "node_modules", "@modelcontextprotocol", "sdk");
  if (existsSync(sdkPath)) return;

  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
  const installArgs = existsSync(resolve(__dirname, "package-lock.json"))
    ? ["ci", "--no-audit", "--no-fund"]
    : ["install", "--no-audit", "--no-fund"];

  process.stderr.write("[studio-brain-mcp] Installing local dependencies before launch.\n");
  const result = spawnSync(npmCommand, installArgs, {
    cwd: __dirname,
    env: mergedEnv,
    stdio: "inherit",
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

ensureDependenciesInstalled();

const bootstrapState = await bootstrapThreadContext(mergedEnv).catch((error) => {
  process.stderr.write(
    `[studio-brain-mcp] Warning: thread bootstrap failed (${error instanceof Error ? error.message : String(error)}).\n`
  );
  return null;
});

if (bootstrapState?.paths) {
  mergedEnv.STUDIO_BRAIN_BOOTSTRAP_CONTEXT_PATH = bootstrapState.paths.bootstrapContextJsonPath;
  mergedEnv.STUDIO_BRAIN_BOOTSTRAP_MARKDOWN_PATH = bootstrapState.paths.bootstrapContextMarkdownPath;
  mergedEnv.STUDIO_BRAIN_BOOTSTRAP_METADATA_PATH = bootstrapState.paths.bootstrapMetadataPath;
  mergedEnv.STUDIO_BRAIN_BOOTSTRAP_THREAD_ID = bootstrapState.threadInfo.threadId;
  mergedEnv.STUDIO_BRAIN_BOOTSTRAP_QUERY = bootstrapState.query;
  mergedEnv.STUDIO_BRAIN_BOOTSTRAP_SATISFIED_BY = bootstrapState.satisfiedBy;
}

const child = spawn(process.execPath, [resolve(__dirname, "server.mjs")], {
  cwd: __dirname,
  env: mergedEnv,
  stdio: "inherit",
});

let companion = null;
if (bootstrapState?.threadInfo?.rolloutPath) {
  companion = spawn(
    process.execPath,
    [
      resolve(repoRoot, "scripts", "codex", "session-memory-companion.mjs"),
      "--thread-id",
      bootstrapState.threadInfo.threadId,
      "--rollout-path",
      bootstrapState.threadInfo.rolloutPath,
      "--cwd",
      bootstrapState.threadInfo.cwd || process.cwd(),
      "--startup-context-path",
      bootstrapState.paths.bootstrapContextJsonPath,
      "--parent-pid",
      String(process.pid),
    ],
    {
      cwd: repoRoot,
      env: mergedEnv,
      stdio: "ignore",
    }
  );
  companion.unref();
}

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});

