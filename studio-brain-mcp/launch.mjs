import { readFileSync, existsSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { mintStaffIdTokenFromPortalEnv } from "../scripts/lib/firebase-auth-token.mjs";
import {
  STARTUP_REASON_CODES,
  classifyStartupReason,
  inspectTokenFreshness,
  startupRecoveryStep,
} from "../scripts/lib/codex-startup-reliability.mjs";
import {
  buildStartupContextSearchPayload,
  buildThreadBootstrapQuery,
  compactionSettingsFromEnv,
  filterExpiredRows,
  normalizeContinuityEnvelope,
  normalizeHandoffArtifact,
  normalizeStartupBlocker,
  resolveBootstrapContinuityState,
  loadBootstrapArtifacts,
  parseRolloutEntries,
  rankBootstrapRows,
  readThreadHistoryLines,
  readThreadName,
  resolveStartupBootstrapPolicy,
  runtimePathsForThread,
  writeBootstrapArtifacts,
  writeContinuityEnvelope,
  writeStartupBlocker,
} from "../scripts/lib/codex-session-memory-utils.mjs";
import {
  attachMachineToolProfileContext,
  shouldAttachMachineToolProfile,
  syncMachineToolProfile,
} from "../scripts/lib/codex-machine-tool-profile.mjs";
import { studioBrainRequestJson } from "../scripts/lib/studio-brain-memory-write.mjs";
import { stableHash } from "../scripts/lib/pst-memory-utils.mjs";
import { resolveBootstrapThreadInfo } from "./thread-context.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const studioBrainMcpEnvPath = resolve(repoRoot, "secrets", "studio-brain", "studio-brain-mcp.env");
const studioBrainAutomationEnvPath = resolve(repoRoot, "secrets", "studio-brain", "studio-brain-automation.env");
const homeStudioBrainMcpEnvPath = resolve(homedir(), "secrets", "studio-brain", "studio-brain-mcp.env");
const homeStudioBrainAutomationEnvPath = resolve(homedir(), "secrets", "studio-brain", "studio-brain-automation.env");
const defaultPortalEnvPath = resolve(repoRoot, "secrets", "portal", "portal-automation.env");
const homePortalEnvPath = resolve(homedir(), "secrets", "portal", "portal-automation.env");
const repoPortalCredentialsPath = resolve(repoRoot, "secrets", "portal", "portal-agent-staff.json");
const homePortalSecretCredentialsPath = resolve(homedir(), "secrets", "portal", "portal-agent-staff.json");
const homePortalCredentialsPath = resolve(homedir(), ".ssh", "portal-agent-staff.json");

function clean(value) {
  return String(value ?? "").trim();
}

function normalizeBearer(value) {
  const token = clean(value);
  if (!token) return "";
  return /^bearer\s+/i.test(token) ? token : `Bearer ${token}`;
}

function resolveStudioBrainAuthHeader(env) {
  return normalizeBearer(
    env.STUDIO_BRAIN_MCP_AUTH_HEADER ||
      env.STUDIO_BRAIN_MCP_ID_TOKEN ||
      env.STUDIO_BRAIN_ID_TOKEN ||
      env.STUDIO_BRAIN_AUTH_TOKEN ||
      ""
  );
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

function summarizeText(value, maxChars = 220) {
  return clean(value).replace(/\s+/g, " ").slice(0, maxChars);
}

function summarizeRows(rows, maxItems = 4, maxChars = 480) {
  return (Array.isArray(rows) ? rows : [])
    .slice(0, Math.max(1, maxItems))
    .map((row, index) => `${index + 1}. [${clean(row?.source || row?.metadata?.source || "memory")}] ${summarizeText(row?.content || row?.summary || "", 140)}`)
    .filter(Boolean)
    .join("\n")
    .slice(0, maxChars);
}

function resolveGitState(cwd) {
  const normalizedCwd = clean(cwd);
  if (!normalizedCwd) {
    return {
      state: "unavailable",
      summary: "No cwd available for git inspection.",
      branch: "",
      detached: false,
      dirty: false,
      dirtyCount: 0,
    };
  }

  const result = spawnSync("git", ["-C", normalizedCwd, "status", "--porcelain", "--branch"], {
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.status !== 0) {
    return {
      state: "not-a-repo",
      summary: `No git worktree resolved for ${normalizedCwd}.`,
      branch: "",
      detached: false,
      dirty: false,
      dirtyCount: 0,
      error: clean(result.stderr || result.stdout),
    };
  }

  const lines = String(result.stdout || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const branchLine = lines[0] || "";
  const statusLines = lines.slice(1);
  const detached = /^(##\s+HEAD\b|##\s+\(HEAD detached)/i.test(branchLine);
  const branchMatch = /^##\s+([^.\s]+)/.exec(branchLine);
  const branch = detached ? "HEAD" : clean(branchMatch?.[1]);
  const dirtyCount = statusLines.length;
  return {
    state: "ready",
    summary: dirtyCount > 0 ? `${branch || "HEAD"} has ${dirtyCount} local change(s).` : `${branch || "HEAD"} is clean.`,
    branch,
    detached,
    dirty: dirtyCount > 0,
    dirtyCount,
  };
}

function synthesizeContextFromHandoff({ handoff, continuityEnvelope, threadInfo, query }) {
  const normalizedHandoff = normalizeHandoffArtifact(handoff, { threadId: clean(threadInfo?.threadId) });
  const normalizedEnvelope = normalizeContinuityEnvelope(continuityEnvelope, { threadId: clean(threadInfo?.threadId) });
  const summary = summarizeText(
    normalizedHandoff.summary
      || normalizedHandoff.workCompleted
      || normalizedEnvelope.lastHandoffSummary
      || normalizedEnvelope.currentGoal
      || normalizedHandoff.activeGoal
      || normalizedHandoff.nextRecommendedAction
      || normalizedEnvelope.nextRecommendedAction
      || "",
    600
  );
  if (!summary) return null;
  return {
    schema: "codex-startup-bootstrap-context.v1",
    createdAt: new Date().toISOString(),
    threadId: clean(threadInfo?.threadId),
    query: clean(query),
    summary,
    items: [
      {
        id: `handoff-${stableHash(`${clean(threadInfo?.threadId)}|${summary}`, 24)}`,
        source: "codex-handoff",
        score: 0.96,
        content: summary,
        matchedBy: ["trusted-envelope"],
        metadata: {
          ...normalizedEnvelope,
          ...normalizedHandoff,
          threadId: clean(threadInfo?.threadId),
          cwd: clean(threadInfo?.cwd),
        },
      },
    ],
    diagnostics: {
      startupSourceBias: "preferred-startup-sources",
      strictStartupAllowlist: true,
      fallbackUsed: true,
      fallbackStrategy: "validated-local-continuity",
      bootstrapContextLoaded: true,
    },
  };
}

function resolveValidatedPriorScaffold(threadInfo, query, prior = loadBootstrapArtifacts(threadInfo?.threadId || "")) {
  const contextItems = Array.isArray(prior.context?.items) ? prior.context.items : [];
  if (contextItems.length > 0) {
    return {
      ok: true,
      prior,
      satisfiedBy: "validated-local-continuity",
      context: {
        ...(prior.context && typeof prior.context === "object" ? prior.context : {}),
        query: clean(query) || clean(prior.context?.query),
        diagnostics: {
          ...(prior.context?.diagnostics && typeof prior.context.diagnostics === "object"
            ? prior.context.diagnostics
            : {}),
          bootstrapContextLoaded: true,
          fallbackUsed: true,
          fallbackStrategy: "validated-local-continuity",
        },
      },
    };
  }

  const synthesized = synthesizeContextFromHandoff({
    handoff: prior.handoff,
    continuityEnvelope: prior.continuityEnvelope,
    threadInfo,
    query,
  });
  if (!synthesized) {
    return { ok: false, prior };
  }
  return {
    ok: true,
    prior,
    satisfiedBy: "validated-local-continuity",
    context: synthesized,
  };
}

function classifyStartupBlocker({ remote, threadInfo, query, gitState, localDiagnosticsAvailable, tokenFreshness }) {
  const remoteError = clean(remote?.error);
  const reason = classifyStartupReason({
    attempted: Boolean(remote && !remote?.skipped),
    reason: remoteError ? "context-request-failed" : "empty-context",
    error: remoteError,
    status: Number(remote?.status || 0),
    itemCount: 0,
    tokenFreshness,
  });
  const unblockStep = startupRecoveryStep(reason);
  return {
    schema: "codex-startup-blocker.v1",
    createdAt: new Date().toISOString(),
    status: "blocked",
    failureClass: reason,
    threadId: clean(threadInfo?.threadId),
    cwd: clean(threadInfo?.cwd),
    query: clean(query),
    queryFingerprint: stableHash(clean(query), 24),
    firstSignal: remoteError || "No trusted continuity scaffold is available for this thread.",
    remoteError,
    unblockStep,
    localDiagnosticsAvailable: Boolean(localDiagnosticsAvailable),
    git: gitState,
  };
}

function extractSignalRows(rows, matcher, limit = 3) {
  return (Array.isArray(rows) ? rows : [])
    .filter((row) => matcher(String(row?.source || ""), row?.metadata && typeof row.metadata === "object" ? row.metadata : {}, String(row?.content || "")))
    .slice(0, limit)
    .map((row) => ({
      source: clean(row?.source || row?.metadata?.source),
      summary: summarizeText(row?.content || row?.summary || "", 180),
    }))
    .filter((row) => row.summary);
}

function buildContinuityEnvelope({ threadInfo, query, contextPayload, metadata, blocker, satisfiedBy, continuityState, gitState, priorArtifacts }) {
  const items = Array.isArray(contextPayload?.items) ? contextPayload.items : [];
  const handoffItem = items.find((row) => clean(row?.source) === "codex-handoff");
  const handoffSummary =
    summarizeText(
      handoffItem?.content
        || priorArtifacts?.handoff?.summary
        || priorArtifacts?.handoff?.workCompleted
        || priorArtifacts?.continuityEnvelope?.lastHandoffSummary
        || "",
      320
    );
  const frustrationSignals = extractSignalRows(
    items,
    (source, metadataValue, content) =>
      source === "codex-friction-feedback-loop" ||
      Array.isArray(metadataValue?.tags) && metadataValue.tags.some((tag) => /friction|frustration/i.test(String(tag))) ||
      /friction|frustrat/i.test(content),
  );
  const ratholeSignals = extractSignalRows(
    items,
    (source, metadataValue, content) =>
      /rathole/i.test(source) ||
      Array.isArray(metadataValue?.tags) && metadataValue.tags.some((tag) => /rathole/i.test(String(tag))) ||
      /rathole/i.test(content),
  );
  const blockers = blocker?.status === "blocked"
    ? [{ reason: blocker.failureClass, summary: blocker.firstSignal, unblockStep: blocker.unblockStep }]
    : [];
  const currentGoal =
    summarizeText(
      clean(threadInfo?.firstUserMessage) ||
        clean(threadInfo?.title) ||
        summarizeText(contextPayload?.summary || handoffSummary, 280),
      280
    );
  const nextRecommendedAction =
    continuityState === "blocked"
      ? blocker.unblockStep
      : summarizeText(priorArtifacts?.handoff?.nextRecommendedAction || "Use studio_brain_startup_context as the first continuity lookup for this thread.", 220);
  return {
    schema: "codex-continuity-envelope.v1",
    createdAt: new Date().toISOString(),
    threadId: clean(threadInfo?.threadId),
    cwd: clean(threadInfo?.cwd),
    rolloutPath: clean(threadInfo?.rolloutPath),
    threadTitle: clean(metadata?.threadTitle || threadInfo?.title),
    firstUserMessage: clean(threadInfo?.firstUserMessage),
    query: clean(query),
    continuityState,
    startupSatisfiedBy: clean(satisfiedBy),
    startup: {
      satisfiedBy: clean(satisfiedBy),
      continuityState,
      continuityAvailable: continuityState === "ready",
      remoteError: clean(metadata?.remoteError),
    },
    currentGoal,
    lastHandoffSummary: handoffSummary,
    blockers,
    git: gitState,
    frustrationSignals,
    ratholeSignals,
    nextRecommendedAction,
    trustedSources: [...new Set(items.map((row) => clean(row?.source || row?.metadata?.source)).filter(Boolean))].slice(0, 12),
    bootstrapSummary: summarizeText(contextPayload?.summary || summarizeRows(items), 600),
    artifactPointers: {
      bootstrapContextPath: clean(process.env.STUDIO_BRAIN_BOOTSTRAP_CONTEXT_PATH),
      bootstrapMetadataPath: clean(process.env.STUDIO_BRAIN_BOOTSTRAP_METADATA_PATH),
      priorHandoffPath: clean(priorArtifacts?.paths?.handoffPath),
    },
  };
}

function resolvePortalEnvPath(env) {
  const explicit = resolveFromRepoRoot(env.PORTAL_AUTOMATION_ENV_PATH);
  const candidates = [explicit, defaultPortalEnvPath, homePortalEnvPath].filter(Boolean);
  return candidates.find((candidate) => existsSync(candidate)) || explicit || defaultPortalEnvPath;
}

function resolvePortalCredentialsPath(env) {
  const explicitPath = resolveFromRepoRoot(env.PORTAL_AGENT_STAFF_CREDENTIALS);
  const candidates = [explicitPath, repoPortalCredentialsPath, homePortalSecretCredentialsPath, homePortalCredentialsPath].filter(Boolean);
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

function extractPayloadRows(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];
  if (Array.isArray(payload.rows)) return payload.rows;
  if (Array.isArray(payload.results)) return payload.results;
  if (Array.isArray(payload.items)) return payload.items;
  return [];
}

async function requestRemoteBootstrapSearch({
  env,
  query,
  threadInfo,
  timeoutMs,
  strictStartupAllowlist = true,
}) {
  const headers = {
    "content-type": "application/json",
    accept: "application/json",
  };
  const authHeader = resolveStudioBrainAuthHeader(env);
  if (authHeader) headers.authorization = authHeader;
  const adminToken = clean(env.STUDIO_BRAIN_MCP_ADMIN_TOKEN || env.STUDIO_BRAIN_ADMIN_TOKEN || "");
  if (adminToken) headers["x-studio-brain-admin-token"] = adminToken;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(new URL("/api/memory/search", env.STUDIO_BRAIN_MCP_BASE_URL), {
      method: "POST",
      headers,
      signal: controller.signal,
      body: JSON.stringify({
        query,
        limit: 24,
        sourceAllowlist: strictStartupAllowlist ? preferredStartupSources() : undefined,
        sourceDenylist: [],
      }),
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

    const rankedItems = rankBootstrapRows(filterExpiredRows(extractPayloadRows(payload)), threadInfo).slice(0, 10);
    const rankedSummary =
      summarizeRows(rankedItems, 4, 480) ||
      rankedItems.map((row) => clean(row?.content).slice(0, 120)).filter(Boolean).slice(0, 4).join(" | ");
    return {
      ok: rankedItems.length > 0,
      status: response.status,
      context: {
        schema: "codex-startup-bootstrap-context.v1",
        createdAt: new Date().toISOString(),
        threadId: clean(threadInfo?.threadId),
        query,
        summary: rankedSummary || clean(payload?.summary),
        items: rankedItems,
        diagnostics: {
          ...(payload?.diagnostics && typeof payload.diagnostics === "object" ? payload.diagnostics : {}),
          startupSourceBias: strictStartupAllowlist ? "preferred-startup-sources" : "startup-ranking-only",
          strictStartupAllowlist,
          startupSelectionStrategy: "search-first",
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

async function requestRemoteBootstrapContext({ env, query, threadInfo, timeoutMs, strictStartupAllowlist = true }) {
  const search = await requestRemoteBootstrapSearch({
    env,
    query,
    threadInfo,
    timeoutMs,
    strictStartupAllowlist,
  });
  if (search.ok) return search;

  const headers = {
    "content-type": "application/json",
    accept: "application/json",
  };
  const authHeader = resolveStudioBrainAuthHeader(env);
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
    const rankedSummary =
      summarizeRows(rankedItems, 4, 480) ||
      rankedItems.map((row) => clean(row?.content).slice(0, 120)).filter(Boolean).slice(0, 4).join(" | ");
    return {
      ok: rankedItems.length > 0,
      status: response.status,
      context: {
        schema: "codex-startup-bootstrap-context.v1",
        createdAt: new Date().toISOString(),
        threadId: clean(threadInfo?.threadId),
        query,
        summary: rankedSummary || summary,
        items: rankedItems,
        diagnostics: {
          ...(diagnostics && typeof diagnostics === "object" ? diagnostics : {}),
          startupSourceBias: strictStartupAllowlist ? "preferred-startup-sources" : "startup-ranking-only",
          strictStartupAllowlist,
          startupSelectionStrategy: "context-fallback",
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
  const resolvedThread = resolveBootstrapThreadInfo({
    env,
    fallbackCwd: process.cwd(),
  });
  if (resolvedThread.resolution === "fallback") {
    process.stderr.write(
      `[studio-brain-mcp] Warning: thread context not found in Codex state DB; using fallback bootstrap context for ${resolvedThread.threadId} (${resolvedThread.cwd}).\n`
    );
  }

  const threadName = readThreadName(resolvedThread.threadId);
  const historyLines = readThreadHistoryLines(resolvedThread.threadId, { limit: 5 });
  const query = buildThreadBootstrapQuery({
    threadInfo: resolvedThread,
    threadName,
    historyLines,
  });
  const toolProfileSync = await syncMachineToolProfile({
    env,
    shell: env.SHELL || env.ComSpec || env.COMSPEC || "powershell",
    threadSnapshotPath: runtimePathsForThread(resolvedThread.threadId).toolProfileSnapshotPath,
    requestJson: studioBrainRequestJson,
    baseUrl: env.STUDIO_BRAIN_MCP_BASE_URL,
    timeoutMs: Math.min(settings.bootstrapTimeoutMs, 4_000),
  });
  toolProfileSync.remoteWritePromise?.catch((error) => {
    process.stderr.write(
      `[studio-brain-mcp] Warning: tool profile refresh failed (${error instanceof Error ? error.message : String(error)}).\n`
    );
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
  const tokenFreshness = inspectTokenFreshness(
    env.STUDIO_BRAIN_MCP_ID_TOKEN || env.STUDIO_BRAIN_ID_TOKEN || env.STUDIO_BRAIN_AUTH_TOKEN || ""
  );

  const priorArtifacts = loadBootstrapArtifacts(resolvedThread.threadId);
  let contextPayload = remote.ok ? remote.context : null;
  let satisfiedBy = remote.ok ? "studio-brain" : policy.remoteEnabled ? "studio-brain-unmet" : "bootstrap-disabled";
  let blocker = null;
  const continuityDecision = resolveBootstrapContinuityState({
    remoteContextAvailable: Boolean(contextPayload && Array.isArray(contextPayload.items) && contextPayload.items.length > 0),
    startupBlocker: priorArtifacts.startupBlocker,
    continuityEnvelope: priorArtifacts.continuityEnvelope,
    handoff: priorArtifacts.handoff,
    query,
  });
  const priorScaffold = continuityDecision.continuityState === "ready" && (!contextPayload || !Array.isArray(contextPayload.items) || contextPayload.items.length === 0)
    ? resolveValidatedPriorScaffold(resolvedThread, query, priorArtifacts)
    : { ok: false, prior: priorArtifacts };
  if (!contextPayload || !Array.isArray(contextPayload.items) || contextPayload.items.length === 0) {
    if (continuityDecision.blockerActive) {
      blocker = normalizeStartupBlocker(priorArtifacts.startupBlocker, {
        threadId: resolvedThread.threadId,
        cwd: resolvedThread.cwd,
      });
      contextPayload = buildEmptyBootstrapContext({
        threadInfo: resolvedThread,
        query,
        diagnostics: {
          startupSourceBias: "preferred-startup-sources",
          strictStartupAllowlist: policy.strictStartupAllowlist,
          fallbackUsed: true,
          fallbackStrategy: "startup-blocker",
          itemCount: 0,
          continuityState: "blocked",
          continuityAvailable: false,
          continuityReason: blocker.failureClass,
          continuityReasonCode: blocker.failureClass,
        },
      });
      satisfiedBy = "blocked";
    } else if (priorScaffold.ok) {
      contextPayload = priorScaffold.context;
      satisfiedBy = priorScaffold.satisfiedBy;
    } else if (clean(remote.error)) {
      const rolloutEntries = parseRolloutEntries(resolvedThread.rolloutPath);
      const gitState = resolveGitState(resolvedThread.cwd);
      blocker = classifyStartupBlocker({
        remote,
        threadInfo: resolvedThread,
        query,
        gitState,
        localDiagnosticsAvailable: rolloutEntries.length > 0 || historyLines.length > 0,
        tokenFreshness,
      });
      contextPayload = buildEmptyBootstrapContext({
        threadInfo: resolvedThread,
        query,
        diagnostics: {
          startupSourceBias: "preferred-startup-sources",
          strictStartupAllowlist: policy.strictStartupAllowlist,
          fallbackUsed: false,
          fallbackStrategy: null,
          itemCount: 0,
          continuityState: "blocked",
          continuityAvailable: false,
          continuityReason: blocker.failureClass,
          continuityReasonCode: blocker.failureClass,
        },
      });
      satisfiedBy = "blocked";
    } else {
      contextPayload = buildEmptyBootstrapContext({
        threadInfo: resolvedThread,
        query,
        diagnostics: {
          startupSourceBias: "preferred-startup-sources",
          strictStartupAllowlist: policy.strictStartupAllowlist,
          fallbackUsed: false,
          fallbackStrategy: null,
          itemCount: 0,
          continuityState: "missing",
          continuityAvailable: false,
          continuityReason: "empty_context",
          continuityReasonCode: "empty_context",
        },
      });
      satisfiedBy = "missing";
    }
  }
  const continuityStateForToolProfile =
    blocker?.status === "blocked"
      ? "blocked"
      : Array.isArray(contextPayload?.items) && contextPayload.items.length > 0
        ? "ready"
        : "missing";
  contextPayload = attachMachineToolProfileContext(contextPayload, toolProfileSync.profile, {
    include: shouldAttachMachineToolProfile({
      threadInfo: resolvedThread,
      continuityState: continuityStateForToolProfile,
    }),
  });

  const gitState = resolveGitState(resolvedThread.cwd);
  const metadata = {
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
    remoteReasonCode:
      remote.ok || remote.skipped
        ? STARTUP_REASON_CODES.OK
        : classifyStartupReason({
            attempted: true,
            reason: "context-request-failed",
            error: remote.error,
            status: remote.status,
            itemCount: 0,
            tokenFreshness,
          }),
    toolProfileFingerprint: clean(toolProfileSync.profile?.toolFingerprint),
    toolProfileIncluded: shouldAttachMachineToolProfile({
      threadInfo: resolvedThread,
      continuityState: continuityStateForToolProfile,
    }),
  };
  const paths = writeBootstrapArtifacts({
    threadId: resolvedThread.threadId,
    contextPayload,
    metadata,
  });
  const continuityEnvelope = buildContinuityEnvelope({
    threadInfo: resolvedThread,
    query,
    contextPayload,
    metadata,
    blocker,
    satisfiedBy,
    continuityState: continuityStateForToolProfile,
    gitState,
    priorArtifacts,
  });
  writeContinuityEnvelope(resolvedThread.threadId, continuityEnvelope);
  writeStartupBlocker(
    resolvedThread.threadId,
    blocker || {
      schema: "codex-startup-blocker.v1",
      createdAt: new Date().toISOString(),
      status: "clear",
      threadId: resolvedThread.threadId,
      cwd: resolvedThread.cwd,
      query,
      queryFingerprint: stableHash(clean(query), 24),
      firstSignal: "",
      remoteError: "",
      git: gitState,
    }
  );

  return {
    threadInfo: resolvedThread,
    query,
    paths,
    satisfiedBy,
    ready: continuityStateForToolProfile === "ready",
    blocker,
    continuityEnvelope,
  };
}

const studioFileEnv = {
  ...loadOptionalEnvFile(homeStudioBrainMcpEnvPath),
  ...loadOptionalEnvFile(homeStudioBrainAutomationEnvPath),
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
if (!clean(mergedEnv.STUDIO_BRAIN_MCP_AUTH_HEADER)) {
  mergedEnv.STUDIO_BRAIN_MCP_AUTH_HEADER = resolveStudioBrainAuthHeader(mergedEnv);
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
  mergedEnv.STUDIO_BRAIN_BOOTSTRAP_FAILURE_MODE = "none";
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
const normalizedAuthHeader = resolveStudioBrainAuthHeader(mergedEnv);
if (normalizedAuthHeader) {
  mergedEnv.STUDIO_BRAIN_MCP_AUTH_HEADER = normalizedAuthHeader;
}
if (!clean(mergedEnv.STUDIO_BRAIN_ID_TOKEN) && clean(mergedEnv.STUDIO_BRAIN_MCP_ID_TOKEN)) {
  mergedEnv.STUDIO_BRAIN_ID_TOKEN = clean(mergedEnv.STUDIO_BRAIN_MCP_ID_TOKEN);
}
if (!clean(mergedEnv.STUDIO_BRAIN_AUTH_TOKEN) && clean(mergedEnv.STUDIO_BRAIN_ID_TOKEN)) {
  mergedEnv.STUDIO_BRAIN_AUTH_TOKEN = clean(mergedEnv.STUDIO_BRAIN_ID_TOKEN);
}
if (!clean(mergedEnv.STUDIO_BRAIN_AUTH_TOKEN) && clean(mergedEnv.STUDIO_BRAIN_MCP_AUTH_HEADER)) {
  mergedEnv.STUDIO_BRAIN_AUTH_TOKEN = clean(mergedEnv.STUDIO_BRAIN_MCP_AUTH_HEADER);
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
  mergedEnv.STUDIO_BRAIN_CONTINUITY_ENVELOPE_PATH = bootstrapState.paths.continuityEnvelopePath;
  mergedEnv.STUDIO_BRAIN_STARTUP_BLOCKER_PATH = bootstrapState.paths.startupBlockerPath;
  mergedEnv.STUDIO_BRAIN_HANDOFF_PATH = bootstrapState.paths.handoffPath;
  mergedEnv.STUDIO_BRAIN_BOOTSTRAP_THREAD_ID = bootstrapState.threadInfo.threadId;
  mergedEnv.STUDIO_BRAIN_BOOTSTRAP_QUERY = bootstrapState.query;
  mergedEnv.STUDIO_BRAIN_BOOTSTRAP_SATISFIED_BY = bootstrapState.satisfiedBy;
  mergedEnv.STUDIO_BRAIN_BOOTSTRAP_READY = bootstrapState.ready ? "1" : "0";
  mergedEnv.STUDIO_BRAIN_STARTUP_CONTEXT_PREFER_LOCAL = "1";
  if (!bootstrapState.ready && bootstrapState.blocker) {
    process.stderr.write(
      `[studio-brain-mcp] Continuity blocked for thread ${bootstrapState.threadInfo.threadId} (${bootstrapState.blocker.failureClass}): ${bootstrapState.blocker.firstSignal}\n`
    );
  }
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
