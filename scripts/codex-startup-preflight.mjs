#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadAutomationStartupMemoryContext } from "./codex/open-memory-automation.mjs";
import { loadCodexAutomationEnv } from "./lib/codex-automation-env.mjs";
import {
  buildThreadBootstrapQuery,
  readThreadHistoryLines,
  readThreadName,
  resolveCodexThreadContext,
} from "./lib/codex-session-memory-utils.mjs";
import {
  STARTUP_REASON_CODES,
  buildStartupContract,
  clean,
  evaluateStartupLatency,
  inspectTokenFreshness,
  isTrustedStartupGroundingAuthority,
  startupRecoveryStep,
} from "./lib/codex-startup-reliability.mjs";
import {
  inspectStartupTranscriptTelemetry,
  logStartupTelemetryToolcall,
  maybeLogStartupTelemetryToolcall,
} from "./lib/codex-startup-telemetry.mjs";
import { hydrateStudioBrainAuthFromPortal } from "./lib/studio-brain-startup-auth.mjs";
import { resolveStudioBrainBaseUrlFromEnv } from "./studio-brain-url-resolution.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..");

function buildStartupObservationKey(transcriptTelemetry) {
  const threadId = clean(transcriptTelemetry?.threadId);
  const rolloutPath = clean(transcriptTelemetry?.rolloutPath);
  if (threadId && rolloutPath) return `${threadId}|${rolloutPath}`;
  return threadId || rolloutPath || "";
}

function normalizeLocalArtifactRepair(value) {
  if (!value || typeof value !== "object") return null;
  return {
    repaired: value.repaired === true,
    reason: clean(value.reason),
    source: clean(value.source),
    capturedFrom: clean(value.capturedFrom),
  };
}

function parseArgs(argv) {
  const options = {
    json: false,
    includeMcpSmoke: true,
    query: "",
    runId: "codex-startup-preflight",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = String(argv[index] || "").trim();
    if (!arg) continue;
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    if (arg === "--skip-mcp-smoke") {
      options.includeMcpSmoke = false;
      continue;
    }
    if (arg === "--query" && argv[index + 1]) {
      options.query = String(argv[index + 1]).trim();
      index += 1;
      continue;
    }
    if (arg.startsWith("--query=")) {
      options.query = arg.slice("--query=".length).trim();
      continue;
    }
    if (arg === "--run-id" && argv[index + 1]) {
      options.runId = String(argv[index + 1]).trim();
      index += 1;
      continue;
    }
    if (arg.startsWith("--run-id=")) {
      options.runId = arg.slice("--run-id=".length).trim();
    }
  }
  return options;
}

function resolvePreflightStartupQuery() {
  const hintedThreadId = clean(
    process.env.STUDIO_BRAIN_BOOTSTRAP_THREAD_ID || process.env.CODEX_THREAD_ID || process.env.CODEX_RUN_THREAD_ID || ""
  );
  const threadInfo = resolveCodexThreadContext({
    threadId: hintedThreadId,
    cwd: REPO_ROOT,
  });
  if (!threadInfo?.threadId) {
    return "codex shell startup preflight";
  }
  const threadName = readThreadName(threadInfo.threadId);
  const historyLines = readThreadHistoryLines(threadInfo.threadId, { limit: 5 });
  return buildThreadBootstrapQuery({
    threadInfo,
    threadName,
    historyLines,
  }) || "codex shell startup preflight";
}

async function probeStudioBrainReachability(baseUrl) {
  const startedAt = Date.now();
  try {
    const response = await fetch(new URL("/healthz", baseUrl));
    return {
      ok: response.ok,
      status: response.status,
      latencyMs: Date.now() - startedAt,
      error: response.ok ? "" : `HTTP ${response.status}`,
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      latencyMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function probeMcpBridge() {
  const startedAt = Date.now();
  const result = spawnSync(process.execPath, [resolve(REPO_ROOT, "studio-brain-mcp", "smoke.mjs")], {
    cwd: resolve(REPO_ROOT, "studio-brain-mcp"),
    encoding: "utf8",
    env: process.env,
    timeout: 45_000,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return {
    ok: result.status === 0,
    status: typeof result.status === "number" ? result.status : 1,
    latencyMs: Date.now() - startedAt,
    stdout: clean(result.stdout),
    stderr: clean(result.stderr),
    error:
      result.error instanceof Error
        ? result.error.message
        : result.status === 0
          ? ""
          : clean(result.stderr || result.stdout) || "Studio Brain MCP smoke failed",
  };
}

async function main() {
  loadCodexAutomationEnv({ repoRoot: REPO_ROOT, env: process.env });
  const options = parseArgs(process.argv.slice(2));
  const hydration = await hydrateStudioBrainAuthFromPortal({ repoRoot: REPO_ROOT, env: process.env }).catch(() => ({
    ok: false,
    hydrated: false,
    reason: "auth_hydration_failed",
    source: "codex-startup-preflight",
    tokenFreshness: inspectTokenFreshness(""),
  }));
  const baseUrl = clean(resolveStudioBrainBaseUrlFromEnv({ env: process.env })).replace(/\/$/, "");
  const token = clean(process.env.STUDIO_BRAIN_AUTH_TOKEN || process.env.STUDIO_BRAIN_ID_TOKEN || process.env.STUDIO_BRAIN_MCP_ID_TOKEN || "");
  const tokenFreshness = inspectTokenFreshness(token);
  const reachability = await probeStudioBrainReachability(baseUrl);
  const resolvedQuery = clean(options.query) || resolvePreflightStartupQuery();
  const startup = await loadAutomationStartupMemoryContext({
    tool: "codex-startup-preflight",
    runId: options.runId,
    query: resolvedQuery,
    maxItems: 8,
    maxChars: 2200,
    scanLimit: 120,
  });
  const startupLatency = startup.startupLatency || evaluateStartupLatency(startup.latencyMs);
  const transcriptTelemetry = inspectStartupTranscriptTelemetry({
    env: process.env,
    cwd: REPO_ROOT,
  });
  const mcpBridge = options.includeMcpSmoke ? probeMcpBridge() : null;
  const startupDiagnostics =
    startup.diagnostics && typeof startup.diagnostics === "object"
      ? startup.diagnostics
      : {};
  const presentationProjectLane = clean(
    startupDiagnostics.presentationProjectLane || startupDiagnostics.projectLane || startupDiagnostics.dominantProjectLane
  );
  const threadScopedItemCount = Math.max(0, Math.round(Number(startupDiagnostics.threadScopedItemCount || 0)));
  const manualOnly = startupDiagnostics.manualOnly === true;
  const groundingQuality = clean(startupDiagnostics.groundingQuality || "missing");
  const localArtifactRepair = normalizeLocalArtifactRepair(startupDiagnostics.localArtifactRepair);
  const transcriptOrderingProven =
    transcriptTelemetry.startupToolObserved === true &&
    transcriptTelemetry.startupToolCalledBeforeFirstAssistantMessage === true &&
    transcriptTelemetry.repoReadTelemetryObserved === true;
  const startupContract = buildStartupContract({
    reasonCode: startup.reasonCode,
    continuityState: startup.continuityState,
    diagnostics: {
      ...startupDiagnostics,
      presentationProjectLane,
      threadScopedItemCount,
      manualOnly,
      groundingQuality,
      dominantGoal: startup.dominantGoal || startupDiagnostics.dominantGoal,
      topBlocker: startup.topBlocker || startupDiagnostics.topBlocker,
      nextRecommendedAction: startup.nextRecommendedAction || startupDiagnostics.nextRecommendedAction,
      laneSourceQuality: startup.laneSourceQuality || startupDiagnostics.laneSourceQuality,
      fallbackOnly: startup.fallbackOnly === true,
      groundingAuthority: clean(startup.groundingAuthority || startupDiagnostics.groundingAuthority),
    },
    telemetry: {
      transcriptOrderingProven,
      groundingLineEmitted: transcriptTelemetry.groundingLineEmitted,
      repoReadsBeforeStartupContext: transcriptTelemetry.repoReadsBeforeStartupContext,
    },
    tokenFreshness,
    studioBrainReachable: reachability.ok,
    mcpBridgeOk: mcpBridge?.ok ?? null,
  });
  const observationKey = buildStartupObservationKey(transcriptTelemetry);
  const startupLatencyBreakdown =
    startup.latencyBreakdown && typeof startup.latencyBreakdown === "object" ? startup.latencyBreakdown : {};
  const startupContextStage = clean(startupDiagnostics.startupContextStage);
  const startupCache =
    startupDiagnostics.startupCache && typeof startupDiagnostics.startupCache === "object"
      ? startupDiagnostics.startupCache
      : {};
  const trustMismatchDetected =
    (
      clean(startup.continuityState || "").toLowerCase() === "ready" &&
      !isTrustedStartupGroundingAuthority(clean(startup.groundingAuthority || startupDiagnostics.groundingAuthority))
    ) ||
    (
      startupDiagnostics.publishTrustedGrounding !== true &&
      Boolean(clean(startup.dominantGoal || startup.topBlocker || startup.nextRecommendedAction))
    );
  const startupPacket = {
    schema: "codex-startup-packet.v1",
    observationKey,
    observationClass: "synthetic",
    status: reportStatusForContract(startupContract.status),
    reasonCode: clean(startup.reasonCode || STARTUP_REASON_CODES.STARTUP_UNAVAILABLE),
    continuityState: clean(startup.continuityState || "missing").toLowerCase(),
    groundingAuthority: clean(startup.groundingAuthority || startupDiagnostics.groundingAuthority || startupContract.groundingAuthority),
    presentationProjectLane,
    threadScopedItemCount,
    itemCount: Number(startup.itemCount || 0),
    contextSummary: clean(startup.contextSummary).slice(0, 300),
    grounding: startup.grounding && typeof startup.grounding === "object" ? startup.grounding : {},
    advisory: startup.advisory && typeof startup.advisory === "object" ? startup.advisory : {},
    startupContextStage,
    startupCache,
    trustMismatchDetected,
    degradationBuckets: startupContract.degradationBuckets,
    missingStartupIngredients: startupContract.missingStartupIngredients,
    latencyBreakdown: {
      ...startupLatencyBreakdown,
      startup: startupLatency,
      studioBrainReachabilityMs: reachability.latencyMs ?? null,
      mcpBridgeMs: mcpBridge?.latencyMs ?? null,
    },
  };

  const report = {
    schema: "codex-startup-preflight.v1",
    generatedAt: new Date().toISOString(),
    status: startupContract.status,
    baseUrl,
    checks: {
      studioBrainReachability: reachability,
      authHydration: hydration,
      tokenFreshness,
      startupContext: {
        attempted: Boolean(startup.attempted),
        ok: Boolean(startup.ok),
        reason: clean(startup.reason),
        reasonCode: clean(startup.reasonCode || STARTUP_REASON_CODES.STARTUP_UNAVAILABLE),
        continuityState: clean(startup.continuityState || "missing"),
        error: clean(startup.error),
        itemCount: Number(startup.itemCount || 0),
        contextSummary: clean(startup.contextSummary).slice(0, 300),
        query: resolvedQuery,
        presentationProjectLane,
        threadScopedItemCount,
        manualOnly,
        groundingQuality,
        degradationBuckets: startupContract.degradationBuckets,
        missingStartupIngredients: startupContract.missingStartupIngredients,
        transcriptOrderingProven: startupContract.transcriptOrderingProven,
        dominantGoal: clean(startup.dominantGoal),
        topBlocker: clean(startup.topBlocker),
        nextRecommendedAction: clean(startup.nextRecommendedAction),
        groundingAuthority: startupPacket.groundingAuthority,
        grounding: startupPacket.grounding,
        advisory: startupPacket.advisory,
        goalAuthority: clean(startup.goalAuthority || startupDiagnostics.goalAuthority),
        blockerAuthority: clean(startup.blockerAuthority || startupDiagnostics.blockerAuthority),
        publishTrustedGrounding: startupDiagnostics.publishTrustedGrounding === true,
        laneSourceQuality: startupContract.laneSourceQuality,
        startupSourceQuality: startupContract.startupSourceQuality,
        fallbackOnly: startupContract.fallbackOnly,
        startupContextStage,
        startupCache,
        trustMismatchDetected,
        ...(localArtifactRepair ? { localArtifactRepair } : {}),
        fallbackSources: Array.isArray(startup.fallbackSources) ? startup.fallbackSources.slice(0, 8) : [],
        memoryBriefPath: clean(startup.memoryBriefPath),
        consolidationMode: clean(startup.memoryBrief?.consolidation?.mode || "unavailable"),
        latency: startupLatency,
        startupPacket,
        recoveryStep: startupContract.recoveryStep || startupRecoveryStep(startup.reasonCode || STARTUP_REASON_CODES.STARTUP_UNAVAILABLE),
        telemetry: {
          toolName: "studio_brain_startup_context",
          toolStatus: "called",
          toolObservedInTranscript: transcriptTelemetry.startupToolObserved,
          toolCalledBeforeFirstAssistantMessage: transcriptTelemetry.startupToolCalledBeforeFirstAssistantMessage,
          groundingLineEmitted: transcriptTelemetry.groundingLineEmitted,
          groundingLineObserved: transcriptTelemetry.groundingLineObserved,
          repoReadsBeforeStartupContext: transcriptTelemetry.repoReadsBeforeStartupContext,
          repoReadTelemetryObserved: transcriptTelemetry.repoReadTelemetryObserved,
          transcriptOrderingProven,
          transcriptSource: transcriptTelemetry.source,
          threadId: transcriptTelemetry.threadId,
          rolloutPath: transcriptTelemetry.rolloutPath,
        },
      },
      ...(mcpBridge ? { mcpBridge } : {}),
    },
  };

  logStartupTelemetryToolcall({
    tool: "codex-startup-preflight",
    action: "startup-bootstrap",
    ok: report.status !== "fail",
    durationMs: startupLatency.latencyMs ?? null,
    errorType: report.status === "fail" ? "startup-preflight" : report.status === "degraded" ? "startup-preflight-degraded" : null,
    errorMessage:
      clean(report.checks.startupContext.error) ||
      clean(reachability.error) ||
      clean(mcpBridge?.error) ||
      null,
    context: {
      startup: {
        observationKey,
        observationClass: "synthetic",
        toolName: "studio_brain_startup_context",
        startupToolStatus: "called",
        itemCount: Number(startup.itemCount || 0),
        contextSummary: clean(startup.contextSummary).slice(0, 300),
        reasonCode: report.checks.startupContext.reasonCode,
        continuityState: report.checks.startupContext.continuityState,
        presentationProjectLane,
        threadScopedItemCount,
        manualOnly,
        groundingQuality,
        degradationBuckets: startupContract.degradationBuckets,
        missingStartupIngredients: startupContract.missingStartupIngredients,
        transcriptOrderingProven: startupContract.transcriptOrderingProven,
        dominantGoal: clean(startup.dominantGoal),
        topBlocker: clean(startup.topBlocker),
        nextRecommendedAction: clean(startup.nextRecommendedAction),
        groundingAuthority: startupPacket.groundingAuthority,
        grounding: startupPacket.grounding,
        advisory: startupPacket.advisory,
        goalAuthority: clean(startup.goalAuthority || startupDiagnostics.goalAuthority),
        blockerAuthority: clean(startup.blockerAuthority || startupDiagnostics.blockerAuthority),
        publishTrustedGrounding: startupDiagnostics.publishTrustedGrounding === true,
        laneSourceQuality: startupContract.laneSourceQuality,
        startupSourceQuality: startupContract.startupSourceQuality,
        fallbackOnly: startupContract.fallbackOnly,
        startupContextStage,
        startupCache,
        trustMismatchDetected,
        localArtifactRepairApplied: localArtifactRepair?.repaired === true,
        ...(localArtifactRepair ? { localArtifactRepair } : {}),
        latencyMs: startupLatency.latencyMs ?? null,
        latencyBreakdown: startupPacket.latencyBreakdown,
        startupPacket,
        recoveryStep: report.checks.startupContext.recoveryStep,
        groundingLineEmitted: transcriptTelemetry.groundingLineEmitted,
        groundingLineObserved: transcriptTelemetry.groundingLineObserved,
        repoReadsBeforeStartupContext: transcriptTelemetry.repoReadsBeforeStartupContext,
        repoReadTelemetryObserved: transcriptTelemetry.repoReadTelemetryObserved,
        startupToolObservedInTranscript: transcriptTelemetry.startupToolObserved,
        startupToolCalledBeforeFirstAssistantMessage: transcriptTelemetry.startupToolCalledBeforeFirstAssistantMessage,
        transcriptOrderingProven,
        telemetryCoverage: {
          groundingLine: transcriptTelemetry.groundingLineObserved,
          preStartupRepoReads: transcriptTelemetry.repoReadTelemetryObserved,
          fullyObserved:
            transcriptTelemetry.groundingLineObserved === true &&
            transcriptTelemetry.repoReadTelemetryObserved === true,
        },
        transcriptSource: transcriptTelemetry.source,
        threadId: transcriptTelemetry.threadId || null,
        rolloutPath: transcriptTelemetry.rolloutPath || null,
      },
      telemetryCoverage: {
        startupSource: transcriptTelemetry.source,
        transcriptOrderingProven: startupContract.transcriptOrderingProven,
        groundingLineObserved: transcriptTelemetry.groundingLineObserved,
        preStartupRepoReadObserved: transcriptTelemetry.repoReadTelemetryObserved,
      },
      studioBrainReachable: reachability.ok,
      mcpBridgeOk: mcpBridge?.ok ?? null,
    },
    env: process.env,
    cwd: REPO_ROOT,
  });

  if (transcriptTelemetry.startupToolObserved === true) {
    maybeLogStartupTelemetryToolcall({
      tool: "codex-desktop",
      action: "startup-bootstrap",
      ok: report.status !== "fail",
      durationMs: startupLatency.latencyMs ?? null,
      errorType:
        report.status === "fail" ? "startup-bootstrap" : report.status === "degraded" ? "startup-bootstrap-degraded" : null,
      errorMessage:
        clean(report.checks.startupContext.error) ||
        clean(reachability.error) ||
        clean(mcpBridge?.error) ||
        null,
      context: {
        startup: {
          observationKey,
          observationClass: "live",
          observedVia: "codex-startup-preflight",
          toolName: "studio_brain_startup_context",
          startupToolStatus: "called",
          startupToolObservedInTranscript: transcriptTelemetry.startupToolObserved,
          startupToolNameObserved: transcriptTelemetry.startupToolName || null,
          startupToolCalledBeforeFirstAssistantMessage: transcriptTelemetry.startupToolCalledBeforeFirstAssistantMessage,
          itemCount: Number(startup.itemCount || 0),
          contextSummary: clean(startup.contextSummary).slice(0, 300),
          reasonCode: report.checks.startupContext.reasonCode,
          continuityState: report.checks.startupContext.continuityState,
          presentationProjectLane,
          threadScopedItemCount,
          manualOnly,
          groundingQuality,
          degradationBuckets: startupContract.degradationBuckets,
          missingStartupIngredients: startupContract.missingStartupIngredients,
          dominantGoal: clean(startup.dominantGoal),
          topBlocker: clean(startup.topBlocker),
          nextRecommendedAction: clean(startup.nextRecommendedAction),
          groundingAuthority: startupPacket.groundingAuthority,
          grounding: startupPacket.grounding,
          advisory: startupPacket.advisory,
          goalAuthority: clean(startup.goalAuthority || startupDiagnostics.goalAuthority),
          blockerAuthority: clean(startup.blockerAuthority || startupDiagnostics.blockerAuthority),
          publishTrustedGrounding: startupDiagnostics.publishTrustedGrounding === true,
          laneSourceQuality: startupContract.laneSourceQuality,
          startupSourceQuality: startupContract.startupSourceQuality,
          fallbackOnly: startupContract.fallbackOnly,
          startupContextStage,
          startupCache,
          trustMismatchDetected,
          localArtifactRepairApplied: localArtifactRepair?.repaired === true,
          ...(localArtifactRepair ? { localArtifactRepair } : {}),
          latencyMs: startupLatency.latencyMs ?? null,
          latencyBreakdown: startupPacket.latencyBreakdown,
          startupPacket: {
            ...startupPacket,
            observationClass: "live",
          },
          recoveryStep: report.checks.startupContext.recoveryStep,
          groundingLineEmitted: transcriptTelemetry.groundingLineEmitted,
          groundingLineObserved: transcriptTelemetry.groundingLineObserved,
          repoReadsBeforeStartupContext: transcriptTelemetry.repoReadsBeforeStartupContext,
          repoReadTelemetryObserved: transcriptTelemetry.repoReadTelemetryObserved,
          transcriptOrderingProven,
          telemetryCoverage: {
            groundingLine: transcriptTelemetry.groundingLineObserved,
            preStartupRepoReads: transcriptTelemetry.repoReadTelemetryObserved,
            fullyObserved:
              transcriptTelemetry.groundingLineObserved === true &&
              transcriptTelemetry.repoReadTelemetryObserved === true,
          },
          transcriptSource: transcriptTelemetry.source,
          threadId: transcriptTelemetry.threadId || null,
          rolloutPath: transcriptTelemetry.rolloutPath || null,
        },
        telemetryCoverage: {
          startupSource: transcriptTelemetry.source,
          transcriptOrderingProven: startupContract.transcriptOrderingProven,
          groundingLineObserved: transcriptTelemetry.groundingLineObserved,
          preStartupRepoReadObserved: transcriptTelemetry.repoReadTelemetryObserved,
        },
        studioBrainReachable: reachability.ok,
        mcpBridgeOk: mcpBridge?.ok ?? null,
      },
      env: process.env,
      cwd: REPO_ROOT,
    });
  }

  if (options.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return;
  }

  process.stdout.write(`status: ${report.status}\n`);
  process.stdout.write(`studio brain: ${reachability.ok ? "reachable" : `unreachable (${reachability.error || "unknown"})`}\n`);
  process.stdout.write(`token: ${tokenFreshness.state}\n`);
  process.stdout.write(`startup reason: ${report.checks.startupContext.reasonCode}\n`);
  process.stdout.write(`continuity state: ${report.checks.startupContext.continuityState}\n`);
  process.stdout.write(`presentation lane: ${report.checks.startupContext.presentationProjectLane || "unresolved"}\n`);
  process.stdout.write(`grounding quality: ${report.checks.startupContext.groundingQuality}\n`);
  process.stdout.write(`startup stage: ${report.checks.startupContext.startupContextStage || "unspecified"}\n`);
  process.stdout.write(
    `startup cache: ${
      report.checks.startupContext.startupCache?.shortCircuitLocal === true
        ? "validated-local-short-circuit"
        : report.checks.startupContext.startupCache?.cacheHit === true
          ? `cache-hit (${report.checks.startupContext.startupCache?.hitType || "hit"})`
          : "cache-miss"
    }\n`
  );
  process.stdout.write(`dream cycle: ${report.checks.startupContext.consolidationMode}\n`);
  process.stdout.write(`startup latency: ${startupLatency.latencyMs ?? "n/a"}ms (${startupLatency.state})\n`);
  if (mcpBridge) {
    process.stdout.write(`mcp bridge: ${mcpBridge.ok ? "reachable" : `unreachable (${mcpBridge.error || "unknown"})`}\n`);
  }
}

function reportStatusForContract(status) {
  const normalized = clean(status).toLowerCase();
  if (normalized === "pass" || normalized === "degraded" || normalized === "fail") return normalized;
  return "fail";
}

main().catch((error) => {
  process.stderr.write(`codex-startup-preflight failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
