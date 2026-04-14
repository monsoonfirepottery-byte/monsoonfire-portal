import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  refreshLocalBootstrapArtifacts,
  codexHomePath,
  loadBootstrapArtifacts,
  normalizeContinuityEnvelope,
  normalizeHandoffArtifact,
  resolveCodexThreadContext,
  runtimePathsForThread,
  writeContinuityEnvelope,
  writeHandoffArtifact,
} from "./codex-session-memory-utils.mjs";
import { mintStaffIdTokenFromPortalEnv, normalizeBearer } from "./firebase-auth-token.mjs";
import { classifyDevelopmentScope, inferProjectLane } from "./hybrid-memory-utils.mjs";
import { appendJsonl, readJson, readJsonl, stableHash } from "./pst-memory-utils.mjs";
import { resolveStudioBrainBaseUrlFromEnv } from "../studio-brain-url-resolution.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..", "..");
const DEFAULT_TIMEOUT_MS = 10_000;
const AUTH_REFRESH_MIN_INTERVAL_MS = 10_000;
const DEFAULT_REPO_CREDENTIALS_PATH = resolve(REPO_ROOT, "secrets", "portal", "portal-agent-staff.json");
const DEFAULT_HOME_SECRETS_CREDENTIALS_PATH = resolve(homedir(), "secrets", "portal", "portal-agent-staff.json");
const DEFAULT_HOME_CREDENTIALS_PATH = resolve(homedir(), ".ssh", "portal-agent-staff.json");
const REMEMBER_SOURCE_MAP = {
  fact: { source: "manual", status: "accepted", memoryType: "semantic" },
  preference: { source: "manual", status: "accepted", memoryType: "semantic" },
  decision: { source: "codex", status: "accepted", memoryType: "episodic" },
  progress: { source: "codex", status: "accepted", memoryType: "episodic" },
  blocker: { source: "codex-handoff", status: "accepted", memoryType: "episodic" },
  handoff: { source: "codex-handoff", status: "accepted", memoryType: "episodic" },
  checkpoint: { source: "codex-handoff", status: "accepted", memoryType: "episodic" },
};
const REMEMBER_KINDS = new Set(Object.keys(REMEMBER_SOURCE_MAP));
const STARTUP_CONTINUITY_KINDS = new Set(["decision", "progress", "blocker", "handoff", "checkpoint"]);

function clean(value) {
  return String(value ?? "").trim();
}

function dedupeStrings(values, limit = 64) {
  const out = [];
  const seen = new Set();
  for (const value of values || []) {
    const normalized = clean(value);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
    if (out.length >= limit) break;
  }
  return out;
}

function clip(value, max = 280) {
  const normalized = clean(value).replace(/\s+/g, " ");
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, Math.max(1, max - 1)).trimEnd()}…`;
}

function coerceImportance(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return undefined;
  return Math.max(0, Math.min(1, parsed));
}

function normalizeKind(value) {
  const normalized = clean(value).toLowerCase();
  if (!REMEMBER_KINDS.has(normalized)) {
    throw new Error(
      `Unsupported remember kind: ${value}. Expected one of ${Array.from(REMEMBER_KINDS).join(", ")}.`
    );
  }
  return normalized;
}

function shouldRejectSpeculative(content, metadata) {
  const confidence = Number(metadata?.confidence ?? metadata?.sourceConfidence);
  if (metadata?.speculative === true || metadata?.weakInference === true) {
    return true;
  }
  if (Number.isFinite(confidence) && confidence < 0.5) {
    return true;
  }
  return /^(maybe|probably|i think|might|could be)\b/i.test(clean(content));
}

function isStartupContinuityWrite(write) {
  return STARTUP_CONTINUITY_KINDS.has(clean(write?.kind).toLowerCase()) || write?.rememberForStartup === true;
}

function countStartupContinuityAuditRows(rows = []) {
  return (Array.isArray(rows) ? rows : []).filter(
    (row) => STARTUP_CONTINUITY_KINDS.has(clean(row?.kind).toLowerCase()) || row?.rememberedForStartup === true
  ).length;
}

function inferThreadPresentationProjectLane(threadContext) {
  return inferProjectLane({
    text: `${clean(threadContext?.firstUserMessage)}\n${clean(threadContext?.threadTitle)}`,
    title: clean(threadContext?.threadTitle),
    path: clean(threadContext?.cwd),
  });
}

function bootstrapThreadScopedItemCount(artifacts = {}) {
  return Math.max(
    0,
    Math.round(
      Number(
        artifacts?.continuityEnvelope?.threadScopedItemCount ||
          artifacts?.continuityEnvelope?.startup?.threadScopedItemCount ||
          0
      )
    )
  );
}

function resolveDefaultCredentialsPath(env = process.env) {
  const explicitPath = clean(env.PORTAL_AGENT_STAFF_CREDENTIALS);
  const candidates = [
    explicitPath,
    DEFAULT_REPO_CREDENTIALS_PATH,
    DEFAULT_HOME_SECRETS_CREDENTIALS_PATH,
    DEFAULT_HOME_CREDENTIALS_PATH,
  ].filter(Boolean);
  return candidates.find((candidate) => existsSync(candidate)) || DEFAULT_REPO_CREDENTIALS_PATH;
}

function getErrorMessage(payload) {
  if (typeof payload?.message === "string" && payload.message.trim()) {
    return payload.message.trim();
  }
  if (typeof payload?.error?.message === "string" && payload.error.message.trim()) {
    return payload.error.message.trim();
  }
  if (typeof payload?.raw === "string" && payload.raw.trim()) {
    return payload.raw.trim();
  }
  return "";
}

function shouldRefreshAuthorization(status, payload) {
  if (status !== 401 && status !== 403) return false;
  const message = getErrorMessage(payload);
  return /missing authorization header|invalid authorization|id-token-expired|auth\/id-token-expired|token.*expired/i.test(
    message
  );
}

export async function studioBrainRequestJson({
  method,
  path,
  body,
  env = process.env,
  baseUrl,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}) {
  let authorizationHeader = normalizeBearer(env.STUDIO_BRAIN_MCP_ID_TOKEN || env.STUDIO_BRAIN_ID_TOKEN || "");
  let lastRefreshAtMs = 0;
  const adminToken = clean(env.STUDIO_BRAIN_MCP_ADMIN_TOKEN || env.STUDIO_BRAIN_ADMIN_TOKEN);
  const resolvedBaseUrl = clean(baseUrl) || resolveStudioBrainBaseUrlFromEnv({ env });

  async function mintAuthorizationHeader() {
    const minted = await mintStaffIdTokenFromPortalEnv({
      env,
      defaultCredentialsPath: resolveDefaultCredentialsPath(env),
      preferRefreshToken: true,
    });
    if (!minted.ok || !minted.token) return "";
    env.STUDIO_BRAIN_MCP_ID_TOKEN = minted.token;
    return normalizeBearer(minted.token);
  }

  async function requestOnce() {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(new URL(path, resolvedBaseUrl), {
        method,
        headers: {
          "content-type": "application/json",
          accept: "application/json",
          ...(authorizationHeader ? { authorization: authorizationHeader } : {}),
          ...(adminToken ? { "x-studio-brain-admin-token": adminToken } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
      const raw = await response.text();
      let payload;
      try {
        payload = raw ? JSON.parse(raw) : null;
      } catch {
        payload = { raw };
      }
      return { ok: response.ok, status: response.status, payload };
    } finally {
      clearTimeout(timer);
    }
  }

  let result = await requestOnce();
  if (!result.ok && shouldRefreshAuthorization(result.status, result.payload)) {
    const now = Date.now();
    if (now - lastRefreshAtMs > AUTH_REFRESH_MIN_INTERVAL_MS) {
      lastRefreshAtMs = now;
      const refreshed = await mintAuthorizationHeader().catch(() => "");
      if (refreshed) {
        authorizationHeader = refreshed;
        result = await requestOnce();
      }
    }
  }

  if (!result.ok) {
    const message = getErrorMessage(result.payload) || `Studio Brain returned HTTP ${result.status}`;
    throw new Error(message);
  }
  return result.payload;
}

function resolveThreadContext({
  env = process.env,
  threadId = "",
  cwd = process.cwd(),
  threadTitle = "",
  firstUserMessage = "",
} = {}) {
  const initialThreadId = clean(threadId || env.STUDIO_BRAIN_BOOTSTRAP_THREAD_ID || env.CODEX_THREAD_ID);
  const initialCwd = clean(cwd || process.cwd());
  const resolved = resolveCodexThreadContext({
    threadId: initialThreadId,
    cwd: initialCwd,
    stateDbPath: codexHomePath("state_5.sqlite"),
  });
  const resolvedThreadId = clean(initialThreadId || resolved?.threadId);
  const artifacts = loadBootstrapArtifacts(resolvedThreadId);
  const metadata = artifacts.metadata && typeof artifacts.metadata === "object" ? artifacts.metadata : {};
  return {
    threadId: resolvedThreadId,
    cwd: clean(initialCwd || resolved?.cwd || metadata.cwd || process.cwd()),
    threadTitle: clean(threadTitle || resolved?.title || metadata.threadTitle),
    firstUserMessage: clean(firstUserMessage || resolved?.firstUserMessage || metadata.firstUserMessage),
    bootstrapArtifacts: artifacts,
  };
}

function resolveScopeClass({ requestedScopeClass, threadContext, content, subjectKey }) {
  const explicit = clean(requestedScopeClass).toLowerCase();
  if (explicit === "personal" || explicit === "work") return explicit;
  const cwd = clean(threadContext.cwd);
  const normalizedCwd = cwd.toLowerCase();
  const homeRoot = homedir().toLowerCase();
  if (normalizedCwd.includes("monsoonfire-portal")) return "work";
  const scope = classifyDevelopmentScope({
    text: `${subjectKey}\n${threadContext.firstUserMessage}\n${content}`,
    title: threadContext.threadTitle,
    path: cwd,
  });
  if (scope.isDevelopment) return "work";
  if (normalizedCwd === homeRoot || normalizedCwd.startsWith(`${homeRoot}\\`) || normalizedCwd.startsWith(`${homeRoot}/`)) {
    return "personal";
  }
  return scope.isPersonal ? "personal" : "work";
}

function resolveProjectLane({ threadContext, content, subjectKey }) {
  return inferProjectLane({
    text: `${threadContext.firstUserMessage}\n${subjectKey}\n${content}`,
    title: threadContext.threadTitle,
    path: threadContext.cwd,
  });
}

function resolveTurnId({ env = process.env, metadata = {} } = {}) {
  return clean(
    metadata.turnId ||
      env.CODEX_TURN_ID ||
      env.CODEX_TOOL_TURN_ID ||
      env.STUDIO_BRAIN_TURN_ID ||
      "turn-unknown"
  );
}

function buildRequestId({ threadId, turnId, kind, content, index }) {
  return `remember-${stableHash(`${threadId}|${turnId}|${kind}|${index}|${stableHash(content, 24)}`, 24)}`;
}

function inferProfileClass({ kind, scopeClass, subjectKey, content, metadata = {} }) {
  if (!["fact", "preference"].includes(kind) || scopeClass !== "personal") {
    return "";
  }
  const explicit = clean(metadata.profileClass);
  if (explicit) return explicit;
  const haystack = `${subjectKey}\n${content}`.toLowerCase();
  if (/\b(birthday|bday|born|date of birth)\b/.test(haystack)) return "birthday";
  if (/\b(mom|mother|dad|father|wife|husband|partner|spouse|kid|child|children|family)\b/.test(haystack)) {
    return "family";
  }
  if (/\b(home|house|apartment|rent|mortgage|address|housing|live in)\b/.test(haystack)) {
    return "housing";
  }
  if (kind === "preference" || /\b(prefer|favorite|favourite|like to|dislike|hate|love)\b/.test(haystack)) {
    return "preference";
  }
  if (/\b(name|identity|pronouns|i am|my name)\b/.test(haystack)) return "identity";
  return "personal";
}

function normalizeRememberInput(input = {}) {
  const common = {
    kind: clean(input.kind),
    subjectKey: clean(input.subjectKey),
    scopeClass: clean(input.scopeClass),
    tags: dedupeStrings(input.tags, 32),
    metadata: input.metadata && typeof input.metadata === "object" && !Array.isArray(input.metadata) ? input.metadata : {},
    rememberForStartup: input.rememberForStartup === true,
    importance: coerceImportance(input.importance),
    occurredAt: clean(input.occurredAt),
  };

  if (Array.isArray(input.items) && input.items.length > 0) {
    return input.items.map((row, index) => {
      const item = row && typeof row === "object" ? row : {};
      return {
        index,
        kind: clean(item.kind || common.kind),
        content: clean(item.content),
        subjectKey: clean(item.subjectKey || common.subjectKey),
        scopeClass: clean(item.scopeClass || common.scopeClass),
        tags: dedupeStrings([...(common.tags || []), ...(Array.isArray(item.tags) ? item.tags : [])], 32),
        metadata:
          item.metadata && typeof item.metadata === "object" && !Array.isArray(item.metadata)
            ? { ...common.metadata, ...item.metadata }
            : { ...common.metadata },
        rememberForStartup:
          item.rememberForStartup === true || (item.rememberForStartup === undefined && common.rememberForStartup),
        importance: coerceImportance(item.importance ?? common.importance),
        occurredAt: clean(item.occurredAt || common.occurredAt),
      };
    });
  }

  return [
    {
      index: 0,
      kind: clean(common.kind),
      content: clean(input.content),
      subjectKey: clean(common.subjectKey),
      scopeClass: clean(common.scopeClass),
      tags: common.tags,
      metadata: common.metadata,
      rememberForStartup: common.rememberForStartup,
      importance: common.importance,
      occurredAt: common.occurredAt,
    },
  ];
}

function buildRememberRows(rawInput, { env = process.env, threadContext, capturedFrom = "codex-desktop-thread" } = {}) {
  const turnId = resolveTurnId({ env, metadata: rawInput?.metadata });
  return normalizeRememberInput(rawInput).map((item) => {
    if (!item.content) {
      throw new Error("studio_brain_remember requires content for every saved memory.");
    }
    const kind = normalizeKind(item.kind);
    if (shouldRejectSpeculative(item.content, item.metadata)) {
      throw new Error("studio_brain_remember rejects speculative or weakly inferred memories.");
    }
    const config = REMEMBER_SOURCE_MAP[kind];
    const subjectKey = clean(item.subjectKey || item.metadata?.subjectKey || item.metadata?.subject);
    const scopeClass = resolveScopeClass({
      requestedScopeClass: item.scopeClass,
      threadContext,
      content: item.content,
      subjectKey,
    });
    const profileClass = inferProfileClass({
      kind,
      scopeClass,
      subjectKey,
      content: item.content,
      metadata: item.metadata,
    });
    const projectLane = resolveProjectLane({
      threadContext,
      content: item.content,
      subjectKey,
    });
    const clientRequestId = buildRequestId({
      threadId: clean(threadContext.threadId || threadContext.cwd || "thread-unknown"),
      turnId,
      kind,
      content: item.content,
      index: item.index,
    });
    const startupEligible =
      item.metadata?.startupEligible === true ||
      item.rememberForStartup === true ||
      ["decision", "progress", "blocker", "handoff", "checkpoint"].includes(kind) ||
      Boolean(profileClass);
    const metadata = {
      ...item.metadata,
      threadId: clean(threadContext.threadId),
      cwd: clean(threadContext.cwd),
      threadTitle: clean(threadContext.threadTitle),
      firstUserMessage: clean(threadContext.firstUserMessage),
      capturedFrom: clean(item.metadata?.capturedFrom || capturedFrom),
      projectLane,
      scopeClass,
      subjectKey: subjectKey || undefined,
      profileClass: profileClass || undefined,
      startupEligible,
      rememberForStartup: item.rememberForStartup === true,
      rememberKind: kind,
      threadEvidence: clean(item.metadata?.threadEvidence) || (clean(threadContext.threadId) ? "explicit" : "none"),
      clientRequestId,
    };
    const runId = clean(item.metadata?.runId || item.metadata?.startupRunId || threadContext.bootstrapArtifacts?.continuityEnvelope?.runId);
    const agentId = clean(item.metadata?.agentId || threadContext.bootstrapArtifacts?.continuityEnvelope?.agentId);
    return {
      index: item.index,
      kind,
      content: item.content,
      subjectKey,
      scopeClass,
      projectLane,
      rememberForStartup: item.rememberForStartup === true,
      clientRequestId,
      request: {
        content: item.content,
        source: config.source,
        status: config.status,
        memoryType: config.memoryType,
        tags: dedupeStrings(item.tags, 32),
        metadata,
        clientRequestId,
        importance: item.importance,
        occurredAt: item.occurredAt || undefined,
        ...(runId ? { runId } : {}),
        ...(agentId ? { agentId } : {}),
      },
    };
  });
}

function buildHandoffArtifact(row, threadContext) {
  const metadata = row.request.metadata && typeof row.request.metadata === "object" ? row.request.metadata : {};
  const paths = runtimePathsForThread(clean(threadContext.threadId));
  const blockers = Array.isArray(metadata.blockers)
    ? metadata.blockers
    : clean(metadata.blocker)
      ? [{ summary: clean(metadata.blocker) }]
      : [];
  return normalizeHandoffArtifact({
    createdAt: new Date().toISOString(),
    threadId: clean(threadContext.threadId),
    runId: clean(metadata.runId || metadata.startupRunId || threadContext.bootstrapArtifacts?.continuityEnvelope?.runId),
    agentId: clean(metadata.agentId || threadContext.bootstrapArtifacts?.continuityEnvelope?.agentId || "agent:codex-desktop"),
    startupProvenance:
      metadata.startupProvenance && typeof metadata.startupProvenance === "object"
        ? metadata.startupProvenance
        : {
            satisfiedBy: clean(
              threadContext.bootstrapArtifacts?.metadata?.startupGateSatisfiedBy ||
                threadContext.bootstrapArtifacts?.continuityEnvelope?.startup?.satisfiedBy
            ),
            continuityEnvelopePath: clean(threadContext.bootstrapArtifacts?.paths?.continuityEnvelopePath),
            bootstrapContextPath: clean(threadContext.bootstrapArtifacts?.paths?.bootstrapContextJsonPath),
            bootstrapMetadataPath: clean(threadContext.bootstrapArtifacts?.paths?.bootstrapMetadataPath),
          },
    completionStatus: clean(metadata.completionStatus || metadata.status || "complete"),
    activeGoal: clean(metadata.activeGoal || row.subjectKey || threadContext.firstUserMessage || threadContext.threadTitle),
    summary: clean(row.content),
    workCompleted: clean(metadata.workCompleted || row.content),
    blockers,
    nextRecommendedAction: clean(metadata.nextRecommendedAction),
    artifactPointers: {
      ...(metadata.artifactPointers && typeof metadata.artifactPointers === "object" ? metadata.artifactPointers : {}),
      continuityEnvelopePath: clean(paths.continuityEnvelopePath),
      bootstrapContextPath: clean(paths.bootstrapContextJsonPath),
      bootstrapMetadataPath: clean(paths.bootstrapMetadataPath),
      handoffPath: clean(paths.handoffPath),
      startupContextCachePath: clean(paths.startupContextCachePath),
      writesJsonlPath: clean(paths.writesJsonlPath),
    },
    parentRunId: clean(metadata.parentRunId || threadContext.bootstrapArtifacts?.handoff?.parentRunId),
    handoffOwner: clean(metadata.handoffOwner || metadata.owner || threadContext.bootstrapArtifacts?.handoff?.handoffOwner),
    sourceShellId: clean(metadata.sourceShellId || threadContext.bootstrapArtifacts?.handoff?.sourceShellId),
    targetShellId: clean(metadata.targetShellId || threadContext.bootstrapArtifacts?.handoff?.targetShellId),
    resumeHints: Array.isArray(metadata.resumeHints) ? metadata.resumeHints : [],
  }, {
    threadId: clean(threadContext.threadId),
    existing: threadContext.bootstrapArtifacts?.handoff,
  });
}

function handoffCandidatePriority(write) {
  if (!write || typeof write !== "object") return 99;
  if (write.kind === "handoff") return 0;
  if (write.kind === "checkpoint") return 1;
  if (write.kind === "progress") return 2;
  if (write.kind === "decision") return 3;
  return 99;
}

function isStartupHandoffCandidate(write) {
  if (!write || typeof write !== "object") return false;
  if (write.kind === "handoff") return true;
  if (!["checkpoint", "progress", "decision"].includes(write.kind)) return false;
  return write.rememberForStartup === true || write.request?.metadata?.startupEligible === true;
}

function selectBestHandoffCandidate(successfulWrites) {
  return (Array.isArray(successfulWrites) ? successfulWrites : [])
    .filter((write) => isStartupHandoffCandidate(write))
    .sort((left, right) => {
      const priorityDelta = handoffCandidatePriority(left) - handoffCandidatePriority(right);
      if (priorityDelta !== 0) return priorityDelta;
      const leftImportance = Number(left?.request?.importance ?? left?.importance ?? 0);
      const rightImportance = Number(right?.request?.importance ?? right?.importance ?? 0);
      if (Number.isFinite(leftImportance) && Number.isFinite(rightImportance) && rightImportance !== leftImportance) {
        return rightImportance - leftImportance;
      }
      return Number(right?.index ?? 0) - Number(left?.index ?? 0);
    })[0] || null;
}

function mergeSignals(existing, incoming, keyName) {
  const rows = [...(Array.isArray(existing) ? existing : []), ...(Array.isArray(incoming) ? incoming : [])];
  const seen = new Set();
  return rows.filter((row) => {
    if (!row || typeof row !== "object") return false;
    const key = clean(row[keyName] || row.summary || row.reason || JSON.stringify(row));
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function updateContinuityEnvelope(threadId, threadContext, writes) {
  if (!threadId) return;
  const paths = runtimePathsForThread(threadId);
  const existing = readJson(paths.continuityEnvelopePath, {}) || {};
  const next = normalizeContinuityEnvelope(existing, {
    threadId,
    cwd: clean(threadContext.cwd),
  });
  const bootstrapEnvelope = normalizeContinuityEnvelope(threadContext.bootstrapArtifacts?.continuityEnvelope, {
    threadId,
    cwd: clean(threadContext.cwd),
  });
  const bootstrapMetadata =
    threadContext.bootstrapArtifacts?.metadata && typeof threadContext.bootstrapArtifacts.metadata === "object"
      ? threadContext.bootstrapArtifacts.metadata
      : {};
  const startupRelevantWrites = writes.filter((write) => isStartupContinuityWrite(write));
  const writeAuditRows = readJsonl(paths.writesJsonlPath);
  const writePresentationProjectLane =
    dedupeStrings(
      startupRelevantWrites.map((write) =>
        clean(write.projectLane || write.request?.metadata?.projectLane || write.request?.metadata?.presentationProjectLane)
      ),
      4
    )[0] || "";
  const effectivePresentationProjectLane = clean(
    writePresentationProjectLane ||
      bootstrapEnvelope.presentationProjectLane ||
      next.presentationProjectLane ||
      inferThreadPresentationProjectLane(threadContext)
  );
  const effectiveThreadScopedItemCount = Math.max(
    0,
    Math.round(Number(next.threadScopedItemCount || next.startup?.threadScopedItemCount || 0)),
    bootstrapThreadScopedItemCount(threadContext.bootstrapArtifacts),
    countStartupContinuityAuditRows(writeAuditRows),
    startupRelevantWrites.length
  );
  const startupSatisfiedBy = clean(
    next.startupSatisfiedBy ||
      bootstrapMetadata.startupGateSatisfiedBy ||
      bootstrapEnvelope.startupSatisfiedBy ||
      bootstrapEnvelope.startup?.satisfiedBy
  );

  next.threadTitle = clean(threadContext.threadTitle || next.threadTitle);
  next.firstUserMessage = clean(threadContext.firstUserMessage || next.firstUserMessage);
  if (startupSatisfiedBy) {
    next.startupSatisfiedBy = startupSatisfiedBy;
  }
  if (effectivePresentationProjectLane) {
    next.presentationProjectLane = effectivePresentationProjectLane;
  }
  if (effectiveThreadScopedItemCount > 0) {
    next.threadScopedItemCount = effectiveThreadScopedItemCount;
  }

  for (const write of writes) {
    const metadata = write.request.metadata && typeof write.request.metadata === "object" ? write.request.metadata : {};
    const startupRelevant =
      write.kind === "handoff" ||
      write.kind === "checkpoint" ||
      write.kind === "decision" ||
      write.kind === "progress" ||
      write.kind === "blocker" ||
      write.rememberForStartup === true;

    if (clean(metadata.activeGoal)) {
      next.currentGoal = clean(metadata.activeGoal);
    } else if (!next.currentGoal && write.subjectKey) {
      next.currentGoal = write.subjectKey;
    }
    if (clean(metadata.nextRecommendedAction)) {
      next.nextRecommendedAction = clean(metadata.nextRecommendedAction);
    }

    if (startupRelevant && write.kind !== "blocker" && clean(write.content)) {
      next.bootstrapSummary = clip(write.content, 400);
      next.continuityState = "ready";
    }
    if (write.kind === "handoff") {
      next.lastHandoffSummary = clip(write.content, 400);
      next.continuityState = "ready";
    }
    if (write.kind === "blocker") {
      next.blockers = [
        {
          summary: clip(write.content, 240),
          reason: clean(metadata.reason || metadata.blockerReason || "blocker"),
          unblockStep: clean(metadata.nextRecommendedAction || metadata.unblockStep),
          occurredAt: new Date().toISOString(),
          source: "studio_brain_remember",
        },
        ...(Array.isArray(next.blockers) ? next.blockers : []),
      ].slice(0, 12);
    }

    next.frustrationSignals = mergeSignals(
      next.frustrationSignals,
      metadata.frustrationSignals,
      "summary"
    );
    next.ratholeSignals = mergeSignals(
      next.ratholeSignals,
      metadata.ratholeSignals,
      "summary"
    );
  }

  if (next.continuityState === "ready" && effectiveThreadScopedItemCount > 0) {
    next.fallbackOnly = false;
    next.startupSourceQuality = "thread-scoped-dominant";
    next.laneSourceQuality = "thread-scoped-dominant";
  }

  next.artifactPointers = {
    ...(next.artifactPointers && typeof next.artifactPointers === "object" ? next.artifactPointers : {}),
    continuityEnvelopePath: clean(paths.continuityEnvelopePath),
    bootstrapContextPath: clean(paths.bootstrapContextJsonPath),
    bootstrapMetadataPath: clean(paths.bootstrapMetadataPath),
    handoffPath: clean(paths.handoffPath),
    startupContextCachePath: clean(paths.startupContextCachePath),
    writesJsonlPath: clean(paths.writesJsonlPath),
  };
  next.startup = {
    ...(next.startup && typeof next.startup === "object" ? next.startup : {}),
    ...(startupSatisfiedBy ? { satisfiedBy: startupSatisfiedBy } : {}),
    ...(effectiveThreadScopedItemCount > 0 ? { threadScopedItemCount: effectiveThreadScopedItemCount } : {}),
    ...(clean(next.startupSourceQuality) ? { startupSourceQuality: clean(next.startupSourceQuality) } : {}),
    fallbackOnly: next.fallbackOnly === true,
  };

  writeContinuityEnvelope(threadId, normalizeContinuityEnvelope(next, {
    threadId,
    cwd: clean(threadContext.cwd),
    existing,
  }));
}

function refreshBootstrapArtifacts(threadId, threadContext, successfulWrites) {
  if (!threadId) return null;
  const latestEnvelope = loadBootstrapArtifacts(threadId)?.continuityEnvelope || {};
  const satisfiedBy = clean(
    latestEnvelope.startupSatisfiedBy ||
      latestEnvelope.startup?.satisfiedBy ||
      threadContext.bootstrapArtifacts?.metadata?.startupGateSatisfiedBy ||
      "validated-local-continuity"
  );
  const presentationProjectLane = clean(
    latestEnvelope.presentationProjectLane || inferThreadPresentationProjectLane(threadContext)
  );
  const refreshed = refreshLocalBootstrapArtifacts({
    threadId,
    cwd: clean(threadContext.cwd),
    threadTitle: clean(threadContext.threadTitle),
    firstUserMessage: clean(threadContext.firstUserMessage),
    metadata: {
      startupGateSatisfiedBy: satisfiedBy,
      continuityState: clean(latestEnvelope.continuityState || "ready"),
      presentationProjectLane,
      threadScopedItemCount: Math.max(
        0,
        Number(latestEnvelope.threadScopedItemCount || latestEnvelope.startup?.threadScopedItemCount || 0)
      ),
      startupSourceQuality: clean(
        latestEnvelope.startupSourceQuality || latestEnvelope.laneSourceQuality || "thread-scoped-dominant"
      ),
      rememberedMemoryIds: dedupeStrings(successfulWrites.map((write) => clean(write.memoryId)), 24),
      rememberedRequestIds: dedupeStrings(successfulWrites.map((write) => clean(write.clientRequestId)), 24),
      rememberedKinds: dedupeStrings(successfulWrites.map((write) => clean(write.kind)), 12),
    },
  });
  return refreshed;
}

function appendWriteAudit(threadId, threadContext, successfulWrites) {
  if (!threadId || !Array.isArray(successfulWrites) || successfulWrites.length === 0) return;
  const paths = runtimePathsForThread(threadId);
  const existing = existsSync(paths.writesJsonlPath)
    ? new Set(
        readJsonl(paths.writesJsonlPath)
          .map((row) => clean(row?.requestId || row?.clientRequestId))
          .filter(Boolean)
      )
    : new Set();
  const rows = successfulWrites
    .filter((write) => !existing.has(write.clientRequestId))
    .map((write) => ({
      schema: "codex-memory-write-audit.v1",
      savedAt: new Date().toISOString(),
      threadId,
      cwd: clean(threadContext.cwd),
      threadTitle: clean(threadContext.threadTitle),
      memoryId: clean(write.memoryId),
      requestId: write.clientRequestId,
      kind: write.kind,
      source: write.request.source,
      status: write.request.status,
      memoryType: write.request.memoryType,
      scopeClass: write.scopeClass,
      projectLane: write.projectLane,
      subjectKey: write.subjectKey || undefined,
      rememberedForStartup: write.rememberForStartup === true,
    }));
  if (rows.length > 0) {
    appendJsonl(paths.writesJsonlPath, rows);
  }
}

function syncLocalArtifacts(threadContext, successfulWrites) {
  const threadId = clean(threadContext.threadId);
  if (!threadId || successfulWrites.length === 0) return;
  appendWriteAudit(threadId, threadContext, successfulWrites);
  const handoffCandidate = selectBestHandoffCandidate(successfulWrites);
  if (handoffCandidate) {
    writeHandoffArtifact(threadId, buildHandoffArtifact(handoffCandidate, threadContext));
  }
  updateContinuityEnvelope(threadId, threadContext, successfulWrites);
  refreshBootstrapArtifacts(threadId, threadContext, successfulWrites);
}

function parseRememberResponse(response, rememberRows) {
  const usedBatch = rememberRows.length > 1;
  if (!usedBatch) {
    const memoryId = clean(response?.memory?.id);
    const successfulWrites = memoryId ? [{ ...rememberRows[0], memoryId }] : [];
    return {
      usedBatch,
      successfulWrites,
      saved: successfulWrites.length,
      failed: rememberRows.length - successfulWrites.length,
    };
  }

  const results = Array.isArray(response?.result?.results) ? response.result.results : [];
  const successfulWrites = results
    .filter((row) => row && row.ok && clean(row.id))
    .map((row) => {
      const index = Number(row.index);
      if (!Number.isInteger(index) || index < 0 || index >= rememberRows.length) return null;
      return {
        ...rememberRows[index],
        memoryId: clean(row.id),
      };
    })
    .filter(Boolean);
  const imported = Number(response?.result?.imported ?? successfulWrites.length) || successfulWrites.length;
  const failed = Number(response?.result?.failed ?? Math.max(0, rememberRows.length - successfulWrites.length));
  return {
    usedBatch,
    successfulWrites,
    saved: imported,
    failed,
  };
}

export async function rememberWithStudioBrain(
  input,
  {
    env = process.env,
    threadId = "",
    cwd = process.cwd(),
    threadTitle = "",
    firstUserMessage = "",
    capturedFrom = "codex-desktop-thread",
    requestJson = studioBrainRequestJson,
    baseUrl,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  } = {}
) {
  const threadContext = resolveThreadContext({
    env,
    threadId,
    cwd,
    threadTitle,
    firstUserMessage,
  });
  const rememberRows = buildRememberRows(input, { env, threadContext, capturedFrom });
  const requestBody =
    rememberRows.length === 1
      ? rememberRows[0].request
      : {
          sourceOverride: undefined,
          continueOnError: false,
          items: rememberRows.map((row) => row.request),
        };
  const response = await requestJson({
    method: "POST",
    path: rememberRows.length === 1 ? "/api/memory/capture" : "/api/memory/import",
    body: requestBody,
    env,
    baseUrl,
    timeoutMs,
  });
  const parsed = parseRememberResponse(response, rememberRows);
  syncLocalArtifacts(threadContext, parsed.successfulWrites);
  return {
    saved: parsed.saved,
    memoryIds: parsed.successfulWrites.map((row) => row.memoryId),
    kinds: dedupeStrings(parsed.successfulWrites.map((row) => row.kind)),
    usedBatch: parsed.usedBatch,
    verified: parsed.saved === rememberRows.length && parsed.failed === 0,
    threadLinked: Boolean(clean(threadContext.threadId)),
    threadId: clean(threadContext.threadId),
    scopeClass:
      parsed.successfulWrites.length === 1
        ? parsed.successfulWrites[0].scopeClass
        : dedupeStrings(parsed.successfulWrites.map((row) => row.scopeClass)).join(","),
    failed: parsed.failed,
  };
}
