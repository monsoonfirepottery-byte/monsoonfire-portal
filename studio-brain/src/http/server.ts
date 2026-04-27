import http from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { URL } from "node:url";
import crypto from "node:crypto";
import { getAuth } from "firebase-admin/auth";
import { getApps, initializeApp } from "firebase-admin/app";
import type { Logger } from "../config/logger";
import type { ArtifactStore } from "../connectivity/artifactStore";
import type { EventStore, StateStore } from "../stores/interfaces";
import { renderDashboard } from "./dashboard";
import { checkPgConnection } from "../db/postgres";
import type { CapabilityRuntime } from "../capabilities/runtime";
import type { CapabilityActorContext } from "../capabilities/policy";
import type { ActionProposal, CapabilityDefinition } from "../capabilities/model";
import { resolveCapabilityActor, type DelegationPayload } from "../capabilities/actorResolution";
import { canTransitionDraftStatus, type MarketingDraftStatus } from "../swarm/marketing/draftPipeline";
import {
  buildIntakeQueue,
  classifyIntakeRisk,
  hasOverrideGrant,
  isValidOverrideTransition,
  type IntakeOverrideDecision,
} from "../swarm/trustSafety/intakeControls";
import { buildTriageSuggestion, computeSuggestionFeedbackStats } from "../swarm/trustSafety/triageAssistant";
import type { FinanceReconciliationDraft } from "../swarm/finance/reconciliation";
import { InMemoryQuotaStore, type QuotaStore } from "../capabilities/policy";
import { computeScorecard, type ScoreStatus } from "../observability/scorecard";
import { buildAuditExportBundle } from "../observability/auditExport";
import { lintCapabilityPolicy } from "../observability/policyLint";
import { capabilityPolicyMetadata } from "../capabilities/policyMetadata";
import type { PilotWriteExecutor } from "../capabilities/pilotWrite";
import type { BackendHealthReport } from "../connectivity/healthcheck";
import type { MemoryStats } from "../memory/contracts";
import type { MemoryService } from "../memory/service";
import type { KilnObservationProvider } from "../kiln/adapters/kilnaid/types";
import { firingQueueStates } from "../kiln/domain/model";
import type { KilnStore } from "../kiln/store";
import { importGenesisArtifact } from "../kiln/services/artifacts";
import { recordOperatorAction } from "../kiln/services/manualEvents";
import { createFiringRun } from "../kiln/services/orchestration";
import { buildFiringRunDetail, buildKilnDetail, buildKilnOverview } from "../kiln/services/overview";
import { renderKilnCommandPage } from "../kiln/ui/renderKilnCommandPage";
import type { OpsService } from "../ops/service";
import type { OpsCapability, OpsDegradeMode, GrowthExperiment, ImprovementCase, OpsHumanRole, OpsPortalRole, ProofMode, TaskEscapeHatch } from "../ops/contracts";
import { deriveOpsCapabilitiesFromClaims, deriveOpsRolesFromClaims, derivePortalRoleFromClaims } from "../ops/staffData";
import { renderOpsPortalChoicePage, renderOpsPortalPage } from "../ops/ui/renderOpsPortalPage";
import type { SupportOpsStore } from "../supportOps/store";
import { MemoryValidationError } from "../memory/service";
import {
  buildEmberMemoryScope,
  buildEmberMemberSubject,
  buildEmberPatternSubject,
  buildEmberRunId,
} from "../supportOps/service";
import {
  DEFAULT_HOST_USER as DEFAULT_CONTROL_TOWER_HOST_USER,
  DEFAULT_ROOT_SESSION as DEFAULT_CONTROL_TOWER_ROOT_SESSION,
  clipText,
  collectControlTowerRawState,
  resolveControlTowerRepoRoot,
  writeControlTowerState,
  type Runner as ControlTowerRunner,
} from "../controlTower/collect";
import { resolveFirebaseProjectId } from "../cloud/firebaseProject";
import {
  appendControlTowerOverseerAck,
  buildControlTowerAttachCommand,
  resolvePrimarySessionForRoom,
  runControlTowerServiceAction,
  sendControlTowerInstruction,
  spawnControlTowerSession,
} from "../controlTower/actions";
import { deriveControlTowerState, deriveRoomDetail } from "../controlTower/derive";
import type {
  ControlTowerApprovalItem,
  ControlTowerEvent,
  ControlTowerHostCard,
  ControlTowerMemoryHealth,
  ControlTowerMemoryBrief,
  ControlTowerNextAction,
  ControlTowerRawState,
  ControlTowerStartupScorecard,
  ControlTowerState,
} from "../controlTower/types";
import { draftDiscordSupportReply, getSupportAgentProfile } from "../supportOps/discord";
import type { AgentRuntimeSummary, RunLedgerEvent } from "../agentRuntime/contracts";
import { buildAgentRuntimeRunDetail } from "../agentRuntime/detail";
import {
  appendAgentRuntimeEvent,
  listAgentRuntimeSummaries,
  normalizeAgentRuntimeRunId,
  readAgentRuntimeEvents,
  readLatestAgentRuntimeSummary,
  writeAgentRuntimeSummary,
} from "../agentRuntime/files";
import {
  listControlTowerHostHeartbeats,
  normalizeControlTowerHostId,
  writeControlTowerHostHeartbeat,
  type ControlTowerHostHeartbeat,
} from "../controlTower/hosts";
import type { PartnerBrief, PartnerCheckinAction } from "../partner/contracts";
import { readPartnerCheckins } from "../partner/files";
import {
  deriveAndPersistPartnerBrief,
  recordPartnerCheckin,
  updatePartnerOpenLoop,
} from "../partner/service";

const CONTROL_TOWER_MEMORY_BRIEF_RELATIVE_PATH = ["output", "studio-brain", "memory-brief", "latest.json"] as const;
const CONTROL_TOWER_MEMORY_CONSOLIDATION_RELATIVE_PATH = ["output", "studio-brain", "memory-consolidation", "latest.json"] as const;
const CONTROL_TOWER_STARTUP_SCORECARD_RELATIVE_PATH = ["output", "qa", "codex-startup-scorecard.json"] as const;
const CONTROL_TOWER_EVENT_STREAM_POLL_MS = 5_000;
const CONTROL_TOWER_EVENT_STREAM_HEARTBEAT_MS = 15_000;

function withSecurityHeaders(headers: Record<string, string>): Record<string, string> {
  return {
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "cache-control": "no-store",
    ...headers,
  };
}

function parseIsoToMillis(value: string): number | null {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toBooleanFlag(value: string | null, fallback = false): boolean {
  if (value === null) return fallback;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return fallback;
  if (normalized === "0" || normalized === "false" || normalized === "no" || normalized === "off") return false;
  return true;
}

function toObjectRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function toTrimmedString(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim();
}

function toBoundedInt(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(parsed)));
}

function toNullableNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toNullableRatio(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.min(1, parsed));
}

function toStringList(value: unknown, maxItems = 64): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => toTrimmedString(entry))
    .filter(Boolean)
    .slice(0, Math.max(1, maxItems));
}

function isPartnerCheckinAction(value: unknown): value is PartnerCheckinAction {
  return (
    value === "ack"
    || value === "snooze"
    || value === "pause"
    || value === "redirect"
    || value === "why_this"
    || value === "continue"
  );
}

function isPartnerOpenLoopStatus(value: unknown): value is "delegated" | "paused" | "resolved" {
  return value === "delegated" || value === "paused" || value === "resolved";
}

function readJsonFile<T>(path: string): T | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return null;
  }
}

function normalizeContinuityState(value: unknown, fallback: ControlTowerMemoryBrief["continuityState"]): ControlTowerMemoryBrief["continuityState"] {
  const raw = toTrimmedString(value);
  if (raw === "ready" || raw === "continuity_degraded" || raw === "missing") {
    return raw;
  }
  return fallback;
}

function normalizeConsolidationMode(
  value: unknown,
  fallback: ControlTowerMemoryBrief["consolidation"]["mode"],
): ControlTowerMemoryBrief["consolidation"]["mode"] {
  const raw = toTrimmedString(value);
  if (raw === "idle" || raw === "scheduled" || raw === "running" || raw === "repair" || raw === "unavailable") {
    return raw;
  }
  return fallback;
}

function deriveArtifactConsolidationMode(
  artifact: Record<string, unknown> | null,
  fallback: ControlTowerMemoryBrief["consolidation"]["mode"],
): ControlTowerMemoryBrief["consolidation"]["mode"] {
  if (!artifact) return fallback;
  const status = toTrimmedString(artifact.status);
  const rawMode = toTrimmedString(artifact.mode);
  if (status === "failed") return "repair";
  if (rawMode === "running") return "running";
  if (rawMode === "repair" || rawMode === "unavailable") return rawMode;
  if (rawMode) return "scheduled";
  return fallback;
}

function readControlTowerMemoryBrief(repoRoot: string, fallback: ControlTowerMemoryBrief): ControlTowerMemoryBrief {
  const targetPath = resolve(repoRoot, ...CONTROL_TOWER_MEMORY_BRIEF_RELATIVE_PATH);
  const payload = readJsonFile<Record<string, unknown>>(targetPath);
  const consolidationArtifact = readJsonFile<Record<string, unknown>>(
    resolve(repoRoot, ...CONTROL_TOWER_MEMORY_CONSOLIDATION_RELATIVE_PATH)
  );
  if (!payload) {
    return {
      ...fallback,
      sourcePath: fallback.sourcePath || CONTROL_TOWER_MEMORY_BRIEF_RELATIVE_PATH.join("/"),
      consolidation: {
        ...fallback.consolidation,
        mode: deriveArtifactConsolidationMode(consolidationArtifact, fallback.consolidation.mode),
        status: toTrimmedString(consolidationArtifact?.status) || fallback.consolidation.status || null,
        summary: toTrimmedString(consolidationArtifact?.summary) || fallback.consolidation.summary,
        counts:
          consolidationArtifact && typeof consolidationArtifact === "object"
            ? {
                promotions: toBoundedInt(consolidationArtifact.promotionCount, 0, 0, 1_000_000),
                archives: toBoundedInt(consolidationArtifact.archiveCount, 0, 0, 1_000_000),
                quarantines: toBoundedInt(consolidationArtifact.quarantineCount, 0, 0, 1_000_000),
                repairedLinks: toBoundedInt(consolidationArtifact.repairedEdgeCount, 0, 0, 1_000_000),
              }
            : fallback.consolidation.counts,
        lastRunAt:
          toTrimmedString(consolidationArtifact?.finishedAt || consolidationArtifact?.lastSuccessAt)
          || fallback.consolidation.lastRunAt,
        nextRunAt: toTrimmedString(consolidationArtifact?.nextRunAt) || fallback.consolidation.nextRunAt,
        actionabilityStatus: toTrimmedString(consolidationArtifact?.actionabilityStatus) || fallback.consolidation.actionabilityStatus || null,
        actionableInsightCount: toBoundedInt(consolidationArtifact?.actionableInsightCount, 0, 0, 1_000_000),
        suppressedConnectionNoteCount: toBoundedInt(consolidationArtifact?.suppressedConnectionNoteCount, 0, 0, 1_000_000),
        suppressedPseudoDecisionCount: toBoundedInt(consolidationArtifact?.suppressedPseudoDecisionCount, 0, 0, 1_000_000),
        topActions: toStringList(consolidationArtifact?.topActions, 6),
        lastError: toTrimmedString(consolidationArtifact?.lastError) || fallback.consolidation.lastError || null,
      },
    };
  }

  const layers = toObjectRecord(payload.layers);
  const consolidation = toObjectRecord(payload.consolidation);
  return {
    ...fallback,
    schema: "studio-brain.memory-brief.v1",
    generatedAt: toTrimmedString(payload.generatedAt) || fallback.generatedAt,
    continuityState: normalizeContinuityState(payload.continuityState, fallback.continuityState),
    summary: toTrimmedString(payload.summary) || fallback.summary,
    goal: toTrimmedString(payload.goal) || fallback.goal,
    blockers: toStringList(payload.blockers, 8),
    recentDecisions: toStringList(payload.recentDecisions, 8),
    recommendedNextActions: toStringList(payload.recommendedNextActions, 8),
    fallbackSources: toStringList(payload.fallbackSources, 8),
    sourcePath: CONTROL_TOWER_MEMORY_BRIEF_RELATIVE_PATH.join("/"),
    layers: {
      coreBlocks: toStringList(layers.coreBlocks, 8),
      workingMemory: toStringList(layers.workingMemory, 8),
      episodicMemory: toStringList(layers.episodicMemory, 8),
      canonicalMemory: toStringList(layers.canonicalMemory, 8),
    },
    consolidation: {
      mode:
        consolidationArtifact && typeof consolidationArtifact === "object"
          ? deriveArtifactConsolidationMode(consolidationArtifact, normalizeConsolidationMode(consolidation.mode, fallback.consolidation.mode))
          : normalizeConsolidationMode(consolidation.mode, fallback.consolidation.mode),
      status:
        toTrimmedString(consolidationArtifact?.status)
        || toTrimmedString(consolidation.status)
        || fallback.consolidation.status
        || null,
      summary:
        toTrimmedString(consolidationArtifact?.summary)
        || toTrimmedString(consolidation.summary)
        || fallback.consolidation.summary,
      lastRunAt:
        toTrimmedString(consolidationArtifact?.finishedAt || consolidationArtifact?.lastSuccessAt || consolidation.lastRunAt)
        || fallback.consolidation.lastRunAt,
      nextRunAt: toTrimmedString(consolidationArtifact?.nextRunAt || consolidation.nextRunAt) || fallback.consolidation.nextRunAt,
      focusAreas: toStringList(consolidationArtifact?.focusAreas, 8).length
        ? toStringList(consolidationArtifact?.focusAreas, 8)
        : toStringList(consolidation.focusAreas, 8).length
          ? toStringList(consolidation.focusAreas, 8)
          : fallback.consolidation.focusAreas,
      maintenanceActions: toStringList(consolidation.maintenanceActions, 8).length
        ? toStringList(consolidation.maintenanceActions, 8)
        : fallback.consolidation.maintenanceActions,
      outputs: toStringList(consolidationArtifact?.outputs, 8).length
        ? toStringList(consolidationArtifact?.outputs, 8)
        : toStringList(consolidation.outputs, 8).length
          ? toStringList(consolidation.outputs, 8)
          : fallback.consolidation.outputs,
      counts: {
        promotions: toBoundedInt(consolidation.counts && toObjectRecord(consolidation.counts).promotions || consolidationArtifact?.promotionCount, 0, 0, 1_000_000),
        archives: toBoundedInt(consolidation.counts && toObjectRecord(consolidation.counts).archives || consolidationArtifact?.archiveCount, 0, 0, 1_000_000),
        quarantines: toBoundedInt(consolidation.counts && toObjectRecord(consolidation.counts).quarantines || consolidationArtifact?.quarantineCount, 0, 0, 1_000_000),
        repairedLinks: toBoundedInt(consolidation.counts && toObjectRecord(consolidation.counts).repairedLinks || consolidationArtifact?.repairedEdgeCount, 0, 0, 1_000_000),
      },
      mixQuality: toTrimmedString(consolidation.mixQuality || consolidationArtifact?.candidateSelectionDetails && toObjectRecord(consolidationArtifact.candidateSelectionDetails).mixQuality) || null,
      dominanceWarnings: toStringList(consolidation.dominanceWarnings, 6).length
        ? toStringList(consolidation.dominanceWarnings, 6)
        : toStringList(consolidationArtifact?.dominanceWarnings, 6),
      secondPassQueriesUsed: toBoundedInt(consolidation.secondPassQueriesUsed || consolidationArtifact?.secondPassQueriesUsed, 0, 0, 1_000_000),
      promotionCandidatesPending: toBoundedInt(consolidation.promotionCandidatesPending || consolidationArtifact?.promotionCandidateCount, 0, 0, 1_000_000),
      promotionCandidatesConfirmed: toBoundedInt(consolidation.promotionCandidatesConfirmed || consolidationArtifact?.promotionCandidateConfirmedCount, 0, 0, 1_000_000),
      stalledCandidateCount: toBoundedInt(consolidation.stalledCandidateCount || consolidationArtifact?.stalledCandidateCount, 0, 0, 1_000_000),
      actionabilityStatus: toTrimmedString(consolidationArtifact?.actionabilityStatus || consolidation.actionabilityStatus) || null,
      actionableInsightCount: toBoundedInt(consolidationArtifact?.actionableInsightCount || consolidation.actionableInsightCount, 0, 0, 1_000_000),
      suppressedConnectionNoteCount: toBoundedInt(consolidationArtifact?.suppressedConnectionNoteCount || consolidation.suppressedConnectionNoteCount, 0, 0, 1_000_000),
      suppressedPseudoDecisionCount: toBoundedInt(consolidationArtifact?.suppressedPseudoDecisionCount || consolidation.suppressedPseudoDecisionCount, 0, 0, 1_000_000),
      topActions: toStringList(consolidationArtifact?.topActions, 6).length
        ? toStringList(consolidationArtifact?.topActions, 6)
        : toStringList(consolidation.topActions, 6),
      lastError: toTrimmedString(consolidation.lastError || consolidationArtifact?.lastError) || fallback.consolidation.lastError || null,
    },
  };
}

function readControlTowerStartupScorecard(repoRoot: string): ControlTowerStartupScorecard | null {
  const payload = readJsonFile<Record<string, unknown>>(resolve(repoRoot, ...CONTROL_TOWER_STARTUP_SCORECARD_RELATIVE_PATH));
  if (!payload) return null;

  const latest = toObjectRecord(payload.latest);
  const latestSample = toObjectRecord(latest.sample);
  const metrics = toObjectRecord(payload.metrics);
  const supportingSignals = toObjectRecord(payload.supportingSignals);
  const toolcalls = toObjectRecord(supportingSignals.toolcalls);
  const coverage = toObjectRecord(payload.coverage);
  const launcherCoverage = toObjectRecord(payload.launcherCoverage);
  const rubric = toObjectRecord(payload.rubric);

  return {
    schema: toTrimmedString(payload.schema) || "codex-startup-scorecard.v1",
    sourcePath: CONTROL_TOWER_STARTUP_SCORECARD_RELATIVE_PATH.join("/"),
    generatedAtIso: toTrimmedString(payload.generatedAtIso),
    latest: {
      sample: {
        status: toTrimmedString(latestSample.status) || "unknown",
        reasonCode: toTrimmedString(latestSample.reasonCode) || "unknown",
        continuityState: toTrimmedString(latestSample.continuityState) || "missing",
        latencyMs: toNullableNumber(latestSample.latencyMs),
      },
    },
    metrics: {
      readyRate: toNullableRatio(metrics.readyRate),
      groundingReadyRate: toNullableRatio(metrics.groundingReadyRate),
      blockedContinuityRate: toNullableRatio(metrics.blockedContinuityRate),
      p95LatencyMs: toNullableNumber(metrics.p95LatencyMs),
    },
    supportingSignals: {
      toolcalls: {
        startupEntries: toBoundedInt(toolcalls.startupEntries, 0, 0, 1_000_000),
        startupFailures: toBoundedInt(toolcalls.startupFailures, 0, 0, 1_000_000),
        startupFailureRate: toNullableRatio(toolcalls.startupFailureRate),
        groundingObservedEntries: toBoundedInt(toolcalls.groundingObservedEntries, 0, 0, 1_000_000),
        groundingLineComplianceRate: toNullableRatio(toolcalls.groundingLineComplianceRate),
        preStartupRepoReadObservedEntries: toBoundedInt(toolcalls.preStartupRepoReadObservedEntries, 0, 0, 1_000_000),
        averagePreStartupRepoReads: toNullableNumber(toolcalls.averagePreStartupRepoReads),
        preStartupRepoReadFreeRate: toNullableRatio(toolcalls.preStartupRepoReadFreeRate),
        telemetryCoverageRate: toNullableRatio(toolcalls.telemetryCoverageRate),
        repeatFailureBursts: toBoundedInt(toolcalls.repeatFailureBursts, 0, 0, 1_000_000),
      },
    },
    coverage: {
      gaps: toStringList(coverage.gaps, 8),
    },
    launcherCoverage: {
      liveStartupSamples: toBoundedInt(launcherCoverage.liveStartupSamples, 0, 0, 1_000_000),
      requiredLiveStartupSamples: toBoundedInt(launcherCoverage.requiredLiveStartupSamples, 5, 1, 1_000_000),
      trustworthy: toBooleanFlag(toTrimmedString(String(launcherCoverage.trustworthy ?? "")), false),
    },
    rubric: {
      overallScore: toNullableNumber(rubric.overallScore),
      grade: toTrimmedString(rubric.grade) || "n/a",
    },
    recommendations: toStringList(payload.recommendations, 8),
  };
}

function buildAgentRuntimeAttention(agentRuntime: AgentRuntimeSummary | null): Array<{
  id: string;
  title: string;
  why: string;
  ageMinutes: number | null;
  severity: "info" | "warning" | "critical";
  actionLabel: string;
  target: ControlTowerNextAction["target"];
}> {
  if (!agentRuntime) return [];
  if (agentRuntime.status !== "blocked" && agentRuntime.status !== "failed") return [];
  return [
    {
      id: `agent-runtime-attention:${agentRuntime.runId}`,
      title: `Inspect ${agentRuntime.title}`,
      why: clipText(agentRuntime.activeBlockers[0] || "The background runtime is blocked and needs an explicit next move.", 180),
      ageMinutes: ageMinutesSince(agentRuntime.updatedAt),
      severity: agentRuntime.status === "failed" ? "critical" : "warning",
      actionLabel: "Inspect runtime",
      target: { type: "ops", action: "agent-runtime" },
    },
  ];
}

function buildAgentRuntimeNextActions(agentRuntime: AgentRuntimeSummary | null): ControlTowerNextAction[] {
  if (!agentRuntime) return [];
  return [
    {
      id: `agent-runtime-next:${agentRuntime.runId}`,
      title: clipText(agentRuntime.boardRow?.next || "Inspect background runtime", 120),
      why: clipText(agentRuntime.activeBlockers[0] || agentRuntime.goal || "Background runtime state changed.", 180),
      ageMinutes: ageMinutesSince(agentRuntime.updatedAt),
      actionLabel: "Open runtime",
      target: { type: "ops", action: "agent-runtime" },
    },
  ];
}

function buildServerHostCard(raw: ControlTowerRawState, agentRuntime: AgentRuntimeSummary | null): ControlTowerHostCard {
  const degradedServices = raw.services.filter((service) => service.status === "error").length;
  const health: ControlTowerHostCard["health"] =
    raw.ops.overallStatus === "error" || raw.ops.overallStatus === "waiting" ? "degraded" : "healthy";
  return {
    hostId: "studio-brain-server",
    label: "Studio Brain Server",
    environment: "server",
    role: "control-plane",
    connectivity: "online",
    health,
    lastSeenAt: raw.generatedAt,
    ageMinutes: ageMinutesSince(raw.generatedAt),
    currentRunId: agentRuntime?.runId ?? null,
    agentCount: Math.max(raw.rooms.length, agentRuntime ? 1 : 0),
    version: null,
    summary:
      degradedServices > 0
        ? `${degradedServices} service${degradedServices === 1 ? "" : "s"} degraded across the control plane.`
        : `${raw.rooms.length} active room${raw.rooms.length === 1 ? "" : "s"} visible in the control plane.`,
    metrics: {
      cpuPct: null,
      memoryPct: null,
      load1: null,
    },
  };
}

function dedupeHosts(hosts: ControlTowerHostCard[]): ControlTowerHostCard[] {
  const seen = new Set<string>();
  return hosts.filter((host) => {
    const key = `${host.environment}:${host.hostId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function buildHostAttention(hosts: ControlTowerHostCard[]): Array<{
  id: string;
  title: string;
  why: string;
  ageMinutes: number | null;
  severity: "info" | "warning" | "critical";
  actionLabel: string;
  target: ControlTowerNextAction["target"];
}> {
  return hosts
    .filter((host) => host.connectivity !== "online" || host.health === "degraded" || host.health === "offline")
    .slice(0, 3)
    .map((host) => ({
      id: `attention:host:${host.hostId}`,
      title:
        host.connectivity === "offline"
          ? `${host.label} went offline`
          : host.connectivity === "stale"
            ? `${host.label} heartbeat is stale`
            : `${host.label} is degraded`,
      why: clipText(host.summary, 180),
      ageMinutes: host.ageMinutes,
      severity: host.connectivity === "offline" || host.health === "offline" ? "critical" : "warning",
      actionLabel: host.currentRunId ? "Open runtime" : "Inspect events",
      target: host.currentRunId ? { type: "ops", action: "agent-runtime" } : { type: "ops", action: "events" },
    }));
}

function buildControlTowerApprovals(
  proposals: ActionProposal[],
  capabilityDefinitions: CapabilityDefinition[],
): ControlTowerApprovalItem[] {
  const definitions = new Map(capabilityDefinitions.map((capability) => [capability.id, capability]));

  return proposals
    .filter((proposal) => proposal.status !== "executed" && proposal.status !== "rejected")
    .map((proposal) => {
      const definition = definitions.get(proposal.capabilityId);
      const policy = capabilityPolicyMetadata[proposal.capabilityId];
      return {
        id: proposal.id,
        capabilityId: proposal.capabilityId,
        summary: proposal.preview.summary,
        requestedBy: proposal.requestedBy,
        status: proposal.status,
        createdAt: proposal.createdAt,
        owner: policy?.owner || proposal.tenantId,
        approvalMode: policy?.approvalMode || (definition?.requiresApproval ? "required" : "exempt"),
        risk: definition?.risk || "medium",
        previewInput: proposal.preview.input,
        expectedEffects: proposal.preview.expectedEffects,
        target: { type: "ops", action: "approvals" },
      } satisfies ControlTowerApprovalItem;
    })
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, 8);
}

function buildSyntheticControlTowerEvents(
  memoryBrief: ControlTowerMemoryBrief,
  approvals: ControlTowerApprovalItem[],
  agentRuntime: AgentRuntimeSummary | null,
  hosts: ControlTowerHostCard[],
  partner: PartnerBrief | null = null,
): ControlTowerEvent[] {
  const output: ControlTowerEvent[] = [];

  output.push({
    id: `memory-brief:${memoryBrief.generatedAt}`,
    at: memoryBrief.generatedAt,
    kind: "operator",
    type: "memory.promoted",
    runId: null,
    agentId: null,
    channel: "ops",
    occurredAt: memoryBrief.generatedAt,
    severity: memoryBrief.continuityState === "ready" ? "info" : "warning",
    title: memoryBrief.continuityState === "ready" ? "Memory brief refreshed" : "Continuity degraded",
    summary: clipText(memoryBrief.summary, 220),
    actor: "startup-memory",
    roomId: null,
    serviceId: null,
    actionLabel: null,
    sourceAction: "control_tower.memory_brief",
    payload: {
      continuityState: memoryBrief.continuityState,
      goal: memoryBrief.goal,
      sourcePath: memoryBrief.sourcePath,
    },
  });

  output.push({
    id: `memory-consolidation:${memoryBrief.generatedAt}`,
    at: memoryBrief.generatedAt,
    kind: "operator",
    type: "memory.promoted",
    runId: null,
    agentId: null,
    channel: "memory",
    occurredAt: memoryBrief.generatedAt,
    severity:
      memoryBrief.consolidation.mode === "repair"
      || memoryBrief.consolidation.mode === "unavailable"
      || memoryBrief.consolidation.status === "failed"
        ? "warning"
        : "info",
    title:
      memoryBrief.consolidation.mode === "running"
        ? "Offline consolidation running"
        : memoryBrief.consolidation.mode === "repair" || memoryBrief.consolidation.mode === "unavailable"
          ? "Offline consolidation waiting on repair"
          : "Offline consolidation queued",
    summary: clipText(memoryBrief.consolidation.summary, 220),
    actor: "memory-dream-cycle",
    roomId: null,
    serviceId: null,
    actionLabel: null,
    sourceAction: "control_tower.memory_consolidation",
    payload: {
      mode: memoryBrief.consolidation.mode,
      status: memoryBrief.consolidation.status ?? null,
      focusAreas: memoryBrief.consolidation.focusAreas,
      outputs: memoryBrief.consolidation.outputs,
      nextRunAt: memoryBrief.consolidation.nextRunAt,
      lastRunAt: memoryBrief.consolidation.lastRunAt,
      counts: memoryBrief.consolidation.counts ?? null,
      mixQuality: memoryBrief.consolidation.mixQuality ?? null,
      dominanceWarnings: memoryBrief.consolidation.dominanceWarnings ?? [],
      secondPassQueriesUsed: memoryBrief.consolidation.secondPassQueriesUsed ?? 0,
      promotionCandidatesPending: memoryBrief.consolidation.promotionCandidatesPending ?? 0,
      promotionCandidatesConfirmed: memoryBrief.consolidation.promotionCandidatesConfirmed ?? 0,
      stalledCandidateCount: memoryBrief.consolidation.stalledCandidateCount ?? 0,
      lastError: memoryBrief.consolidation.lastError ?? null,
    },
  });

  approvals
    .filter((approval) => approval.status === "pending_approval")
    .forEach((approval) => {
      output.push({
        id: `approval:${approval.id}`,
        at: approval.createdAt,
        kind: "operator",
        type: "approval.requested",
        runId: approval.id,
        agentId: approval.requestedBy,
        channel: "ops",
        occurredAt: approval.createdAt,
        severity: approval.approvalMode === "required" ? "warning" : "info",
        title: "Approval requested",
        summary: clipText(`${approval.capabilityId}: ${approval.summary}`, 220),
        actor: approval.requestedBy,
        roomId: null,
        serviceId: null,
        actionLabel: "Open approvals",
        sourceAction: `capability.${approval.capabilityId}.proposal_created`,
        payload: {
          approvalId: approval.id,
          capabilityId: approval.capabilityId,
          status: approval.status,
          approvalMode: approval.approvalMode,
          risk: approval.risk,
        },
      });
    });

  if (agentRuntime) {
    output.push({
      id: `agent-runtime:${agentRuntime.runId}:${agentRuntime.updatedAt}`,
      at: agentRuntime.updatedAt,
      kind: "session",
      type: "run.status",
      runId: agentRuntime.runId,
      agentId: agentRuntime.agentId ?? "agent-runtime",
      channel: "codex",
      occurredAt: agentRuntime.updatedAt,
      severity: agentRuntime.status === "failed" ? "critical" : agentRuntime.status === "blocked" ? "warning" : "info",
      title: `${agentRuntime.status}: ${agentRuntime.title}`,
      summary: clipText(agentRuntime.activeBlockers[0] || agentRuntime.boardRow?.next || agentRuntime.goal, 220),
      actor: agentRuntime.agentId ?? "agent-runtime",
      roomId: null,
      serviceId: null,
      actionLabel: "Open runtime",
      sourceAction: "control_tower.agent_runtime",
      payload: {
        hostId: agentRuntime.hostId ?? null,
        environment: agentRuntime.environment ?? null,
        riskLane: agentRuntime.riskLane,
        blocker: agentRuntime.activeBlockers[0] ?? null,
      },
    });
  }

  hosts
    .filter((host) => host.connectivity !== "online" || host.health === "degraded" || host.health === "offline")
    .slice(0, 4)
    .forEach((host) => {
      output.push({
        id: `host:${host.hostId}:${host.lastSeenAt || host.health}`,
        at: host.lastSeenAt || new Date().toISOString(),
        kind: "session",
        type: "health.changed",
        runId: host.currentRunId,
        agentId: null,
        channel: "ops",
        occurredAt: host.lastSeenAt || new Date().toISOString(),
        severity: host.connectivity === "offline" || host.health === "offline" ? "critical" : "warning",
        title: `${host.label} ${host.connectivity === "online" ? host.health : host.connectivity}`,
        summary: clipText(host.summary, 220),
        actor: host.hostId,
        roomId: null,
        serviceId: null,
        actionLabel: host.currentRunId ? "Open runtime" : "Inspect events",
        sourceAction: "control_tower.host_heartbeat",
        payload: {
          hostId: host.hostId,
          environment: host.environment,
          connectivity: host.connectivity,
          health: host.health,
          currentRunId: host.currentRunId,
        },
      });
    });

  if (partner) {
    output.push({
      id: `partner-brief:${partner.generatedAt}`,
      at: partner.generatedAt,
      kind: "operator",
      type: "task.updated",
      runId: null,
      agentId: partner.persona.id,
      channel: "codex",
      occurredAt: partner.generatedAt,
      severity: partner.needsOwnerDecision ? "warning" : "info",
      title: partner.needsOwnerDecision ? "Chief-of-staff decision waiting" : "Chief-of-staff brief refreshed",
      summary: clipText(partner.summary, 220),
      actor: partner.persona.displayName,
      roomId: partner.openLoops[0]?.roomId ?? null,
      serviceId: null,
      actionLabel: "Review partner brief",
      sourceAction: "control_tower.partner_brief",
      payload: {
        initiativeState: partner.initiativeState,
        needsOwnerDecision: partner.needsOwnerDecision,
        nextCheckInAt: partner.nextCheckInAt,
        recommendedFocus: partner.recommendedFocus,
      },
    });
  }

  return output;
}

function ageMinutesSince(iso: string | null | undefined): number | null {
  const parsed = parseIsoToMillis(String(iso || ""));
  if (parsed == null) return null;
  return Math.max(0, Math.floor((Date.now() - parsed) / 60_000));
}

function dedupeTextList(values: string[], maxItems: number): string[] {
  const output: string[] = [];
  const seen = new Set<string>();
  for (const rawValue of values) {
    const value = clipText(toTrimmedString(rawValue), 160);
    const key = value.toLowerCase();
    if (!value || seen.has(key)) continue;
    seen.add(key);
    output.push(value);
    if (output.length >= maxItems) break;
  }
  return output;
}

function serializeActionTarget(target: ControlTowerNextAction["target"]): string {
  if (target.type === "room") return `room:${target.roomId}`;
  if (target.type === "session") return `session:${target.sessionName}`;
  if (target.type === "service") return `service:${target.serviceId}`;
  return `ops:${target.action}`;
}

function dedupeNextActions(actions: ControlTowerNextAction[], maxItems: number): ControlTowerNextAction[] {
  const output: ControlTowerNextAction[] = [];
  const seen = new Set<string>();
  for (const action of actions) {
    const signature = `${serializeActionTarget(action.target)}|${toTrimmedString(action.title).toLowerCase()}`;
    if (!action.title || seen.has(signature)) continue;
    seen.add(signature);
    output.push(action);
    if (output.length >= maxItems) break;
  }
  return output;
}

function shouldSurfaceMemoryNextMoves(
  memoryBrief: ControlTowerMemoryBrief,
  startupScorecard: ControlTowerStartupScorecard | null,
): boolean {
  if (memoryBrief.continuityState !== "ready") return true;

  const actionabilityStatus = toTrimmedString(memoryBrief.consolidation.actionabilityStatus).toLowerCase();
  if (actionabilityStatus && actionabilityStatus !== "passed") return true;

  if (!startupScorecard) return false;

  if (toTrimmedString(startupScorecard.latest.sample.status).toLowerCase() !== "pass") return true;
  if (startupScorecard.launcherCoverage.trustworthy !== true) return true;
  if (
    startupScorecard.metrics.readyRate != null &&
    startupScorecard.metrics.readyRate < 0.85
  ) {
    return true;
  }
  if (
    startupScorecard.metrics.groundingReadyRate != null &&
    startupScorecard.metrics.groundingReadyRate < 0.9
  ) {
    return true;
  }
  if (
    startupScorecard.metrics.blockedContinuityRate != null &&
    startupScorecard.metrics.blockedContinuityRate > 0.05
  ) {
    return true;
  }
  return false;
}

function buildMemoryActionNextMoves(
  memoryBrief: ControlTowerMemoryBrief,
  startupScorecard: ControlTowerStartupScorecard | null,
): ControlTowerNextAction[] {
  if (!shouldSurfaceMemoryNextMoves(memoryBrief, startupScorecard)) {
    return [];
  }

  const memoryActions = dedupeTextList(
    [
      ...memoryBrief.recommendedNextActions,
      ...(memoryBrief.consolidation.topActions ?? []),
    ],
    4,
  );
  if (memoryActions.length === 0) {
    return [];
  }

  const issues = dedupeTextList(
    [
      memoryBrief.continuityState !== "ready" ? `continuity is ${memoryBrief.continuityState}` : "",
      startupScorecard?.metrics.readyRate != null && startupScorecard.metrics.readyRate < 0.85
        ? `ready rate ${Math.round(startupScorecard.metrics.readyRate * 100)}%`
        : "",
      startupScorecard?.metrics.groundingReadyRate != null && startupScorecard.metrics.groundingReadyRate < 0.9
        ? `grounding-ready rate ${Math.round(startupScorecard.metrics.groundingReadyRate * 100)}%`
        : "",
      startupScorecard?.metrics.blockedContinuityRate != null && startupScorecard.metrics.blockedContinuityRate > 0.05
        ? `blocked continuity ${Math.round(startupScorecard.metrics.blockedContinuityRate * 100)}%`
        : "",
      startupScorecard && startupScorecard.launcherCoverage.trustworthy !== true
        ? `live startup coverage ${startupScorecard.launcherCoverage.liveStartupSamples}/${startupScorecard.launcherCoverage.requiredLiveStartupSamples}`
        : "",
      toTrimmedString(memoryBrief.consolidation.actionabilityStatus).toLowerCase() &&
      toTrimmedString(memoryBrief.consolidation.actionabilityStatus).toLowerCase() !== "passed"
        ? `actionability ${toTrimmedString(memoryBrief.consolidation.actionabilityStatus)}`
        : "",
    ],
    4,
  );
  const why = issues.length > 0
    ? clipText(`Memory continuity needs operator attention because ${issues.join(", ")}.`, 180)
    : "Memory continuity needs operator attention before repo work fans out further.";
  const ageMinutes = ageMinutesSince(memoryBrief.generatedAt);

  return memoryActions.map((title, index) => ({
    id: `memory-next:${index}:${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    title,
    why,
    ageMinutes,
    actionLabel: "Review memory",
    target: { type: "ops", action: "memory" },
  }));
}

function buildControlTowerMemoryHealth(stats: MemoryStats | null | undefined): ControlTowerMemoryHealth | null {
  if (!stats) return null;

  const coverage = {
    rowsWithLattice: toBoundedInt(stats.lattice?.coverage.rowsWithLattice, 0, 0, 1_000_000),
    totalRows: toBoundedInt(stats.lattice?.coverage.totalRows ?? stats.total, 0, 0, 1_000_000),
    ratio: toNullableRatio(stats.lattice?.coverage.ratio),
  };
  const reviewBacklog = {
    reviewNow: toBoundedInt(stats.reviewBacklog?.reviewNow ?? stats.lattice?.backlog.reviewNow, 0, 0, 1_000_000),
    revalidate: toBoundedInt(stats.reviewBacklog?.revalidate ?? stats.lattice?.backlog.revalidate, 0, 0, 1_000_000),
    resolveConflict: toBoundedInt(stats.reviewBacklog?.resolveConflict ?? stats.lattice?.backlog.resolveConflict, 0, 0, 1_000_000),
    retire: toBoundedInt(stats.reviewBacklog?.retire ?? stats.lattice?.backlog.retire, 0, 0, 1_000_000),
    folkloreRiskHigh: toBoundedInt(stats.reviewBacklog?.folkloreRiskHigh ?? stats.lattice?.backlog.folkloreRiskHigh, 0, 0, 1_000_000),
  };
  const openReviewCases = toBoundedInt(stats.openReviewCases, 0, 0, 1_000_000);
  const verificationFailures24h = toBoundedInt(stats.verificationFailures24h, 0, 0, 1_000_000);
  const emberPromotionBacklog = toBoundedInt(stats.emberPromotionBacklog, 0, 0, 1_000_000);
  const conflictBacklog = {
    contestedRows: toBoundedInt(stats.conflictBacklog?.contestedRows, 0, 0, 1_000_000),
    hardConflicts: toBoundedInt(stats.conflictBacklog?.hardConflicts, 0, 0, 1_000_000),
    quarantinedRows: toBoundedInt(stats.conflictBacklog?.quarantinedRows, 0, 0, 1_000_000),
    conflictRecords: toBoundedInt(stats.conflictBacklog?.conflictRecords, 0, 0, 1_000_000),
    retrievalShadowedRows: toBoundedInt(stats.conflictBacklog?.retrievalShadowedRows, 0, 0, 1_000_000),
  };
  const startupReadiness = {
    startupEligibleRows: toBoundedInt(stats.startupReadiness?.startupEligibleRows, 0, 0, 1_000_000),
    trustedStartupRows: toBoundedInt(stats.startupReadiness?.trustedStartupRows, 0, 0, 1_000_000),
    handoffRows: toBoundedInt(stats.startupReadiness?.handoffRows, 0, 0, 1_000_000),
    checkpointRows: toBoundedInt(stats.startupReadiness?.checkpointRows, 0, 0, 1_000_000),
    fallbackRiskRows: toBoundedInt(stats.startupReadiness?.fallbackRiskRows, 0, 0, 1_000_000),
  };
  const secretExposureFindings = {
    totalRows: toBoundedInt(stats.secretExposureFindings?.totalRows, 0, 0, 1_000_000),
    redactedRows: toBoundedInt(stats.secretExposureFindings?.redactedRows, 0, 0, 1_000_000),
    requiresReviewRows: toBoundedInt(stats.secretExposureFindings?.requiresReviewRows, 0, 0, 1_000_000),
    canonicalBlockedRows: toBoundedInt(stats.secretExposureFindings?.canonicalBlockedRows, 0, 0, 1_000_000),
    quarantinedRows: toBoundedInt(stats.secretExposureFindings?.quarantinedRows, 0, 0, 1_000_000),
  };
  const shadowMcpFindings = {
    totalRows: toBoundedInt(stats.shadowMcpFindings?.totalRows, 0, 0, 1_000_000),
    governedRows: toBoundedInt(stats.shadowMcpFindings?.governedRows, 0, 0, 1_000_000),
    ungovernedRows: toBoundedInt(stats.shadowMcpFindings?.ungovernedRows, 0, 0, 1_000_000),
    reviewRows: toBoundedInt(stats.shadowMcpFindings?.reviewRows, 0, 0, 1_000_000),
    highRiskRows: toBoundedInt(stats.shadowMcpFindings?.highRiskRows, 0, 0, 1_000_000),
  };

  const criticalHighlights = dedupeTextList(
    [
      secretExposureFindings.canonicalBlockedRows > 0
        ? `${secretExposureFindings.canonicalBlockedRows} secret-bearing memories are blocked from canonical promotion`
        : "",
      secretExposureFindings.quarantinedRows > 0
        ? `${secretExposureFindings.quarantinedRows} secret-bearing memories remain quarantined`
        : "",
      shadowMcpFindings.highRiskRows > 0
        ? `${shadowMcpFindings.highRiskRows} MCP memories are flagged high risk`
        : "",
      shadowMcpFindings.ungovernedRows > 0
        ? `${shadowMcpFindings.ungovernedRows} MCP memories are missing governance registration`
        : "",
    ],
    4,
  );
  const warningHighlights = dedupeTextList(
    [
      startupReadiness.fallbackRiskRows > 0
        ? `${startupReadiness.fallbackRiskRows} startup memories still depend on fallback continuity`
        : "",
      reviewBacklog.resolveConflict > 0
        ? `${reviewBacklog.resolveConflict} memory conflicts need resolution`
        : "",
      reviewBacklog.revalidate > 0
        ? `${reviewBacklog.revalidate} stale memories need revalidation`
        : "",
      reviewBacklog.reviewNow > 0
        ? `${reviewBacklog.reviewNow} memories are waiting for review`
        : "",
      openReviewCases > 0
        ? `${openReviewCases} memory review cases are open`
        : "",
      verificationFailures24h > 0
        ? `${verificationFailures24h} verification runs failed in the last 24 hours`
        : "",
      emberPromotionBacklog > 0
        ? `${emberPromotionBacklog} Ember guidance promotions are waiting for review`
        : "",
      reviewBacklog.folkloreRiskHigh > 0
        ? `${reviewBacklog.folkloreRiskHigh} folklore-risk memories need verification`
        : "",
      conflictBacklog.hardConflicts > 0
        ? `${conflictBacklog.hardConflicts} hard conflicts remain in the lattice`
        : "",
      conflictBacklog.retrievalShadowedRows > 0
        ? `${conflictBacklog.retrievalShadowedRows} memories are being shadowed by hard conflict retrieval rules`
        : "",
      coverage.totalRows > 0 && coverage.ratio != null && coverage.ratio < 0.95
        ? `lattice coverage is ${Math.round(coverage.ratio * 100)}%`
        : "",
    ],
    4,
  );
  const severity: ControlTowerMemoryHealth["severity"] =
    criticalHighlights.length > 0
      ? "critical"
      : warningHighlights.length > 0 ||
          startupReadiness.startupEligibleRows > startupReadiness.trustedStartupRows
        ? "warning"
        : "info";
  const highlights = criticalHighlights.length > 0
    ? criticalHighlights
    : warningHighlights.length > 0
      ? warningHighlights
      : ["Memory trust signals are within the current launch thresholds."];
  const summary =
    severity === "critical"
      ? clipText(`Memory launch trust needs immediate operator review: ${highlights.join("; ")}.`, 220)
      : severity === "warning"
        ? clipText(`Memory launch trust is degraded but recoverable: ${highlights.join("; ")}.`, 220)
        : "Memory launch trust is healthy and startup coverage is within the current policy thresholds.";

  return {
    severity,
    summary,
    highlights,
    coverage,
    reviewBacklog,
    openReviewCases,
    verificationFailures24h,
    emberPromotionBacklog,
    conflictBacklog,
    startupReadiness,
    secretExposureFindings,
    shadowMcpFindings,
  };
}

function buildMemoryHealthAttention(memoryHealth: ControlTowerMemoryHealth | null): Array<{
  id: string;
  title: string;
  why: string;
  ageMinutes: number | null;
  severity: "info" | "warning" | "critical";
  actionLabel: string;
  target: { type: "ops"; action: "memory" };
}> {
  if (!memoryHealth) return [];

  const items = [
    memoryHealth.secretExposureFindings.canonicalBlockedRows > 0 || memoryHealth.secretExposureFindings.quarantinedRows > 0
      ? {
          id: "attention:memory:secret-exposure",
          title: "Secret-bearing memories need review",
          why: clipText(memoryHealth.summary, 180),
          ageMinutes: null,
          severity: "critical" as const,
          actionLabel: "Review memory",
          target: { type: "ops" as const, action: "memory" as const },
        }
      : null,
    memoryHealth.shadowMcpFindings.highRiskRows > 0 || memoryHealth.shadowMcpFindings.ungovernedRows > 0
      ? {
          id: "attention:memory:shadow-mcp",
          title: "Shadow MCP memory needs governance review",
          why: clipText(memoryHealth.summary, 180),
          ageMinutes: null,
          severity: memoryHealth.shadowMcpFindings.highRiskRows > 0 ? ("critical" as const) : ("warning" as const),
          actionLabel: "Review memory",
          target: { type: "ops" as const, action: "memory" as const },
        }
      : null,
    memoryHealth.startupReadiness.fallbackRiskRows > 0 || memoryHealth.reviewBacklog.resolveConflict > 0
      ? {
          id: "attention:memory:startup-trust",
          title: "Startup memory trust needs repair",
          why: clipText(memoryHealth.summary, 180),
          ageMinutes: null,
          severity:
            memoryHealth.startupReadiness.fallbackRiskRows > 0
              ? ("warning" as const)
              : ("info" as const),
          actionLabel: "Review memory",
          target: { type: "ops" as const, action: "memory" as const },
        }
      : null,
  ].filter((item): item is NonNullable<typeof item> => item !== null);

  return items.slice(0, 3);
}

function buildMemoryHealthNextMoves(memoryHealth: ControlTowerMemoryHealth | null): ControlTowerNextAction[] {
  if (!memoryHealth || memoryHealth.severity === "info") return [];

  const titles = dedupeTextList(
    [
      memoryHealth.secretExposureFindings.canonicalBlockedRows > 0 || memoryHealth.secretExposureFindings.quarantinedRows > 0
        ? "Review quarantined secret-bearing memories"
        : "",
      memoryHealth.shadowMcpFindings.highRiskRows > 0 || memoryHealth.shadowMcpFindings.ungovernedRows > 0
        ? "Audit MCP governance coverage in memory"
        : "",
      memoryHealth.startupReadiness.fallbackRiskRows > 0
        ? "Promote trusted startup continuity memories"
        : "",
      memoryHealth.reviewBacklog.resolveConflict > 0 || memoryHealth.reviewBacklog.revalidate > 0
        ? "Work the memory conflict and revalidation backlog"
        : "",
      memoryHealth.reviewBacklog.folkloreRiskHigh > 0
        ? "Verify folklore-risk memories before launch"
        : "",
    ],
    4,
  );

  return titles.map((title, index) => ({
    id: `memory-health-next:${index}:${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    title,
    why: clipText(memoryHealth.summary, 180),
    ageMinutes: null,
    actionLabel: "Review memory",
    target: { type: "ops", action: "memory" },
  }));
}

function buildPartnerAttention(partner: PartnerBrief | null): Array<{
  id: string;
  title: string;
  why: string;
  ageMinutes: number | null;
  severity: "info" | "warning" | "critical";
  actionLabel: string;
  target: { type: "ops"; action: "partner" };
}> {
  if (!partner) return [];
  if (partner.needsOwnerDecision) {
    return [
      {
        id: "attention:partner:decision",
        title: "Chief-of-staff decision waiting",
        why: clipText(partner.summary, 180),
        ageMinutes: null,
        severity: "warning",
        actionLabel: "Review partner brief",
        target: { type: "ops", action: "partner" },
      },
    ];
  }
  if (partner.initiativeState === "cooldown") {
    return [];
  }
  if ((partner.openLoops ?? []).some((entry) => entry.status === "open")) {
    return [
      {
        id: "attention:partner:open-loop",
        title: "Chief-of-staff open loop needs review",
        why: clipText(partner.contactReason, 180),
        ageMinutes: null,
        severity: "info",
        actionLabel: "Review partner brief",
        target: { type: "ops", action: "partner" },
      },
    ];
  }
  return [];
}

function buildPartnerNextMoves(partner: PartnerBrief | null): ControlTowerNextAction[] {
  if (!partner) return [];
  const focus = clipText(partner.recommendedFocus || partner.contactReason, 160);
  const actionLabel = partner.needsOwnerDecision ? "Review partner brief" : "Review cadence";
  return [
    {
      id: "partner:review",
      title: partner.needsOwnerDecision ? "Review chief-of-staff decision" : "Review chief-of-staff brief",
      why: focus,
      ageMinutes: null,
      actionLabel,
      target: { type: "ops", action: "partner" },
    },
  ];
}

function applyPartnerSignalsToRooms(
  rooms: ControlTowerState["rooms"],
  partner: PartnerBrief | null,
): ControlTowerState["rooms"] {
  if (!partner) return rooms;
  const loopsByRoom = new Map<string, PartnerBrief["openLoops"][number]>();
  for (const loop of partner.openLoops) {
    if (!loop.roomId || loopsByRoom.has(loop.roomId)) continue;
    loopsByRoom.set(loop.roomId, loop);
  }
  return rooms.map((room) => {
    const loop = loopsByRoom.get(room.id);
    if (!loop) return room;
    return {
      ...room,
      contactReason: partner.contactReason,
      verifiedContext: loop.verifiedContext,
      decisionNeeded: loop.decisionNeeded,
    };
  });
}

function applyPartnerSignalsToBoard(
  board: ControlTowerState["board"],
  partner: PartnerBrief | null,
): ControlTowerState["board"] {
  if (!partner) return board;
  const loopsByRoom = new Map<string, PartnerBrief["openLoops"][number]>();
  for (const loop of partner.openLoops) {
    if (!loop.roomId || loopsByRoom.has(loop.roomId)) continue;
    loopsByRoom.set(loop.roomId, loop);
  }
  return board.map((row, index) => {
    const loop = row.roomId ? loopsByRoom.get(row.roomId) : null;
    if (loop) {
      return {
        ...row,
        contactReason: partner.contactReason,
        verifiedContext: loop.verifiedContext,
        decisionNeeded: loop.decisionNeeded,
      };
    }
    if (index === 0 && !row.roomId) {
      return {
        ...row,
        contactReason: partner.contactReason,
        verifiedContext: partner.verifiedContext,
        decisionNeeded: partner.singleDecisionNeeded,
      };
    }
    return row;
  });
}

function enrichControlTowerState(
  state: ControlTowerState,
  syntheticEvents: ControlTowerEvent[],
  approvals: ControlTowerApprovalItem[],
  memoryBrief: ControlTowerMemoryBrief,
  startupScorecard: ControlTowerStartupScorecard | null,
  memoryHealth: ControlTowerMemoryHealth | null,
  agentRuntime: AgentRuntimeSummary | null,
  hosts: ControlTowerHostCard[],
  partner: PartnerBrief | null,
): ControlTowerState {
  const mergedEvents = [...syntheticEvents, ...state.events]
    .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt))
    .slice(0, 48);
  const approvalAttention = approvals
    .filter((approval) => approval.status === "pending_approval")
    .slice(0, 2)
    .map((approval) => ({
      id: `attention:approval:${approval.id}`,
      title: "Approval waiting",
      why: clipText(`${approval.capabilityId}: ${approval.summary}`, 180),
      ageMinutes: null,
      severity: approval.approvalMode === "required" ? ("warning" as const) : ("info" as const),
      actionLabel: "Open approvals",
      target: approval.target,
    }));
  const memoryAttention = buildMemoryHealthAttention(memoryHealth);
  const agentRuntimeAttention = buildAgentRuntimeAttention(agentRuntime);
  const hostAttention = buildHostAttention(hosts);
  const partnerAttention = buildPartnerAttention(partner);
  const memoryNextMoves = buildMemoryActionNextMoves(memoryBrief, startupScorecard);
  const memoryHealthMoves = buildMemoryHealthNextMoves(memoryHealth);
  const agentRuntimeMoves = buildAgentRuntimeNextActions(agentRuntime);
  const partnerMoves = buildPartnerNextMoves(partner);
  const mergedActions = dedupeNextActions(
    [...partnerMoves, ...agentRuntimeMoves, ...memoryHealthMoves, ...memoryNextMoves, ...state.actions],
    6,
  );
  const mergedBoard = agentRuntime?.boardRow
    ? [
        {
          runId: agentRuntime.runId,
          roomId: null,
          sessionName: null,
          ...agentRuntime.boardRow,
        },
        ...state.board.filter((row) => row.id !== agentRuntime.boardRow.id),
      ].slice(0, 8)
    : state.board;
  const nextRooms = applyPartnerSignalsToRooms(state.rooms, partner);
  const nextBoard = applyPartnerSignalsToBoard(mergedBoard, partner);

  return {
    ...state,
    rooms: nextRooms,
    approvals,
    memoryBrief,
    startupScorecard,
    memoryHealth,
    agentRuntime,
    hosts,
    partner,
    board: nextBoard,
    events: mergedEvents,
    recentChanges: mergedEvents.slice(0, 6),
    actions: mergedActions,
    counts: {
      ...state.counts,
      needsAttention:
        state.counts.needsAttention
          + approvalAttention.length
          + memoryAttention.length
          + hostAttention.length
          + agentRuntimeAttention.length
          + partnerAttention.length,
    },
    overview: {
      ...state.overview,
      needsAttention: [
        ...partnerAttention,
        ...hostAttention,
        ...agentRuntimeAttention,
        ...memoryAttention,
        ...approvalAttention,
        ...state.overview.needsAttention,
      ].slice(0, 6),
      goodNextMoves: mergedActions,
      recentEvents: mergedEvents.slice(0, 8),
    },
  };
}

function isTransientMemoryQueryError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = String(error.message ?? "").toLowerCase();
  if (!message) return false;
  return (
    /timeout/.test(message) ||
    /timed\s*out/.test(message) ||
    /aborted/.test(message) ||
    /temporarily unavailable/.test(message) ||
    /connection/.test(message) ||
    /too many clients/.test(message) ||
    /remaining connection slots/.test(message) ||
    /request-failed/.test(message) ||
    /connect/.test(message) ||
    /cancel/.test(message)
  );
}

async function withRouteTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return promise;
  }
  let timer: NodeJS.Timeout | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`${label} timed out after ${Math.max(1, Math.floor(timeoutMs))}ms`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function normalizeRelationshipType(value: unknown): string {
  const token = String(value ?? "related")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return token || "related";
}

function readStringValues(input: unknown, limit = 24): string[] {
  if (Array.isArray(input)) {
    return input
      .map((entry) => toTrimmedString(entry))
      .filter(Boolean)
      .slice(0, Math.max(1, limit));
  }
  const single = toTrimmedString(input);
  return single ? [single] : [];
}

type DerivedRelationshipEdge = {
  sourceId: string;
  targetId: string;
  relationType: string;
};

function extractRelationshipEdgesFromMetadata(sourceId: string, metadataRaw: unknown): DerivedRelationshipEdge[] {
  const metadata = toObjectRecord(metadataRaw);
  const edges: DerivedRelationshipEdge[] = [];
  const seen = new Set<string>();
  const pushEdge = (targetCandidate: unknown, relationTypeCandidate: unknown): void => {
    const targetId = toTrimmedString(targetCandidate);
    if (!targetId || targetId === sourceId) return;
    const relationType = normalizeRelationshipType(relationTypeCandidate);
    const key = `${sourceId}|${targetId}|${relationType}`;
    if (seen.has(key)) return;
    seen.add(key);
    edges.push({ sourceId, targetId, relationType });
  };

  const pushFromKeys = (keys: string[], relationType: string): void => {
    for (const key of keys) {
      for (const value of readStringValues(metadata[key], 32)) {
        pushEdge(value, relationType);
      }
    }
  };

  pushFromKeys(["relatedMemoryIds", "relatedIds", "relatedTo", "relatedMemoryIdList", "relationshipsIds"], "related");
  pushFromKeys(["parentMemoryId", "parentId", "inReplyToParentId"], "parent");
  pushFromKeys(["replyToMemoryId", "replyToId", "replyToMessageId"], "reply-to");
  pushFromKeys(["threadRootMemoryId", "threadRootId", "threadId"], "thread-root");
  pushFromKeys(["resolvesMemoryId", "resolvesId", "resolvedMemoryId"], "resolves");
  pushFromKeys(["reopensMemoryId", "reopensId", "reopenedMemoryId"], "reopens");
  pushFromKeys(["supersedesMemoryId", "supersedesId", "supersededMemoryId"], "supersedes");
  pushFromKeys(["referencesMemoryId", "referencesId"], "references");
  pushFromKeys(["dependsOnMemoryId", "dependsOnId"], "depends-on");
  pushFromKeys(["conflictsWithMemoryId", "conflictsWithId"], "conflicts-with");

  for (const key of ["resolvesMemoryIds", "reopensMemoryIds", "supersedesMemoryIds", "referencesMemoryIds"]) {
    const relationType = key
      .replace(/MemoryIds?$/i, "")
      .replace(/([a-z])([A-Z])/g, "$1-$2")
      .toLowerCase();
    for (const value of readStringValues(metadata[key], 48)) {
      pushEdge(value, relationType);
    }
  }

  const relationships = metadata.relationships;
  if (Array.isArray(relationships)) {
    for (const entry of relationships.slice(0, 64)) {
      if (typeof entry === "string") {
        pushEdge(entry, "related");
        continue;
      }
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
      const row = entry as Record<string, unknown>;
      const targetId = row.targetId ?? row.relatedId ?? row.memoryId ?? row.id;
      const relationType = row.relationType ?? row.type ?? row.kind;
      pushEdge(targetId, relationType);
    }
  }

  const relationship = metadata.relationship;
  if (relationship && typeof relationship === "object" && !Array.isArray(relationship)) {
    const row = relationship as Record<string, unknown>;
    pushEdge(row.targetId ?? row.relatedId ?? row.memoryId ?? row.id, row.relationType ?? row.type ?? row.kind);
  }

  return edges;
}

function summarizePreview(text: unknown, maxChars = 180): string {
  const value = typeof text === "string" ? text.trim() : "";
  if (!value) return "";
  if (value.length <= maxChars) return value;
  return `${value.slice(0, Math.max(1, maxChars - 1)).trimEnd()}…`;
}

function buildRelationshipDiagnosticsFromNodes(
  seedMemoryId: string | null,
  rows: Array<{ id: string; content: string; metadata: Record<string, unknown> }>
): {
  edgeSummary: {
    seedMemoryId: string | null;
    nodeCount: number;
    edgeCount: number;
    internalEdgeCount: number;
    externalEdgeCount: number;
    relationshipTypes: Record<string, number>;
    unresolvedConflictCount: number;
  };
  relationshipTypeCounts: Record<string, number>;
  unresolvedConflicts: Array<{ sourceId: string; targetId: string; relationTypes: string[] }>;
  previewSummaries: Array<{ id: string; summary: string }>;
} {
  const nodeIds = new Set(rows.map((row) => row.id));
  const relationshipTypeCountsMap = new Map<string, number>();
  const edgeTypesByPair = new Map<string, Set<string>>();
  let edgeCount = 0;
  let internalEdgeCount = 0;
  let externalEdgeCount = 0;

  for (const row of rows) {
    const edges = extractRelationshipEdgesFromMetadata(row.id, row.metadata);
    for (const edge of edges) {
      edgeCount += 1;
      if (nodeIds.has(edge.targetId)) internalEdgeCount += 1;
      else externalEdgeCount += 1;
      relationshipTypeCountsMap.set(edge.relationType, Number(relationshipTypeCountsMap.get(edge.relationType) ?? 0) + 1);
      const pairKey = `${edge.sourceId}|${edge.targetId}`;
      const bucket = edgeTypesByPair.get(pairKey) ?? new Set<string>();
      bucket.add(edge.relationType);
      edgeTypesByPair.set(pairKey, bucket);
    }
  }

  const conflictingPairs: Array<{ sourceId: string; targetId: string; relationTypes: string[] }> = [];
  const conflictTypeSets = [
    ["resolves", "reopens"],
    ["resolves", "supersedes"],
    ["reopens", "supersedes"],
    ["depends-on", "conflicts-with"],
  ];
  for (const [pairKey, typeSet] of edgeTypesByPair.entries()) {
    const types = Array.from(typeSet);
    const isConflict = conflictTypeSets.some(
      ([left, right]) => typeSet.has(left) && typeSet.has(right)
    );
    if (!isConflict) continue;
    const [sourceId, targetId] = pairKey.split("|");
    conflictingPairs.push({
      sourceId: sourceId ?? "",
      targetId: targetId ?? "",
      relationTypes: types.sort((left, right) => left.localeCompare(right)),
    });
  }

  const relationshipTypeCounts = Object.fromEntries(
    Array.from(relationshipTypeCountsMap.entries()).sort((left, right) => {
      if (right[1] !== left[1]) return right[1] - left[1];
      return left[0].localeCompare(right[0]);
    })
  );

  return {
    edgeSummary: {
      seedMemoryId,
      nodeCount: rows.length,
      edgeCount,
      internalEdgeCount,
      externalEdgeCount,
      relationshipTypes: relationshipTypeCounts,
      unresolvedConflictCount: conflictingPairs.length,
    },
    relationshipTypeCounts,
    unresolvedConflicts: conflictingPairs.slice(0, 24),
    previewSummaries: rows.slice(0, 10).map((row) => ({
      id: row.id,
      summary: summarizePreview(row.content, 200),
    })),
  };
}

function formatLoopDigestMarkdown(payload: {
  generatedAt: string;
  query: string | null;
  incidents: Array<{
    loopKey: string;
    lane: string;
    currentState: string;
    escalationScore: number;
    blastRadiusScore: number;
    anomalyScore: number;
    suggestedOwner: string | null;
    hoursUntilBreach: number;
    slaStatus: string;
    recommendedAction: string;
    narrative: string;
  }>;
  summary: Record<string, unknown> | null;
}): string {
  const lines: string[] = [];
  lines.push(`# Loop Incident Digest`);
  lines.push(`Generated: ${payload.generatedAt}`);
  if (payload.query) {
    lines.push(`Query: ${payload.query}`);
  }
  const incidentCount = payload.incidents.length;
  lines.push(`Incidents: ${incidentCount}`);
  if (payload.summary && typeof payload.summary === "object") {
    const summaryRow = payload.summary as Record<string, unknown>;
    const highestEscalation = Number(summaryRow.highestEscalationScore ?? 0);
    const highestBlast = Number(summaryRow.highestBlastRadiusScore ?? 0);
    const sla = (summaryRow.sla as Record<string, unknown> | undefined) ?? {};
    const ownerQueues = Array.isArray(summaryRow.ownerQueues) ? summaryRow.ownerQueues : [];
    lines.push(`Top escalation score: ${highestEscalation.toFixed(2)} | Top blast radius: ${highestBlast.toFixed(2)}`);
    lines.push(
      `SLA: healthy ${Number(sla.healthy ?? 0)}, at-risk ${Number(sla.atRisk ?? 0)}, breached ${Number(
        sla.breached ?? 0
      )}, soonest breach ${sla.soonestBreachHours === null || sla.soonestBreachHours === undefined ? "n/a" : `${Number(
        sla.soonestBreachHours
      ).toFixed(1)}h`}`
    );
    if (ownerQueues.length > 0) {
      const topOwners = ownerQueues
        .slice(0, 3)
        .map((row) => `${String((row as Record<string, unknown>).owner ?? "unassigned")}:${Number((row as Record<string, unknown>).total ?? 0)}`)
        .join(", ");
      lines.push(`Top owner queues: ${topOwners}`);
    }
  }
  lines.push("");
  if (incidentCount === 0) {
    lines.push(`No incidents matched the current thresholds.`);
    return lines.join("\n");
  }
  payload.incidents.forEach((incident, index) => {
    lines.push(
      `${index + 1}. [${incident.lane.toUpperCase()}] ${incident.loopKey} (${incident.currentState})`
    );
    lines.push(
      `   Escalation ${incident.escalationScore.toFixed(2)} | Blast ${incident.blastRadiusScore.toFixed(2)} | Anomaly ${incident.anomalyScore.toFixed(2)}`
    );
    lines.push(`   Owner: ${incident.suggestedOwner ?? "unassigned"}`);
    lines.push(`   SLA: ${incident.slaStatus} (${incident.hoursUntilBreach.toFixed(1)}h until breach)`);
    lines.push(`   Action: ${incident.recommendedAction}`);
    lines.push(`   Narrative: ${incident.narrative}`);
    lines.push("");
  });
  return lines.join("\n").trim();
}

export type RuntimeStatusProvider = () => Record<string, unknown> | Promise<Record<string, unknown>>;
export type RuntimeMetricsProvider = () => Record<string, unknown> | Promise<Record<string, unknown>>;
export type EndpointRateLimitConfig = {
  createProposalPerMinute: number;
  executeProposalPerMinute: number;
  intakeOverridePerMinute: number;
  marketingReviewPerMinute: number;
};

export type MemoryIngestConfig = {
  enabled?: boolean;
  hmacSecret?: string | null;
  maxSkewSeconds?: number;
  requireClientRequestId?: boolean;
  allowedSources?: string[];
  allowedDiscordGuildIds?: string[];
  allowedDiscordChannelIds?: string[];
};

export type OpsIngestConfig = {
  enabled?: boolean;
  hmacSecret?: string | null;
  maxSkewSeconds?: number;
  allowedSources?: string[];
};

type ParsedJsonBody = {
  raw: string;
  json: Record<string, unknown>;
};

async function readRawBody(req: http.IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (!chunks.length) return "";
  return Buffer.concat(chunks).toString("utf8");
}

async function readRawBodyLimited(req: http.IncomingMessage, maxBytes: number): Promise<string> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.byteLength;
    if (totalBytes > maxBytes) {
      throw new Error(`Request body exceeds ${maxBytes} bytes.`);
    }
    chunks.push(buffer);
  }
  if (!chunks.length) return "";
  return Buffer.concat(chunks).toString("utf8");
}

function parseJsonBody(raw: string): Record<string, unknown> {
  if (!raw.trim()) return {};
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("JSON body must be an object.");
  }
  return parsed as Record<string, unknown>;
}

async function readJsonBodyWithRaw(req: http.IncomingMessage): Promise<ParsedJsonBody> {
  const raw = await readRawBody(req);
  return {
    raw,
    json: parseJsonBody(raw),
  };
}

async function readJsonBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  return (await readJsonBodyWithRaw(req)).json;
}

function normalizeHmacSignature(value: string | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const candidate = trimmed.includes("=") ? trimmed.slice(trimmed.lastIndexOf("=") + 1).trim() : trimmed;
  return /^[a-f0-9]{64}$/i.test(candidate) ? candidate.toLowerCase() : null;
}

function parseEpochSeconds(raw: string | undefined): number | null {
  if (!raw) return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return null;
  const value = Math.trunc(parsed);
  return value > 0 ? value : null;
}

function isTimestampWithinSkew(timestampSeconds: number, nowMs: number, maxSkewSeconds: number): boolean {
  const deltaMs = Math.abs(nowMs - timestampSeconds * 1000);
  return deltaMs <= maxSkewSeconds * 1000;
}

function verifyHmacSignature(expectedHex: string, providedHex: string): boolean {
  if (expectedHex.length !== providedHex.length) return false;
  try {
    const expected = Buffer.from(expectedHex, "hex");
    const provided = Buffer.from(providedHex, "hex");
    if (expected.length !== provided.length) return false;
    return crypto.timingSafeEqual(expected, provided);
  } catch {
    return false;
  }
}

type SignedOpsSessionPrincipal = Pick<AuthPrincipal, "uid" | "isStaff" | "roles" | "portalRole" | "opsRoles" | "opsCapabilities">;

function createSignedOpsSessionToken(secret: string, ttlSeconds: number, principal: SignedOpsSessionPrincipal): string {
  const nowMs = Date.now();
  const expiresAt = nowMs + Math.max(60, Math.min(3600, ttlSeconds)) * 1000;
  const payload = {
    aud: "studio-brain-ops",
    sub: principal.uid,
    principal: {
      uid: principal.uid,
      isStaff: principal.isStaff,
      roles: principal.roles,
      portalRole: principal.portalRole,
      opsRoles: principal.opsRoles,
      opsCapabilities: principal.opsCapabilities,
    },
    iat: nowMs,
    exp: expiresAt,
    nonce: crypto.randomBytes(12).toString("base64url"),
  };
  const payloadEncoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = crypto.createHmac("sha256", secret).update(payloadEncoded).digest("hex");
  return `sbops.${payloadEncoded}.${signature}`;
}

function parseSignedOpsSessionPrincipal(value: unknown): AuthPrincipal | null {
  const payload = toObjectRecord(value);
  const uid = toTrimmedString(payload.uid);
  if (!uid) return null;
  const portalRoleRaw = toTrimmedString(payload.portalRole);
  const portalRole: OpsPortalRole =
    portalRoleRaw === "admin" || portalRoleRaw === "staff" || portalRoleRaw === "member" ? portalRoleRaw : "member";
  const opsRoles = toStringList(payload.opsRoles, 32).filter((entry): entry is OpsHumanRole =>
    [
      "owner",
      "member_ops",
      "support_ops",
      "kiln_lead",
      "floor_staff",
      "events_ops",
      "library_ops",
      "finance_ops",
    ].includes(entry)
  );
  const opsCapabilities = toStringList(payload.opsCapabilities, 96).filter(Boolean) as OpsCapability[];
  const roles = toStringList(payload.roles, 32);
  const isStaff = payload.isStaff === true || portalRole === "admin" || portalRole === "staff" || opsRoles.length > 0;
  if (!isStaff) return null;
  return {
    uid,
    isStaff,
    roles,
    portalRole,
    opsRoles,
    opsCapabilities,
  };
}

function verifySignedOpsSessionToken(token: string, secret: string): AuthPrincipal | null {
  const trimmed = token.trim();
  if (!trimmed.startsWith("sbops.")) return null;
  const parts = trimmed.split(".");
  if (parts.length !== 3) return null;
  const payloadEncoded = parts[1] ?? "";
  const providedSignature = parts[2] ?? "";
  const expectedSignature = crypto.createHmac("sha256", secret).update(payloadEncoded).digest("hex");
  if (!verifyHmacSignature(expectedSignature, providedSignature)) {
    return null;
  }
  try {
    const decoded = JSON.parse(Buffer.from(payloadEncoded, "base64url").toString("utf8")) as {
      aud?: string;
      exp?: number;
      iat?: number;
      principal?: unknown;
      sub?: string;
    };
    const exp = decoded.exp ?? 0;
    const iat = decoded.iat ?? 0;
    if (decoded.aud !== "studio-brain-ops") return null;
    if (!Number.isFinite(exp) || exp <= Date.now()) return null;
    if (!Number.isFinite(iat) || iat > Date.now() + 60_000) return null;
    const principal = parseSignedOpsSessionPrincipal(decoded.principal);
    if (!principal || principal.uid !== decoded.sub) return null;
    return principal;
  } catch {
    return null;
  }
}

function toNormalizedSet(values: string[] | undefined): Set<string> {
  return new Set(
    (values ?? [])
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean)
  );
}

function parseActor(payload: Record<string, unknown>): CapabilityActorContext {
  const ownerUid = String(payload.ownerUid ?? "unknown");
  const tenantIdRaw = typeof payload.tenantId === "string" ? payload.tenantId.trim() : "";
  return {
    actorType: String(payload.actorType ?? "staff") as CapabilityActorContext["actorType"],
    actorId: String(payload.actorId ?? "unknown"),
    ownerUid,
    tenantId: tenantIdRaw || ownerUid,
    effectiveScopes: Array.isArray(payload.effectiveScopes)
      ? payload.effectiveScopes.map((scope) => String(scope))
      : [],
  };
}

function parseDelegation(payload: Record<string, unknown>): DelegationPayload | undefined {
  if (!payload.delegation || typeof payload.delegation !== "object") return undefined;
  const row = payload.delegation as Record<string, unknown>;
  return {
    delegationId: typeof row.delegationId === "string" ? row.delegationId : undefined,
    agentUid: typeof row.agentUid === "string" ? row.agentUid : undefined,
    ownerUid: typeof row.ownerUid === "string" ? row.ownerUid : undefined,
    scopes: Array.isArray(row.scopes) ? row.scopes.map((scope) => String(scope)) : undefined,
    issuedAt: typeof row.issuedAt === "string" ? row.issuedAt : undefined,
    expiresAt: typeof row.expiresAt === "string" ? row.expiresAt : undefined,
    revokedAt: typeof row.revokedAt === "string" ? row.revokedAt : undefined,
  };
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && value[0]) return value[0];
  return undefined;
}

function parseTraceId(traceparent: string | undefined): string | null {
  if (!traceparent) return null;
  const parts = traceparent.split("-");
  return parts.length >= 2 ? parts[1] ?? null : null;
}

type AuthPrincipal = {
  uid: string;
  isStaff: boolean;
  roles: string[];
  portalRole: OpsPortalRole;
  opsRoles: OpsHumanRole[];
  opsCapabilities: OpsCapability[];
};

function ensureFirebaseAdminForAuth(): void {
  if (getApps().length > 0) return;
  initializeApp({ projectId: resolveFirebaseProjectId() });
}

async function verifyFirebaseAuthHeader(authorizationHeader: string | undefined): Promise<AuthPrincipal> {
  if (!authorizationHeader) {
    throw new Error("Missing Authorization header.");
  }
  const match = authorizationHeader.match(/^Bearer\s+(.+)$/i);
  if (!match || !match[1]) {
    throw new Error("Invalid Authorization header format.");
  }
  ensureFirebaseAdminForAuth();
  const decoded = await getAuth().verifyIdToken(match[1]);
  const roles = Array.isArray(decoded.roles) ? decoded.roles.map((value) => String(value)) : [];
  const claims = decoded as Record<string, unknown>;
  const portalRole = derivePortalRoleFromClaims(claims);
  const opsRoles = deriveOpsRolesFromClaims(claims);
  const opsCapabilities = deriveOpsCapabilitiesFromClaims(claims);
  const isStaff = decoded.staff === true || decoded.admin === true || roles.includes("staff") || roles.includes("admin") || opsRoles.length > 0;
  return {
    uid: decoded.uid,
    isStaff,
    roles,
    portalRole,
    opsRoles,
    opsCapabilities,
  };
}

export function startHttpServer(params: {
  host: string;
  port: number;
  logger: Logger;
  stateStore: StateStore;
  eventStore: EventStore;
  artifactStore?: ArtifactStore | null;
  kilnStore?: KilnStore | null;
  kilnEnabled?: boolean;
  kilnImportMaxBytes?: number;
  kilnEnableSupportedWrites?: boolean;
  kilnObservationProvider?: KilnObservationProvider | null;
  requireFreshSnapshotForReady?: boolean;
  readyMaxSnapshotAgeMinutes?: number;
  pgCheck?: () => Promise<{ ok: boolean; latencyMs: number; error?: string }>;
  getRuntimeStatus?: RuntimeStatusProvider;
  getRuntimeMetrics?: RuntimeMetricsProvider;
  capabilityRuntime?: CapabilityRuntime;
  allowedOrigins?: string[];
  adminToken?: string;
  verifyFirebaseAuth?: (authorizationHeader: string | undefined) => Promise<AuthPrincipal>;
  backendHealth?: () => Promise<BackendHealthReport>;
  memoryService?: MemoryService | null;
  memoryIngestConfig?: MemoryIngestConfig;
  opsService?: OpsService | null;
  opsIngestConfig?: OpsIngestConfig;
  opsPortalConfig?: {
    enabled?: boolean;
    requireStaffAuth?: boolean;
    compareEnabled?: boolean;
    legacyUrl?: string;
    defaultSurface?: string;
  };
  endpointRateLimits?: Partial<EndpointRateLimitConfig>;
  abuseQuotaStore?: QuotaStore;
  pilotWriteExecutor?: PilotWriteExecutor | null;
  supportOpsStore?: SupportOpsStore | null;
  controlTowerRepoRoot?: string;
  controlTowerRootSession?: string;
  controlTowerHostUser?: string;
  controlTowerSshHostAlias?: string;
  controlTowerRunner?: ControlTowerRunner;
}): http.Server {
  const {
    host,
    port,
    logger,
    stateStore,
    eventStore,
    artifactStore = null,
    kilnStore = null,
    kilnEnabled = false,
    kilnImportMaxBytes = 5 * 1024 * 1024,
    kilnEnableSupportedWrites = false,
    kilnObservationProvider = null,
    requireFreshSnapshotForReady = false,
    readyMaxSnapshotAgeMinutes = 240,
    pgCheck = checkPgConnection,
    getRuntimeStatus,
    getRuntimeMetrics,
    capabilityRuntime,
    allowedOrigins = [],
    adminToken,
    verifyFirebaseAuth = verifyFirebaseAuthHeader,
    backendHealth,
    memoryService = null,
    memoryIngestConfig,
    opsService = null,
    opsIngestConfig,
    opsPortalConfig,
    endpointRateLimits,
    abuseQuotaStore = new InMemoryQuotaStore(),
    pilotWriteExecutor = null,
    supportOpsStore = null,
    controlTowerRepoRoot,
    controlTowerRootSession = DEFAULT_CONTROL_TOWER_ROOT_SESSION,
    controlTowerHostUser = DEFAULT_CONTROL_TOWER_HOST_USER,
    controlTowerSshHostAlias,
    controlTowerRunner,
  } = params;
  const resolvedKilnImportMaxBytes = Math.max(4_096, kilnImportMaxBytes);
  const rateLimits: EndpointRateLimitConfig = {
    createProposalPerMinute: Math.max(1, endpointRateLimits?.createProposalPerMinute ?? 20),
    executeProposalPerMinute: Math.max(1, endpointRateLimits?.executeProposalPerMinute ?? 20),
    intakeOverridePerMinute: Math.max(1, endpointRateLimits?.intakeOverridePerMinute ?? 10),
    marketingReviewPerMinute: Math.max(1, endpointRateLimits?.marketingReviewPerMinute ?? 20),
  };
  const resolvedControlTowerRepoRoot = resolveControlTowerRepoRoot(controlTowerRepoRoot);
  const resolvedControlTowerRootSession = String(controlTowerRootSession || DEFAULT_CONTROL_TOWER_ROOT_SESSION).trim() || DEFAULT_CONTROL_TOWER_ROOT_SESSION;
  const resolvedControlTowerHostUser = String(controlTowerHostUser || DEFAULT_CONTROL_TOWER_HOST_USER).trim() || DEFAULT_CONTROL_TOWER_HOST_USER;
  const resolvedControlTowerSshHostAlias = String(controlTowerSshHostAlias || process.env.STUDIO_BRAIN_SSH_HOST_ALIAS || "studiobrain").trim() || "studiobrain";
  const memoryIngest = {
    enabled: memoryIngestConfig?.enabled === true,
    hmacSecret: memoryIngestConfig?.hmacSecret?.trim() ?? "",
    maxSkewSeconds: Math.max(30, memoryIngestConfig?.maxSkewSeconds ?? 300),
    requireClientRequestId: memoryIngestConfig?.requireClientRequestId !== false,
    allowedSources: toNormalizedSet(memoryIngestConfig?.allowedSources),
    allowedDiscordGuildIds: toNormalizedSet(memoryIngestConfig?.allowedDiscordGuildIds),
    allowedDiscordChannelIds: toNormalizedSet(memoryIngestConfig?.allowedDiscordChannelIds),
  };
  const opsIngest = {
    enabled: opsIngestConfig?.enabled !== false,
    hmacSecret: opsIngestConfig?.hmacSecret?.trim() ?? "",
    maxSkewSeconds: Math.max(30, opsIngestConfig?.maxSkewSeconds ?? 300),
    allowedSources: toNormalizedSet(opsIngestConfig?.allowedSources),
  };
  const opsPortal = {
    enabled: opsPortalConfig?.enabled ?? Boolean(opsService),
    requireStaffAuth: opsPortalConfig?.requireStaffAuth !== false,
    compareEnabled: opsPortalConfig?.compareEnabled !== false,
    legacyUrl: toTrimmedString(opsPortalConfig?.legacyUrl) || null,
    defaultSurface: toTrimmedString(opsPortalConfig?.defaultSurface) || "manager",
  };
  const opsSessionSecret = String(process.env.STUDIO_BRAIN_OPS_SESSION_SECRET ?? adminToken ?? "").trim();
  const opsSessionTtlSeconds = Math.max(60, Math.min(3600, Number(process.env.STUDIO_BRAIN_OPS_SESSION_TTL_SECONDS ?? "900") || 900));

  const readControlTowerSnapshot = async () => {
    const [overseerRun, audits, proposals] = await Promise.all([
      stateStore.getLatestOverseerRun(),
      eventStore.listRecent(200),
      capabilityRuntime ? capabilityRuntime.listProposals(25) : Promise.resolve([]),
    ]);
    const raw = collectControlTowerRawState({
      repoRoot: resolvedControlTowerRepoRoot,
      rootSession: resolvedControlTowerRootSession,
      hostUser: resolvedControlTowerHostUser,
      overseerRun,
      runner: controlTowerRunner,
    });
    writeControlTowerState(raw, resolvedControlTowerRepoRoot);
    const approvals = capabilityRuntime
      ? buildControlTowerApprovals(proposals, capabilityRuntime.listCapabilities())
      : [];
    const initialState = deriveControlTowerState(raw, audits, { approvals });
    const memoryBrief = readControlTowerMemoryBrief(resolvedControlTowerRepoRoot, initialState.memoryBrief);
    const startupScorecard = readControlTowerStartupScorecard(resolvedControlTowerRepoRoot);
    const agentRuntime = readLatestAgentRuntimeSummary(resolvedControlTowerRepoRoot);
    const hosts = dedupeHosts([
      buildServerHostCard(raw, agentRuntime),
      ...listControlTowerHostHeartbeats(resolvedControlTowerRepoRoot),
    ]);
    const stateWithMemory = deriveControlTowerState(raw, audits, {
      approvals,
      memoryBrief,
    });
    const partner = deriveAndPersistPartnerBrief({
      repoRoot: resolvedControlTowerRepoRoot,
      generatedAt: raw.generatedAt,
      memoryBrief,
        rooms: stateWithMemory.rooms,
        approvals,
        agentRuntime,
      });
    let memoryHealth: ControlTowerMemoryHealth | null = null;
    if (memoryService) {
      try {
        memoryHealth = buildControlTowerMemoryHealth(await memoryService.stats({}));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.warn(`control tower memory health unavailable: ${message}`);
      }
    }
    const syntheticEvents = buildSyntheticControlTowerEvents(memoryBrief, approvals, agentRuntime, hosts, partner);
    const state = enrichControlTowerState(
      stateWithMemory,
      syntheticEvents,
      approvals,
      memoryBrief,
      startupScorecard,
      memoryHealth,
      agentRuntime,
      hosts,
      partner,
    );
    return { raw, state, audits };
  };

  const appendControlTowerAudit = async (
    principal: AuthPrincipal | undefined,
    action: string,
    rationale: string,
    metadata: Record<string, unknown>,
  ) => {
    return eventStore.append({
      actorType: "staff",
      actorId: principal?.uid ?? "staff:unknown",
      action,
      rationale,
      target: "local",
      approvalState: "approved",
      inputHash: action,
      outputHash: null,
      metadata,
    });
  };
  const parseBoundedEnvInt = (name: string, fallback: number, min = 0, max = 10_000): number => {
    const raw = String(process.env[name] ?? "").trim();
    if (!raw) return fallback;
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(min, Math.min(max, parsed));
  };
  const parseBoundedEnvFloat = (name: string, fallback: number, min = 0, max = 10_000): number => {
    const raw = String(process.env[name] ?? "").trim();
    if (!raw) return fallback;
    const parsed = Number.parseFloat(raw);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(min, Math.min(max, parsed));
  };
  const parseBoundedEnvBool = (name: string, fallback: boolean): boolean => {
    const raw = String(process.env[name] ?? "").trim().toLowerCase();
    if (!raw) return fallback;
    if (raw === "1" || raw === "true" || raw === "yes" || raw === "on") return true;
    if (raw === "0" || raw === "false" || raw === "no" || raw === "off") return false;
    return fallback;
  };
  const maxActiveImportsBeforeBackfill = parseBoundedEnvInt("STUDIO_BRAIN_MAX_ACTIVE_IMPORTS_BEFORE_BACKFILL", 8, 0, 10_000);
  const memoryPressureConfig = {
    maxActiveImportsBeforeBackfill,
    maxActiveImportRequests: parseBoundedEnvInt("STUDIO_BRAIN_MAX_ACTIVE_IMPORT_REQUESTS", maxActiveImportsBeforeBackfill, 1, 1_000),
    maxConcurrentBackfills: parseBoundedEnvInt("STUDIO_BRAIN_MAX_CONCURRENT_BACKFILLS", 1, 1, 100),
    retryAfterSeconds: parseBoundedEnvInt("STUDIO_BRAIN_BACKFILL_RETRY_AFTER_SECONDS", 20, 1, 3600),
    maxActiveImportsBeforeQueryDegrade: parseBoundedEnvInt("STUDIO_BRAIN_MAX_ACTIVE_IMPORTS_BEFORE_QUERY_DEGRADE", 4, 0, 10_000),
    maxActiveImportsBeforeQueryShed: parseBoundedEnvInt("STUDIO_BRAIN_MAX_ACTIVE_IMPORTS_BEFORE_QUERY_SHED", 14, 0, 10_000),
    maxActiveSearchRequests: parseBoundedEnvInt("STUDIO_BRAIN_MAX_ACTIVE_SEARCH_REQUESTS", 20, 1, 2_000),
    maxActiveContextRequests: parseBoundedEnvInt("STUDIO_BRAIN_MAX_ACTIVE_CONTEXT_REQUESTS", 12, 1, 2_000),
    maxActiveQueryRequests: parseBoundedEnvInt("STUDIO_BRAIN_MAX_ACTIVE_MEMORY_QUERY_REQUESTS", 28, 1, 4_000),
    queryRetryAfterSeconds: parseBoundedEnvInt("STUDIO_BRAIN_MEMORY_QUERY_RETRY_AFTER_SECONDS", 5, 1, 3600),
    queryDegradeLimitCap: parseBoundedEnvInt("STUDIO_BRAIN_MEMORY_QUERY_DEGRADE_LIMIT_CAP", 10, 1, 100),
    queryDegradeScanLimitCap: parseBoundedEnvInt("STUDIO_BRAIN_MEMORY_QUERY_DEGRADE_SCAN_LIMIT_CAP", 120, 10, 500),
    queryDegradeMaxItemsCap: parseBoundedEnvInt("STUDIO_BRAIN_MEMORY_QUERY_DEGRADE_MAX_ITEMS_CAP", 10, 1, 100),
    queryDegradeMaxCharsCap: parseBoundedEnvInt("STUDIO_BRAIN_MEMORY_QUERY_DEGRADE_MAX_CHARS_CAP", 6000, 512, 100_000),
    queryRouteTimeoutMs: parseBoundedEnvInt("STUDIO_BRAIN_MEMORY_QUERY_ROUTE_TIMEOUT_MS", 16_000, 1_000, 120_000),
  };
  const memoryAdaptiveConfig = {
    enabled: parseBoundedEnvBool("STUDIO_BRAIN_MEMORY_QUERY_ADAPTIVE_ENABLED", true),
    p95TargetMs: parseBoundedEnvInt("STUDIO_BRAIN_MEMORY_QUERY_ADAPTIVE_P95_TARGET_MS", 1200, 100, 60_000),
    minFactor: parseBoundedEnvFloat("STUDIO_BRAIN_MEMORY_QUERY_ADAPTIVE_MIN_FACTOR", 0.45, 0.1, 1),
    maxFactor: parseBoundedEnvFloat("STUDIO_BRAIN_MEMORY_QUERY_ADAPTIVE_MAX_FACTOR", 1.2, 0.4, 3),
    sampleWindow: parseBoundedEnvInt("STUDIO_BRAIN_MEMORY_QUERY_ADAPTIVE_SAMPLE_WINDOW", 240, 20, 5_000),
  };
  const memoryQueueConfig = {
    enabled: parseBoundedEnvBool("STUDIO_BRAIN_MEMORY_QUERY_QUEUE_ENABLED", true),
    interactiveWaitMs: parseBoundedEnvInt("STUDIO_BRAIN_MEMORY_QUERY_INTERACTIVE_QUEUE_WAIT_MS", 1200, 0, 30_000),
    pollMs: parseBoundedEnvInt("STUDIO_BRAIN_MEMORY_QUERY_QUEUE_POLL_MS", 120, 20, 2_000),
  };
  const memorySearchLatencySamples: number[] = [];
  const memoryContextLatencySamples: number[] = [];
  const pushLatencySample = (bucket: number[], latencyMs: number): void => {
    if (!Number.isFinite(latencyMs) || latencyMs < 0) return;
    bucket.push(Math.round(latencyMs));
    if (bucket.length > memoryAdaptiveConfig.sampleWindow) {
      bucket.splice(0, bucket.length - memoryAdaptiveConfig.sampleWindow);
    }
  };
  const percentile = (values: number[], p: number): number => {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((left, right) => left - right);
    const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * p) - 1));
    return sorted[idx] ?? 0;
  };
  const latencySnapshot = () => ({
    searchP95Ms: percentile(memorySearchLatencySamples, 0.95),
    contextP95Ms: percentile(memoryContextLatencySamples, 0.95),
    searchSamples: memorySearchLatencySamples.length,
    contextSamples: memoryContextLatencySamples.length,
  });
  const recordMemoryLatency = (kind: "search" | "context", startedAtMs: number): void => {
    const duration = Date.now() - startedAtMs;
    if (kind === "search") {
      pushLatencySample(memorySearchLatencySamples, duration);
      return;
    }
    pushLatencySample(memoryContextLatencySamples, duration);
  };
  const clampInt = (value: number, min: number, max: number): number => {
    if (!Number.isFinite(value)) return min;
    return Math.max(min, Math.min(max, Math.trunc(value)));
  };
  const resolveDynamicMemoryThresholds = () => {
    if (!memoryAdaptiveConfig.enabled) {
      return {
        ...memoryPressureConfig,
      };
    }
    const latency = latencySnapshot();
    const p95Target = Math.max(100, memoryAdaptiveConfig.p95TargetMs);
    const p95Observed = Math.max(latency.searchP95Ms, latency.contextP95Ms);
    const ratio = p95Observed > 0 ? p95Target / p95Observed : 1;
    const factor = Math.max(memoryAdaptiveConfig.minFactor, Math.min(memoryAdaptiveConfig.maxFactor, ratio));
    return {
      ...memoryPressureConfig,
      maxActiveSearchRequests: clampInt(
        memoryPressureConfig.maxActiveSearchRequests * factor,
        4,
        memoryPressureConfig.maxActiveSearchRequests
      ),
      maxActiveContextRequests: clampInt(
        memoryPressureConfig.maxActiveContextRequests * factor,
        2,
        memoryPressureConfig.maxActiveContextRequests
      ),
      maxActiveQueryRequests: clampInt(
        memoryPressureConfig.maxActiveQueryRequests * factor,
        4,
        memoryPressureConfig.maxActiveQueryRequests
      ),
    };
  };
  let activeImportRequests = 0;
  let activeBackfillRequests = 0;
  let activeSearchRequests = 0;
  let activeContextRequests = 0;
  const memoryPressureSnapshot = (thresholds = resolveDynamicMemoryThresholds()) => ({
    activeImportRequests,
    activeBackfillRequests,
    activeSearchRequests,
    activeContextRequests,
    activeQueryRequests: activeSearchRequests + activeContextRequests,
    latency: latencySnapshot(),
    thresholds: {
      maxActiveImportsBeforeBackfill: thresholds.maxActiveImportsBeforeBackfill,
      maxActiveImportRequests: thresholds.maxActiveImportRequests,
      maxConcurrentBackfills: thresholds.maxConcurrentBackfills,
      retryAfterSeconds: thresholds.retryAfterSeconds,
      maxActiveImportsBeforeQueryDegrade: thresholds.maxActiveImportsBeforeQueryDegrade,
      maxActiveImportsBeforeQueryShed: thresholds.maxActiveImportsBeforeQueryShed,
      maxActiveSearchRequests: thresholds.maxActiveSearchRequests,
      maxActiveContextRequests: thresholds.maxActiveContextRequests,
      maxActiveQueryRequests: thresholds.maxActiveQueryRequests,
      queryRetryAfterSeconds: thresholds.queryRetryAfterSeconds,
      queryDegradeLimitCap: thresholds.queryDegradeLimitCap,
      queryDegradeScanLimitCap: thresholds.queryDegradeScanLimitCap,
      queryDegradeMaxItemsCap: thresholds.queryDegradeMaxItemsCap,
      queryDegradeMaxCharsCap: thresholds.queryDegradeMaxCharsCap,
      queryRouteTimeoutMs: thresholds.queryRouteTimeoutMs,
    },
  });
  type MemoryQueryLane = "interactive" | "ops" | "bulk";
  type MemoryQueryKind = "search" | "context";
  const deriveMemoryQueryLane = (payload: Record<string, unknown>, fallback: MemoryQueryLane = "interactive"): MemoryQueryLane => {
    const requestedLane = toTrimmedString(payload.queryLane).toLowerCase();
    if (requestedLane === "interactive" || requestedLane === "ops" || requestedLane === "bulk") {
      return requestedLane;
    }
    if (toBooleanFlag(toTrimmedString(payload.bulk), false)) {
      return "bulk";
    }
    const hasSessionScope = Boolean(toTrimmedString(payload.runId) || toTrimmedString(payload.agentId));
    if (hasSessionScope) {
      return "interactive";
    }
    return fallback;
  };
  const classifyMemoryQueryPressure = (lane: MemoryQueryLane, kind: MemoryQueryKind) => {
    const thresholds = resolveDynamicMemoryThresholds();
    const pressure = memoryPressureSnapshot(thresholds);
    const reasons: string[] = [];
    const querySaturated = pressure.activeQueryRequests >= thresholds.maxActiveQueryRequests;
    if (querySaturated) {
      reasons.push("query-concurrency-saturated");
    }
    const importDegrade = pressure.activeImportRequests >= thresholds.maxActiveImportsBeforeQueryDegrade;
    const importShed = pressure.activeImportRequests >= thresholds.maxActiveImportsBeforeQueryShed;
    if (importDegrade) {
      reasons.push("active-import-pressure");
    }
    if (pressure.activeBackfillRequests >= thresholds.maxConcurrentBackfills) {
      reasons.push("backfill-pressure");
    }
    const kindSaturated =
      kind === "search"
        ? pressure.activeSearchRequests >= thresholds.maxActiveSearchRequests
        : pressure.activeContextRequests >= thresholds.maxActiveContextRequests;
    if (kindSaturated) {
      reasons.push(`${kind}-concurrency-saturated`);
    }
    const backfillAtCapacity = pressure.activeBackfillRequests >= thresholds.maxConcurrentBackfills;
    const backfillDegrade = backfillAtCapacity && (lane !== "interactive" || importDegrade || querySaturated || kindSaturated);
    if (backfillDegrade) {
      reasons.push("backfill-pressure");
    }
    const degrade = importDegrade || querySaturated || kindSaturated || backfillDegrade;
    const interactiveContextShed = kind === "context" && kindSaturated;
    const shed =
      lane === "bulk"
        ? importShed || querySaturated || kindSaturated
        : importShed || querySaturated || interactiveContextShed;
    return {
      pressure,
      thresholds,
      reasons: Array.from(new Set(reasons)),
      degrade,
      shed,
      queued: false,
      queueWaitMs: 0,
    };
  };
  const waitForMemoryQuerySlot = async (
    lane: MemoryQueryLane,
    kind: MemoryQueryKind,
    requestId: string
  ): Promise<{
    pressure: ReturnType<typeof memoryPressureSnapshot>;
    thresholds: ReturnType<typeof resolveDynamicMemoryThresholds>;
    reasons: string[];
    degrade: boolean;
    shed: boolean;
    queued: boolean;
    queueWaitMs: number;
  }> => {
    let policy = classifyMemoryQueryPressure(lane, kind);
    if (!policy.shed || lane !== "interactive" || !memoryQueueConfig.enabled || memoryQueueConfig.interactiveWaitMs <= 0) {
      return {
        ...policy,
        queued: false,
        queueWaitMs: 0,
      };
    }
    const startedAt = Date.now();
    let queued = false;
    while (Date.now() - startedAt < memoryQueueConfig.interactiveWaitMs) {
      const waitMs = Math.min(memoryQueueConfig.pollMs, memoryQueueConfig.interactiveWaitMs);
      await new Promise((resolveWait) => setTimeout(resolveWait, waitMs));
      policy = classifyMemoryQueryPressure(lane, kind);
      if (!policy.shed) {
        queued = true;
        break;
      }
    }
    const queueWaitMs = Date.now() - startedAt;
    if (queued) {
      logger.info("memory_query_queue_admitted", {
        requestId,
        endpoint: kind === "search" ? "/api/memory/search" : "/api/memory/context",
        lane,
        queueWaitMs,
        reasons: policy.reasons,
        pressure: policy.pressure,
      });
    }
    return {
      ...policy,
      queued,
      queueWaitMs,
    };
  };

  const isOriginAllowed = (origin: string | null): boolean => {
    if (!origin) return true;
    return allowedOrigins.includes(origin);
  };

  const corsHeadersFor = (origin: string | null): Record<string, string> => {
    if (!origin || !isOriginAllowed(origin)) return {};
    return {
      "access-control-allow-origin": origin,
      "access-control-allow-headers":
        "content-type, authorization, x-studio-brain-admin-token, x-memory-ingest-signature, x-memory-ingest-timestamp, x-ops-ingest-signature, x-ops-ingest-timestamp, x-studio-brain-ops-session",
      "access-control-allow-methods": "GET,POST,OPTIONS",
      "access-control-max-age": "600",
      vary: "Origin",
    };
  };

  const assertCapabilityAuth = async (
    req: http.IncomingMessage,
    { requireAdminToken = true }: { requireAdminToken?: boolean } = {}
  ): Promise<{ ok: boolean; message?: string; principal?: AuthPrincipal }> => {
    try {
      const authorizationHeader = Array.isArray(req.headers.authorization)
        ? req.headers.authorization[0]
        : req.headers.authorization;
      const principal = await verifyFirebaseAuth(authorizationHeader);
      if (!principal.isStaff) {
        return { ok: false, message: "Staff claim required for studio-brain capability endpoints." };
      }
      if (!requireAdminToken || !adminToken || adminToken.trim().length === 0) {
        return { ok: true, principal };
      }
      const provided = req.headers["x-studio-brain-admin-token"];
      const token = Array.isArray(provided) ? provided[0] : provided;
      if (!token || token !== adminToken) {
        return { ok: false, message: "Missing or invalid studio-brain admin token." };
      }
      return { ok: true, principal };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) };
    }
  };
  const assertKilnAccess = (req: http.IncomingMessage) =>
    assertCapabilityAuth(req, { requireAdminToken: false });
  const assertOpsPortalAuth = async (
    req: http.IncomingMessage,
  ): Promise<{ ok: true; principal?: AuthPrincipal; actorId: string } | { ok: false; message: string; actorId: string }> => {
    if (!opsPortal.requireStaffAuth) {
      return { ok: true, actorId: "ops-portal:anonymous" };
    }
    const sessionToken = firstHeader(req.headers["x-studio-brain-ops-session"]);
    if (opsSessionSecret && sessionToken) {
      const principal = verifySignedOpsSessionToken(sessionToken, opsSessionSecret);
      if (principal) {
        return { ok: true, principal, actorId: principal.uid };
      }
    }
    const auth = await assertCapabilityAuth(req, { requireAdminToken: false });
    if (!auth.ok) {
      return { ok: false, message: auth.message ?? "Unauthorized", actorId: "unknown" };
    }
    return { ok: true, principal: auth.principal, actorId: auth.principal?.uid ?? "staff:unknown" };
  };
  const memoryImportPressureRejection = (route: string, requestId: string) => {
    const thresholds = resolveDynamicMemoryThresholds();
    if (activeImportRequests < thresholds.maxActiveImportRequests) return null;
    const pressure = memoryPressureSnapshot(thresholds);
    logger.warn("memory_import_shed", {
      route,
      reason: "active-import-pressure",
      pressure,
      requestId,
    });
    return {
      message: "Memory import is busy; retry later.",
      reason: "active-import-pressure",
      retryAfterSeconds: thresholds.retryAfterSeconds,
      pressure,
    };
  };
  const assertHostHeartbeatAuth = async (
    req: http.IncomingMessage,
  ): Promise<{ ok: boolean; message?: string; principal?: AuthPrincipal; actorId: string }> => {
    const provided = firstHeader(req.headers["x-studio-brain-admin-token"]);
    if (adminToken && provided && provided === adminToken) {
      return { ok: true, actorId: "machine:control-tower-host" };
    }
    const auth = await assertCapabilityAuth(req, { requireAdminToken: false });
    if (!auth.ok) {
      return { ok: false, message: auth.message, actorId: "unknown" };
    }
    return { ok: true, principal: auth.principal, actorId: auth.principal?.uid ?? "staff:unknown" };
  };
  const opsActorContext = (auth: { principal?: AuthPrincipal; actorId: string }) => ({
    actorId: auth.actorId,
    isStaff: auth.principal?.isStaff ?? false,
    portalRole: auth.principal?.portalRole ?? "member",
    opsRoles: auth.principal?.opsRoles ?? [],
    opsCapabilities: auth.principal?.opsCapabilities ?? [],
  });
  const kilnProviderSupport = () => kilnObservationProvider?.describeSupport() ?? null;
  const ensureKilnRuntime = (): { ok: true } | { ok: false; message: string } => {
    if (!kilnEnabled) {
      return { ok: false, message: "Kiln overlay is disabled." };
    }
    if (!kilnStore) {
      return { ok: false, message: "Kiln store is unavailable." };
    }
    return { ok: true };
  };
  const ensureKilnArtifacts = (): { ok: true } | { ok: false; message: string } => {
    const runtime = ensureKilnRuntime();
    if (!runtime.ok) return runtime;
    if (!artifactStore) {
      return { ok: false, message: "Kiln artifact store is unavailable." };
    }
    return { ok: true };
  };

  const server = http.createServer(async (req, res) => {
    const requestId =
      firstHeader(req.headers["x-request-id"]) ??
      firstHeader(req.headers["x-trace-id"]) ??
      firstHeader(req.headers["traceparent"]) ??
      crypto.randomUUID();
    const startedAt = Date.now();
    const traceParent = firstHeader(req.headers["traceparent"]);
    const traceId = parseTraceId(traceParent);
    const method = req.method ?? "GET";
    const url = new URL(req.url ?? "/", `http://${host}:${port}`);
    const originHeader = req.headers.origin ?? null;
    const corsHeaders = corsHeadersFor(originHeader);
    let statusCode = 500;
    const requestMeta = {
      requestId,
      method,
      path: url.pathname,
      traceId: traceId ?? requestId,
      traceParent,
    };
    res.setHeader("x-request-id", requestId);
    res.setHeader("x-trace-id", requestMeta.traceId);
    if (traceParent) {
      res.setHeader("traceparent", traceParent);
    }
    logger.debug("studio_brain_http_request_start", requestMeta);

    try {
      const enforceRateLimit = async (
        bucket: string,
        limit: number,
        windowSeconds: number,
        actorId: string,
        capabilityId: string | null = null
      ): Promise<{ allowed: boolean; retryAfterSeconds: number }> => {
        const decision = await abuseQuotaStore.consume(bucket, limit, windowSeconds, Date.now());
        if (decision.allowed) return { allowed: true, retryAfterSeconds: 0 };
        await eventStore.append({
          actorType: "system",
          actorId: "studio-brain",
          action: "rate_limit_triggered",
          rationale: "Endpoint abuse control triggered.",
          target: "local",
          approvalState: "required",
          inputHash: bucket,
          outputHash: null,
          metadata: {
            bucket,
            actorId,
            capabilityId,
            limit,
            windowSeconds,
            retryAfterSeconds: decision.retryAfterSeconds,
            method,
            path: url.pathname,
          },
        });
        return { allowed: false, retryAfterSeconds: decision.retryAfterSeconds };
      };

      if (method === "OPTIONS") {
        statusCode = isOriginAllowed(originHeader) ? 204 : 403;
        res.writeHead(statusCode, withSecurityHeaders({ ...corsHeaders, "x-request-id": requestId }));
        res.end();
        return;
      }

      if (method === "GET" && url.pathname === "/healthz") {
        statusCode = 200;
        res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
        res.end(JSON.stringify({ ok: true, service: "studio-brain", at: new Date().toISOString() }));
        return;
      }

      if (method === "GET" && url.pathname === "/health/dependencies") {
        const dependencyHealth = backendHealth ? await backendHealth() : { at: new Date().toISOString(), ok: true, checks: [] };
        statusCode = dependencyHealth.ok ? 200 : 503;
        res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
        res.end(JSON.stringify(dependencyHealth));
        return;
      }

      if (method === "GET" && url.pathname === "/readyz") {
        const [pg, snapshot] = await Promise.all([pgCheck(), stateStore.getLatestStudioState()]);
        const generatedMillis = snapshot ? parseIsoToMillis(snapshot.generatedAt) : null;
        const snapshotAgeMinutes =
          generatedMillis === null ? null : Math.floor((Date.now() - generatedMillis) / 60_000);
        const hasFreshSnapshot =
          snapshotAgeMinutes !== null ? snapshotAgeMinutes <= readyMaxSnapshotAgeMinutes : false;
        const freshSnapshotSatisfied = requireFreshSnapshotForReady ? hasFreshSnapshot : true;
        const ok = pg.ok && freshSnapshotSatisfied;

        statusCode = ok ? 200 : 503;
        res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
        res.end(
          JSON.stringify({
            ok,
            checks: {
              postgres: pg,
              snapshot: {
                exists: Boolean(snapshot),
                generatedAt: snapshot?.generatedAt ?? null,
                ageMinutes: snapshotAgeMinutes,
                maxAgeMinutes: readyMaxSnapshotAgeMinutes,
                requireFresh: requireFreshSnapshotForReady,
                fresh: hasFreshSnapshot,
              },
            },
            at: new Date().toISOString(),
          })
        );
        return;
      }

      if (method === "GET" && url.pathname === "/api/studio-state/latest") {
        const snapshot = await stateStore.getLatestStudioState();
        statusCode = 200;
        res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
        res.end(JSON.stringify({ ok: true, snapshot }));
        return;
      }

      if (memoryService && method === "POST" && url.pathname === "/api/memory/capture") {
        const auth = await assertCapabilityAuth(req);
        if (!auth.ok) {
          statusCode = 401;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: auth.message }));
          return;
        }

        try {
          const payload = await readJsonBody(req);
          const metadata =
            payload.metadata && typeof payload.metadata === "object" && !Array.isArray(payload.metadata)
              ? (payload.metadata as Record<string, unknown>)
              : {};
          const memory = await memoryService.capture({
            ...payload,
            metadata: {
              ...metadata,
              writerUid: auth.principal?.uid ?? "staff:unknown",
            },
          });
          statusCode = 201;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: true, memory }));
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const isValidation = error instanceof MemoryValidationError;
          statusCode = isValidation ? 400 : 500;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message }));
        }
        return;
      }

      if (memoryService && method === "POST" && url.pathname === "/api/memory/consolidate") {
        const auth = await assertCapabilityAuth(req);
        if (!auth.ok) {
          statusCode = 401;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: auth.message }));
          return;
        }

        try {
          const payload = toObjectRecord(await readJsonBody(req));
          const result = await memoryService.consolidate(payload);
          try {
            await appendControlTowerAudit(
              auth.principal,
              "studio_brain.memory_consolidated",
              "Memory consolidation executed via the Studio Brain HTTP control plane.",
              {
                endpoint: "/api/memory/consolidate",
                mode: toTrimmedString(payload.mode) || "idle",
                runId: toTrimmedString(payload.runId) || null,
                tenantId: toTrimmedString(payload.tenantId) || null,
                focusAreas: toStringList(payload.focusAreas, 12),
                requestOrigin: toTrimmedString(payload.requestOrigin) || null,
                requestedTransport: toTrimmedString(payload.requestedTransport) || null,
                transport: toTrimmedString(payload.transport) || null,
                status: toTrimmedString((result as Record<string, unknown>)?.status) || null,
              },
            );
          } catch (auditError) {
            logger.warn(
              `memory consolidation audit append failed: ${auditError instanceof Error ? auditError.message : String(auditError)}`,
            );
          }
          statusCode = 200;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: true, result }));
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const isValidation = error instanceof MemoryValidationError;
          statusCode = isValidation ? 400 : 500;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message }));
        }
        return;
      }

      if (memoryService && method === "POST" && url.pathname === "/api/memory/ingest") {
        if (!memoryIngest.enabled) {
          statusCode = 404;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: "Memory ingest endpoint is disabled." }));
          return;
        }
        if (!memoryIngest.hmacSecret) {
          statusCode = 503;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: "Memory ingest endpoint is misconfigured." }));
          return;
        }

        try {
          const timestampRaw = firstHeader(req.headers["x-memory-ingest-timestamp"]);
          const signatureRaw = firstHeader(req.headers["x-memory-ingest-signature"]);
          const timestampSeconds = parseEpochSeconds(timestampRaw);
          const providedSignature = normalizeHmacSignature(signatureRaw);

          if (!timestampSeconds || !providedSignature) {
            statusCode = 401;
            res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
            res.end(JSON.stringify({ ok: false, message: "Missing or invalid ingest signature headers." }));
            return;
          }
          if (!isTimestampWithinSkew(timestampSeconds, Date.now(), memoryIngest.maxSkewSeconds)) {
            statusCode = 401;
            res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
            res.end(JSON.stringify({ ok: false, message: "Ingest signature timestamp is outside allowed skew." }));
            return;
          }

          const parsedBody = await readJsonBodyWithRaw(req);
          const expectedSignature = crypto
            .createHmac("sha256", memoryIngest.hmacSecret)
            .update(`${timestampSeconds}.${parsedBody.raw}`)
            .digest("hex");

          if (!verifyHmacSignature(expectedSignature, providedSignature)) {
            statusCode = 401;
            res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
            res.end(JSON.stringify({ ok: false, message: "Invalid ingest signature." }));
            return;
          }

          const payload = parsedBody.json;
          const sourceRaw = typeof payload.source === "string" ? payload.source.trim() : "";
          const source = sourceRaw.toLowerCase();
          if (memoryIngest.allowedSources.size > 0 && (!source || !memoryIngest.allowedSources.has(source))) {
            statusCode = 403;
            res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
            res.end(JSON.stringify({ ok: false, message: "Memory ingest source is not allowed." }));
            return;
          }

          const metadata =
            payload.metadata && typeof payload.metadata === "object" && !Array.isArray(payload.metadata)
              ? (payload.metadata as Record<string, unknown>)
              : {};
          if (source === "discord") {
            const guildId = String(metadata.discordGuildId ?? metadata.guildId ?? "").trim().toLowerCase();
            const channelId = String(metadata.discordChannelId ?? metadata.channelId ?? "").trim().toLowerCase();
            if (memoryIngest.allowedDiscordGuildIds.size > 0 && (!guildId || !memoryIngest.allowedDiscordGuildIds.has(guildId))) {
              statusCode = 403;
              res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
              res.end(JSON.stringify({ ok: false, message: "Discord guild is not allowed for ingest." }));
              return;
            }
            if (memoryIngest.allowedDiscordChannelIds.size > 0 && (!channelId || !memoryIngest.allowedDiscordChannelIds.has(channelId))) {
              statusCode = 403;
              res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
              res.end(JSON.stringify({ ok: false, message: "Discord channel is not allowed for ingest." }));
              return;
            }
          }

          if (memoryIngest.requireClientRequestId) {
            const clientRequestIdRaw = typeof payload.clientRequestId === "string" ? payload.clientRequestId.trim() : "";
            if (!clientRequestIdRaw) {
              statusCode = 400;
              res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
              res.end(JSON.stringify({ ok: false, message: "clientRequestId is required for memory ingest." }));
              return;
            }
          }
          const pressureRejection = memoryImportPressureRejection("/api/memory/ingest", requestId);
          if (pressureRejection) {
            statusCode = 429;
            res.writeHead(
              statusCode,
              withSecurityHeaders({
                "content-type": "application/json",
                ...corsHeaders,
                "retry-after": String(pressureRejection.retryAfterSeconds),
                "x-request-id": requestId,
              })
            );
            res.end(JSON.stringify({ ok: false, ...pressureRejection }));
            return;
          }

          let memory;
          activeImportRequests += 1;
          try {
            memory = await memoryService.capture(payload);
          } finally {
            activeImportRequests = Math.max(0, activeImportRequests - 1);
          }
          statusCode = 201;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: true, memory }));
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const isValidation =
            error instanceof MemoryValidationError ||
            (error instanceof Error && error.message === "JSON body must be an object.");
          statusCode = isValidation ? 400 : 500;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message }));
        }
        return;
      }

      if (memoryService && method === "POST" && url.pathname === "/api/memory/context") {
        const auth = await assertCapabilityAuth(req, { requireAdminToken: false });
        if (!auth.ok) {
          statusCode = 401;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: auth.message }));
          return;
        }
        let payload: Record<string, unknown> = {};
        let lane: MemoryQueryLane = "interactive";
        let routeStartedAtMs = Date.now();
        let policy = classifyMemoryQueryPressure(lane, "context");
        try {
          payload = toObjectRecord(await readJsonBody(req));
          lane = deriveMemoryQueryLane(payload, "interactive");
          routeStartedAtMs = Date.now();
          policy = await waitForMemoryQuerySlot(lane, "context", requestId);
          if (policy.shed) {
            logger.warn("memory_query_shed", {
              requestId,
              endpoint: "/api/memory/context",
              lane,
              reasons: policy.reasons,
              pressure: policy.pressure,
            });
            statusCode = 503;
            res.writeHead(
              statusCode,
              withSecurityHeaders({
                "content-type": "application/json",
                ...corsHeaders,
                "x-request-id": requestId,
                "retry-after": String(policy.thresholds.queryRetryAfterSeconds),
              })
            );
            res.end(
              JSON.stringify({
                ok: false,
                message: "Memory context deferred due ingest/query pressure.",
                reason: "query-shed",
                lane,
                retryAfterSeconds: policy.thresholds.queryRetryAfterSeconds,
                pressure: policy.pressure,
                degradation: {
                  applied: true,
                  lane,
                  shed: true,
                  reasons: policy.reasons,
                  queued: policy.queued,
                  queueWaitMs: policy.queueWaitMs,
                },
              })
            );
            return;
          }

          const requestedMaxItems = toBoundedInt(payload.maxItems, 12, 1, 100);
          const requestedMaxChars = toBoundedInt(payload.maxChars, 8_000, 256, 100_000);
          const requestedScanLimit = toBoundedInt(payload.scanLimit, 200, 1, 500);
          const requestedModeRaw = toTrimmedString(payload.retrievalMode).toLowerCase();
          const requestedRetrievalMode =
            requestedModeRaw === "lexical" || requestedModeRaw === "semantic" || requestedModeRaw === "hybrid"
              ? requestedModeRaw
              : "hybrid";

          const effectivePayload: Record<string, unknown> = {
            ...payload,
            maxItems: requestedMaxItems,
            maxChars: requestedMaxChars,
            scanLimit: requestedScanLimit,
            retrievalMode: requestedRetrievalMode,
          };
          const adjustments: string[] = [];
          if (policy.degrade) {
            const preferredMode = lane === "interactive" ? "hybrid" : "lexical";
            if (requestedRetrievalMode !== preferredMode) {
              effectivePayload.retrievalMode = preferredMode;
              adjustments.push(`retrievalMode:${requestedRetrievalMode}->${preferredMode}`);
            }
            const maxItemsCap =
              lane === "interactive"
                ? Math.min(100, Math.max(4, policy.thresholds.queryDegradeMaxItemsCap + 4))
                : Math.max(3, policy.thresholds.queryDegradeMaxItemsCap);
            const scanLimitCap =
              lane === "interactive"
                ? Math.min(500, Math.max(40, policy.thresholds.queryDegradeScanLimitCap + 60))
                : Math.max(24, policy.thresholds.queryDegradeScanLimitCap);
            const maxCharsCap =
              lane === "interactive"
                ? Math.min(100_000, Math.max(1_500, policy.thresholds.queryDegradeMaxCharsCap + 1_500))
                : Math.max(1_024, policy.thresholds.queryDegradeMaxCharsCap);

            const effectiveMaxItems = Math.min(requestedMaxItems, maxItemsCap);
            const effectiveScanLimit = Math.min(requestedScanLimit, scanLimitCap);
            const effectiveMaxChars = Math.min(requestedMaxChars, maxCharsCap);
            if (effectiveMaxItems !== requestedMaxItems) {
              effectivePayload.maxItems = effectiveMaxItems;
              adjustments.push(`maxItems:${requestedMaxItems}->${effectiveMaxItems}`);
            }
            if (effectiveScanLimit !== requestedScanLimit) {
              effectivePayload.scanLimit = effectiveScanLimit;
              adjustments.push(`scanLimit:${requestedScanLimit}->${effectiveScanLimit}`);
            }
            if (effectiveMaxChars !== requestedMaxChars) {
              effectivePayload.maxChars = effectiveMaxChars;
              adjustments.push(`maxChars:${requestedMaxChars}->${effectiveMaxChars}`);
            }
            if (payload.includeTenantFallback !== true) {
              effectivePayload.includeTenantFallback = true;
              adjustments.push("includeTenantFallback:true");
            }
          }

          let context;
          activeContextRequests += 1;
          try {
            context = await withRouteTimeout(
              memoryService.context(effectivePayload),
              policy.thresholds.queryRouteTimeoutMs,
              "memory context query route"
            );
          } finally {
            activeContextRequests = Math.max(0, activeContextRequests - 1);
          }
          recordMemoryLatency("context", routeStartedAtMs);
          const degradation = {
            applied: policy.degrade || adjustments.length > 0,
            lane,
            shed: false,
            reasons: Array.from(new Set([...policy.reasons, ...adjustments])),
            retryAfterSeconds: policy.degrade ? policy.thresholds.queryRetryAfterSeconds : 0,
            requested: {
              retrievalMode: requestedRetrievalMode,
              maxItems: requestedMaxItems,
              scanLimit: requestedScanLimit,
              maxChars: requestedMaxChars,
            },
            effective: {
              retrievalMode: String(effectivePayload.retrievalMode ?? requestedRetrievalMode),
              maxItems: Number(effectivePayload.maxItems ?? requestedMaxItems),
              scanLimit: Number(effectivePayload.scanLimit ?? requestedScanLimit),
              maxChars: Number(effectivePayload.maxChars ?? requestedMaxChars),
            },
            pressure: memoryPressureSnapshot(),
            queued: policy.queued,
            queueWaitMs: policy.queueWaitMs,
          };
          if (degradation.applied) {
            logger.info("memory_query_degraded", {
              requestId,
              endpoint: "/api/memory/context",
              lane,
              reasons: degradation.reasons,
              requested: degradation.requested,
              effective: degradation.effective,
              pressure: degradation.pressure,
            });
          }
          const contextWithDiagnostics = {
            ...context,
            diagnostics: {
              ...(context.diagnostics ?? {}),
              queryDegradation: degradation,
            },
          };
          statusCode = 200;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(
            JSON.stringify({
              ok: true,
              context: contextWithDiagnostics,
              payload: contextWithDiagnostics,
              items: contextWithDiagnostics.items,
              summary: contextWithDiagnostics.summary,
              degradation,
            })
          );
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const isValidation = error instanceof MemoryValidationError;
          if (!isValidation && isTransientMemoryQueryError(error)) {
            const requestedMaxItems = toBoundedInt(payload.maxItems, 12, 1, 100);
            const requestedMaxChars = toBoundedInt(payload.maxChars, 8_000, 256, 100_000);
            const requestedScanLimit = toBoundedInt(payload.scanLimit, 200, 1, 500);
            const requestedModeRaw = toTrimmedString(payload.retrievalMode).toLowerCase();
            const requestedRetrievalMode =
              requestedModeRaw === "lexical" || requestedModeRaw === "semantic" || requestedModeRaw === "hybrid"
                ? requestedModeRaw
                : "hybrid";
            const fallbackRecentTimeoutMs = 2_500;
            const fallbackRecentLimit = Math.max(2, Math.min(12, requestedMaxItems));
            let fallbackRows: Array<Record<string, unknown>> = [];
            try {
              const recentRows = await withRouteTimeout(
                memoryService.recent({
                  tenantId: toTrimmedString(payload.tenantId) || undefined,
                  limit: Math.max(8, fallbackRecentLimit * 2),
                }),
                fallbackRecentTimeoutMs,
                "memory context transient recent fallback"
              );
              fallbackRows = recentRows
                .filter((row) => row.status !== "quarantined")
                .slice(0, fallbackRecentLimit)
                .map((row) => ({
                  ...row,
                  score: 0.24 + row.sourceConfidence * 0.24 + row.importance * 0.24,
                  scoreBreakdown: {
                    rrf: 0.16,
                    sourceTrust: row.sourceConfidence,
                    recency: 0.24,
                    importance: row.importance,
                    session: 0,
                    lexical: 0,
                    semantic: 0,
                    sessionLane: 0,
                  },
                  matchedBy: ["transient-recent-fallback", "backend-timeout"],
                }));
            } catch {}
            const fallbackUsedChars = fallbackRows.reduce((acc, row) => acc + String(row.content ?? "").length, 0);
            const pressure = memoryPressureSnapshot();
            const degradation = {
              applied: true,
              lane,
              shed: false,
              reasons: fallbackRows.length > 0 ? ["backend-timeout", "recent-fallback"] : ["backend-timeout", "graceful-empty-context"],
              retryAfterSeconds: policy.thresholds.queryRetryAfterSeconds,
              requested: {
                retrievalMode: requestedRetrievalMode,
                maxItems: requestedMaxItems,
                scanLimit: requestedScanLimit,
                maxChars: requestedMaxChars,
              },
              effective: {
                retrievalMode: "lexical",
                maxItems: fallbackRows.length,
                scanLimit: fallbackRows.length,
                maxChars: fallbackUsedChars,
              },
              pressure,
              warning: message,
              queued: policy.queued,
              queueWaitMs: policy.queueWaitMs,
            };
            const fallbackContext = {
              summary:
                fallbackRows.length > 0
                  ? "Context degraded due backend timeout; serving recent fallback items to keep workflow continuity."
                  : "Context temporarily unavailable due backend timeout; returning empty result to keep the workflow responsive.",
              items: fallbackRows,
              budget: {
                maxItems: requestedMaxItems,
                maxChars: requestedMaxChars,
                usedChars: fallbackUsedChars,
                scanLimit: requestedScanLimit,
                scanned: fallbackRows.length,
                droppedByBudget: Math.max(0, fallbackRows.length - requestedMaxItems),
              },
              selection: {
                tenantId: null,
                requestedTenantId: toTrimmedString(payload.tenantId) || null,
                tenantFallbackApplied: false,
                agentId: toTrimmedString(payload.agentId) || null,
                runId: toTrimmedString(payload.runId) || null,
                query: toTrimmedString(payload.query) || null,
                seedMemoryId: toTrimmedString(payload.seedMemoryId) || null,
                retrievalMode: "lexical",
                sourceAllowlist: toStringList(payload.sourceAllowlist),
                sourceDenylist: toStringList(payload.sourceDenylist),
                temporalAnchorAt: toTrimmedString(payload.temporalAnchorAt) || null,
                includeExplain: payload.explain === true,
                expandRelationships: payload.expandRelationships === true,
                requestedMaxHops: toBoundedInt(payload.maxHops, 2, 1, 4),
                tenantFallbackUsedForEmptyScope: false,
                relationshipExpansion: {
                  hopsUsed: 0,
                  addedFromRelationships: 0,
                  attempted: payload.expandRelationships === true,
                  frontierSeedCount: 0,
                },
              },
              diagnostics: {
                candidateCounts: {
                  tenantRows: fallbackRows.length,
                  scopedRows: fallbackRows.length,
                  searchRows: fallbackRows.length,
                  mergedRows: fallbackRows.length,
                },
                retrievalModeUsed: "lexical",
                includeTenantFallback: payload.includeTenantFallback === true,
                queryDegradation: degradation,
              },
            };
            logger.warn("memory_query_transient_error", {
              requestId,
              endpoint: "/api/memory/context",
              lane,
              message,
              pressure,
            });
            recordMemoryLatency("context", routeStartedAtMs);
            statusCode = 200;
            res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
            res.end(
              JSON.stringify({
                ok: true,
                context: fallbackContext,
                payload: fallbackContext,
                items: fallbackRows,
                summary: fallbackContext.summary,
                degradation,
              })
            );
            return;
          }
          statusCode = isValidation ? 400 : 500;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message }));
        }
        return;
      }

      if (memoryService && method === "POST" && url.pathname === "/api/memory/search") {
        const auth = await assertCapabilityAuth(req, { requireAdminToken: false });
        if (!auth.ok) {
          statusCode = 401;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: auth.message }));
          return;
        }
        let payload: Record<string, unknown> = {};
        let lane: MemoryQueryLane = "ops";
        let routeStartedAtMs = Date.now();
        let policy = classifyMemoryQueryPressure(lane, "search");
        try {
          payload = toObjectRecord(await readJsonBody(req));
          lane = deriveMemoryQueryLane(payload, "ops");
          routeStartedAtMs = Date.now();
          policy = await waitForMemoryQuerySlot(lane, "search", requestId);
          if (policy.shed) {
            logger.warn("memory_query_shed", {
              requestId,
              endpoint: "/api/memory/search",
              lane,
              reasons: policy.reasons,
              pressure: policy.pressure,
            });
            statusCode = 503;
            res.writeHead(
              statusCode,
              withSecurityHeaders({
                "content-type": "application/json",
                ...corsHeaders,
                "x-request-id": requestId,
                "retry-after": String(policy.thresholds.queryRetryAfterSeconds),
              })
            );
            res.end(
              JSON.stringify({
                ok: false,
                message: "Memory search deferred due ingest/query pressure.",
                reason: "query-shed",
                lane,
                retryAfterSeconds: policy.thresholds.queryRetryAfterSeconds,
                pressure: policy.pressure,
                degradation: {
                  applied: true,
                  lane,
                  shed: true,
                  reasons: policy.reasons,
                  queued: policy.queued,
                  queueWaitMs: policy.queueWaitMs,
                },
              })
            );
            return;
          }
          const requestedLimit = toBoundedInt(payload.limit, 10, 1, 100);
          const requestedModeRaw = toTrimmedString(payload.retrievalMode).toLowerCase();
          const requestedRetrievalMode =
            requestedModeRaw === "lexical" || requestedModeRaw === "semantic" || requestedModeRaw === "hybrid"
              ? requestedModeRaw
              : "hybrid";
          const effectivePayload: Record<string, unknown> = {
            ...payload,
            limit: requestedLimit,
            retrievalMode: requestedRetrievalMode,
          };
          const adjustments: string[] = [];
          if (policy.degrade) {
            const preferredMode = lane === "interactive" ? "hybrid" : "lexical";
            if (requestedRetrievalMode !== preferredMode) {
              effectivePayload.retrievalMode = preferredMode;
              adjustments.push(`retrievalMode:${requestedRetrievalMode}->${preferredMode}`);
            }
            const limitCap =
              lane === "interactive"
                ? Math.min(100, Math.max(4, policy.thresholds.queryDegradeLimitCap + 4))
                : Math.max(3, policy.thresholds.queryDegradeLimitCap);
            const effectiveLimit = Math.min(requestedLimit, limitCap);
            if (effectiveLimit !== requestedLimit) {
              effectivePayload.limit = effectiveLimit;
              adjustments.push(`limit:${requestedLimit}->${effectiveLimit}`);
            }
          }

          let rows;
          activeSearchRequests += 1;
          try {
            rows = await withRouteTimeout(
              memoryService.search(effectivePayload),
              policy.thresholds.queryRouteTimeoutMs,
              "memory search query route"
            );
          } finally {
            activeSearchRequests = Math.max(0, activeSearchRequests - 1);
          }
          recordMemoryLatency("search", routeStartedAtMs);
          const degradation = {
            applied: policy.degrade || adjustments.length > 0,
            lane,
            shed: false,
            reasons: Array.from(new Set([...policy.reasons, ...adjustments])),
            retryAfterSeconds: policy.degrade ? policy.thresholds.queryRetryAfterSeconds : 0,
            requested: {
              retrievalMode: requestedRetrievalMode,
              limit: requestedLimit,
            },
            effective: {
              retrievalMode: String(effectivePayload.retrievalMode ?? requestedRetrievalMode),
              limit: Number(effectivePayload.limit ?? requestedLimit),
            },
            pressure: memoryPressureSnapshot(),
            queued: policy.queued,
            queueWaitMs: policy.queueWaitMs,
          };
          if (degradation.applied) {
            logger.info("memory_query_degraded", {
              requestId,
              endpoint: "/api/memory/search",
              lane,
              reasons: degradation.reasons,
              requested: degradation.requested,
              effective: degradation.effective,
              pressure: degradation.pressure,
            });
          }
          statusCode = 200;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: true, rows, results: rows, degradation }));
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const isValidation = error instanceof MemoryValidationError;
          if (!isValidation && isTransientMemoryQueryError(error)) {
            const requestedLimit = toBoundedInt(payload.limit, 10, 1, 100);
            const requestedModeRaw = toTrimmedString(payload.retrievalMode).toLowerCase();
            const requestedRetrievalMode =
              requestedModeRaw === "lexical" || requestedModeRaw === "semantic" || requestedModeRaw === "hybrid"
                ? requestedModeRaw
                : "hybrid";
            const fallbackRecentTimeoutMs = 2_500;
            const fallbackRecentLimit = Math.max(2, Math.min(12, requestedLimit));
            let fallbackRows: Array<Record<string, unknown>> = [];
            try {
              const recentRows = await withRouteTimeout(
                memoryService.recent({
                  tenantId: toTrimmedString(payload.tenantId) || undefined,
                  limit: Math.max(8, fallbackRecentLimit * 2),
                }),
                fallbackRecentTimeoutMs,
                "memory search transient recent fallback"
              );
              fallbackRows = recentRows
                .filter((row) => row.status !== "quarantined")
                .slice(0, fallbackRecentLimit)
                .map((row) => ({
                  ...row,
                  score: 0.24 + row.sourceConfidence * 0.24 + row.importance * 0.24,
                  scoreBreakdown: {
                    rrf: 0.16,
                    sourceTrust: row.sourceConfidence,
                    recency: 0.24,
                    importance: row.importance,
                    session: 0,
                    lexical: 0,
                    semantic: 0,
                    sessionLane: 0,
                  },
                  matchedBy: ["transient-recent-fallback", "backend-timeout"],
                }));
            } catch {}
            const pressure = memoryPressureSnapshot();
            const degradation = {
              applied: true,
              lane,
              shed: false,
              reasons: fallbackRows.length > 0 ? ["backend-timeout", "recent-fallback"] : ["backend-timeout", "graceful-empty-search"],
              retryAfterSeconds: policy.thresholds.queryRetryAfterSeconds,
              requested: {
                retrievalMode: requestedRetrievalMode,
                limit: requestedLimit,
              },
              effective: {
                retrievalMode: "lexical",
                limit: fallbackRows.length,
              },
              pressure,
              warning: message,
              queued: policy.queued,
              queueWaitMs: policy.queueWaitMs,
            };
            logger.warn("memory_query_transient_error", {
              requestId,
              endpoint: "/api/memory/search",
              lane,
              message,
              pressure,
            });
            recordMemoryLatency("search", routeStartedAtMs);
            statusCode = 200;
            res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
            res.end(JSON.stringify({ ok: true, rows: fallbackRows, results: fallbackRows, degradation }));
            return;
          }
          statusCode = isValidation ? 400 : 500;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message }));
        }
        return;
      }

      if (memoryService && method === "POST" && url.pathname === "/api/memory/neighborhood") {
        const auth = await assertCapabilityAuth(req, { requireAdminToken: false });
        if (!auth.ok) {
          statusCode = 401;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: auth.message }));
          return;
        }
        try {
          const payload = await readJsonBody(req);
          const seedMemoryId = toTrimmedString(payload.seedMemoryId);
          if (!seedMemoryId) {
            throw new MemoryValidationError("seedMemoryId is required.");
          }
          const maxItems = toBoundedInt(payload.maxItems, 24, 1, 100);
          const maxHops = toBoundedInt(payload.maxHops, 2, 1, 4);
          const includeSeed = payload.includeSeed !== false;
          const maxChars = toBoundedInt(payload.maxChars, Math.max(8_000, maxItems * 1_200), 256, 100_000);
          const scanLimit = toBoundedInt(payload.scanLimit, Math.max(200, maxItems * 10), 1, 500);
          const context = await memoryService.context({
            tenantId: toTrimmedString(payload.tenantId) || undefined,
            agentId: toTrimmedString(payload.agentId) || undefined,
            runId: toTrimmedString(payload.runId) || undefined,
            query: toTrimmedString(payload.query) || undefined,
            seedMemoryId,
            sourceAllowlist: toStringList(payload.sourceAllowlist),
            sourceDenylist: toStringList(payload.sourceDenylist),
            retrievalMode: toTrimmedString(payload.retrievalMode) || undefined,
            temporalAnchorAt: toTrimmedString(payload.temporalAnchorAt) || undefined,
            explain: payload.explain === true,
            includeTenantFallback: payload.includeTenantFallback === true,
            expandRelationships: true,
            maxHops,
            maxItems: includeSeed ? maxItems : Math.min(100, maxItems + 1),
            maxChars,
            scanLimit,
          });
          let nodes = context.items;
          if (!includeSeed) {
            nodes = nodes.filter((row) => row.id !== seedMemoryId);
          }
          nodes = nodes.slice(0, maxItems);
          const diagnostics = buildRelationshipDiagnosticsFromNodes(seedMemoryId, nodes);
          statusCode = 200;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(
            JSON.stringify({
              ok: true,
              neighborhood: {
                seedMemoryId,
                maxItems,
                maxHops,
                includeSeed,
                nodes,
                selection: context.selection,
                budget: context.budget,
              },
              edgeSummary: diagnostics.edgeSummary,
              relationshipTypeCounts: diagnostics.relationshipTypeCounts,
              diagnostics,
            })
          );
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const isValidation = error instanceof MemoryValidationError;
          statusCode = isValidation ? 400 : 500;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message }));
        }
        return;
      }

      if (memoryService && method === "POST" && url.pathname === "/api/memory/relationship-diagnostics") {
        const auth = await assertCapabilityAuth(req, { requireAdminToken: false });
        if (!auth.ok) {
          statusCode = 401;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: auth.message }));
          return;
        }
        try {
          const payload = await readJsonBody(req);
          const seedMemoryId = toTrimmedString(payload.seedMemoryId);
          const query = toTrimmedString(payload.query);
          if (!seedMemoryId && !query) {
            throw new MemoryValidationError("seedMemoryId or query is required.");
          }
          const maxItems = toBoundedInt(payload.maxItems, 24, 1, 100);
          const maxHops = toBoundedInt(payload.maxHops, 2, 1, 4);
          const includeSeed = payload.includeSeed !== false;
          const maxChars = toBoundedInt(payload.maxChars, Math.max(8_000, maxItems * 1_200), 256, 100_000);
          const scanLimit = toBoundedInt(payload.scanLimit, Math.max(200, maxItems * 10), 1, 500);
          const context = await memoryService.context({
            tenantId: toTrimmedString(payload.tenantId) || undefined,
            agentId: toTrimmedString(payload.agentId) || undefined,
            runId: toTrimmedString(payload.runId) || undefined,
            query: query || undefined,
            seedMemoryId: seedMemoryId || undefined,
            sourceAllowlist: toStringList(payload.sourceAllowlist),
            sourceDenylist: toStringList(payload.sourceDenylist),
            retrievalMode: toTrimmedString(payload.retrievalMode) || undefined,
            temporalAnchorAt: toTrimmedString(payload.temporalAnchorAt) || undefined,
            explain: payload.explain === true,
            includeTenantFallback: payload.includeTenantFallback === true,
            expandRelationships: true,
            maxHops,
            maxItems: includeSeed ? maxItems : Math.min(100, maxItems + 1),
            maxChars,
            scanLimit,
          });
          let nodes = context.items;
          if (!includeSeed && seedMemoryId) {
            nodes = nodes.filter((row) => row.id !== seedMemoryId);
          }
          nodes = nodes.slice(0, maxItems);
          const diagnostics = buildRelationshipDiagnosticsFromNodes(seedMemoryId || null, nodes);
          statusCode = 200;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(
            JSON.stringify({
              ok: true,
              diagnostics: {
                ...diagnostics,
                query: query || null,
                maxItems,
                maxHops,
                includeSeed,
                selection: context.selection,
                budget: context.budget,
              },
            })
          );
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const isValidation = error instanceof MemoryValidationError;
          statusCode = isValidation ? 400 : 500;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message }));
        }
        return;
      }

      if (memoryService && method === "GET" && url.pathname === "/api/memory/recent") {
        const auth = await assertCapabilityAuth(req, { requireAdminToken: false });
        if (!auth.ok) {
          statusCode = 401;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: auth.message }));
          return;
        }
        try {
          const limitRaw = Number(url.searchParams.get("limit") ?? "20");
          const tenantParam = url.searchParams.get("tenantId");
          const rows = await memoryService.recent({
            limit: Number.isFinite(limitRaw) ? limitRaw : 20,
            tenantId: tenantParam === null || tenantParam.trim().length === 0 ? undefined : tenantParam.trim(),
          });
          statusCode = 200;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: true, rows }));
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const isValidation = error instanceof MemoryValidationError;
          statusCode = isValidation ? 400 : 500;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message }));
        }
        return;
      }

      if (memoryService && method === "POST" && url.pathname === "/api/memory/get-by-ids") {
        const auth = await assertCapabilityAuth(req, { requireAdminToken: false });
        if (!auth.ok) {
          statusCode = 401;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: auth.message }));
          return;
        }
        try {
          const payload = await readJsonBody(req);
          const rows = await memoryService.getByIds(payload);
          statusCode = 200;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: true, rows }));
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const isValidation = error instanceof MemoryValidationError;
          statusCode = isValidation ? 400 : 500;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message }));
        }
        return;
      }

      if (memoryService && method === "GET" && url.pathname === "/api/memory/stats") {
        const auth = await assertCapabilityAuth(req, { requireAdminToken: false });
        if (!auth.ok) {
          statusCode = 401;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: auth.message }));
          return;
        }
        try {
          const tenantParam = url.searchParams.get("tenantId");
          const stats = await memoryService.stats({
            tenantId: tenantParam === null || tenantParam.trim().length === 0 ? undefined : tenantParam.trim(),
          });
          statusCode = 200;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: true, stats }));
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const isValidation = error instanceof MemoryValidationError;
          statusCode = isValidation ? 400 : 500;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message }));
        }
        return;
      }

      if (memoryService && method === "GET" && url.pathname === "/api/memory/review-cases") {
        const auth = await assertCapabilityAuth(req);
        if (!auth.ok) {
          statusCode = 401;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: auth.message }));
          return;
        }
        try {
          const tenantParam = url.searchParams.get("tenantId");
          const limitRaw = Number(url.searchParams.get("limit") ?? "50");
          const statuses = [
            ...url.searchParams.getAll("status"),
            ...url.searchParams.getAll("statuses"),
            ...toStringList(url.searchParams.get("status")?.split(",") ?? []),
          ];
          const caseTypes = [
            ...url.searchParams.getAll("caseType"),
            ...url.searchParams.getAll("caseTypes"),
            ...toStringList(url.searchParams.get("caseType")?.split(",") ?? []),
          ];
          const scopePrefixes = [
            ...url.searchParams.getAll("scopePrefix"),
            ...url.searchParams.getAll("scopePrefixes"),
          ].map((value) => value.trim()).filter(Boolean);
          const linkedMemoryIds = [
            ...url.searchParams.getAll("linkedMemoryId"),
            ...url.searchParams.getAll("linkedMemoryIds"),
          ].map((value) => value.trim()).filter(Boolean);
          const rows = await memoryService.listReviewCases({
            tenantId: tenantParam === null || tenantParam.trim().length === 0 ? undefined : tenantParam.trim(),
            statuses,
            caseTypes,
            scopePrefixes,
            linkedMemoryIds,
            limit: Number.isFinite(limitRaw) ? Math.max(1, Math.min(Math.trunc(limitRaw), 200)) : 50,
          });
          const latestVerificationRuns = memoryService.listVerificationRuns
            ? await Promise.all(rows.map((row) => memoryService.listVerificationRuns({ tenantId: row.tenantId ?? undefined, caseId: row.id, limit: 1 })))
            : [];
          statusCode = 200;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({
            ok: true,
            rows,
            latestVerificationRuns: latestVerificationRuns.flatMap((entry) => entry).slice(0, rows.length),
          }));
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const isValidation = error instanceof MemoryValidationError;
          statusCode = isValidation ? 400 : 500;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message }));
        }
        return;
      }

      const memoryReviewCaseActionMatch = memoryService && method === "POST"
        ? url.pathname.match(/^\/api\/memory\/review-cases\/([^/]+)\/actions$/)
        : null;
      if (memoryService && memoryReviewCaseActionMatch) {
        const auth = await assertCapabilityAuth(req);
        if (!auth.ok) {
          statusCode = 401;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: auth.message }));
          return;
        }
        try {
          const payload = toObjectRecord(await readJsonBody(req));
          const result = await memoryService.reviewCaseAction({
            ...payload,
            id: decodeURIComponent(memoryReviewCaseActionMatch[1] ?? ""),
          });
          statusCode = 200;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: true, ...result }));
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const isValidation = error instanceof MemoryValidationError;
          statusCode = isValidation ? 400 : 500;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message }));
        }
        return;
      }

      const memoryReviewCaseMatch = memoryService && method === "GET"
        ? url.pathname.match(/^\/api\/memory\/review-cases\/([^/]+)$/)
        : null;
      if (memoryService && memoryReviewCaseMatch) {
        const auth = await assertCapabilityAuth(req);
        if (!auth.ok) {
          statusCode = 401;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: auth.message }));
          return;
        }
        try {
          const tenantParam = url.searchParams.get("tenantId");
          const reviewCase = await memoryService.getReviewCase({
            tenantId: tenantParam === null || tenantParam.trim().length === 0 ? undefined : tenantParam.trim(),
            id: decodeURIComponent(memoryReviewCaseMatch[1] ?? ""),
          });
          if (!reviewCase) {
            statusCode = 404;
            res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
            res.end(JSON.stringify({ ok: false, message: "Memory review case not found." }));
            return;
          }
          const verificationRuns = memoryService.listVerificationRuns
            ? await memoryService.listVerificationRuns({
                tenantId: reviewCase.tenantId ?? undefined,
                caseId: reviewCase.id,
                limit: 10,
              })
            : [];
          statusCode = 200;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: true, reviewCase, verificationRuns }));
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const isValidation = error instanceof MemoryValidationError;
          statusCode = isValidation ? 400 : 500;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message }));
        }
        return;
      }

      if (memoryService && method === "GET" && url.pathname === "/api/memory/pressure") {
        const auth = await assertCapabilityAuth(req);
        if (!auth.ok) {
          statusCode = 401;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: auth.message }));
          return;
        }
        statusCode = 200;
        res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
        res.end(
          JSON.stringify({
            ok: true,
            pressure: memoryPressureSnapshot(),
          })
        );
        return;
      }

      if (memoryService && method === "GET" && url.pathname === "/api/memory/loops") {
        const auth = await assertCapabilityAuth(req);
        if (!auth.ok) {
          statusCode = 401;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: auth.message }));
          return;
        }
        try {
          const tenantParam = url.searchParams.get("tenantId");
          const limitRaw = Number(url.searchParams.get("limit") ?? "30");
          const query = url.searchParams.get("query");
          const sortBy = url.searchParams.get("sortBy");
          const includeMemoryRaw = url.searchParams.get("includeMemory");
          const includeIncidentsRaw = url.searchParams.get("includeIncidents");
          const minAttentionParam = url.searchParams.get("minAttention");
          const minVolatilityParam = url.searchParams.get("minVolatility");
          const minAnomalyParam = url.searchParams.get("minAnomaly");
          const minCentralityParam = url.searchParams.get("minCentrality");
          const minEscalationParam = url.searchParams.get("minEscalation");
          const minBlastRadiusParam = url.searchParams.get("minBlastRadius");
          const incidentLimitParam = url.searchParams.get("incidentLimit");
          const incidentMinEscalationParam = url.searchParams.get("incidentMinEscalation");
          const incidentMinBlastRadiusParam = url.searchParams.get("incidentMinBlastRadius");
          const minAttentionRaw = minAttentionParam === null ? Number.NaN : Number(minAttentionParam);
          const minVolatilityRaw = minVolatilityParam === null ? Number.NaN : Number(minVolatilityParam);
          const minAnomalyRaw = minAnomalyParam === null ? Number.NaN : Number(minAnomalyParam);
          const minCentralityRaw = minCentralityParam === null ? Number.NaN : Number(minCentralityParam);
          const minEscalationRaw = minEscalationParam === null ? Number.NaN : Number(minEscalationParam);
          const minBlastRadiusRaw = minBlastRadiusParam === null ? Number.NaN : Number(minBlastRadiusParam);
          const incidentLimitRaw = incidentLimitParam === null ? Number.NaN : Number(incidentLimitParam);
          const incidentMinEscalationRaw =
            incidentMinEscalationParam === null ? Number.NaN : Number(incidentMinEscalationParam);
          const incidentMinBlastRadiusRaw =
            incidentMinBlastRadiusParam === null ? Number.NaN : Number(incidentMinBlastRadiusParam);
          const states = String(url.searchParams.get("states") ?? "")
            .split(",")
            .map((entry) => entry.trim())
            .filter(Boolean);
          const lanes = String(url.searchParams.get("lanes") ?? "")
            .split(",")
            .map((entry) => entry.trim())
            .filter(Boolean);
          const loopKeys = String(url.searchParams.get("loopKeys") ?? "")
            .split(",")
            .map((entry) => entry.trim())
            .filter(Boolean);
          const loops = await memoryService.loops({
            tenantId: tenantParam === null || tenantParam.trim().length === 0 ? undefined : tenantParam.trim(),
            limit: Number.isFinite(limitRaw) ? limitRaw : 30,
            query: query === null || query.trim().length === 0 ? undefined : query.trim(),
            sortBy: sortBy === null || sortBy.trim().length === 0 ? undefined : sortBy.trim(),
            includeMemory:
              includeMemoryRaw === null ? undefined : includeMemoryRaw.trim().toLowerCase() !== "false",
            includeIncidents:
              includeIncidentsRaw === null ? undefined : includeIncidentsRaw.trim().toLowerCase() !== "false",
            states,
            lanes,
            loopKeys,
            minAttention: Number.isFinite(minAttentionRaw) ? minAttentionRaw : undefined,
            minVolatility: Number.isFinite(minVolatilityRaw) ? minVolatilityRaw : undefined,
            minAnomaly: Number.isFinite(minAnomalyRaw) ? minAnomalyRaw : undefined,
            minCentrality: Number.isFinite(minCentralityRaw) ? minCentralityRaw : undefined,
            minEscalation: Number.isFinite(minEscalationRaw) ? minEscalationRaw : undefined,
            minBlastRadius: Number.isFinite(minBlastRadiusRaw) ? minBlastRadiusRaw : undefined,
            incidentLimit: Number.isFinite(incidentLimitRaw) ? incidentLimitRaw : undefined,
            incidentMinEscalation: Number.isFinite(incidentMinEscalationRaw)
              ? incidentMinEscalationRaw
              : undefined,
            incidentMinBlastRadius: Number.isFinite(incidentMinBlastRadiusRaw)
              ? incidentMinBlastRadiusRaw
              : undefined,
          });
          statusCode = 200;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: true, loops, rows: loops.rows, incidents: loops.incidents, summary: loops.summary }));
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const isValidation = error instanceof MemoryValidationError;
          statusCode = isValidation ? 400 : 500;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message }));
        }
        return;
      }

      if (memoryService && method === "GET" && url.pathname === "/api/memory/loops/incidents") {
        const auth = await assertCapabilityAuth(req);
        if (!auth.ok) {
          statusCode = 401;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: auth.message }));
          return;
        }
        try {
          const tenantParam = url.searchParams.get("tenantId");
          const query = url.searchParams.get("query");
          const limitRaw = Number(url.searchParams.get("limit") ?? "12");
          const incidentMinEscalationRaw = Number(url.searchParams.get("incidentMinEscalation") ?? "NaN");
          const incidentMinBlastRadiusRaw = Number(url.searchParams.get("incidentMinBlastRadius") ?? "NaN");
          const states = String(url.searchParams.get("states") ?? "")
            .split(",")
            .map((entry) => entry.trim())
            .filter(Boolean);
          const lanes = String(url.searchParams.get("lanes") ?? "")
            .split(",")
            .map((entry) => entry.trim())
            .filter(Boolean);
          const loopKeys = String(url.searchParams.get("loopKeys") ?? "")
            .split(",")
            .map((entry) => entry.trim())
            .filter(Boolean);
          const loops = await memoryService.loops({
            tenantId: tenantParam === null || tenantParam.trim().length === 0 ? undefined : tenantParam.trim(),
            query: query === null || query.trim().length === 0 ? undefined : query.trim(),
            sortBy: "escalation",
            includeMemory: true,
            includeIncidents: true,
            states,
            lanes,
            loopKeys,
            limit: Math.min(200, Math.max(30, Number.isFinite(limitRaw) ? limitRaw * 3 : 36)),
            incidentLimit: Number.isFinite(limitRaw) ? limitRaw : 12,
            incidentMinEscalation: Number.isFinite(incidentMinEscalationRaw) ? incidentMinEscalationRaw : undefined,
            incidentMinBlastRadius: Number.isFinite(incidentMinBlastRadiusRaw) ? incidentMinBlastRadiusRaw : undefined,
          });
          statusCode = 200;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(
            JSON.stringify({
              ok: true,
              incidents: loops.incidents,
              summary: loops.summary,
            })
          );
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const isValidation = error instanceof MemoryValidationError;
          statusCode = isValidation ? 400 : 500;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message }));
        }
        return;
      }

      if (memoryService && method === "POST" && url.pathname === "/api/memory/loops/incident-action") {
        const auth = await assertCapabilityAuth(req);
        if (!auth.ok) {
          statusCode = 401;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: auth.message }));
          return;
        }
        try {
          const payload = await readJsonBody(req);
          const result = await memoryService.incidentAction(payload);
          statusCode = 200;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: true, result }));
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const isValidation = error instanceof MemoryValidationError;
          statusCode = isValidation ? 400 : 500;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message }));
        }
        return;
      }

      if (memoryService && method === "POST" && url.pathname === "/api/memory/loops/incident-action/batch") {
        const auth = await assertCapabilityAuth(req);
        if (!auth.ok) {
          statusCode = 401;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: auth.message }));
          return;
        }
        try {
          const payload = await readJsonBody(req);
          const result = await memoryService.incidentActionBatch(payload);
          statusCode = 200;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: true, result }));
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const isValidation = error instanceof MemoryValidationError;
          statusCode = isValidation ? 400 : 500;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message }));
        }
        return;
      }

      if (memoryService && method === "GET" && url.pathname === "/api/memory/loops/feedback-stats") {
        const auth = await assertCapabilityAuth(req);
        if (!auth.ok) {
          statusCode = 401;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: auth.message }));
          return;
        }
        try {
          const tenantParam = url.searchParams.get("tenantId");
          const limitRaw = Number(url.searchParams.get("limit") ?? "120");
          const windowDaysRaw = Number(url.searchParams.get("windowDays") ?? "180");
          const loopKeys = String(url.searchParams.get("loopKeys") ?? "")
            .split(",")
            .map((entry) => entry.trim())
            .filter(Boolean);
          const report = await memoryService.loopFeedbackStats({
            tenantId: tenantParam === null || tenantParam.trim().length === 0 ? undefined : tenantParam.trim(),
            loopKeys,
            limit: Number.isFinite(limitRaw) ? limitRaw : 120,
            windowDays: Number.isFinite(windowDaysRaw) ? windowDaysRaw : 180,
          });
          statusCode = 200;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: true, report, rows: report.rows, summary: report.summary }));
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const isValidation = error instanceof MemoryValidationError;
          statusCode = isValidation ? 400 : 500;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message }));
        }
        return;
      }

      if (memoryService && method === "GET" && url.pathname === "/api/memory/loops/owner-queues") {
        const auth = await assertCapabilityAuth(req);
        if (!auth.ok) {
          statusCode = 401;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: auth.message }));
          return;
        }
        try {
          const tenantParam = url.searchParams.get("tenantId");
          const query = url.searchParams.get("query");
          const limitRaw = Number(url.searchParams.get("limit") ?? "50");
          const incidentLimitRaw = Number(url.searchParams.get("incidentLimit") ?? "20");
          const incidentMinEscalationRaw = Number(url.searchParams.get("incidentMinEscalation") ?? "NaN");
          const incidentMinBlastRadiusRaw = Number(url.searchParams.get("incidentMinBlastRadius") ?? "NaN");
          const states = String(url.searchParams.get("states") ?? "")
            .split(",")
            .map((entry) => entry.trim())
            .filter(Boolean);
          const lanes = String(url.searchParams.get("lanes") ?? "")
            .split(",")
            .map((entry) => entry.trim())
            .filter(Boolean);
          const loopKeys = String(url.searchParams.get("loopKeys") ?? "")
            .split(",")
            .map((entry) => entry.trim())
            .filter(Boolean);
          const report = await memoryService.ownerQueues({
            tenantId: tenantParam === null || tenantParam.trim().length === 0 ? undefined : tenantParam.trim(),
            query: query === null || query.trim().length === 0 ? undefined : query.trim(),
            states,
            lanes,
            loopKeys,
            limit: Number.isFinite(limitRaw) ? limitRaw : 50,
            incidentLimit: Number.isFinite(incidentLimitRaw) ? incidentLimitRaw : 20,
            incidentMinEscalation: Number.isFinite(incidentMinEscalationRaw) ? incidentMinEscalationRaw : undefined,
            incidentMinBlastRadius: Number.isFinite(incidentMinBlastRadiusRaw) ? incidentMinBlastRadiusRaw : undefined,
          });
          statusCode = 200;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(
            JSON.stringify({
              ok: true,
              report,
              queues: report.queues,
              sla: report.sla,
              incidents: report.incidents,
              summary: report.summary,
            })
          );
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const isValidation = error instanceof MemoryValidationError;
          statusCode = isValidation ? 400 : 500;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message }));
        }
        return;
      }

      if (memoryService && method === "GET" && url.pathname === "/api/memory/loops/action-plan") {
        const auth = await assertCapabilityAuth(req);
        if (!auth.ok) {
          statusCode = 401;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: auth.message }));
          return;
        }
        try {
          const tenantParam = url.searchParams.get("tenantId");
          const query = url.searchParams.get("query");
          const limitRaw = Number(url.searchParams.get("limit") ?? "50");
          const incidentLimitRaw = Number(url.searchParams.get("incidentLimit") ?? "30");
          const maxActionsRaw = Number(url.searchParams.get("maxActions") ?? "40");
          const includeBatchPayloadRaw = url.searchParams.get("includeBatchPayload");
          const incidentMinEscalationRaw = Number(url.searchParams.get("incidentMinEscalation") ?? "NaN");
          const incidentMinBlastRadiusRaw = Number(url.searchParams.get("incidentMinBlastRadius") ?? "NaN");
          const states = String(url.searchParams.get("states") ?? "")
            .split(",")
            .map((entry) => entry.trim())
            .filter(Boolean);
          const lanes = String(url.searchParams.get("lanes") ?? "")
            .split(",")
            .map((entry) => entry.trim())
            .filter(Boolean);
          const loopKeys = String(url.searchParams.get("loopKeys") ?? "")
            .split(",")
            .map((entry) => entry.trim())
            .filter(Boolean);
          const plan = await memoryService.actionPlan({
            tenantId: tenantParam === null || tenantParam.trim().length === 0 ? undefined : tenantParam.trim(),
            query: query === null || query.trim().length === 0 ? undefined : query.trim(),
            states,
            lanes,
            loopKeys,
            limit: Number.isFinite(limitRaw) ? limitRaw : 50,
            incidentLimit: Number.isFinite(incidentLimitRaw) ? incidentLimitRaw : 30,
            maxActions: Number.isFinite(maxActionsRaw) ? maxActionsRaw : 40,
            includeBatchPayload: toBooleanFlag(includeBatchPayloadRaw, true),
            incidentMinEscalation: Number.isFinite(incidentMinEscalationRaw) ? incidentMinEscalationRaw : undefined,
            incidentMinBlastRadius: Number.isFinite(incidentMinBlastRadiusRaw) ? incidentMinBlastRadiusRaw : undefined,
          });
          statusCode = 200;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: true, plan }));
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const isValidation = error instanceof MemoryValidationError;
          statusCode = isValidation ? 400 : 500;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message }));
        }
        return;
      }

      if (memoryService && method === "POST" && url.pathname === "/api/memory/loops/automation-tick") {
        const auth = await assertCapabilityAuth(req);
        if (!auth.ok) {
          statusCode = 401;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: auth.message }));
          return;
        }
        try {
          const payload = await readJsonBody(req);
          const tick = await memoryService.automationTick(payload);
          const shouldDispatch = toBooleanFlag(String((payload as Record<string, unknown>).dispatch ?? "").trim(), false);
          const webhookUrl =
            String((payload as Record<string, unknown>).webhookUrl ?? "").trim() ||
            String(process.env.STUDIO_BRAIN_LOOP_DIGEST_WEBHOOK ?? "").trim();
          const incidents = tick.plan.actions.slice(0, 20).map((action) => ({
            loopKey: action.loopKey,
            lane: action.lane,
            currentState: action.currentState,
            escalationScore: action.escalationScore,
            blastRadiusScore: action.blastRadiusScore,
            anomalyScore: action.anomalyScore,
            suggestedOwner: action.suggestedOwner,
            hoursUntilBreach: action.hoursUntilBreach,
            slaStatus: action.slaStatus,
            recommendedAction: action.reason,
            narrative: action.reason,
          }));
          const markdown = formatLoopDigestMarkdown({
            generatedAt: tick.generatedAt,
            query: tick.plan.query,
            incidents,
            summary: {
              highestEscalationScore:
                tick.plan.actions.length > 0 ? Math.max(...tick.plan.actions.map((row) => row.escalationScore)) : 0,
              highestBlastRadiusScore: tick.plan.actions.length > 0 ? Math.max(...tick.plan.actions.map((row) => row.blastRadiusScore)) : 0,
              ownerQueues: tick.plan.ownerQueues,
              sla: tick.plan.sla,
            },
          });
          let dispatchResult: { requested: boolean; delivered: boolean; status?: number; message?: string; webhookUrl?: string } = {
            requested: shouldDispatch,
            delivered: false,
          };
          if (shouldDispatch) {
            if (!webhookUrl) {
              dispatchResult = {
                requested: true,
                delivered: false,
                message: "Missing webhook URL. Set STUDIO_BRAIN_LOOP_DIGEST_WEBHOOK or pass webhookUrl.",
              };
            } else {
              try {
                const response = await fetch(webhookUrl, {
                  method: "POST",
                  headers: {
                    "content-type": "application/json",
                  },
                  body: JSON.stringify({
                    text: markdown,
                    tick,
                  }),
                });
                dispatchResult = {
                  requested: true,
                  delivered: response.ok,
                  status: response.status,
                  webhookUrl,
                  message: response.ok ? "Delivered." : `Webhook returned HTTP ${response.status}.`,
                };
              } catch (error) {
                dispatchResult = {
                  requested: true,
                  delivered: false,
                  webhookUrl,
                  message: error instanceof Error ? error.message : String(error),
                };
              }
            }
          }
          statusCode = 200;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(
            JSON.stringify({
              ok: true,
              tick,
              dispatch: dispatchResult,
            })
          );
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const isValidation = error instanceof MemoryValidationError;
          statusCode = isValidation ? 400 : 500;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message }));
        }
        return;
      }

      if (memoryService && method === "GET" && url.pathname === "/api/memory/loops/digest") {
        const auth = await assertCapabilityAuth(req);
        if (!auth.ok) {
          statusCode = 401;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: auth.message }));
          return;
        }
        try {
          const tenantParam = url.searchParams.get("tenantId");
          const query = url.searchParams.get("query");
          const limitRaw = Number(url.searchParams.get("limit") ?? "12");
          const incidentMinEscalationRaw = Number(url.searchParams.get("incidentMinEscalation") ?? "NaN");
          const incidentMinBlastRadiusRaw = Number(url.searchParams.get("incidentMinBlastRadius") ?? "NaN");
          const dispatch = toBooleanFlag(url.searchParams.get("dispatch"), false);
          const webhookUrl =
            String(url.searchParams.get("webhookUrl") ?? "").trim() ||
            String(process.env.STUDIO_BRAIN_LOOP_DIGEST_WEBHOOK ?? "").trim();
          const states = String(url.searchParams.get("states") ?? "")
            .split(",")
            .map((entry) => entry.trim())
            .filter(Boolean);
          const lanes = String(url.searchParams.get("lanes") ?? "")
            .split(",")
            .map((entry) => entry.trim())
            .filter(Boolean);
          const loopKeys = String(url.searchParams.get("loopKeys") ?? "")
            .split(",")
            .map((entry) => entry.trim())
            .filter(Boolean);
          const loops = await memoryService.loops({
            tenantId: tenantParam === null || tenantParam.trim().length === 0 ? undefined : tenantParam.trim(),
            query: query === null || query.trim().length === 0 ? undefined : query.trim(),
            sortBy: "escalation",
            includeMemory: true,
            includeIncidents: true,
            states,
            lanes,
            loopKeys,
            limit: Math.min(200, Math.max(30, Number.isFinite(limitRaw) ? limitRaw * 3 : 36)),
            incidentLimit: Number.isFinite(limitRaw) ? limitRaw : 12,
            incidentMinEscalation: Number.isFinite(incidentMinEscalationRaw) ? incidentMinEscalationRaw : undefined,
            incidentMinBlastRadius: Number.isFinite(incidentMinBlastRadiusRaw) ? incidentMinBlastRadiusRaw : undefined,
          });
          const digest = {
            generatedAt: new Date().toISOString(),
            query: query === null || query.trim().length === 0 ? null : query.trim(),
            incidentCount: loops.incidents.length,
            incidents: loops.incidents,
            summary: loops.summary,
          };
          const markdown = formatLoopDigestMarkdown({
            generatedAt: digest.generatedAt,
            query: digest.query,
            incidents: loops.incidents,
            summary: loops.summary as unknown as Record<string, unknown>,
          });
          let dispatchResult: { requested: boolean; delivered: boolean; status?: number; message?: string; webhookUrl?: string } = {
            requested: dispatch,
            delivered: false,
          };
          if (dispatch) {
            if (!webhookUrl) {
              dispatchResult = {
                requested: true,
                delivered: false,
                message: "Missing webhook URL. Set STUDIO_BRAIN_LOOP_DIGEST_WEBHOOK or pass webhookUrl.",
              };
            } else {
              try {
                const response = await fetch(webhookUrl, {
                  method: "POST",
                  headers: {
                    "content-type": "application/json",
                  },
                  body: JSON.stringify({
                    text: markdown,
                    digest,
                  }),
                });
                dispatchResult = {
                  requested: true,
                  delivered: response.ok,
                  status: response.status,
                  webhookUrl,
                  message: response.ok ? "Delivered." : `Webhook returned HTTP ${response.status}.`,
                };
              } catch (error) {
                dispatchResult = {
                  requested: true,
                  delivered: false,
                  webhookUrl,
                  message: error instanceof Error ? error.message : String(error),
                };
              }
            }
          }
          statusCode = 200;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(
            JSON.stringify({
              ok: true,
              digest: {
                ...digest,
                markdown,
              },
              dispatch: dispatchResult,
            })
          );
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const isValidation = error instanceof MemoryValidationError;
          statusCode = isValidation ? 400 : 500;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message }));
        }
        return;
      }

      if (memoryService && method === "POST" && url.pathname === "/api/memory/import") {
        const auth = await assertCapabilityAuth(req);
        if (!auth.ok) {
          statusCode = 401;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: auth.message }));
          return;
        }
        const pressureRejection = memoryImportPressureRejection("/api/memory/import", requestId);
        if (pressureRejection) {
          statusCode = 429;
          res.writeHead(
            statusCode,
            withSecurityHeaders({
              "content-type": "application/json",
              ...corsHeaders,
              "retry-after": String(pressureRejection.retryAfterSeconds),
              "x-request-id": requestId,
            })
          );
          res.end(JSON.stringify({ ok: false, ...pressureRejection }));
          return;
        }
        try {
          const payload = await readJsonBody(req);
          let result;
          activeImportRequests += 1;
          try {
            result = await memoryService.importBatch(payload);
          } finally {
            activeImportRequests = Math.max(0, activeImportRequests - 1);
          }
          const shouldDispatch = toBooleanFlag(String((payload as Record<string, unknown>).dispatch ?? "").trim(), false);
          const webhookUrl =
            String((payload as Record<string, unknown>).webhookUrl ?? "").trim() ||
            String(process.env.STUDIO_BRAIN_LOOP_DIGEST_WEBHOOK ?? "").trim();
          let dispatchResult: { requested: boolean; delivered: boolean; status?: number; message?: string; webhookUrl?: string } = {
            requested: shouldDispatch,
            delivered: false,
          };
          if (shouldDispatch) {
            if (!result.briefing) {
              dispatchResult = {
                requested: true,
                delivered: false,
                message: "No briefing was generated for this import. Enable generateBriefing or import mail-like sources.",
              };
            } else if (!webhookUrl) {
              dispatchResult = {
                requested: true,
                delivered: false,
                message: "Missing webhook URL. Set STUDIO_BRAIN_LOOP_DIGEST_WEBHOOK or pass webhookUrl.",
              };
            } else {
              const markdown = formatLoopDigestMarkdown({
                generatedAt: result.briefing.generatedAt,
                query: result.briefing.query,
                incidents: result.briefing.incidents,
                summary: result.briefing.summary as unknown as Record<string, unknown>,
              });
              const actionHeadlines = result.briefing.actionPlan.actions
                .slice(0, 5)
                .map((row, index) => `${index + 1}. [${row.priority.toUpperCase()}] ${row.action} ${row.loopKey} (${row.reason})`)
                .join("\n");
              const text = actionHeadlines
                ? `${markdown}\n\n# Recommended Actions\n${actionHeadlines}`
                : markdown;
              try {
                const response = await fetch(webhookUrl, {
                  method: "POST",
                  headers: {
                    "content-type": "application/json",
                  },
                  body: JSON.stringify({
                    text,
                    briefing: result.briefing,
                    result,
                  }),
                });
                dispatchResult = {
                  requested: true,
                  delivered: response.ok,
                  status: response.status,
                  webhookUrl,
                  message: response.ok ? "Delivered." : `Webhook returned HTTP ${response.status}.`,
                };
              } catch (error) {
                dispatchResult = {
                  requested: true,
                  delivered: false,
                  webhookUrl,
                  message: error instanceof Error ? error.message : String(error),
                };
              }
            }
          }
          statusCode = 201;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(
            JSON.stringify({
              ok: true,
              result,
              briefing: result.briefing ?? null,
              dispatch: dispatchResult,
            })
          );
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const isValidation = error instanceof MemoryValidationError;
          statusCode = isValidation ? 400 : 500;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message }));
        }
        return;
      }

      if (memoryService && method === "POST" && url.pathname === "/api/memory/backfill-email-threading") {
        const auth = await assertCapabilityAuth(req);
        if (!auth.ok) {
          statusCode = 401;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: auth.message }));
          return;
        }
        const pressure = memoryPressureSnapshot();
        if (
          pressure.activeImportRequests >= memoryPressureConfig.maxActiveImportsBeforeBackfill ||
          pressure.activeBackfillRequests >= memoryPressureConfig.maxConcurrentBackfills
        ) {
          const reason =
            pressure.activeImportRequests >= memoryPressureConfig.maxActiveImportsBeforeBackfill
              ? "active-import-pressure"
              : "backfill-concurrency-limit";
          statusCode = 503;
          res.writeHead(
            statusCode,
            withSecurityHeaders({
              "content-type": "application/json",
              ...corsHeaders,
              "x-request-id": requestId,
              "retry-after": String(memoryPressureConfig.retryAfterSeconds),
            })
          );
          res.end(
            JSON.stringify({
              ok: false,
              message: "Backfill deferred due current memory ingest pressure.",
              reason,
              retryAfterSeconds: memoryPressureConfig.retryAfterSeconds,
              pressure,
            })
          );
          return;
        }
        try {
          const payload = await readJsonBody(req);
          let result;
          activeBackfillRequests += 1;
          try {
            result = await memoryService.backfillEmailThreading(payload);
          } finally {
            activeBackfillRequests = Math.max(0, activeBackfillRequests - 1);
          }
          logger.info("memory_backfill_email_threading_summary", {
            requestId,
            tenantId: result.tenantId ?? null,
            dryRun: result.dryRun,
            scanned: result.scanned,
            eligible: result.eligible,
            updated: result.updated,
            skipped: result.skipped,
            failed: result.failed,
            writesAttempted: result.writesAttempted ?? 0,
            maxWrites: result.maxWrites ?? 0,
            timeoutErrors: result.timeoutErrors ?? 0,
            stopReason: result.stopReason ?? null,
            convergence: result.convergence ?? null,
            pressure: memoryPressureSnapshot(),
          });
          statusCode = 200;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: true, result }));
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const isValidation = error instanceof MemoryValidationError;
          statusCode = isValidation ? 400 : 500;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message }));
        }
        return;
      }

      if (memoryService && method === "POST" && url.pathname === "/api/memory/backfill-signal-indexing") {
        const auth = await assertCapabilityAuth(req);
        if (!auth.ok) {
          statusCode = 401;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: auth.message }));
          return;
        }
        const pressure = memoryPressureSnapshot();
        if (
          pressure.activeImportRequests >= memoryPressureConfig.maxActiveImportsBeforeBackfill ||
          pressure.activeBackfillRequests >= memoryPressureConfig.maxConcurrentBackfills
        ) {
          const reason =
            pressure.activeImportRequests >= memoryPressureConfig.maxActiveImportsBeforeBackfill
              ? "active-import-pressure"
              : "backfill-concurrency-limit";
          statusCode = 503;
          res.writeHead(
            statusCode,
            withSecurityHeaders({
              "content-type": "application/json",
              ...corsHeaders,
              "x-request-id": requestId,
              "retry-after": String(memoryPressureConfig.retryAfterSeconds),
            })
          );
          res.end(
            JSON.stringify({
              ok: false,
              message: "Backfill deferred due current memory ingest pressure.",
              reason,
              retryAfterSeconds: memoryPressureConfig.retryAfterSeconds,
              pressure,
            })
          );
          return;
        }
        try {
          const payload = await readJsonBody(req);
          let result;
          activeBackfillRequests += 1;
          try {
            result = await memoryService.backfillSignalIndexing(payload);
          } finally {
            activeBackfillRequests = Math.max(0, activeBackfillRequests - 1);
          }
          logger.info("memory_backfill_signal_indexing_summary", {
            requestId,
            tenantId: result.tenantId ?? null,
            dryRun: result.dryRun,
            scanned: result.scanned,
            eligible: result.eligible,
            updated: result.updated,
            skipped: result.skipped,
            failed: result.failed,
            writesAttempted: result.writesAttempted ?? 0,
            maxWrites: result.maxWrites ?? 0,
            timeoutErrors: result.timeoutErrors ?? 0,
            alreadyIndexedSkipped: result.alreadyIndexedSkipped ?? 0,
            loopStateUpdates: result.loopStateUpdates ?? 0,
            relationshipInference: result.relationshipInference ?? null,
            relationshipProbes: result.relationshipInference?.probes ?? 0,
            relationshipEdgesAdded: result.relationshipInference?.inferredEdgesAdded ?? 0,
            stopReason: result.stopReason ?? null,
            convergence: result.convergence ?? null,
            pressure: memoryPressureSnapshot(),
          });
          statusCode = 200;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: true, result }));
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const isValidation = error instanceof MemoryValidationError;
          statusCode = isValidation ? 400 : 500;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message }));
        }
        return;
      }

      if (memoryService && method === "POST" && url.pathname === "/api/memory/scrub-thread-metadata") {
        const auth = await assertCapabilityAuth(req);
        if (!auth.ok) {
          statusCode = 401;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: auth.message }));
          return;
        }
        const pressure = memoryPressureSnapshot();
        if (
          pressure.activeImportRequests >= memoryPressureConfig.maxActiveImportsBeforeBackfill ||
          pressure.activeBackfillRequests >= memoryPressureConfig.maxConcurrentBackfills
        ) {
          const reason =
            pressure.activeImportRequests >= memoryPressureConfig.maxActiveImportsBeforeBackfill
              ? "active-import-pressure"
              : "backfill-concurrency-limit";
          statusCode = 503;
          res.writeHead(
            statusCode,
            withSecurityHeaders({
              "content-type": "application/json",
              ...corsHeaders,
              "x-request-id": requestId,
              "retry-after": String(memoryPressureConfig.retryAfterSeconds),
            })
          );
          res.end(
            JSON.stringify({
              ok: false,
              message: "Backfill deferred due current memory ingest pressure.",
              reason,
              retryAfterSeconds: memoryPressureConfig.retryAfterSeconds,
              pressure,
            })
          );
          return;
        }
        try {
          const payload = await readJsonBody(req);
          let result;
          activeBackfillRequests += 1;
          try {
            result = await memoryService.scrubSyntheticThreadMetadata(payload);
          } finally {
            activeBackfillRequests = Math.max(0, activeBackfillRequests - 1);
          }
          logger.info("memory_scrub_thread_metadata_summary", {
            requestId,
            tenantId: result.tenantId ?? null,
            dryRun: result.dryRun,
            scanned: result.scanned,
            eligible: result.eligible,
            updated: result.updated,
            skipped: result.skipped,
            failed: result.failed,
            writesAttempted: result.writesAttempted ?? 0,
            maxWrites: result.maxWrites ?? 0,
            timeoutErrors: result.timeoutErrors ?? 0,
            stopReason: result.stopReason ?? null,
            convergence: result.convergence ?? null,
            pressure: memoryPressureSnapshot(),
          });
          statusCode = 200;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: true, result }));
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const isValidation = error instanceof MemoryValidationError;
          statusCode = isValidation ? 400 : 500;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message }));
        }
        return;
      }

      if (capabilityRuntime && method === "GET" && url.pathname === "/api/capabilities") {
        const auth = await assertCapabilityAuth(req);
        if (!auth.ok) {
          statusCode = 401;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: auth.message }));
          return;
        }
        statusCode = 200;
        res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
        res.end(
          JSON.stringify({
            ok: true,
            capabilities: capabilityRuntime.listCapabilities().map((capability) => ({
              ...capability,
              policyMetadata: capabilityPolicyMetadata[capability.id] ?? null,
            })),
            proposals: await capabilityRuntime.listProposals(25),
            policy: await capabilityRuntime.getPolicyState(),
            connectors: await capabilityRuntime.listConnectorHealth(),
          })
        );
        return;
      }

      if (supportOpsStore && method === "GET" && url.pathname === "/api/support-ops/queue") {
        const auth = await assertCapabilityAuth(req);
        if (!auth.ok) {
          statusCode = 401;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: auth.message }));
          return;
        }
        const limitRaw = Number(url.searchParams.get("limit") ?? "20");
        const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(Math.floor(limitRaw), 100)) : 20;
        const recentCases = await supportOpsStore.listRecentCases(limit);
        let casesWithReviewLinks = recentCases;
        if (memoryService) {
          const linkedCaseMap = new Map<string, string[]>();
          for (const row of recentCases) {
            const scope = toTrimmedString(row.emberMemoryScope ?? "");
            if (!scope) continue;
            try {
              const reviewCases = await memoryService.listReviewCases({
                tenantId: undefined,
                statuses: ["open", "in-progress"],
                scopePrefixes: [scope],
                limit: 8,
              });
              if (reviewCases.length > 0) {
                linkedCaseMap.set(row.supportRequestId, reviewCases.map((entry) => entry.id));
              }
            } catch {
              // best-effort memory linkage
            }
          }
          casesWithReviewLinks = recentCases.map((row) => ({
            ...row,
            linkedMemoryReviewCaseIds: linkedCaseMap.get(row.supportRequestId) ?? row.linkedMemoryReviewCaseIds ?? [],
          }));
        }
        statusCode = 200;
        res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
        res.end(
          JSON.stringify({
            ok: true,
            summary: await supportOpsStore.getQueueSummary(),
            recentCases: casesWithReviewLinks,
          })
        );
        return;
      }

      if (method === "GET" && url.pathname === "/api/support-ops/persona") {
        const auth = await assertCapabilityAuth(req, { requireAdminToken: false });
        if (!auth.ok) {
          statusCode = 401;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: auth.message }));
          return;
        }
        statusCode = 200;
        res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
        res.end(JSON.stringify({ ok: true, persona: getSupportAgentProfile() }));
        return;
      }

      if (method === "POST" && url.pathname === "/api/support-ops/discord/respond") {
        const auth = await assertCapabilityAuth(req, { requireAdminToken: false });
        if (!auth.ok) {
          statusCode = 401;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: auth.message }));
          return;
        }
        const body = toObjectRecord(await readJsonBody(req));
        try {
          const draftInput = {
            channelId: toTrimmedString(body.channelId),
            threadId: toTrimmedString(body.threadId) || null,
            messageId: toTrimmedString(body.messageId) || null,
            guildId: toTrimmedString(body.guildId) || null,
            senderId: toTrimmedString(body.senderId) || null,
            senderName: toTrimmedString(body.senderName) || null,
            senderEmail: toTrimmedString(body.senderEmail) || null,
            question: toTrimmedString(body.question),
            receivedAt: toTrimmedString(body.receivedAt) || null,
          };
          let draft = await draftDiscordSupportReply(draftInput);
          if (memoryService) {
            let emberContextSummary: string | null = null;
            try {
              const emberContext = await memoryService.context({
                agentId: "ember-support",
                runId: buildEmberRunId("discord", draft.conversationKey),
                query: draftInput.question,
                useMode: "planning",
                includeTenantFallback: true,
                layerAllowlist: ["working", "episodic", "canonical"],
                maxItems: 4,
                maxChars: 1_200,
              });
              emberContextSummary = toTrimmedString(emberContext.summary) || null;
            } catch {
              emberContextSummary = null;
            }
            if (emberContextSummary) {
              draft = await draftDiscordSupportReply(draftInput, {
                emberContextSummary,
              });
            }
            const confusionState =
              /\b(overwhelmed|lost|embarrassed)\b/i.test(draftInput.question)
                ? "overwhelmed"
                : /\b(frustrated|upset|annoyed|still waiting)\b/i.test(draftInput.question)
                  ? "frustrated"
                  : /\b(sorry|apolog(?:y|ize|ies)|my bad)\b/i.test(draftInput.question)
                    ? "apologetic"
                    : /\b(confused|not sure|timing|delay|any chance|can i|could i|would it be okay)\b/i.test(draftInput.question)
                      ? "uncertain"
                      : /\b(thank you|thanks|appreciate)\b/i.test(draftInput.question)
                        ? "grateful"
                        : "none";
            const confusionReason = confusionState === "none" ? null : `discord-${confusionState}`;
            try {
              await memoryService.capture({
                agentId: "ember-support",
                runId: buildEmberRunId("discord", draft.conversationKey),
                source: "support:discord:working",
                tags: [
                  "ember-support",
                  "discord",
                  "working",
                  draft.policySlug ?? "general-support",
                  confusionState,
                ].filter(Boolean),
                memoryLayer: "working",
                memoryType: "working",
                memoryCategory: "observation",
                sourceConfidence: 0.62,
                importance: draft.humanReviewRequired ? 0.82 : 0.68,
                content: [
                  `Discord support thread for ${draftInput.senderName || draftInput.senderEmail || draftInput.senderId || "unknown member"}.`,
                  `Latest ask: ${draftInput.question}`,
                  emberContextSummary ? `Existing Ember context: ${emberContextSummary}` : "",
                  `Support summary: ${draft.supportSummary}`,
                  `Next safe step: ${draft.humanReviewRequired ? "human review required" : "reply drafted for safe Discord follow-up"}`,
                ].filter(Boolean).join(" "),
                metadata: {
                  scope: buildEmberMemoryScope("discord", draft.conversationKey),
                  subjectKey: buildEmberMemberSubject(draftInput.senderEmail || draftInput.senderId || draftInput.senderName),
                  relatedSubjects: [buildEmberPatternSubject(draft.policySlug ?? "general-support")],
                  emberMemoryScope: buildEmberMemoryScope("discord", draft.conversationKey),
                  conversationKey: draft.conversationKey,
                  confusionState,
                  confusionReason,
                  humanHandoff: draft.humanReviewRequired,
                  nextRecommendedAction: draft.humanReviewRequired ? "Escalate to human support review." : "Use the drafted Discord response as the next safe step.",
                  supportSummary: draft.supportSummary,
                  emberSummary: emberContextSummary ?? draft.supportSummary,
                  startupEligible: false,
                },
              });
            } catch {
              // best-effort Ember working memory capture for Discord drafts
            }
          }
          statusCode = 200;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: true, draft }));
        } catch (error) {
          statusCode = 400;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(
            JSON.stringify({
              ok: false,
              message: error instanceof Error ? error.message : String(error),
            }),
          );
        }
        return;
      }

      if (supportOpsStore && method === "GET" && url.pathname === "/api/support-ops/dead-letters") {
        const auth = await assertCapabilityAuth(req);
        if (!auth.ok) {
          statusCode = 401;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: auth.message }));
          return;
        }
        const limitRaw = Number(url.searchParams.get("limit") ?? "20");
        const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(Math.floor(limitRaw), 100)) : 20;
        statusCode = 200;
        res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
        res.end(JSON.stringify({ ok: true, rows: await supportOpsStore.listDeadLetters(limit) }));
        return;
      }

      if (capabilityRuntime && method === "GET" && url.pathname === "/api/connectors/health") {
        const auth = await assertCapabilityAuth(req);
        if (!auth.ok) {
          statusCode = 401;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: auth.message }));
          return;
        }
        statusCode = 200;
        res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
        res.end(JSON.stringify({ ok: true, connectors: await capabilityRuntime.listConnectorHealth() }));
        return;
      }

      if (capabilityRuntime && method === "GET" && url.pathname === "/api/capabilities/policy") {
        const auth = await assertCapabilityAuth(req);
        if (!auth.ok) {
          statusCode = 401;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: auth.message }));
          return;
        }
        statusCode = 200;
        res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
        res.end(JSON.stringify({ ok: true, policy: await capabilityRuntime.getPolicyState() }));
        return;
      }

      if (capabilityRuntime && method === "GET" && url.pathname === "/api/capabilities/policy-lint") {
        const auth = await assertCapabilityAuth(req);
        if (!auth.ok) {
          statusCode = 401;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: auth.message }));
          return;
        }
        const capabilities = capabilityRuntime.listCapabilities();
        const violations = lintCapabilityPolicy(capabilities, capabilityPolicyMetadata);
        statusCode = 200;
        res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
        res.end(
          JSON.stringify({
            ok: true,
            checkedAt: new Date().toISOString(),
            capabilitiesChecked: capabilities.length,
            violations,
          })
        );
        return;
      }

      if (capabilityRuntime && method === "GET" && url.pathname === "/api/capabilities/quotas") {
        const auth = await assertCapabilityAuth(req);
        if (!auth.ok) {
          statusCode = 401;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: auth.message }));
          return;
        }
        const limitRaw = Number(url.searchParams.get("limit") ?? "50");
        const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(Math.floor(limitRaw), 500)) : 50;
        statusCode = 200;
        res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
        res.end(JSON.stringify({ ok: true, buckets: await capabilityRuntime.listQuotaBuckets(limit) }));
        return;
      }

      if (capabilityRuntime && method === "GET" && url.pathname === "/api/capabilities/audit") {
        const auth = await assertCapabilityAuth(req);
        if (!auth.ok) {
          statusCode = 401;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: auth.message }));
          return;
        }
        const limitRaw = Number(url.searchParams.get("limit") ?? "100");
        const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(Math.floor(limitRaw), 500)) : 100;
        const actionPrefix = String(url.searchParams.get("actionPrefix") ?? "").trim();
        const actorIdFilter = String(url.searchParams.get("actorId") ?? "").trim();
        const approvalFilter = String(url.searchParams.get("approvalState") ?? "").trim();
        const rows = await eventStore.listRecent(Math.max(limit * 4, 100));
        const capabilityRows = rows
          .filter((row) => row.action.startsWith("capability."))
          .filter((row) => (actionPrefix ? row.action.startsWith(actionPrefix) : true))
          .filter((row) => (actorIdFilter ? row.actorId === actorIdFilter : true))
          .filter((row) => (approvalFilter ? row.approvalState === approvalFilter : true))
          .slice(0, limit);
        statusCode = 200;
        res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
        res.end(JSON.stringify({ ok: true, rows: capabilityRows }));
        return;
      }

      if (capabilityRuntime && method === "GET" && url.pathname === "/api/capabilities/audit/export") {
        const auth = await assertCapabilityAuth(req);
        if (!auth.ok) {
          statusCode = 401;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: auth.message }));
          return;
        }
        const limitRaw = Number(url.searchParams.get("limit") ?? "1000");
        const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(Math.floor(limitRaw), 10_000)) : 1000;
        const rows = (await eventStore.listRecent(limit)).filter((row) => row.action.startsWith("capability."));
        const signingKey = process.env.STUDIO_BRAIN_EXPORT_SIGNING_KEY;
        const bundle = buildAuditExportBundle(rows, { signingKey });
        await eventStore.append({
          actorType: "staff",
          actorId: auth.principal?.uid ?? "staff:unknown",
          action: "studio_ops.audit_export_generated",
          rationale: "Generated signed audit export bundle for staff review.",
          target: "local",
          approvalState: "approved",
          inputHash: `${limit}`,
          outputHash: bundle.manifest.payloadHash,
          metadata: {
            rowCount: bundle.manifest.rowCount,
            payloadHash: bundle.manifest.payloadHash,
            signatureAlgorithm: bundle.manifest.signatureAlgorithm,
          },
        });
        statusCode = 200;
        res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
        res.end(JSON.stringify({ ok: true, bundle }));
        return;
      }

      if (capabilityRuntime && method === "GET" && url.pathname === "/api/capabilities/delegation/traces") {
        const auth = await assertCapabilityAuth(req);
        if (!auth.ok) {
          statusCode = 401;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: auth.message }));
          return;
        }
        const limitRaw = Number(url.searchParams.get("limit") ?? "100");
        const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(Math.floor(limitRaw), 500)) : 100;
        const rows = await eventStore.listRecent(Math.max(limit * 4, 100));
        const traces = rows.filter((row) => row.action.startsWith("capability.delegation.")).slice(0, limit);
        statusCode = 200;
        res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
        res.end(JSON.stringify({ ok: true, rows: traces }));
        return;
      }

      if (method === "GET" && url.pathname === "/api/capabilities/rate-limits/events") {
        const auth = await assertCapabilityAuth(req);
        if (!auth.ok) {
          statusCode = 401;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: auth.message }));
          return;
        }
        const limitRaw = Number(url.searchParams.get("limit") ?? "100");
        const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(Math.floor(limitRaw), 500)) : 100;
        const rows = await eventStore.listRecent(Math.max(limit * 6, 100));
        const matches = rows.filter((row) => row.action === "rate_limit_triggered").slice(0, limit);
        statusCode = 200;
        res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
        res.end(JSON.stringify({ ok: true, rows: matches }));
        return;
      }

      if (capabilityRuntime && method === "GET" && url.pathname === "/api/ops/scorecard") {
        const auth = await assertCapabilityAuth(req);
        if (!auth.ok) {
          statusCode = 401;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: auth.message }));
          return;
        }
        const [snapshot, proposals, connectors, rows] = await Promise.all([
          stateStore.getLatestStudioState(),
          capabilityRuntime.listProposals(200),
          capabilityRuntime.listConnectorHealth(),
          eventStore.listRecent(1_000),
        ]);
        const previousScorecard = rows.find((row) => row.action === "studio_ops.scorecard_computed");
        const lastBreach = rows.find((row) => row.action === "studio_ops.scorecard_breach");
        const scorecard = computeScorecard({
          now: new Date(),
          snapshotGeneratedAt: snapshot?.generatedAt ?? null,
          proposals,
          connectors,
          auditRows: rows.filter((row) => row.action.startsWith("capability.")),
          lastBreachAt: lastBreach?.at ?? null,
        });
        await eventStore.append({
          actorType: "staff",
          actorId: auth.principal?.uid ?? "staff:unknown",
          action: "studio_ops.scorecard_computed",
          rationale: "Computed v3 scorecard from snapshot + capability telemetry.",
          target: "local",
          approvalState: "approved",
          inputHash: "scorecard:v3",
          outputHash: null,
          metadata: {
            overallStatus: scorecard.overallStatus,
            metricStates: scorecard.metrics.map((metric) => ({ key: metric.key, status: metric.status })),
          },
        });
        const previousStatus = (previousScorecard?.metadata?.overallStatus ?? null) as ScoreStatus | null;
        if (previousStatus && previousStatus === "ok" && scorecard.overallStatus !== "ok") {
          await eventStore.append({
            actorType: "staff",
            actorId: auth.principal?.uid ?? "staff:unknown",
            action: "studio_ops.scorecard_breach",
            rationale: `Scorecard breached: ${scorecard.overallStatus}`,
            target: "local",
            approvalState: "approved",
            inputHash: "scorecard:v3",
            outputHash: null,
            metadata: {
              previousStatus,
              currentStatus: scorecard.overallStatus,
              reasonCode: "SLO_STATUS_DEGRADED",
            },
          });
          scorecard.lastBreachAt = new Date().toISOString();
        } else if (previousStatus && previousStatus !== "ok" && scorecard.overallStatus === "ok") {
          await eventStore.append({
            actorType: "staff",
            actorId: auth.principal?.uid ?? "staff:unknown",
            action: "studio_ops.scorecard_recovered",
            rationale: "Scorecard recovered to ok.",
            target: "local",
            approvalState: "approved",
            inputHash: "scorecard:v3",
            outputHash: null,
            metadata: {
              previousStatus,
              currentStatus: scorecard.overallStatus,
              reasonCode: "SLO_STATUS_RECOVERED",
            },
          });
        }
        statusCode = 200;
        res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
        res.end(JSON.stringify({ ok: true, scorecard }));
        return;
      }

      if (method === "GET" && url.pathname === "/api/ops/recommendations/drafts") {
        const auth = await assertCapabilityAuth(req, { requireAdminToken: false });
        if (!auth.ok) {
          statusCode = 401;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: auth.message }));
          return;
        }
        const limitRaw = Number(url.searchParams.get("limit") ?? "50");
        const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(Math.floor(limitRaw), 200)) : 50;
        const rows = await eventStore.listRecent(Math.max(limit * 5, 100));
        const drafts = rows
          .filter((row) => row.action === "studio_ops.recommendation_draft_created")
          .slice(0, limit)
          .map((row) => ({
            id: row.id,
            at: row.at,
            rationale: row.rationale,
            ...(row.metadata ?? {}),
          }));
        statusCode = 200;
        res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
        res.end(JSON.stringify({ ok: true, rows: drafts }));
        return;
      }

      if (opsPortal.enabled && opsService && method === "POST" && url.pathname === "/api/ops/events/ingest") {
        if (!opsIngest.enabled) {
          statusCode = 404;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: "Ops ingest endpoint is disabled." }));
          return;
        }
        if (!opsIngest.hmacSecret) {
          statusCode = 503;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: "Ops ingest endpoint is misconfigured." }));
          return;
        }
        try {
          const timestampRaw = firstHeader(req.headers["x-ops-ingest-timestamp"]);
          const signatureRaw = firstHeader(req.headers["x-ops-ingest-signature"]);
          const timestampSeconds = parseEpochSeconds(timestampRaw);
          const providedSignature = normalizeHmacSignature(signatureRaw);
          if (!timestampSeconds || !providedSignature) {
            statusCode = 401;
            res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
            res.end(JSON.stringify({ ok: false, message: "Missing or invalid ops ingest signature headers." }));
            return;
          }
          if (!isTimestampWithinSkew(timestampSeconds, Date.now(), opsIngest.maxSkewSeconds)) {
            statusCode = 401;
            res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
            res.end(JSON.stringify({ ok: false, message: "Ops ingest signature timestamp is outside allowed skew." }));
            return;
          }
          const parsedBody = await readJsonBodyWithRaw(req);
          const expectedSignature = crypto
            .createHmac("sha256", opsIngest.hmacSecret)
            .update(`${timestampSeconds}.${parsedBody.raw}`)
            .digest("hex");
          if (!verifyHmacSignature(expectedSignature, providedSignature)) {
            statusCode = 401;
            res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
            res.end(JSON.stringify({ ok: false, message: "Invalid ops ingest signature." }));
            return;
          }
          const body = parsedBody.json;
          const sourceSystem = toTrimmedString(body.sourceSystem || body.source).toLowerCase();
          if (!sourceSystem) {
            statusCode = 400;
            res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
            res.end(JSON.stringify({ ok: false, message: "sourceSystem is required." }));
            return;
          }
          if (opsIngest.allowedSources.size > 0 && !opsIngest.allowedSources.has(sourceSystem)) {
            statusCode = 403;
            res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
            res.end(JSON.stringify({ ok: false, message: "Ops ingest source is not allowed." }));
            return;
          }
          const eventType = toTrimmedString(body.eventType);
          const entityKind = toTrimmedString(body.entityKind);
          const entityId = toTrimmedString(body.entityId);
          const sourceEventId = toTrimmedString(body.sourceEventId || body.clientRequestId);
          if (!eventType || !entityKind || !entityId || !sourceEventId) {
            statusCode = 400;
            res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
            res.end(JSON.stringify({ ok: false, message: "eventType, entityKind, entityId, and sourceEventId are required." }));
            return;
          }
          const metadata =
            body.payload && typeof body.payload === "object" && !Array.isArray(body.payload)
              ? (body.payload as Record<string, unknown>)
              : body;
          const result = await opsService.ingestWorldEvent({
            eventType,
            entityKind,
            entityId,
            sourceSystem,
            sourceEventId,
            actorKind: toTrimmedString(body.actorKind) || "machine",
            actorId: toTrimmedString(body.actorId) || `machine:${sourceSystem}`,
            payload: metadata,
            caseId: toTrimmedString(body.caseId) || null,
            roomId: toTrimmedString(body.roomId) || null,
            confidence: toNullableRatio(body.confidence) ?? 0.8,
            verificationClass:
              toTrimmedString(body.verificationClass) === "confirmed"
                ? "confirmed"
                : toTrimmedString(body.verificationClass) === "claimed"
                  ? "claimed"
                  : toTrimmedString(body.verificationClass) === "planned"
                    ? "planned"
                    : toTrimmedString(body.verificationClass) === "inferred"
                      ? "inferred"
                      : "observed",
            artifactRefs: toStringList(body.artifactRefs, 32),
            authPrincipal: `hmac:${sourceSystem}`,
            timestampSkewSeconds: Math.abs(Math.round(Date.now() / 1000) - timestampSeconds),
          });
          statusCode = result.accepted ? 202 : 200;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: true, accepted: result.accepted, event: result.event, receipt: result.receipt }));
        } catch (error) {
          statusCode = 500;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: error instanceof Error ? error.message : String(error) }));
        }
        return;
      }

      if (opsPortal.enabled && opsService && method === "GET" && url.pathname === "/api/ops/session/me") {
        const auth = await assertOpsPortalAuth(req);
        if (!auth.ok || !auth.principal) {
          statusCode = 401;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: auth.ok ? "Unauthorized" : auth.message }));
          return;
        }
        const session = await opsService.getSessionMe(opsActorContext(auth));
        statusCode = 200;
        res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
        res.end(JSON.stringify({ ok: true, session }));
        return;
      }

      if (opsPortal.enabled && opsService && method === "GET" && url.pathname === "/api/ops/members") {
        const auth = await assertOpsPortalAuth(req);
        if (!auth.ok || !auth.principal) {
          statusCode = 401;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: auth.ok ? "Unauthorized" : auth.message }));
          return;
        }
        const rows = await opsService.listMembers(opsActorContext(auth));
        statusCode = 200;
        res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
        res.end(JSON.stringify({ ok: true, rows }));
        return;
      }

      if (opsPortal.enabled && opsService && method === "POST" && url.pathname === "/api/ops/members") {
        const auth = await assertOpsPortalAuth(req);
        if (!auth.ok || !auth.principal) {
          statusCode = 401;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: auth.ok ? "Unauthorized" : auth.message }));
          return;
        }
        const body = await readJsonBody(req);
        const portalRole = toTrimmedString(body.portalRole || body.role) as OpsPortalRole;
        const opsRoles = Array.isArray(body.opsRoles) ? body.opsRoles.map((entry) => toTrimmedString(entry)).filter(Boolean) : [];
        const result = await opsService.createMember({
          email: toTrimmedString(body.email) || "",
          displayName: toTrimmedString(body.displayName) || "",
          membershipTier: toTrimmedString(body.membershipTier) || null,
          portalRole: portalRole === "member" || portalRole === "staff" || portalRole === "admin" ? portalRole : undefined,
          opsRoles: opsRoles as OpsHumanRole[],
          kilnPreferences: toTrimmedString(body.kilnPreferences) || null,
          staffNotes: toTrimmedString(body.staffNotes) || null,
          reason: toTrimmedString(body.reason) || null,
        }, opsActorContext(auth));
        statusCode = 200;
        res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
        res.end(JSON.stringify({ ok: true, ...result }));
        return;
      }

      const opsMemberDetailMatch = method === "GET" ? url.pathname.match(/^\/api\/ops\/members\/([^/]+)$/) : null;
      if (opsPortal.enabled && opsService && opsMemberDetailMatch) {
        const auth = await assertOpsPortalAuth(req);
        if (!auth.ok || !auth.principal) {
          statusCode = 401;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: auth.ok ? "Unauthorized" : auth.message }));
          return;
        }
        const uid = decodeURIComponent(opsMemberDetailMatch[1] ?? "");
        const member = await opsService.getMember(uid, opsActorContext(auth));
        if (!member) {
          statusCode = 404;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: `Member ${uid} not found.` }));
          return;
        }
        statusCode = 200;
        res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
        res.end(JSON.stringify({ ok: true, member }));
        return;
      }

      const opsMemberProfileMatch = method === "POST" ? url.pathname.match(/^\/api\/ops\/members\/([^/]+)\/profile$/) : null;
      if (opsPortal.enabled && opsService && opsMemberProfileMatch) {
        const auth = await assertOpsPortalAuth(req);
        if (!auth.ok || !auth.principal) {
          statusCode = 401;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: auth.ok ? "Unauthorized" : auth.message }));
          return;
        }
        const uid = decodeURIComponent(opsMemberProfileMatch[1] ?? "");
        const body = await readJsonBody(req);
        const patch = body.patch && typeof body.patch === "object" && !Array.isArray(body.patch)
          ? body.patch as Record<string, unknown>
          : {};
        const result = await opsService.updateMemberProfile({
          uid,
          reason: toTrimmedString(body.reason) || null,
          patch: {
            displayName: Object.prototype.hasOwnProperty.call(patch, "displayName") ? toTrimmedString(patch.displayName) || null : undefined,
            membershipTier: Object.prototype.hasOwnProperty.call(patch, "membershipTier") ? toTrimmedString(patch.membershipTier) || null : undefined,
            kilnPreferences: Object.prototype.hasOwnProperty.call(patch, "kilnPreferences") ? toTrimmedString(patch.kilnPreferences) || null : undefined,
            staffNotes: Object.prototype.hasOwnProperty.call(patch, "staffNotes") ? toTrimmedString(patch.staffNotes) || null : undefined,
          },
        }, opsActorContext(auth));
        statusCode = 200;
        res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
        res.end(JSON.stringify({ ok: true, ...result }));
        return;
      }

      const opsMemberMembershipMatch = method === "POST" ? url.pathname.match(/^\/api\/ops\/members\/([^/]+)\/membership$/) : null;
      if (opsPortal.enabled && opsService && opsMemberMembershipMatch) {
        const auth = await assertOpsPortalAuth(req);
        if (!auth.ok || !auth.principal) {
          statusCode = 401;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: auth.ok ? "Unauthorized" : auth.message }));
          return;
        }
        const uid = decodeURIComponent(opsMemberMembershipMatch[1] ?? "");
        const body = await readJsonBody(req);
        const result = await opsService.updateMemberMembership({
          uid,
          membershipTier: toTrimmedString(body.membershipTier) || null,
          reason: toTrimmedString(body.reason) || null,
        }, opsActorContext(auth));
        statusCode = 200;
        res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
        res.end(JSON.stringify({ ok: true, ...result }));
        return;
      }

      const opsMemberBillingMatch = method === "POST" ? url.pathname.match(/^\/api\/ops\/members\/([^/]+)\/billing$/) : null;
      if (opsPortal.enabled && opsService && opsMemberBillingMatch) {
        const auth = await assertOpsPortalAuth(req);
        if (!auth.ok || !auth.principal) {
          statusCode = 401;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: auth.ok ? "Unauthorized" : auth.message }));
          return;
        }
        const uid = decodeURIComponent(opsMemberBillingMatch[1] ?? "");
        const body = await readJsonBody(req);
        const billing = body.billing && typeof body.billing === "object" && !Array.isArray(body.billing)
          ? body.billing as Record<string, unknown>
          : {};
        const forbiddenRawCardKeys = ["cardNumber", "pan", "fullPan", "cvc", "cvv", "expiry", "exp", "trackData"];
        const forbiddenKey = forbiddenRawCardKeys.find((key) => Object.prototype.hasOwnProperty.call(billing, key) || Object.prototype.hasOwnProperty.call(body, key));
        if (forbiddenKey) {
          statusCode = 400;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({
            ok: false,
            message: "Raw card data is not accepted in /ops. Use Stripe-hosted collection and store only tokenized references plus safe summaries.",
          }));
          return;
        }
        const result = await opsService.updateMemberBilling({
          uid,
          billing: {
            stripeCustomerId: Object.prototype.hasOwnProperty.call(billing, "stripeCustomerId") ? toTrimmedString(billing.stripeCustomerId) || null : undefined,
            defaultPaymentMethodId: Object.prototype.hasOwnProperty.call(billing, "defaultPaymentMethodId") ? toTrimmedString(billing.defaultPaymentMethodId) || null : undefined,
            cardBrand: Object.prototype.hasOwnProperty.call(billing, "cardBrand") ? toTrimmedString(billing.cardBrand) || null : undefined,
            cardLast4: Object.prototype.hasOwnProperty.call(billing, "cardLast4") ? toTrimmedString(billing.cardLast4) || null : undefined,
            expMonth: Object.prototype.hasOwnProperty.call(billing, "expMonth") ? toTrimmedString(billing.expMonth) || null : undefined,
            expYear: Object.prototype.hasOwnProperty.call(billing, "expYear") ? toTrimmedString(billing.expYear) || null : undefined,
            billingContactName: Object.prototype.hasOwnProperty.call(billing, "billingContactName") ? toTrimmedString(billing.billingContactName) || null : undefined,
            billingContactEmail: Object.prototype.hasOwnProperty.call(billing, "billingContactEmail") ? toTrimmedString(billing.billingContactEmail) || null : undefined,
            billingContactPhone: Object.prototype.hasOwnProperty.call(billing, "billingContactPhone") ? toTrimmedString(billing.billingContactPhone) || null : undefined,
          },
          reason: toTrimmedString(body.reason) || null,
        }, opsActorContext(auth));
        statusCode = 200;
        res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
        res.end(JSON.stringify({ ok: true, ...result }));
        return;
      }

      const opsMemberRoleMatch = method === "POST" ? url.pathname.match(/^\/api\/ops\/members\/([^/]+)\/role$/) : null;
      if (opsPortal.enabled && opsService && opsMemberRoleMatch) {
        const auth = await assertOpsPortalAuth(req);
        if (!auth.ok || !auth.principal) {
          statusCode = 401;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: auth.ok ? "Unauthorized" : auth.message }));
          return;
        }
        const uid = decodeURIComponent(opsMemberRoleMatch[1] ?? "");
        const body = await readJsonBody(req);
        const portalRole = toTrimmedString(body.portalRole || body.role) as OpsPortalRole;
        if (portalRole !== "member" && portalRole !== "staff" && portalRole !== "admin") {
          statusCode = 400;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: "portalRole must be member, staff, or admin." }));
          return;
        }
        const opsRoles = Array.isArray(body.opsRoles) ? body.opsRoles.map((entry) => toTrimmedString(entry)).filter(Boolean) : [];
        const result = await opsService.updateMemberRole({
          uid,
          portalRole,
          opsRoles: opsRoles as OpsHumanRole[],
          reason: toTrimmedString(body.reason) || null,
        }, opsActorContext(auth));
        statusCode = 200;
        res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
        res.end(JSON.stringify({ ok: true, ...result }));
        return;
      }

      const opsMemberActivityMatch = method === "GET" ? url.pathname.match(/^\/api\/ops\/members\/([^/]+)\/activity$/) : null;
      if (opsPortal.enabled && opsService && opsMemberActivityMatch) {
        const auth = await assertOpsPortalAuth(req);
        if (!auth.ok || !auth.principal) {
          statusCode = 401;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: auth.ok ? "Unauthorized" : auth.message }));
          return;
        }
        const uid = decodeURIComponent(opsMemberActivityMatch[1] ?? "");
        const activity = await opsService.getMemberActivity(uid, opsActorContext(auth));
        statusCode = 200;
        res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
        res.end(JSON.stringify({ ok: true, activity }));
        return;
      }

      if (opsPortal.enabled && opsService && method === "GET" && url.pathname === "/api/ops/twin") {
        const auth = await assertOpsPortalAuth(req);
        if (!auth.ok) {
          statusCode = 401;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: auth.message }));
          return;
        }
        const twin = await opsService.getTwin();
        statusCode = 200;
        res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
        res.end(JSON.stringify({ ok: true, twin }));
        return;
      }

      if (opsPortal.enabled && opsService && method === "GET" && url.pathname === "/api/ops/truth") {
        const auth = await assertOpsPortalAuth(req);
        if (!auth.ok) {
          statusCode = 401;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: auth.message }));
          return;
        }
        const truth = await opsService.getTruth();
        statusCode = 200;
        res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
        res.end(JSON.stringify({ ok: true, truth }));
        return;
      }

      if (opsPortal.enabled && opsService && method === "GET" && url.pathname === "/api/ops/tasks") {
        const auth = await assertOpsPortalAuth(req);
        if (!auth.ok) {
          statusCode = 401;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: auth.message }));
          return;
        }
        const surface = toTrimmedString(url.searchParams.get("surface"));
        const role = toTrimmedString(url.searchParams.get("role"));
        let rows = await opsService.listTasks(opsActorContext(auth));
        if (surface) rows = rows.filter((entry) => entry.surface === surface);
        if (role) rows = rows.filter((entry) => entry.role === role);
        statusCode = 200;
        res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
        res.end(JSON.stringify({ ok: true, rows }));
        return;
      }

      const opsTaskClaimMatch = method === "POST" ? url.pathname.match(/^\/api\/ops\/tasks\/([^/]+)\/claim$/) : null;
      if (opsPortal.enabled && opsService && opsTaskClaimMatch) {
        const auth = await assertOpsPortalAuth(req);
        if (!auth.ok) {
          statusCode = 401;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: auth.message }));
          return;
        }
        const taskId = decodeURIComponent(opsTaskClaimMatch[1] ?? "");
        const task = await opsService.claimTask(taskId, opsActorContext(auth));
        if (!task) {
          statusCode = 404;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: `Task ${taskId} not found.` }));
          return;
        }
        statusCode = 200;
        res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
        res.end(JSON.stringify({ ok: true, task }));
        return;
      }

      const opsTaskProofMatch = method === "POST" ? url.pathname.match(/^\/api\/ops\/tasks\/([^/]+)\/proof$/) : null;
      if (opsPortal.enabled && opsService && opsTaskProofMatch) {
        const auth = await assertOpsPortalAuth(req);
        if (!auth.ok) {
          statusCode = 401;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: auth.message }));
          return;
        }
        const taskId = decodeURIComponent(opsTaskProofMatch[1] ?? "");
        const body = await readJsonBody(req);
        const mode = toTrimmedString(body.mode) as ProofMode;
        if (!mode) {
          statusCode = 400;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: "mode is required." }));
          return;
        }
        const proof = await opsService.addTaskProof(taskId, opsActorContext(auth), mode, toTrimmedString(body.note) || null, toStringList(body.artifactRefs, 24));
        if (!proof) {
          statusCode = 404;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: `Task ${taskId} not found.` }));
          return;
        }
        statusCode = 200;
        res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
        res.end(JSON.stringify({ ok: true, proof }));
        return;
      }

      const opsTaskProofAcceptMatch = method === "POST" ? url.pathname.match(/^\/api\/ops\/tasks\/([^/]+)\/proof\/accept$/) : null;
      if (opsPortal.enabled && opsService && opsTaskProofAcceptMatch) {
        const auth = await assertOpsPortalAuth(req);
        if (!auth.ok || !auth.principal) {
          statusCode = 401;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: auth.ok ? "Unauthorized" : auth.message }));
          return;
        }
        const taskId = decodeURIComponent(opsTaskProofAcceptMatch[1] ?? "");
        const body = await readJsonBody(req);
        const proofId = toTrimmedString(body.proofId);
        const status = toTrimmedString(body.status) || "accepted";
        if (!proofId || (status !== "accepted" && status !== "rejected" && status !== "readback_pending")) {
          statusCode = 400;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: "proofId and a valid status are required." }));
          return;
        }
        const proof = await opsService.acceptTaskProof({
          taskId,
          proofId,
          actorId: auth.actorId,
          status: status as "accepted" | "rejected" | "readback_pending",
          note: toTrimmedString(body.note) || null,
        }, opsActorContext(auth));
        if (!proof) {
          statusCode = 404;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: `Proof ${proofId} not found for task ${taskId}.` }));
          return;
        }
        statusCode = 200;
        res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
        res.end(JSON.stringify({ ok: true, proof }));
        return;
      }

      const opsTaskCompleteMatch = method === "POST" ? url.pathname.match(/^\/api\/ops\/tasks\/([^/]+)\/complete$/) : null;
      if (opsPortal.enabled && opsService && opsTaskCompleteMatch) {
        const auth = await assertOpsPortalAuth(req);
        if (!auth.ok) {
          statusCode = 401;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: auth.message }));
          return;
        }
        const taskId = decodeURIComponent(opsTaskCompleteMatch[1] ?? "");
        const task = await opsService.completeTask(taskId, opsActorContext(auth));
        if (!task) {
          statusCode = 404;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: `Task ${taskId} not found.` }));
          return;
        }
        statusCode = 200;
        res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
        res.end(JSON.stringify({ ok: true, task }));
        return;
      }

      const opsTaskEscapeMatch = method === "POST" ? url.pathname.match(/^\/api\/ops\/tasks\/([^/]+)\/escape$/) : null;
      if (opsPortal.enabled && opsService && opsTaskEscapeMatch) {
        const auth = await assertOpsPortalAuth(req);
        if (!auth.ok || !auth.principal) {
          statusCode = 401;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: auth.ok ? "Unauthorized" : auth.message }));
          return;
        }
        const taskId = decodeURIComponent(opsTaskEscapeMatch[1] ?? "");
        const body = await readJsonBody(req);
        const escapeHatch = toTrimmedString(body.escapeHatch || body.escape) as TaskEscapeHatch;
        if (!escapeHatch) {
          statusCode = 400;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: "escapeHatch is required." }));
          return;
        }
        const escape = await opsService.escapeTask({
          taskId,
          actorId: auth.actorId,
          escapeHatch,
          reason: toTrimmedString(body.reason) || null,
        }, opsActorContext(auth));
        if (!escape) {
          statusCode = 404;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: `Task ${taskId} not found.` }));
          return;
        }
        statusCode = 200;
        res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
        res.end(JSON.stringify({ ok: true, escape }));
        return;
      }

      if (opsPortal.enabled && opsService && method === "GET" && url.pathname === "/api/ops/cases") {
        const auth = await assertOpsPortalAuth(req);
        if (!auth.ok) {
          statusCode = 401;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: auth.message }));
          return;
        }
        const rows = await opsService.listCases(opsActorContext(auth));
        statusCode = 200;
        res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
        res.end(JSON.stringify({ ok: true, rows }));
        return;
      }

      const opsCaseDetailMatch = method === "GET" ? url.pathname.match(/^\/api\/ops\/cases\/([^/]+)$/) : null;
      if (opsPortal.enabled && opsService && opsCaseDetailMatch) {
        const auth = await assertOpsPortalAuth(req);
        if (!auth.ok) {
          statusCode = 401;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: auth.message }));
          return;
        }
        const caseId = decodeURIComponent(opsCaseDetailMatch[1] ?? "");
        const detail = await opsService.getCase(caseId, opsActorContext(auth));
        if (!detail.record) {
          statusCode = 404;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: `Case ${caseId} not found.` }));
          return;
        }
        statusCode = 200;
        res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
        res.end(JSON.stringify({ ok: true, ...detail }));
        return;
      }

      const opsCaseNoteMatch = method === "POST" ? url.pathname.match(/^\/api\/ops\/cases\/([^/]+)\/note$/) : null;
      if (opsPortal.enabled && opsService && opsCaseNoteMatch) {
        const auth = await assertOpsPortalAuth(req);
        if (!auth.ok) {
          statusCode = 401;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: auth.message }));
          return;
        }
        const caseId = decodeURIComponent(opsCaseNoteMatch[1] ?? "");
        const body = await readJsonBody(req);
        const noteBody = toTrimmedString(body.body);
        if (!noteBody) {
          statusCode = 400;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: "body is required." }));
          return;
        }
        const note = await opsService.addCaseNote({
          caseId,
          actorId: auth.actorId,
          body: noteBody,
          metadata: body.metadata && typeof body.metadata === "object" && !Array.isArray(body.metadata)
            ? (body.metadata as Record<string, unknown>)
            : {},
        });
        statusCode = 200;
        res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
        res.end(JSON.stringify({ ok: true, note }));
        return;
      }

      if (opsPortal.enabled && opsService && method === "GET" && url.pathname === "/api/ops/approvals") {
        const auth = await assertOpsPortalAuth(req);
        if (!auth.ok) {
          statusCode = 401;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: auth.message }));
          return;
        }
        const rows = await opsService.listApprovals(opsActorContext(auth));
        statusCode = 200;
        res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
        res.end(JSON.stringify({ ok: true, rows }));
        return;
      }

      if (opsPortal.enabled && opsService && method === "GET" && url.pathname === "/api/ops/reservations") {
        const auth = await assertOpsPortalAuth(req);
        if (!auth.ok || !auth.principal) {
          statusCode = 401;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: auth.ok ? "Unauthorized" : auth.message }));
          return;
        }
        const rows = await opsService.listReservations(opsActorContext(auth));
        statusCode = 200;
        res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
        res.end(JSON.stringify({ ok: true, rows }));
        return;
      }

      const opsReservationBundleMatch = method === "GET" ? url.pathname.match(/^\/api\/ops\/reservations\/([^/]+)\/bundle$/) : null;
      if (opsPortal.enabled && opsService && opsReservationBundleMatch) {
        const auth = await assertOpsPortalAuth(req);
        if (!auth.ok || !auth.principal) {
          statusCode = 401;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: auth.ok ? "Unauthorized" : auth.message }));
          return;
        }
        const reservationId = decodeURIComponent(opsReservationBundleMatch[1] ?? "");
        const bundle = await opsService.getReservationBundle(reservationId, opsActorContext(auth));
        if (!bundle) {
          statusCode = 404;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: `Reservation ${reservationId} not found.` }));
          return;
        }
        statusCode = 200;
        res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
        res.end(JSON.stringify({ ok: true, bundle }));
        return;
      }

      const opsReservationPrepareMatch = method === "POST" ? url.pathname.match(/^\/api\/ops\/reservations\/([^/]+)\/prepare$/) : null;
      if (opsPortal.enabled && opsService && opsReservationPrepareMatch) {
        const auth = await assertOpsPortalAuth(req);
        if (!auth.ok || !auth.principal) {
          statusCode = 401;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: auth.ok ? "Unauthorized" : auth.message }));
          return;
        }
        const reservationId = decodeURIComponent(opsReservationPrepareMatch[1] ?? "");
        const task = await opsService.prepareReservation(reservationId, opsActorContext(auth));
        if (!task) {
          statusCode = 404;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: `Reservation ${reservationId} not found.` }));
          return;
        }
        statusCode = 200;
        res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
        res.end(JSON.stringify({ ok: true, task }));
        return;
      }

      if (opsPortal.enabled && opsService && method === "GET" && url.pathname === "/api/ops/events") {
        const auth = await assertOpsPortalAuth(req);
        if (!auth.ok || !auth.principal) {
          statusCode = 401;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: auth.ok ? "Unauthorized" : auth.message }));
          return;
        }
        const rows = await opsService.listEvents(opsActorContext(auth));
        statusCode = 200;
        res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
        res.end(JSON.stringify({ ok: true, rows }));
        return;
      }

      if (opsPortal.enabled && opsService && method === "GET" && url.pathname === "/api/ops/reports") {
        const auth = await assertOpsPortalAuth(req);
        if (!auth.ok || !auth.principal) {
          statusCode = 401;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: auth.ok ? "Unauthorized" : auth.message }));
          return;
        }
        const rows = await opsService.listReports(opsActorContext(auth));
        statusCode = 200;
        res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
        res.end(JSON.stringify({ ok: true, rows }));
        return;
      }

      if (opsPortal.enabled && opsService && method === "GET" && url.pathname === "/api/ops/lending") {
        const auth = await assertOpsPortalAuth(req);
        if (!auth.ok || !auth.principal) {
          statusCode = 401;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: auth.ok ? "Unauthorized" : auth.message }));
          return;
        }
        const lending = await opsService.getLending(opsActorContext(auth));
        statusCode = 200;
        res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
        res.end(JSON.stringify({ ok: true, lending }));
        return;
      }

      const opsApprovalResolveMatch = method === "POST" ? url.pathname.match(/^\/api\/ops\/approvals\/([^/]+)\/resolve$/) : null;
      if (opsPortal.enabled && opsService && opsApprovalResolveMatch) {
        const auth = await assertOpsPortalAuth(req);
        if (!auth.ok) {
          statusCode = 401;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: auth.message }));
          return;
        }
        const approvalId = decodeURIComponent(opsApprovalResolveMatch[1] ?? "");
        const body = await readJsonBody(req);
        const status = toTrimmedString(body.status);
        if (status !== "approved" && status !== "rejected") {
          statusCode = 400;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: "status must be approved or rejected." }));
          return;
        }
        const approval = await opsService.resolveApproval({
          approvalId,
          status,
          actorId: auth.actorId,
          note: toTrimmedString(body.note) || null,
        }, opsActorContext(auth));
        if (!approval) {
          statusCode = 404;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: `Approval ${approvalId} not found.` }));
          return;
        }
        statusCode = 200;
        res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
        res.end(JSON.stringify({ ok: true, approval }));
        return;
      }

      const opsDisplayMatch = method === "GET" ? url.pathname.match(/^\/api\/ops\/displays\/([^/]+)$/) : null;
      if (opsPortal.enabled && opsService && opsDisplayMatch) {
        const auth = await assertOpsPortalAuth(req);
        if (!auth.ok) {
          statusCode = 401;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: auth.message }));
          return;
        }
        const stationId = decodeURIComponent(opsDisplayMatch[1] ?? "");
        const state = await opsService.getDisplayState(stationId);
        statusCode = 200;
        res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
        res.end(JSON.stringify({ ok: true, state }));
        return;
      }

      const opsDisplayStreamMatch = method === "GET" ? url.pathname.match(/^\/api\/ops\/displays\/([^/]+)\/stream$/) : null;
      if (opsPortal.enabled && opsService && opsDisplayStreamMatch) {
        const auth = await assertOpsPortalAuth(req);
        if (!auth.ok) {
          statusCode = 401;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: auth.message }));
          return;
        }
        const stationId = decodeURIComponent(opsDisplayStreamMatch[1] ?? "");
        const wantsSse =
          String(req.headers.accept || "")
            .toLowerCase()
            .includes("text/event-stream") || toBooleanFlag(url.searchParams.get("stream"), true);
        if (!wantsSse) {
          const state = await opsService.getDisplayState(stationId);
          statusCode = 200;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: true, state }));
          return;
        }
        statusCode = 200;
        res.writeHead(
          statusCode,
          withSecurityHeaders({
            "content-type": "text/event-stream; charset=utf-8",
            connection: "keep-alive",
            "x-accel-buffering": "no",
            ...corsHeaders,
            "x-request-id": requestId,
          }),
        );
        let closed = false;
        let lastSerialized = "";
        const push = async () => {
          const state = await opsService.getDisplayState(stationId);
          const serialized = JSON.stringify({ ok: true, state });
          if (serialized === lastSerialized) return;
          lastSerialized = serialized;
          res.write(`event: state\ndata: ${serialized}\n\n`);
        };
        const timer = setInterval(() => {
          void push();
        }, 10_000);
        const heartbeat = setInterval(() => {
          res.write(`event: heartbeat\ndata: ${JSON.stringify({ ok: true, at: new Date().toISOString() })}\n\n`);
        }, 15_000);
        const cleanup = () => {
          if (closed) return;
          closed = true;
          clearInterval(timer);
          clearInterval(heartbeat);
          if (!res.writableEnded) res.end();
        };
        req.on("close", cleanup);
        await push();
        return;
      }

      const opsChatMatch = method === "POST" ? url.pathname.match(/^\/api\/ops\/chat\/([^/]+)\/send$/) : null;
      if (opsPortal.enabled && opsService && opsChatMatch) {
        const auth = await assertOpsPortalAuth(req);
        if (!auth.ok) {
          statusCode = 401;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: auth.message }));
          return;
        }
        const surface = decodeURIComponent(opsChatMatch[1] ?? "manager");
        const body = await readJsonBody(req);
        const text = toTrimmedString(body.text);
        if (!text) {
          statusCode = 400;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: "text is required." }));
          return;
        }
        const result = await opsService.sendChat(surface, opsActorContext(auth), text);
        statusCode = 200;
        res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
        res.end(JSON.stringify({ ok: true, ...result }));
        return;
      }

      if (opsPortal.enabled && opsService && method === "POST" && url.pathname === "/api/ops/overrides") {
        const auth = await assertOpsPortalAuth(req);
        if (!auth.ok || !auth.principal) {
          statusCode = 401;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: auth.ok ? "Unauthorized" : auth.message }));
          return;
        }
        const body = await readJsonBody(req);
        const scope = toTrimmedString(body.scope);
        const reason = toTrimmedString(body.reason);
        if (!scope || !reason) {
          statusCode = 400;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: "scope and reason are required." }));
          return;
        }
        const override = await opsService.requestOverride({
          actorId: auth.actorId,
          scope,
          reason,
          expiresAt: toTrimmedString(body.expiresAt) || null,
          requiredRole: (toTrimmedString(body.requiredRole) || "owner") as OpsHumanRole,
          metadata: body.metadata && typeof body.metadata === "object" && !Array.isArray(body.metadata)
            ? body.metadata as Record<string, unknown>
            : {},
        }, opsActorContext(auth));
        statusCode = 202;
        res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
        res.end(JSON.stringify({ ok: true, override }));
        return;
      }

      if (opsPortal.enabled && opsService && method === "GET" && url.pathname === "/api/ops/ceo") {
        const auth = await assertOpsPortalAuth(req);
        if (!auth.ok) {
          statusCode = 401;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: auth.message }));
          return;
        }
        const rows = await opsService.listGrowthExperiments();
        statusCode = 200;
        res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
        res.end(JSON.stringify({ ok: true, rows }));
        return;
      }

      if (opsPortal.enabled && opsService && method === "POST" && url.pathname === "/api/ops/ceo/experiments") {
        const auth = await assertOpsPortalAuth(req);
        if (!auth.ok) {
          statusCode = 401;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: auth.message }));
          return;
        }
        const body = await readJsonBody(req);
        const title = toTrimmedString(body.title);
        const hypothesis = toTrimmedString(body.hypothesis);
        if (!title || !hypothesis) {
          statusCode = 400;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: "title and hypothesis are required." }));
          return;
        }
        const generatedAt = new Date().toISOString();
        const record: GrowthExperiment = {
          id: `growth_${crypto.randomUUID()}`,
          title,
          hypothesis,
          status: "proposed",
          summary: hypothesis,
          safetyBoundaries: ["draft_only", "no_money_without_approval", "no_owner_impersonation"],
          owner: auth.actorId,
          createdAt: generatedAt,
          updatedAt: generatedAt,
          metrics: {},
        };
        await opsService.createGrowthExperiment(record);
        statusCode = 202;
        res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
        res.end(JSON.stringify({ ok: true, experiment: record }));
        return;
      }

      if (opsPortal.enabled && opsService && method === "GET" && url.pathname === "/api/ops/forge") {
        const auth = await assertOpsPortalAuth(req);
        if (!auth.ok) {
          statusCode = 401;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: auth.message }));
          return;
        }
        const rows = await opsService.listImprovementCases();
        statusCode = 200;
        res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
        res.end(JSON.stringify({ ok: true, rows }));
        return;
      }

      if (opsPortal.enabled && opsService && method === "POST" && url.pathname === "/api/ops/forge/improvement-cases") {
        const auth = await assertOpsPortalAuth(req);
        if (!auth.ok) {
          statusCode = 401;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: auth.message }));
          return;
        }
        const body = await readJsonBody(req);
        const title = toTrimmedString(body.title);
        const problem = toTrimmedString(body.problem);
        if (!title || !problem) {
          statusCode = 400;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: "title and problem are required." }));
          return;
        }
        const generatedAt = new Date().toISOString();
        const record: ImprovementCase = {
          id: `improvement_${crypto.randomUUID()}`,
          title,
          problem,
          status: "open",
          summary: problem,
          requiredEvaluations: ["truth-readiness", "ux-clarity", "rollback"],
          rollbackPlan: "Shadow first, then gate behind a feature flag with explicit rollback.",
          createdAt: generatedAt,
          updatedAt: generatedAt,
          metadata: {
            requestedBy: auth.actorId,
          },
        };
        await opsService.createImprovementCase(record);
        statusCode = 202;
        res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
        res.end(JSON.stringify({ ok: true, improvementCase: record }));
        return;
      }

      if (method === "GET" && url.pathname === "/api/overseer/latest") {
        const auth = await assertCapabilityAuth(req, { requireAdminToken: false });
        if (!auth.ok) {
          statusCode = 401;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: auth.message }));
          return;
        }
        const overseer = await stateStore.getLatestOverseerRun();
        statusCode = 200;
        res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
        res.end(JSON.stringify({ ok: true, overseer }));
        return;
      }

      if (method === "GET" && url.pathname === "/api/overseer/discord/latest") {
        const auth = await assertCapabilityAuth(req, { requireAdminToken: false });
        if (!auth.ok) {
          statusCode = 401;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: auth.message }));
          return;
        }
        const overseer = await stateStore.getLatestOverseerRun();
        statusCode = 200;
        res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
        res.end(
          JSON.stringify({
            ok: true,
            discord: overseer
              ? {
                  runId: overseer.runId,
                  computedAt: overseer.computedAt,
                  overallStatus: overseer.overallStatus,
                  dedupeKey: overseer.delivery.dedupeKey,
                  delivery: overseer.delivery.discord,
                  coordinationActions: overseer.coordinationActions,
                }
              : null,
          })
        );
        return;
      }

      if (method === "GET" && url.pathname === "/api/overseer/runs") {
        const auth = await assertCapabilityAuth(req, { requireAdminToken: false });
        if (!auth.ok) {
          statusCode = 401;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: auth.message }));
          return;
        }
        const limitRaw = Number(url.searchParams.get("limit") ?? "20");
        const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(Math.floor(limitRaw), 100)) : 20;
        const rows = await stateStore.listRecentOverseerRuns(limit);
        statusCode = 200;
        res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
        res.end(JSON.stringify({ ok: true, rows }));
        return;
      }

      if (method === "GET" && url.pathname === "/api/control-tower/state") {
        const auth = await assertCapabilityAuth(req, { requireAdminToken: false });
        if (!auth.ok) {
          statusCode = 401;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: auth.message }));
          return;
        }
        const { state } = await readControlTowerSnapshot();
        statusCode = 200;
        res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
        res.end(JSON.stringify({ ok: true, state }));
        return;
      }

      if (method === "GET" && url.pathname === "/api/control-tower/overview") {
        const auth = await assertCapabilityAuth(req, { requireAdminToken: false });
        if (!auth.ok) {
          statusCode = 401;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: auth.message }));
          return;
        }
        const { state } = await readControlTowerSnapshot();
        statusCode = 200;
        res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
        res.end(JSON.stringify({ ok: true, overview: state.overview, counts: state.counts, generatedAt: state.generatedAt }));
        return;
      }

      if (method === "GET" && url.pathname === "/api/control-tower/partner/latest") {
        const auth = await assertCapabilityAuth(req, { requireAdminToken: false });
        if (!auth.ok) {
          statusCode = 401;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: auth.message }));
          return;
        }
        const { state } = await readControlTowerSnapshot();
        statusCode = 200;
        res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
        res.end(
          JSON.stringify({
            ok: true,
            partner: state.partner,
            checkins: readPartnerCheckins(resolvedControlTowerRepoRoot, 24),
          }),
        );
        return;
      }

      if (method === "POST" && url.pathname === "/api/control-tower/partner/brief") {
        const auth = await assertCapabilityAuth(req, { requireAdminToken: false });
        if (!auth.ok) {
          statusCode = 401;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: auth.message }));
          return;
        }
        const { state } = await readControlTowerSnapshot();
        statusCode = 200;
        res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
        res.end(JSON.stringify({ ok: true, partner: state.partner }));
        return;
      }

      if (method === "GET" && url.pathname === "/api/agent-runtime/latest") {
        const auth = await assertCapabilityAuth(req, { requireAdminToken: false });
        if (!auth.ok) {
          statusCode = 401;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: auth.message }));
          return;
        }
        const summary = readLatestAgentRuntimeSummary(resolvedControlTowerRepoRoot);
        const events = summary ? readAgentRuntimeEvents(resolvedControlTowerRepoRoot, summary.runId, 24) : [];
        statusCode = 200;
        res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
        res.end(JSON.stringify({ ok: true, summary, events }));
        return;
      }

      const runDetailMatch = url.pathname.match(/^\/api\/agent-runtime\/runs\/([^/]+)$/);
      if (method === "GET" && runDetailMatch) {
        const auth = await assertCapabilityAuth(req, { requireAdminToken: false });
        if (!auth.ok) {
          statusCode = 401;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: auth.message }));
          return;
        }
        const runId = decodeURIComponent(runDetailMatch[1] ?? "");
        const detail = buildAgentRuntimeRunDetail(resolvedControlTowerRepoRoot, runId);
        if (!detail.summary && detail.events.length === 0 && detail.artifacts.length === 0) {
          statusCode = 404;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: `No runtime detail found for ${runId}.` }));
          return;
        }
        statusCode = 200;
        res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
        res.end(JSON.stringify({ ok: true, detail }));
        return;
      }

      if (method === "GET" && url.pathname === "/api/agent-runtime/runs") {
        const auth = await assertCapabilityAuth(req, { requireAdminToken: false });
        if (!auth.ok) {
          statusCode = 401;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: auth.message }));
          return;
        }
        const limitRaw = Number(url.searchParams.get("limit") ?? "12");
        const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(Math.floor(limitRaw), 50)) : 12;
        const runs = listAgentRuntimeSummaries(resolvedControlTowerRepoRoot, limit);
        statusCode = 200;
        res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
        res.end(JSON.stringify({ ok: true, runs }));
        return;
      }

      if (method === "POST" && url.pathname === "/api/agent-runtime/events") {
        const auth = await assertCapabilityAuth(req);
        if (!auth.ok) {
          statusCode = 401;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: auth.message }));
          return;
        }
        const body = await readJsonBody(req);
        const event = body.event && typeof body.event === "object" ? (body.event as RunLedgerEvent) : null;
        const summary = body.summary && typeof body.summary === "object" ? (body.summary as AgentRuntimeSummary) : null;
        if (!event || !toTrimmedString(event.runId) || !toTrimmedString(event.type)) {
          statusCode = 400;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: "event.runId and event.type are required." }));
          return;
        }
        appendAgentRuntimeEvent(resolvedControlTowerRepoRoot, event);
        if (summary && toTrimmedString(summary.runId)) {
          writeAgentRuntimeSummary(resolvedControlTowerRepoRoot, summary);
        }
        statusCode = 202;
        res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
        res.end(JSON.stringify({ ok: true, accepted: true, runId: event.runId }));
        return;
      }

      if (method === "GET" && url.pathname === "/api/control-tower/hosts") {
        const auth = await assertCapabilityAuth(req, { requireAdminToken: false });
        if (!auth.ok) {
          statusCode = 401;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: auth.message }));
          return;
        }
        const { state } = await readControlTowerSnapshot();
        statusCode = 200;
        res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
        res.end(JSON.stringify({ ok: true, hosts: state.hosts }));
        return;
      }

      if (method === "POST" && url.pathname === "/api/control-tower/hosts/heartbeat") {
        const auth = await assertHostHeartbeatAuth(req);
        if (!auth.ok) {
          statusCode = 401;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: auth.message }));
          return;
        }
        const body = await readJsonBody(req);
        const hostId = toTrimmedString(body.hostId);
        if (!hostId) {
          statusCode = 400;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: "hostId is required." }));
          return;
        }
        const heartbeat: ControlTowerHostHeartbeat = {
          schema: "control-tower-host-heartbeat.v1",
          hostId,
          label: toTrimmedString(body.label) || hostId,
          environment: toTrimmedString(body.environment) === "server" ? "server" : "local",
          role: toTrimmedString(body.role) || "operator-host",
          health:
            toTrimmedString(body.health) === "maintenance"
              ? "maintenance"
              : toTrimmedString(body.health) === "offline"
                ? "offline"
                : toTrimmedString(body.health) === "degraded"
                  ? "degraded"
                  : "healthy",
          lastSeenAt: toTrimmedString(body.lastSeenAt) || new Date().toISOString(),
          currentRunId: toTrimmedString(body.currentRunId) || null,
          agentCount: Number.isFinite(Number(body.agentCount)) ? Math.max(0, Math.floor(Number(body.agentCount))) : 0,
          version: toTrimmedString(body.version) || null,
          metrics: {
            cpuPct: Number.isFinite(Number((body.metrics as Record<string, unknown> | undefined)?.cpuPct))
              ? Number((body.metrics as Record<string, unknown>).cpuPct)
              : null,
            memoryPct: Number.isFinite(Number((body.metrics as Record<string, unknown> | undefined)?.memoryPct))
              ? Number((body.metrics as Record<string, unknown>).memoryPct)
              : null,
            load1: Number.isFinite(Number((body.metrics as Record<string, unknown> | undefined)?.load1))
              ? Number((body.metrics as Record<string, unknown>).load1)
              : null,
          },
        };
        writeControlTowerHostHeartbeat(resolvedControlTowerRepoRoot, heartbeat);
        statusCode = 202;
        res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
        res.end(JSON.stringify({ ok: true, accepted: true, hostId, actorId: auth.actorId }));
        return;
      }

      if (method === "GET" && url.pathname === "/api/control-tower/rooms") {
        const auth = await assertCapabilityAuth(req, { requireAdminToken: false });
        if (!auth.ok) {
          statusCode = 401;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: auth.message }));
          return;
        }
        const { state } = await readControlTowerSnapshot();
        statusCode = 200;
        res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
        res.end(JSON.stringify({ ok: true, rooms: state.rooms }));
        return;
      }

      if (method === "POST" && url.pathname === "/api/control-tower/rooms") {
        const auth = await assertCapabilityAuth(req);
        if (!auth.ok) {
          statusCode = 401;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: auth.message }));
          return;
        }
        const body = await readJsonBody(req);
        const result = spawnControlTowerSession(
          {
            name: toTrimmedString(body.name),
            cwd: toTrimmedString(body.cwd) || resolvedControlTowerRepoRoot,
            command: toTrimmedString(body.command) || "bash",
            tool: toTrimmedString(body.tool) || "custom",
            group: toTrimmedString(body.group),
            room: toTrimmedString(body.room),
            summary: toTrimmedString(body.summary),
            objective: toTrimmedString(body.objective),
          },
          {
            repoRoot: resolvedControlTowerRepoRoot,
            hostUser: resolvedControlTowerHostUser,
            runner: controlTowerRunner,
          },
        );
        statusCode = result.ok ? 201 : 400;
        if (result.ok) {
          await appendControlTowerAudit(
            auth.principal,
            "studio_ops.control_tower.session_spawned",
            `Created room session ${String(result.sessionName || "").trim()}.`,
            {
              roomId: toTrimmedString(body.room) || toTrimmedString(body.group) || toTrimmedString(body.name),
              sessionName: result.sessionName ?? null,
              cwd: result.cwd ?? null,
              tool: toTrimmedString(body.tool) || "custom",
            },
          );
        }
        res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
        res.end(JSON.stringify(result));
        return;
      }

      if (method === "GET" && url.pathname === "/api/control-tower/services") {
        const auth = await assertCapabilityAuth(req);
        if (!auth.ok) {
          statusCode = 401;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: auth.message }));
          return;
        }
        const { state } = await readControlTowerSnapshot();
        statusCode = 200;
        res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
        res.end(JSON.stringify({ ok: true, services: state.services }));
        return;
      }

      if (method === "GET" && url.pathname === "/api/control-tower/events") {
        const auth = await assertCapabilityAuth(req);
        if (!auth.ok) {
          statusCode = 401;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: auth.message }));
          return;
        }
        const wantsSse =
          String(req.headers.accept || "")
            .toLowerCase()
            .includes("text/event-stream") || toBooleanFlag(url.searchParams.get("stream"), false);
        if (!wantsSse) {
          const { state } = await readControlTowerSnapshot();
          statusCode = 200;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: true, events: state.events }));
          return;
        }

        const streamOnce = toBooleanFlag(url.searchParams.get("once"), false);
        statusCode = 200;
        res.writeHead(
          statusCode,
          withSecurityHeaders({
            "content-type": "text/event-stream; charset=utf-8",
            connection: "keep-alive",
            "x-accel-buffering": "no",
            ...corsHeaders,
            "x-request-id": requestId,
          }),
        );

        const seenEventIds = new Set<string>();
        let closed = false;
        let pollTimer: NodeJS.Timeout | null = null;
        let heartbeatTimer: NodeJS.Timeout | null = null;
        let lastSnapshotSignature = "";

        const cleanup = () => {
          if (closed) return;
          closed = true;
          if (pollTimer) clearInterval(pollTimer);
          if (heartbeatTimer) clearInterval(heartbeatTimer);
          if (!res.writableEnded) res.end();
        };

        const pushSnapshot = async () => {
          if (closed) return;
          try {
            const { state } = await readControlTowerSnapshot();
            const freshEvents = state.events.filter((event) => !seenEventIds.has(event.id));
            for (const event of freshEvents) {
              seenEventIds.add(event.id);
              res.write(`id: ${event.id}\n`);
              res.write(`event: ${event.type}\n`);
              res.write(`data: ${JSON.stringify(event)}\n\n`);
            }
            const snapshotSignature = crypto
              .createHash("sha1")
              .update(
                JSON.stringify({
                  generatedAt: state.generatedAt,
                  runtimeUpdatedAt: state.agentRuntime?.updatedAt ?? null,
                  runtimeStatus: state.agentRuntime?.status ?? null,
                  approvals: state.approvals.map((approval) => `${approval.id}:${approval.status}:${approval.createdAt}`),
                  hosts: state.hosts.map((host) => ({
                    hostId: host.hostId,
                    lastSeenAt: host.lastSeenAt,
                    health: host.health,
                    connectivity: host.connectivity,
                    currentRunId: host.currentRunId,
                  })),
                }),
              )
              .digest("hex");
            if (snapshotSignature !== lastSnapshotSignature) {
              lastSnapshotSignature = snapshotSignature;
              const pulseEvent: ControlTowerEvent = {
                id: `snapshot:${snapshotSignature}`,
                at: state.generatedAt,
                kind: "operator",
                type: "run.status",
                runId: state.agentRuntime?.runId ?? null,
                agentId: state.agentRuntime?.agentId ?? null,
                channel: "ops",
                occurredAt: state.generatedAt,
                severity: "info",
                title: "Control Tower snapshot refreshed",
                summary: "Runtime or host presence changed.",
                actor: "control-tower",
                roomId: null,
                serviceId: null,
                actionLabel: null,
                sourceAction: "control_tower.snapshot_refreshed",
                payload: {
                  hostCount: state.hosts.length,
                  approvalCount: state.approvals.length,
                  latestRunId: state.agentRuntime?.runId ?? null,
                },
              };
              if (!freshEvents.length) {
                res.write(`id: ${pulseEvent.id}\n`);
                res.write(`event: ${pulseEvent.type}\n`);
                res.write(`data: ${JSON.stringify(pulseEvent)}\n\n`);
              }
            }
            if (streamOnce) {
              cleanup();
            }
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            res.write(`event: error\n`);
            res.write(`data: ${JSON.stringify({ message })}\n\n`);
            if (streamOnce) cleanup();
          }
        };

        res.write(`retry: 3000\n\n`);
        req.on("close", cleanup);
        res.on("close", cleanup);
        heartbeatTimer = setInterval(() => {
          if (closed) return;
          res.write(`: keepalive ${new Date().toISOString()}\n\n`);
        }, CONTROL_TOWER_EVENT_STREAM_HEARTBEAT_MS);
        pollTimer = setInterval(() => {
          void pushSnapshot();
        }, CONTROL_TOWER_EVENT_STREAM_POLL_MS);
        void pushSnapshot();
        return;
      }

      if (method === "POST" && url.pathname === "/api/control-tower/partner/checkins") {
        const auth = await assertCapabilityAuth(req, { requireAdminToken: false });
        if (!auth.ok) {
          statusCode = 401;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: auth.message }));
          return;
        }
        const snapshot = await readControlTowerSnapshot();
        if (!snapshot.state.partner) {
          statusCode = 503;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: "partner brief is unavailable" }));
          return;
        }
        const body = await readJsonBody(req);
        const action = toTrimmedString(body.action);
        if (!isPartnerCheckinAction(action)) {
          statusCode = 400;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: "action must be one of ack, snooze, pause, redirect, why_this, or continue." }));
          return;
        }
        const partner = recordPartnerCheckin({
          repoRoot: resolvedControlTowerRepoRoot,
          brief: snapshot.state.partner,
          actorId: auth.principal?.uid ?? "staff:unknown",
          action,
          note: toTrimmedString(body.note) || undefined,
          snoozeMinutes: toNullableNumber(body.snoozeMinutes) ?? undefined,
        });
        await appendControlTowerAudit(
          auth.principal,
          "studio_ops.control_tower.partner_checkin",
          `Recorded chief-of-staff command ${action}.`,
          {
            action,
            note: toTrimmedString(body.note) || null,
            snoozeMinutes: toNullableNumber(body.snoozeMinutes),
          },
        );
        statusCode = 200;
        res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
        res.end(JSON.stringify({ ok: true, partner }));
        return;
      }

      const controlTowerPartnerOpenLoopMatch =
        method === "POST" ? url.pathname.match(/^\/api\/control-tower\/partner\/open-loops\/([^/]+)$/) : null;
      if (controlTowerPartnerOpenLoopMatch) {
        const auth = await assertCapabilityAuth(req, { requireAdminToken: false });
        if (!auth.ok) {
          statusCode = 401;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: auth.message }));
          return;
        }
        const snapshot = await readControlTowerSnapshot();
        if (!snapshot.state.partner) {
          statusCode = 503;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: "partner brief is unavailable" }));
          return;
        }
        const loopId = decodeURIComponent(controlTowerPartnerOpenLoopMatch[1] || "");
        const body = await readJsonBody(req);
        const status = toTrimmedString(body.status);
        if (!isPartnerOpenLoopStatus(status)) {
          statusCode = 400;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: "status must be delegated, paused, or resolved." }));
          return;
        }
        const loopExists = snapshot.state.partner.openLoops.some((entry) => entry.id === loopId);
        if (!loopExists) {
          statusCode = 404;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: `open loop ${loopId} not found` }));
          return;
        }
        const partner = updatePartnerOpenLoop({
          repoRoot: resolvedControlTowerRepoRoot,
          brief: snapshot.state.partner,
          loopId,
          status,
          actorId: auth.principal?.uid ?? "staff:unknown",
          note: toTrimmedString(body.note) || undefined,
        });
        await appendControlTowerAudit(
          auth.principal,
          "studio_ops.control_tower.partner_open_loop_updated",
          `Marked ${loopId} as ${status}.`,
          {
            loopId,
            status,
            note: toTrimmedString(body.note) || null,
          },
        );
        statusCode = 200;
        res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
        res.end(JSON.stringify({ ok: true, partner, openLoop: partner.openLoops.find((entry) => entry.id === loopId) ?? null }));
        return;
      }

      const controlTowerRoomSendMatch = method === "POST" ? url.pathname.match(/^\/api\/control-tower\/rooms\/([^/]+)\/send$/) : null;
      if (controlTowerRoomSendMatch) {
        const auth = await assertCapabilityAuth(req);
        if (!auth.ok) {
          statusCode = 401;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: auth.message }));
          return;
        }
        const roomId = decodeURIComponent(controlTowerRoomSendMatch[1] || "");
        const body = await readJsonBody(req);
        const text = toTrimmedString(body.text);
        if (!text) {
          statusCode = 400;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: "text is required" }));
          return;
        }
        const { raw } = await readControlTowerSnapshot();
        const sessionName = resolvePrimarySessionForRoom(raw, roomId) || roomId;
        const result = sendControlTowerInstruction(
          {
            session: sessionName,
            text,
            enter:
              typeof body.enter === "boolean"
                ? body.enter
                : typeof body.enter === "string"
                  ? toBooleanFlag(body.enter, true)
                  : true,
          },
          {
            repoRoot: resolvedControlTowerRepoRoot,
            hostUser: resolvedControlTowerHostUser,
            runner: controlTowerRunner,
          },
        );
        statusCode = result.ok ? 200 : 400;
        if (result.ok) {
          await appendControlTowerAudit(
            auth.principal,
            "studio_ops.control_tower.session_instruction_sent",
            `Sent instruction to ${sessionName}.`,
            {
              roomId,
              sessionName,
              textPreview: clipText(text, 120),
            },
          );
        }
        res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
        res.end(JSON.stringify(result));
        return;
      }

      const controlTowerRoomPinMatch = method === "POST" ? url.pathname.match(/^\/api\/control-tower\/rooms\/([^/]+)\/(pin|unpin)$/) : null;
      if (controlTowerRoomPinMatch) {
        const auth = await assertCapabilityAuth(req);
        if (!auth.ok) {
          statusCode = 401;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: auth.message }));
          return;
        }
        const roomId = decodeURIComponent(controlTowerRoomPinMatch[1] || "");
        const operation = controlTowerRoomPinMatch[2] === "unpin" ? "unpin" : "pin";
        const { raw } = await readControlTowerSnapshot();
        const roomExists = raw.rooms.some((entry) => entry.id === roomId);
        if (!roomExists) {
          statusCode = 404;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: `room ${roomId} not found` }));
          return;
        }
        const body = await readJsonBody(req);
        const rationale =
          toTrimmedString(body.rationale) ||
          (operation === "pin" ? `Escalated ${roomId} from Control Tower.` : `Cleared escalation for ${roomId}.`);
        await appendControlTowerAudit(
          auth.principal,
          operation === "pin" ? "studio_ops.control_tower.room_pinned" : "studio_ops.control_tower.room_unpinned",
          rationale,
          { roomId },
        );
        statusCode = 200;
        res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
        res.end(JSON.stringify({ ok: true, roomId, operation }));
        return;
      }

      const controlTowerRoomAttachMatch = method === "GET" ? url.pathname.match(/^\/api\/control-tower\/rooms\/([^/]+)\/attach-command$/) : null;
      if (controlTowerRoomAttachMatch) {
        const auth = await assertCapabilityAuth(req);
        if (!auth.ok) {
          statusCode = 401;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: auth.message }));
          return;
        }
        const roomId = decodeURIComponent(controlTowerRoomAttachMatch[1] || "");
        const { raw } = await readControlTowerSnapshot();
        const sessionName = resolvePrimarySessionForRoom(raw, roomId);
        if (!sessionName) {
          statusCode = 404;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: `room ${roomId} not found` }));
          return;
        }
        const result = buildControlTowerAttachCommand(
          { sessionName },
          { sshHostAlias: resolvedControlTowerSshHostAlias },
        );
        statusCode = result.ok ? 200 : 404;
        res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
        res.end(JSON.stringify(result));
        return;
      }

      const controlTowerRoomDetailMatch = method === "GET" ? url.pathname.match(/^\/api\/control-tower\/rooms\/([^/]+)$/) : null;
      if (controlTowerRoomDetailMatch) {
        const auth = await assertCapabilityAuth(req);
        if (!auth.ok) {
          statusCode = 401;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: auth.message }));
          return;
        }
        const roomId = decodeURIComponent(controlTowerRoomDetailMatch[1] || "");
        const snapshot = await readControlTowerSnapshot();
        const sessionName = resolvePrimarySessionForRoom(snapshot.raw, roomId);
        const attach = sessionName
          ? buildControlTowerAttachCommand({ sessionName }, { sshHostAlias: resolvedControlTowerSshHostAlias })
          : null;
        const room = deriveRoomDetail(snapshot.raw, snapshot.state, roomId, attach && attach.ok ? attach : null);
        if (!room) {
          statusCode = 404;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: `room ${roomId} not found` }));
          return;
        }
        statusCode = 200;
        res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
        res.end(JSON.stringify({ ok: true, room }));
        return;
      }

      const controlTowerServiceActionMatch = method === "POST" ? url.pathname.match(/^\/api\/control-tower\/services\/([^/]+)\/actions$/) : null;
      if (controlTowerServiceActionMatch) {
        const auth = await assertCapabilityAuth(req);
        if (!auth.ok) {
          statusCode = 401;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: auth.message }));
          return;
        }
        const serviceId = decodeURIComponent(controlTowerServiceActionMatch[1] || "");
        const body = await readJsonBody(req);
        const action = toTrimmedString(body.action) || "status";
        const result = runControlTowerServiceAction(
          { service: serviceId, action },
          { hostUser: resolvedControlTowerHostUser, runner: controlTowerRunner },
        );
        statusCode = result.ok ? 200 : 400;
        if (result.ok) {
          await appendControlTowerAudit(
            auth.principal,
            "studio_ops.control_tower.service_action",
            `Ran ${action} on ${serviceId}.`,
            {
              serviceId,
              action,
            },
          );
        }
        res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
        res.end(JSON.stringify(result));
        return;
      }

      if (method === "POST" && url.pathname === "/api/control-tower/overseer/ack") {
        const auth = await assertCapabilityAuth(req);
        if (!auth.ok) {
          statusCode = 401;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: auth.message }));
          return;
        }
        const body = await readJsonBody(req);
        const result = appendControlTowerOverseerAck(
          {
            note: toTrimmedString(body.note),
            runId: toTrimmedString(body.runId),
            actor: auth.principal?.uid,
          },
          {
            repoRoot: resolvedControlTowerRepoRoot,
            hostUser: resolvedControlTowerHostUser,
          },
        );
        statusCode = result.ok ? 200 : 400;
        if (result.ok) {
          await appendControlTowerAudit(
            auth.principal,
            "studio_ops.control_tower.overseer_ack",
            `Recorded an overseer acknowledgement for ${String(result.runId || "latest").trim()}.`,
            {
              runId: result.runId ?? null,
              note: clipText(body.note, 140),
            },
          );
        }
        res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
        res.end(JSON.stringify(result));
        return;
      }

      if (method === "POST" && url.pathname === "/api/ops/drills") {
        const auth = await assertCapabilityAuth(req);
        if (!auth.ok) {
          statusCode = 401;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: auth.message }));
          return;
        }
        const body = await readJsonBody(req);
        const scenarioId = typeof body.scenarioId === "string" ? body.scenarioId.trim() : "";
        const status = typeof body.status === "string" ? body.status.trim() : "";
        if (!scenarioId || !status) {
          statusCode = 400;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: "scenarioId and status are required." }));
          return;
        }
        await eventStore.append({
          actorType: "staff",
          actorId: auth.principal?.uid ?? "staff:unknown",
          action: "studio_ops.drill_event",
          rationale: `Drill ${scenarioId} status=${status}.`,
          target: "local",
          approvalState: "approved",
          inputHash: scenarioId,
          outputHash: null,
          metadata: {
            scenarioId,
            status,
            outcome: typeof body.outcome === "string" ? body.outcome : null,
            notes: typeof body.notes === "string" ? body.notes : null,
            mttrMinutes: typeof body.mttrMinutes === "number" ? body.mttrMinutes : null,
            unresolvedRisks: Array.isArray(body.unresolvedRisks) ? body.unresolvedRisks : [],
          },
        });
        statusCode = 200;
        res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
        res.end(JSON.stringify({ ok: true }));
        return;
      }

      if (method === "POST" && url.pathname === "/api/ops/degraded") {
        const auth = await assertCapabilityAuth(req);
        if (!auth.ok) {
          statusCode = 401;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: auth.message }));
          return;
        }
        const body = await readJsonBody(req);
        const status = typeof body.status === "string" ? body.status.trim() : "";
        const mode = typeof body.mode === "string" ? body.mode.trim() : "degraded";
        if (!status || (status !== "entered" && status !== "exited")) {
          statusCode = 400;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: "status must be entered or exited." }));
          return;
        }
        const action = status === "entered" ? "studio_ops.degraded_mode_entered" : "studio_ops.degraded_mode_exited";
        await eventStore.append({
          actorType: "staff",
          actorId: auth.principal?.uid ?? "staff:unknown",
          action,
          rationale: typeof body.rationale === "string" ? body.rationale : "Staff console reported degraded mode change.",
          target: "local",
          approvalState: "approved",
          inputHash: `${status}:${mode}`,
          outputHash: null,
          metadata: {
            status,
            mode,
            reason: typeof body.reason === "string" ? body.reason : null,
            details: typeof body.details === "string" ? body.details : null,
          },
        });
        statusCode = 200;
        res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
        res.end(JSON.stringify({ ok: true }));
        return;
      }

      if (method === "GET" && url.pathname === "/api/ops/audit") {
        const auth = await assertCapabilityAuth(req);
        if (!auth.ok) {
          statusCode = 401;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: auth.message }));
          return;
        }
        const limitRaw = Number(url.searchParams.get("limit") ?? "50");
        const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(Math.floor(limitRaw), 200)) : 50;
        const actionPrefix = String(url.searchParams.get("actionPrefix") ?? "studio_ops.").trim();
        const rows = await eventStore.listRecent(Math.max(limit * 4, 100));
        const opsRows = rows
          .filter((row) => row.action.startsWith(actionPrefix))
          .slice(0, limit);
        statusCode = 200;
        res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
        res.end(JSON.stringify({ ok: true, rows: opsRows }));
        return;
      }

      if (method === "GET" && url.pathname === "/api/ops/drills") {
        const auth = await assertCapabilityAuth(req);
        if (!auth.ok) {
          statusCode = 401;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: auth.message }));
          return;
        }
        const limitRaw = Number(url.searchParams.get("limit") ?? "50");
        const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(Math.floor(limitRaw), 200)) : 50;
        const rows = await eventStore.listRecent(Math.max(limit * 4, 100));
        const drills = rows
          .filter((row) => row.action === "studio_ops.drill_event")
          .slice(0, limit)
          .map((row) => ({
            id: row.id,
            at: row.at,
            scenarioId: row.metadata?.scenarioId ?? null,
            status: row.metadata?.status ?? null,
            outcome: row.metadata?.outcome ?? null,
            notes: row.metadata?.notes ?? null,
            mttrMinutes: row.metadata?.mttrMinutes ?? null,
            unresolvedRisks: row.metadata?.unresolvedRisks ?? [],
          }));
        statusCode = 200;
        res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
        res.end(JSON.stringify({ ok: true, rows: drills }));
        return;
      }

      if (method === "GET" && url.pathname === "/api/finance/reconciliation/drafts") {
        const auth = await assertCapabilityAuth(req);
        if (!auth.ok) {
          statusCode = 401;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: auth.message }));
          return;
        }
        const limitRaw = Number(url.searchParams.get("limit") ?? "50");
        const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(Math.floor(limitRaw), 200)) : 50;
        const rows = await eventStore.listRecent(Math.max(limit * 5, 100));
        const drafts = rows
          .filter((row) => row.action === "studio_finance.reconciliation_draft_created")
          .slice(0, limit)
          .map((row) => {
            const metadata = (row.metadata ?? {}) as FinanceReconciliationDraft;
            const { id: _ignored, ...rest } = metadata;
            return {
              id: row.id,
              at: row.at,
              ...rest,
            };
          });
        statusCode = 200;
        res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
        res.end(JSON.stringify({ ok: true, rows: drafts }));
        return;
      }

      if (method === "GET" && url.pathname === "/api/marketing/drafts") {
        const auth = await assertCapabilityAuth(req);
        if (!auth.ok) {
          statusCode = 401;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: auth.message }));
          return;
        }
        const limitRaw = Number(url.searchParams.get("limit") ?? "50");
        const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(Math.floor(limitRaw), 200)) : 50;
        const rows = await eventStore.listRecent(Math.max(limit * 6, 100));
        const created = rows.filter((row) => row.action === "studio_marketing.draft_created");
        const statusEvents = rows.filter((row) => row.action === "studio_marketing.draft_status_changed");
        const latestStatusByDraft = new Map<string, MarketingDraftStatus>();
        for (const row of statusEvents) {
          const draftId = typeof row.metadata?.draftId === "string" ? row.metadata.draftId : "";
          const toStatus = typeof row.metadata?.toStatus === "string" ? (row.metadata.toStatus as MarketingDraftStatus) : null;
          if (!draftId || !toStatus || latestStatusByDraft.has(draftId)) continue;
          latestStatusByDraft.set(draftId, toStatus);
        }
        const drafts = created
          .slice(0, limit)
          .map((row) => {
            const metadata = (row.metadata ?? {}) as Record<string, unknown>;
            const draftId = typeof metadata.draftId === "string" ? metadata.draftId : row.id;
            return {
              id: row.id,
              at: row.at,
              ...metadata,
              draftId,
              status: latestStatusByDraft.get(draftId) ?? metadata.status ?? "draft",
            };
          });
        statusCode = 200;
        res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
        res.end(JSON.stringify({ ok: true, rows: drafts }));
        return;
      }

      if (method === "GET" && url.pathname === "/api/intake/review-queue") {
        const auth = await assertCapabilityAuth(req);
        if (!auth.ok) {
          statusCode = 401;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: auth.message }));
          return;
        }
        const limitRaw = Number(url.searchParams.get("limit") ?? "50");
        const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(Math.floor(limitRaw), 200)) : 50;
        const rows = await eventStore.listRecent(Math.max(limit * 8, 200));
        statusCode = 200;
        res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
        res.end(JSON.stringify({ ok: true, rows: buildIntakeQueue(rows, limit) }));
        return;
      }

      if (method === "POST" && url.pathname === "/api/trust-safety/triage/suggest") {
        const auth = await assertCapabilityAuth(req);
        if (!auth.ok) {
          statusCode = 401;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: auth.message }));
          return;
        }
        const body = await readJsonBody(req);
        const reportId = typeof body.reportId === "string" ? body.reportId.trim() : "";
        const note = typeof body.note === "string" ? body.note : "";
        const targetTitle = typeof body.targetTitle === "string" ? body.targetTitle : "";
        const targetType = typeof body.targetType === "string" ? body.targetType : "";
        const suggestion = buildTriageSuggestion({ note, targetTitle, targetType });
        await eventStore.append({
          actorType: "staff",
          actorId: auth.principal?.uid ?? "staff:unknown",
          action: "trust_safety.triage_suggestion_generated",
          rationale: `Generated suggestion for report ${reportId || "unknown"}.`,
          target: "local",
          approvalState: "approved",
          inputHash: reportId || "unknown",
          outputHash: suggestion.reasonCode,
          metadata: {
            reportId: reportId || null,
            suggestion,
          },
        });
        statusCode = 200;
        res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
        res.end(JSON.stringify({ ok: true, suggestion }));
        return;
      }

      if (method === "POST" && url.pathname === "/api/trust-safety/triage/feedback") {
        const auth = await assertCapabilityAuth(req);
        if (!auth.ok) {
          statusCode = 401;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: auth.message }));
          return;
        }
        const body = await readJsonBody(req);
        const reportId = typeof body.reportId === "string" ? body.reportId.trim() : "";
        const decision = typeof body.decision === "string" ? body.decision.trim() : "";
        if (decision !== "accepted" && decision !== "rejected") {
          statusCode = 400;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: "decision must be accepted or rejected." }));
          return;
        }
        const mismatch = body.mismatch === true;
        await eventStore.append({
          actorType: "staff",
          actorId: auth.principal?.uid ?? "staff:unknown",
          action: "trust_safety.triage_suggestion_feedback",
          rationale: `Staff ${decision} triage suggestion.`,
          target: "local",
          approvalState: "approved",
          inputHash: reportId || "unknown",
          outputHash: null,
          metadata: {
            reportId: reportId || null,
            decision,
            mismatch,
            suggestedSeverity: typeof body.suggestedSeverity === "string" ? body.suggestedSeverity : null,
            suggestedCategory: typeof body.suggestedCategory === "string" ? body.suggestedCategory : null,
            suggestedReasonCode: typeof body.suggestedReasonCode === "string" ? body.suggestedReasonCode : null,
            finalSeverity: typeof body.finalSeverity === "string" ? body.finalSeverity : null,
            finalCategory: typeof body.finalCategory === "string" ? body.finalCategory : null,
            finalReasonCode: typeof body.finalReasonCode === "string" ? body.finalReasonCode : null,
          },
        });
        statusCode = 200;
        res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
        res.end(JSON.stringify({ ok: true }));
        return;
      }

      if (method === "GET" && url.pathname === "/api/trust-safety/triage/stats") {
        const auth = await assertCapabilityAuth(req);
        if (!auth.ok) {
          statusCode = 401;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: auth.message }));
          return;
        }
        const limitRaw = Number(url.searchParams.get("limit") ?? "500");
        const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(Math.floor(limitRaw), 5000)) : 500;
        const rows = await eventStore.listRecent(limit);
        const stats = computeSuggestionFeedbackStats(rows);
        statusCode = 200;
        res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
        res.end(JSON.stringify({ ok: true, stats }));
        return;
      }

      const intakeOverrideMatch = url.pathname.match(/^\/api\/intake\/review-queue\/([^/]+)\/override$/);
      if (method === "POST" && intakeOverrideMatch) {
        const auth = await assertCapabilityAuth(req);
        if (!auth.ok) {
          statusCode = 401;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: auth.message }));
          return;
        }
        const body = await readJsonBody(req);
        const intakeThrottle = await enforceRateLimit(
          `rate:${auth.principal?.uid ?? "staff:unknown"}:intake_override`,
          rateLimits.intakeOverridePerMinute,
          60,
          auth.principal?.uid ?? "staff:unknown"
        );
        if (!intakeThrottle.allowed) {
          statusCode = 429;
          res.writeHead(
            statusCode,
            withSecurityHeaders({
              "content-type": "application/json",
              "retry-after": String(intakeThrottle.retryAfterSeconds),
              ...corsHeaders,
              "x-request-id": requestId,
            })
          );
          res.end(JSON.stringify({ ok: false, reasonCode: "RATE_LIMITED", retryAfterSeconds: intakeThrottle.retryAfterSeconds }));
          return;
        }
        const decision = typeof body.decision === "string" ? (body.decision as IntakeOverrideDecision) : null;
        const reasonCode = typeof body.reasonCode === "string" ? body.reasonCode.trim() : "";
        const rationale = typeof body.rationale === "string" ? body.rationale.trim() : "";
        if (!decision || !["override_granted", "override_denied"].includes(decision)) {
          statusCode = 400;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: "Valid decision is required." }));
          return;
        }
        if (rationale.length < 10 || !isValidOverrideTransition(decision, reasonCode)) {
          statusCode = 400;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: "Valid reasonCode and rationale are required." }));
          return;
        }
        const intakeId = decodeURIComponent(intakeOverrideMatch[1]);
        await eventStore.append({
          actorType: "staff",
          actorId: auth.principal?.uid ?? "staff:unknown",
          action: decision === "override_granted" ? "intake.override_granted" : "intake.override_denied",
          rationale,
          target: "local",
          approvalState: decision === "override_granted" ? "approved" : "rejected",
          inputHash: intakeId,
          outputHash: reasonCode,
          metadata: {
            intakeId,
            reasonCode,
          },
        });
        statusCode = 200;
        res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
        res.end(JSON.stringify({ ok: true, intakeId, decision, reasonCode }));
        return;
      }

      const marketingReviewMatch = url.pathname.match(/^\/api\/marketing\/drafts\/([^/]+)\/review$/);
      if (method === "POST" && marketingReviewMatch) {
        const auth = await assertCapabilityAuth(req);
        if (!auth.ok) {
          statusCode = 401;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: auth.message }));
          return;
        }
        const body = await readJsonBody(req);
        const marketingThrottle = await enforceRateLimit(
          `rate:${auth.principal?.uid ?? "staff:unknown"}:marketing_review`,
          rateLimits.marketingReviewPerMinute,
          60,
          auth.principal?.uid ?? "staff:unknown"
        );
        if (!marketingThrottle.allowed) {
          statusCode = 429;
          res.writeHead(
            statusCode,
            withSecurityHeaders({
              "content-type": "application/json",
              "retry-after": String(marketingThrottle.retryAfterSeconds),
              ...corsHeaders,
              "x-request-id": requestId,
            })
          );
          res.end(
            JSON.stringify({ ok: false, reasonCode: "RATE_LIMITED", retryAfterSeconds: marketingThrottle.retryAfterSeconds })
          );
          return;
        }
        const toStatus = typeof body.toStatus === "string" ? (body.toStatus as MarketingDraftStatus) : null;
        const rationale = typeof body.rationale === "string" ? body.rationale.trim() : "";
        if (!toStatus || !["draft", "needs_review", "approved_for_publish"].includes(toStatus)) {
          statusCode = 400;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: "Valid toStatus is required." }));
          return;
        }
        if (rationale.length < 10) {
          statusCode = 400;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: "Review rationale must be at least 10 characters." }));
          return;
        }
        const draftId = decodeURIComponent(marketingReviewMatch[1]);
        const rows = await eventStore.listRecent(500);
        const existing = rows.find((row) => row.action === "studio_marketing.draft_created" && row.metadata?.draftId === draftId);
        if (!existing) {
          statusCode = 404;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: "Draft not found." }));
          return;
        }
        const latestStatusEvent = rows.find(
          (row) => row.action === "studio_marketing.draft_status_changed" && row.metadata?.draftId === draftId
        );
        const fromStatus = (latestStatusEvent?.metadata?.toStatus as MarketingDraftStatus | undefined) ?? "draft";
        if (!canTransitionDraftStatus(fromStatus, toStatus)) {
          statusCode = 409;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: `Invalid status transition ${fromStatus} -> ${toStatus}.` }));
          return;
        }
        await eventStore.append({
          actorType: "staff",
          actorId: auth.principal?.uid ?? "staff:unknown",
          action: "studio_marketing.draft_status_changed",
          rationale,
          target: "local",
          approvalState: "approved",
          inputHash: draftId,
          outputHash: toStatus,
          metadata: {
            draftId,
            fromStatus,
            toStatus,
          },
        });
        statusCode = 200;
        res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
        res.end(JSON.stringify({ ok: true, draftId, fromStatus, toStatus }));
        return;
      }

      if (capabilityRuntime && method === "POST" && url.pathname === "/api/capabilities/proposals") {
        const auth = await assertCapabilityAuth(req);
        if (!auth.ok) {
          statusCode = 401;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: auth.message }));
          return;
        }
        const body = await readJsonBody(req);
        const actorFromBody = parseActor(body);
        const principalUid = auth.principal?.uid ?? actorFromBody.actorId;
        const capabilityId = String(body.capabilityId ?? "");
        const actorDecision = resolveCapabilityActor({
          actorType: String(body.actorType ?? "staff"),
          actorUid: String(body.actorId ?? principalUid),
          ownerUid: String(body.ownerUid ?? principalUid),
          tenantId: String(body.tenantId ?? body.ownerUid ?? principalUid),
          capabilityId,
          principalUid,
          delegation: parseDelegation(body),
        });
        if (!actorDecision.allowed || !actorDecision.actor) {
          await eventStore.append({
            actorType: "staff",
            actorId: principalUid,
            action: "capability.delegation.denied",
            rationale: `proposal_create:${actorDecision.reasonCode}`,
            target: "local",
            approvalState: "required",
            inputHash: actorDecision.reasonCode,
            outputHash: null,
            metadata: actorDecision.trace,
          });
          statusCode = 403;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: "Delegation denied.", reasonCode: actorDecision.reasonCode, trace: actorDecision.trace }));
          return;
        }
        const actor: CapabilityActorContext = actorDecision.actor;
        const createThrottle = await enforceRateLimit(
          `rate:${principalUid}:capability_create:${capabilityId}`,
          rateLimits.createProposalPerMinute,
          60,
          actor.actorId,
          capabilityId
        );
        if (!createThrottle.allowed) {
          statusCode = 429;
          res.writeHead(
            statusCode,
            withSecurityHeaders({
              "content-type": "application/json",
              "retry-after": String(createThrottle.retryAfterSeconds),
              ...corsHeaders,
              "x-request-id": requestId,
            })
          );
          res.end(JSON.stringify({ ok: false, reasonCode: "RATE_LIMITED", retryAfterSeconds: createThrottle.retryAfterSeconds }));
          return;
        }
        if (actor.actorType === "agent") {
          const intake = classifyIntakeRisk({
            actorId: actor.actorId,
            ownerUid: actor.ownerUid,
            capabilityId,
            rationale: String(body.rationale ?? ""),
            previewSummary: String(body.previewSummary ?? ""),
            requestInput: ((body.requestInput as Record<string, unknown>) ?? {}) as Record<string, unknown>,
          });
          await eventStore.append({
            actorType: "system",
            actorId: "studio-brain",
            action: "intake.classified",
            rationale: `Agent intake classified as ${intake.category}.`,
            target: "local",
            approvalState: intake.blocked ? "required" : "exempt",
            inputHash: intake.intakeId,
            outputHash: intake.reasonCode,
            metadata: {
              ...intake,
              capabilityId,
              actorId: actor.actorId,
              ownerUid: actor.ownerUid,
            },
          });
          if (intake.blocked) {
            const recentEvents = await eventStore.listRecent(300);
            if (!hasOverrideGrant(recentEvents, intake.intakeId)) {
              await eventStore.append({
                actorType: "system",
                actorId: "studio-brain",
                action: "intake.routed_to_review",
                rationale: `Blocked high-risk intake (${intake.category}) for manual review.`,
                target: "local",
                approvalState: "required",
                inputHash: intake.intakeId,
                outputHash: intake.reasonCode,
                metadata: {
                  intakeId: intake.intakeId,
                  category: intake.category,
                  reasonCode: intake.reasonCode,
                  capabilityId,
                  actorId: actor.actorId,
                  ownerUid: actor.ownerUid,
                  summary: intake.summary,
                },
              });
              statusCode = 403;
              res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
              res.end(
                JSON.stringify({
                  ok: false,
                  message: "Blocked by intake policy pending manual review.",
                  reasonCode: "BLOCKED_BY_INTAKE_POLICY",
                  intakeId: intake.intakeId,
                  category: intake.category,
                })
              );
              return;
            }
          }
        }
        const result = await capabilityRuntime.create(actor, {
          capabilityId,
          rationale: String(body.rationale ?? ""),
          previewSummary: String(body.previewSummary ?? ""),
          requestInput: (body.requestInput as Record<string, unknown>) ?? {},
          expectedEffects: Array.isArray(body.expectedEffects) ? body.expectedEffects.map((x) => String(x)) : [],
          requestedBy: principalUid,
        });
        statusCode = result.proposal ? 201 : 400;
        res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
        res.end(JSON.stringify({ ok: Boolean(result.proposal), ...result }));
        return;
      }

      const approveMatch = url.pathname.match(/^\/api\/capabilities\/proposals\/([^/]+)\/approve$/);
      if (capabilityRuntime && method === "POST" && approveMatch) {
        const auth = await assertCapabilityAuth(req);
        if (!auth.ok) {
          statusCode = 401;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: auth.message }));
          return;
        }
        const body = await readJsonBody(req);
        const rationale = typeof body.rationale === "string" ? body.rationale.trim() : "";
        if (rationale.length < 10) {
          statusCode = 400;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: "Approval rationale must be at least 10 characters." }));
          return;
        }
        const proposal = await capabilityRuntime.approve(
          approveMatch[1],
          auth.principal?.uid ?? String(body.approvedBy ?? "staff:unknown"),
          rationale
        );
        statusCode = proposal ? 200 : 404;
        res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
        res.end(JSON.stringify({ ok: Boolean(proposal), proposal }));
        return;
      }

      const rejectMatch = url.pathname.match(/^\/api\/capabilities\/proposals\/([^/]+)\/reject$/);
      if (capabilityRuntime && method === "POST" && rejectMatch) {
        const auth = await assertCapabilityAuth(req);
        if (!auth.ok) {
          statusCode = 401;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: auth.message }));
          return;
        }
        const body = await readJsonBody(req);
        const reason = typeof body.reason === "string" ? body.reason : null;
        if (!reason || reason.trim().length < 10) {
          statusCode = 400;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: "Rejection reason must be at least 10 characters." }));
          return;
        }
        const proposal = await capabilityRuntime.reject(rejectMatch[1], auth.principal?.uid ?? "staff:unknown", reason);
        statusCode = proposal ? 200 : 404;
        res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
        res.end(JSON.stringify({ ok: Boolean(proposal), proposal }));
        return;
      }

      const reopenMatch = url.pathname.match(/^\/api\/capabilities\/proposals\/([^/]+)\/reopen$/);
      if (capabilityRuntime && method === "POST" && reopenMatch) {
        const auth = await assertCapabilityAuth(req);
        if (!auth.ok) {
          statusCode = 401;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: auth.message }));
          return;
        }
        const isAdmin = (auth.principal?.roles ?? []).includes("admin");
        if (!isAdmin) {
          statusCode = 403;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: "Admin role required to reopen rejected proposals." }));
          return;
        }
        const body = await readJsonBody(req);
        const reason = typeof body.reason === "string" ? body.reason.trim() : "";
        if (reason.length < 10) {
          statusCode = 400;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: "Reopen reason must be at least 10 characters." }));
          return;
        }
        const proposal = await capabilityRuntime.reopen(reopenMatch[1], auth.principal?.uid ?? "staff:unknown", reason);
        statusCode = proposal ? 200 : 404;
        res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
        res.end(JSON.stringify({ ok: Boolean(proposal), proposal }));
        return;
      }

      const dryRunMatch = url.pathname.match(/^\/api\/capabilities\/proposals\/([^/]+)\/dry-run$/);
      if (capabilityRuntime && method === "GET" && dryRunMatch) {
        const auth = await assertCapabilityAuth(req);
        if (!auth.ok) {
          statusCode = 401;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: auth.message }));
          return;
        }
        const proposal = await capabilityRuntime.getProposal(dryRunMatch[1]);
        if (!proposal) {
          statusCode = 404;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: "Proposal not found." }));
          return;
        }
        if (proposal.capabilityId !== "firestore.ops_note.append") {
          statusCode = 400;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: "Dry-run is only supported for pilot write capability." }));
          return;
        }
        if (!pilotWriteExecutor) {
          statusCode = 503;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: "Pilot write executor unavailable." }));
          return;
        }
        const dryRun = pilotWriteExecutor.dryRun(proposal.preview.input);
        await eventStore.append({
          actorType: "staff",
          actorId: auth.principal?.uid ?? "staff:unknown",
          action: "studio_ops.pilot_dry_run_generated",
          rationale: `Dry-run generated for proposal ${proposal.id}.`,
          target: "local",
          approvalState: "required",
          inputHash: proposal.inputHash,
          outputHash: crypto.createHash("sha256").update(JSON.stringify(dryRun)).digest("hex"),
          metadata: {
            proposalId: proposal.id,
            capabilityId: proposal.capabilityId,
            tenantId: proposal.tenantId,
            dryRun,
          },
        });
        statusCode = 200;
        res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
        res.end(JSON.stringify({ ok: true, proposalId: proposal.id, dryRun }));
        return;
      }

      const rollbackMatch = url.pathname.match(/^\/api\/capabilities\/proposals\/([^/]+)\/rollback$/);
      if (capabilityRuntime && method === "POST" && rollbackMatch) {
        const auth = await assertCapabilityAuth(req);
        if (!auth.ok) {
          statusCode = 401;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: auth.message }));
          return;
        }
        const proposal = await capabilityRuntime.getProposal(rollbackMatch[1]);
        if (!proposal) {
          statusCode = 404;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: "Proposal not found." }));
          return;
        }
        if (proposal.capabilityId !== "firestore.ops_note.append") {
          statusCode = 400;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: "Rollback is only supported for pilot write capability." }));
          return;
        }
        if (!pilotWriteExecutor) {
          statusCode = 503;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: "Pilot write executor unavailable." }));
          return;
        }
        const body = await readJsonBody(req);
        const idempotencyKey = typeof body.idempotencyKey === "string" ? body.idempotencyKey.trim() : "";
        const reason = typeof body.reason === "string" ? body.reason.trim() : "";
        if (idempotencyKey.length < 8 || reason.length < 10) {
          statusCode = 400;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: "idempotencyKey and reason are required." }));
          return;
        }
        const rollback = await pilotWriteExecutor.rollback({
          proposalId: proposal.id,
          idempotencyKey,
          reason,
          actorUid: auth.principal?.uid ?? "staff:unknown",
          authorizationHeader: firstHeader(req.headers.authorization),
          adminToken: firstHeader(req.headers["x-studio-brain-admin-token"]),
        });
        await eventStore.append({
          actorType: "staff",
          actorId: auth.principal?.uid ?? "staff:unknown",
          action: "studio_ops.pilot_rollback_invoked",
          rationale: reason,
          target: "local",
          approvalState: "approved",
          inputHash: idempotencyKey,
          outputHash: null,
          metadata: {
            proposalId: proposal.id,
            tenantId: proposal.tenantId,
            idempotencyKey,
            replayed: rollback.replayed,
          },
        });
        statusCode = 200;
        res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
        res.end(JSON.stringify({ ok: true, replayed: rollback.replayed }));
        return;
      }

      const executeMatch = url.pathname.match(/^\/api\/capabilities\/proposals\/([^/]+)\/execute$/);
      if (capabilityRuntime && method === "POST" && executeMatch) {
        const auth = await assertCapabilityAuth(req);
        if (!auth.ok) {
          statusCode = 401;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: auth.message }));
          return;
        }
        const body = await readJsonBody(req);
        const actorFromBody = parseActor(body);
        const principalUid = auth.principal?.uid ?? actorFromBody.actorId;
        const proposal = await capabilityRuntime.getProposal(executeMatch[1]);
        if (!proposal) {
          statusCode = 404;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: "Proposal not found." }));
          return;
        }
        const actorDecision = resolveCapabilityActor({
          actorType: String(body.actorType ?? "staff"),
          actorUid: String(body.actorId ?? principalUid),
          ownerUid: String(body.ownerUid ?? principalUid),
          tenantId: String(body.tenantId ?? body.ownerUid ?? principalUid),
          capabilityId: proposal.capabilityId,
          principalUid,
          delegation: parseDelegation(body),
        });
        if (!actorDecision.allowed || !actorDecision.actor) {
          await eventStore.append({
            actorType: "staff",
            actorId: principalUid,
            action: "capability.delegation.denied",
            rationale: `proposal_execute:${actorDecision.reasonCode}`,
            target: "local",
            approvalState: "required",
            inputHash: actorDecision.reasonCode,
            outputHash: null,
            metadata: {
              proposalId: executeMatch[1],
              ...actorDecision.trace,
            },
          });
          statusCode = 403;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: "Delegation denied.", reasonCode: actorDecision.reasonCode, trace: actorDecision.trace }));
          return;
        }
        const actor: CapabilityActorContext = actorDecision.actor;
        const executeThrottle = await enforceRateLimit(
          `rate:${principalUid}:capability_execute:${proposal.capabilityId}`,
          rateLimits.executeProposalPerMinute,
          60,
          actor.actorId,
          proposal.capabilityId
        );
        if (!executeThrottle.allowed) {
          statusCode = 429;
          res.writeHead(
            statusCode,
            withSecurityHeaders({
              "content-type": "application/json",
              "retry-after": String(executeThrottle.retryAfterSeconds),
              ...corsHeaders,
              "x-request-id": requestId,
            })
          );
          res.end(
            JSON.stringify({ ok: false, reasonCode: "RATE_LIMITED", retryAfterSeconds: executeThrottle.retryAfterSeconds })
          );
          return;
        }
        if (actor.actorType === "agent") {
          const intake = classifyIntakeRisk({
            actorId: actor.actorId,
            ownerUid: actor.ownerUid,
            capabilityId: proposal.capabilityId,
            rationale: proposal.rationale,
            previewSummary: proposal.preview.summary,
            requestInput: proposal.preview.input,
          });
          const recentEvents = await eventStore.listRecent(300);
          if (intake.blocked && !hasOverrideGrant(recentEvents, intake.intakeId)) {
            await eventStore.append({
              actorType: "system",
              actorId: "studio-brain",
              action: "intake.routed_to_review",
              rationale: `Blocked execute for high-risk intake (${intake.category}) without override.`,
              target: "local",
              approvalState: "required",
              inputHash: intake.intakeId,
              outputHash: intake.reasonCode,
              metadata: {
                intakeId: intake.intakeId,
                category: intake.category,
                reasonCode: intake.reasonCode,
                capabilityId: proposal.capabilityId,
                actorId: actor.actorId,
                ownerUid: actor.ownerUid,
                summary: intake.summary,
              },
            });
            statusCode = 403;
            res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
            res.end(
              JSON.stringify({
                ok: false,
                message: "Blocked by intake policy pending manual review.",
                reasonCode: "BLOCKED_BY_INTAKE_POLICY",
                intakeId: intake.intakeId,
                category: intake.category,
              })
            );
            return;
          }
        }
        const output = (body.output as Record<string, unknown>) ?? {};
        if (proposal.capabilityId === "firestore.ops_note.append") {
          if (!pilotWriteExecutor) {
            statusCode = 503;
            res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
            res.end(JSON.stringify({ ok: false, message: "Pilot write executor unavailable." }));
            return;
          }
          const idempotencyKeyRaw = typeof body.idempotencyKey === "string" ? body.idempotencyKey.trim() : "";
          const idempotencyKey = idempotencyKeyRaw || `pilot-${requestId}`;
          const pilotDryRun = pilotWriteExecutor.dryRun(proposal.preview.input);
          if (proposal.status !== "approved") {
            statusCode = 409;
            res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
            res.end(JSON.stringify({ ok: false, message: "Pilot write requires approved proposal before execution." }));
            return;
          }
          await eventStore.append({
            actorType: "staff",
            actorId: auth.principal?.uid ?? "staff:unknown",
            action: "studio_ops.pilot_execution_requested",
            rationale: `Pilot write execution requested for proposal ${proposal.id}.`,
            target: "local",
            approvalState: "approved",
            inputHash: idempotencyKey,
            outputHash: null,
            metadata: {
              proposalId: proposal.id,
              tenantId: proposal.tenantId,
              approvalId: proposal.approvedAt ?? null,
              idempotencyKey,
              resourcePointer: {
                collection: pilotDryRun.resourceCollection,
                docId: pilotDryRun.resourceId,
              },
            },
          });
          try {
            const pilotExecution = await pilotWriteExecutor.execute({
              proposalId: proposal.id,
              approvedBy: proposal.approvedBy ?? null,
              approvedAt: proposal.approvedAt ?? null,
              idempotencyKey,
              actorUid: auth.principal?.uid ?? "staff:unknown",
              pilotInput: proposal.preview.input,
              authorizationHeader: firstHeader(req.headers.authorization),
              adminToken: firstHeader(req.headers["x-studio-brain-admin-token"]),
            });
            output.externalWrite = pilotExecution;
            output.idempotencyKey = idempotencyKey;
            await eventStore.append({
              actorType: "staff",
              actorId: auth.principal?.uid ?? "staff:unknown",
              action: "studio_ops.pilot_execution_succeeded",
              rationale: `Pilot write execution succeeded for proposal ${proposal.id}.`,
              target: "local",
              approvalState: "approved",
              inputHash: idempotencyKey,
              outputHash: pilotExecution.resourcePointer.docId,
              metadata: {
                proposalId: proposal.id,
                tenantId: proposal.tenantId,
                approvalId: proposal.approvedAt ?? null,
                idempotencyKey,
                resourcePointer: pilotExecution.resourcePointer,
                replayed: pilotExecution.replayed,
              },
            });
          } catch (error) {
            await eventStore.append({
              actorType: "staff",
              actorId: auth.principal?.uid ?? "staff:unknown",
              action: "studio_ops.pilot_execution_failed",
              rationale: `Pilot write execution failed for proposal ${proposal.id}.`,
              target: "local",
              approvalState: "required",
              inputHash: idempotencyKey,
              outputHash: null,
              metadata: {
                proposalId: proposal.id,
                tenantId: proposal.tenantId,
                approvalId: proposal.approvedAt ?? null,
                idempotencyKey,
                error: error instanceof Error ? error.message : String(error),
              },
            });
            statusCode = 502;
            res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
            res.end(JSON.stringify({ ok: false, message: error instanceof Error ? error.message : String(error) }));
            return;
          }
        }
        const result = await capabilityRuntime.execute(executeMatch[1], actor, output);
        if (!result.decision.allowed && result.decision.reasonCode === "TENANT_MISMATCH" && result.proposal) {
          await eventStore.append({
            actorType: "staff",
            actorId: auth.principal?.uid ?? "staff:unknown",
            action: "studio_ops.cross_tenant_denied",
            rationale: "Cross-tenant capability execution denied by policy.",
            target: "local",
            approvalState: "required",
            inputHash: result.proposal.id,
            outputHash: null,
            metadata: {
              proposalId: result.proposal.id,
              capabilityId: result.proposal.capabilityId,
              proposalTenantId: result.proposal.tenantId,
              actorTenantId: actor.tenantId ?? actor.ownerUid,
            },
          });
        }
        statusCode = result.proposal ? (result.decision.allowed ? 200 : 409) : 404;
        res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
        res.end(JSON.stringify({ ok: result.decision.allowed, ...result }));
        return;
      }

      if (capabilityRuntime && method === "POST" && url.pathname === "/api/capabilities/policy/kill-switch") {
        const auth = await assertCapabilityAuth(req);
        if (!auth.ok) {
          statusCode = 401;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: auth.message }));
          return;
        }
        const body = await readJsonBody(req);
        const enabled = body.enabled === true;
        const rationale = typeof body.rationale === "string" ? body.rationale.trim() : "";
        if (rationale.length < 10) {
          statusCode = 400;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: "Kill switch rationale must be at least 10 characters." }));
          return;
        }
        const killSwitch = await capabilityRuntime.setKillSwitch(enabled, auth.principal?.uid ?? "staff:unknown", rationale);
        statusCode = 200;
        res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
        res.end(JSON.stringify({ ok: true, killSwitch }));
        return;
      }

      if (capabilityRuntime && method === "POST" && url.pathname === "/api/capabilities/policy/exemptions") {
        const auth = await assertCapabilityAuth(req);
        if (!auth.ok) {
          statusCode = 401;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: auth.message }));
          return;
        }
        const body = await readJsonBody(req);
        const capabilityId = typeof body.capabilityId === "string" ? body.capabilityId.trim() : "";
        const ownerUidRaw = typeof body.ownerUid === "string" ? body.ownerUid.trim() : "";
        const justification = typeof body.justification === "string" ? body.justification.trim() : "";
        const expiresAt = typeof body.expiresAt === "string" && body.expiresAt.trim() ? body.expiresAt.trim() : undefined;
        if (!capabilityId || justification.length < 10) {
          statusCode = 400;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: "capabilityId and justification (>=10 chars) are required." }));
          return;
        }
        const exemption = await capabilityRuntime.createExemption({
          capabilityId,
          ownerUid: ownerUidRaw || undefined,
          justification,
          approvedBy: auth.principal?.uid ?? "staff:unknown",
          expiresAt,
        });
        statusCode = 201;
        res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
        res.end(JSON.stringify({ ok: true, exemption }));
        return;
      }

      const revokeExemptionMatch = url.pathname.match(/^\/api\/capabilities\/policy\/exemptions\/([^/]+)\/revoke$/);
      if (capabilityRuntime && method === "POST" && revokeExemptionMatch) {
        const auth = await assertCapabilityAuth(req);
        if (!auth.ok) {
          statusCode = 401;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: auth.message }));
          return;
        }
        const body = await readJsonBody(req);
        const reason = typeof body.reason === "string" ? body.reason.trim() : "";
        if (reason.length < 10) {
          statusCode = 400;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: "Revocation reason must be at least 10 characters." }));
          return;
        }
        const exemption = await capabilityRuntime.revokeExemption(
          decodeURIComponent(revokeExemptionMatch[1]),
          auth.principal?.uid ?? "staff:unknown",
          reason
        );
        statusCode = exemption ? 200 : 404;
        res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
        res.end(JSON.stringify({ ok: Boolean(exemption), exemption }));
        return;
      }

      const resetQuotaMatch = url.pathname.match(/^\/api\/capabilities\/quotas\/([^/]+)\/reset$/);
      if (capabilityRuntime && method === "POST" && resetQuotaMatch) {
        const auth = await assertCapabilityAuth(req);
        if (!auth.ok) {
          statusCode = 401;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: auth.message }));
          return;
        }
        const body = await readJsonBody(req);
        const reason = typeof body.reason === "string" ? body.reason.trim() : "";
        if (!reason) {
          statusCode = 400;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: "Reset reason is required." }));
          return;
        }
        const bucket = decodeURIComponent(resetQuotaMatch[1]);
        const reset = await capabilityRuntime.resetQuotaBucket(bucket);
        if (reset) {
          await eventStore.append({
            actorType: "staff",
            actorId: auth.principal?.uid ?? "staff:unknown",
            action: "capability.quota.reset",
            rationale: reason,
            target: "local",
            approvalState: "exempt",
            inputHash: bucket,
            outputHash: null,
            metadata: {
              bucket,
              reason,
            },
          });
        }
        statusCode = reset ? 200 : 404;
        res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
        res.end(JSON.stringify({ ok: reset, bucket }));
        return;
      }

      if (method === "GET" && url.pathname === "/api/kiln/overview") {
        const auth = await assertKilnAccess(req);
        if (!auth.ok) {
          statusCode = 401;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: auth.message }));
          return;
        }
        const runtime = ensureKilnRuntime();
        if (!runtime.ok) {
          statusCode = 404;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: runtime.message }));
          return;
        }
        const overview = await buildKilnOverview(kilnStore!, {
          enableSupportedWrites: kilnEnableSupportedWrites,
          providerSupport: kilnProviderSupport(),
        });
        statusCode = 200;
        res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
        res.end(JSON.stringify({ ok: true, overview }));
        return;
      }

      if (method === "GET" && url.pathname === "/api/kiln/kilns") {
        const auth = await assertKilnAccess(req);
        if (!auth.ok) {
          statusCode = 401;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: auth.message }));
          return;
        }
        const runtime = ensureKilnRuntime();
        if (!runtime.ok) {
          statusCode = 404;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: runtime.message }));
          return;
        }
        const [kilns, overview] = await Promise.all([
          kilnStore!.listKilns(),
          buildKilnOverview(kilnStore!, {
            enableSupportedWrites: kilnEnableSupportedWrites,
            providerSupport: kilnProviderSupport(),
          }),
        ]);
        statusCode = 200;
        res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
        res.end(JSON.stringify({ ok: true, kilns, overview: overview.kilns }));
        return;
      }

      const kilnDetailMatch = url.pathname.match(/^\/api\/kiln\/kilns\/([^/]+)$/);
      if (method === "GET" && kilnDetailMatch) {
        const auth = await assertKilnAccess(req);
        if (!auth.ok) {
          statusCode = 401;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: auth.message }));
          return;
        }
        const runtime = ensureKilnRuntime();
        if (!runtime.ok) {
          statusCode = 404;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: runtime.message }));
          return;
        }
        const kilnId = decodeURIComponent(kilnDetailMatch[1]);
        const detail = await buildKilnDetail(kilnStore!, kilnId);
        if (!detail.kiln) {
          statusCode = 404;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: "Kiln not found." }));
          return;
        }
        statusCode = 200;
        res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
        res.end(JSON.stringify({ ok: true, detail }));
        return;
      }

      const kilnRunMatch = url.pathname.match(/^\/api\/kiln\/runs\/([^/]+)$/);
      if (method === "GET" && kilnRunMatch) {
        const auth = await assertKilnAccess(req);
        if (!auth.ok) {
          statusCode = 401;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: auth.message }));
          return;
        }
        const runtime = ensureKilnRuntime();
        if (!runtime.ok) {
          statusCode = 404;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: runtime.message }));
          return;
        }
        const runId = decodeURIComponent(kilnRunMatch[1]);
        const detail = await buildFiringRunDetail(kilnStore!, runId);
        if (!detail.run) {
          statusCode = 404;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: "Firing run not found." }));
          return;
        }
        statusCode = 200;
        res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
        res.end(JSON.stringify({ ok: true, detail }));
        return;
      }

      const kilnArtifactContentMatch = url.pathname.match(/^\/api\/kiln\/artifacts\/([^/]+)\/content$/);
      if (method === "GET" && kilnArtifactContentMatch) {
        const auth = await assertKilnAccess(req);
        if (!auth.ok) {
          statusCode = 401;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: auth.message }));
          return;
        }
        const runtime = ensureKilnArtifacts();
        if (!runtime.ok) {
          statusCode = 404;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: runtime.message }));
          return;
        }
        const artifactId = decodeURIComponent(kilnArtifactContentMatch[1]);
        const artifact = await kilnStore!.getArtifactRecord(artifactId);
        if (!artifact) {
          statusCode = 404;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: "Artifact not found." }));
          return;
        }
        const content = await artifactStore!.get(artifact.storageKey);
        if (!content) {
          statusCode = 404;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: "Artifact content not found." }));
          return;
        }
        statusCode = 200;
        res.writeHead(
          statusCode,
          withSecurityHeaders({
            "content-type": artifact.contentType || "application/octet-stream",
            "content-length": String(content.byteLength),
            "content-disposition": `inline; filename="${artifact.filename.replaceAll("\"", "")}"`,
            ...corsHeaders,
            "x-request-id": requestId,
          }),
        );
        res.end(content);
        return;
      }

      if (method === "POST" && url.pathname === "/api/kiln/imports/genesis") {
        const auth = await assertKilnAccess(req);
        if (!auth.ok) {
          statusCode = 401;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: auth.message }));
          return;
        }
        const runtime = ensureKilnArtifacts();
        if (!runtime.ok) {
          statusCode = 404;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: runtime.message }));
          return;
        }
        try {
          const raw = await readRawBodyLimited(req, Math.ceil(resolvedKilnImportMaxBytes * 1.6) + 8_192);
          const body = parseJsonBody(raw);
          const filename = toTrimmedString(body.filename);
          const contentBase64 = typeof body.contentBase64 === "string" ? body.contentBase64.trim() : "";
          if (!filename || !contentBase64) {
            statusCode = 400;
            res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
            res.end(JSON.stringify({ ok: false, message: "filename and contentBase64 are required." }));
            return;
          }
          const content = Buffer.from(contentBase64, "base64");
          if (content.byteLength === 0) {
            statusCode = 400;
            res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
            res.end(JSON.stringify({ ok: false, message: "contentBase64 did not decode to a non-empty artifact." }));
            return;
          }
          if (content.byteLength > resolvedKilnImportMaxBytes) {
            statusCode = 413;
            res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
            res.end(JSON.stringify({ ok: false, message: `Decoded artifact exceeds ${resolvedKilnImportMaxBytes} bytes.` }));
            return;
          }
          const result = await importGenesisArtifact({
            artifactStore: artifactStore!,
            kilnStore: kilnStore!,
            providerSupport: kilnProviderSupport(),
            kilnId: toTrimmedString(body.kilnId) || null,
            filename,
            contentType: toTrimmedString(body.contentType) || null,
            content,
            observedAt: toTrimmedString(body.observedAt) || null,
            sourceLabel: toTrimmedString(body.sourceLabel) || "manual_upload",
            source: "manual_upload",
          });
          statusCode = 201;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: true, result }));
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          statusCode = /exceeds \d+ bytes/i.test(message) ? 413 : 400;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message }));
        }
        return;
      }

      if (method === "POST" && url.pathname === "/api/kiln/operator-actions") {
        const auth = await assertKilnAccess(req);
        if (!auth.ok) {
          statusCode = 401;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: auth.message }));
          return;
        }
        const runtime = ensureKilnRuntime();
        if (!runtime.ok) {
          statusCode = 404;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: runtime.message }));
          return;
        }
        try {
          const body = await readJsonBody(req);
          const kilnId = toTrimmedString(body.kilnId);
          const actionType = toTrimmedString(body.actionType);
          if (!kilnId || !actionType) {
            statusCode = 400;
            res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
            res.end(JSON.stringify({ ok: false, message: "kilnId and actionType are required." }));
            return;
          }
          const result = await recordOperatorAction(kilnStore!, {
            kilnId,
            firingRunId: toTrimmedString(body.firingRunId) || null,
            actionType,
            requestedBy: auth.principal?.uid ?? "staff:unknown",
            confirmedBy: toTrimmedString(body.confirmedBy) || auth.principal?.uid || null,
            checklistJson: toObjectRecord(body.checklistJson),
            notes: toTrimmedString(body.notes) || null,
            completedAt: toTrimmedString(body.completedAt) || null,
            enableSupportedWrites: kilnEnableSupportedWrites,
          });
          statusCode = 201;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: true, result }));
        } catch (error) {
          statusCode = 400;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: error instanceof Error ? error.message : String(error) }));
        }
        return;
      }

      if (method === "POST" && url.pathname === "/api/kiln/runs") {
        const auth = await assertKilnAccess(req);
        if (!auth.ok) {
          statusCode = 401;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: auth.message }));
          return;
        }
        const runtime = ensureKilnRuntime();
        if (!runtime.ok) {
          statusCode = 404;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: runtime.message }));
          return;
        }
        const body = await readJsonBody(req);
        const kilnId = toTrimmedString(body.kilnId);
        if (!kilnId) {
          statusCode = 400;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: "kilnId is required." }));
          return;
        }
        const queueStateRaw = toTrimmedString(body.queueState);
        if (queueStateRaw && !firingQueueStates.includes(queueStateRaw as (typeof firingQueueStates)[number])) {
          statusCode = 400;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: `Unsupported queueState: ${queueStateRaw}` }));
          return;
        }
        const run = await createFiringRun(kilnStore!, {
          kilnId,
          requestedBy: auth.principal?.uid ?? "staff:unknown",
          programName: toTrimmedString(body.programName) || null,
          programType: toTrimmedString(body.programType) || null,
          coneTarget: toTrimmedString(body.coneTarget) || null,
          speed: toTrimmedString(body.speed) || null,
          firmwareVersion: toTrimmedString(body.firmwareVersion) || null,
          queueState: queueStateRaw ? (queueStateRaw as (typeof firingQueueStates)[number]) : undefined,
          linkedPortalRefs: {
            batchIds: Array.isArray(body.batchIds) ? body.batchIds.map((entry) => String(entry)).filter(Boolean) : [],
            pieceIds: Array.isArray(body.pieceIds) ? body.pieceIds.map((entry) => String(entry)).filter(Boolean) : [],
            reservationIds: Array.isArray(body.reservationIds) ? body.reservationIds.map((entry) => String(entry)).filter(Boolean) : [],
            portalFiringId: toTrimmedString(body.portalFiringId) || null,
          },
        });
        statusCode = 201;
        res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
        res.end(JSON.stringify({ ok: true, run }));
        return;
      }

      const kilnAckMatch = url.pathname.match(/^\/api\/kiln\/runs\/([^/]+)\/ack$/);
      if (method === "POST" && kilnAckMatch) {
        const auth = await assertKilnAccess(req);
        if (!auth.ok) {
          statusCode = 401;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: auth.message }));
          return;
        }
        const runtime = ensureKilnRuntime();
        if (!runtime.ok) {
          statusCode = 404;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: runtime.message }));
          return;
        }
        const runId = decodeURIComponent(kilnAckMatch[1]);
        const run = await kilnStore!.getFiringRun(runId);
        if (!run) {
          statusCode = 404;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: "Firing run not found." }));
          return;
        }
        try {
          const body = await readJsonBody(req);
          const actionType = toTrimmedString(body.actionType);
          if (!actionType) {
            statusCode = 400;
            res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
            res.end(JSON.stringify({ ok: false, message: "actionType is required." }));
            return;
          }
          const result = await recordOperatorAction(kilnStore!, {
            kilnId: run.kilnId,
            firingRunId: run.id,
            actionType,
            requestedBy: auth.principal?.uid ?? "staff:unknown",
            confirmedBy: toTrimmedString(body.confirmedBy) || auth.principal?.uid || null,
            checklistJson: toObjectRecord(body.checklistJson),
            notes: toTrimmedString(body.notes) || null,
            completedAt: toTrimmedString(body.completedAt) || null,
            enableSupportedWrites: kilnEnableSupportedWrites,
          });
          statusCode = 200;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: true, result }));
        } catch (error) {
          statusCode = 400;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: error instanceof Error ? error.message : String(error) }));
        }
        return;
      }

      if (method === "GET" && url.pathname === "/kiln-command") {
        const auth = await assertKilnAccess(req);
        if (!auth.ok) {
          statusCode = 401;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: auth.message }));
          return;
        }
        const runtime = ensureKilnRuntime();
        if (!runtime.ok) {
          statusCode = 404;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
          res.end(JSON.stringify({ ok: false, message: runtime.message }));
          return;
        }
        const overview = await buildKilnOverview(kilnStore!, {
          enableSupportedWrites: kilnEnableSupportedWrites,
          providerSupport: kilnProviderSupport(),
        });
        const kilnDetails = await Promise.all(
          overview.kilns.map((kiln) => buildKilnDetail(kilnStore!, kiln.kilnId)),
        );
        const html = renderKilnCommandPage({
          generatedAt: new Date().toISOString(),
          overview,
          kilnDetails,
          uploadMaxBytes: resolvedKilnImportMaxBytes,
        });
        statusCode = 200;
        res.writeHead(statusCode, withSecurityHeaders({ "content-type": "text/html; charset=utf-8", ...corsHeaders, "x-request-id": requestId }));
        res.end(html);
        return;
      }

      if (opsPortal.enabled && opsPortal.compareEnabled && opsService && method === "GET" && url.pathname === "/ops/choice") {
        const auth = await assertOpsPortalAuth(req);
        if (!auth.ok) {
          statusCode = 401;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "text/plain; charset=utf-8", ...corsHeaders, "x-request-id": requestId }));
          res.end(auth.message);
          return;
        }
        const snapshot = await opsService.getPortalSnapshot();
        const html = renderOpsPortalChoicePage({
          headline: snapshot.twin.headline,
          narrative: snapshot.twin.narrative,
          generatedAt: snapshot.generatedAt,
          opsUrl: `/ops?surface=${encodeURIComponent(opsPortal.defaultSurface)}`,
          legacyUrl: opsPortal.legacyUrl,
        });
        statusCode = 200;
        res.writeHead(statusCode, withSecurityHeaders({ "content-type": "text/html; charset=utf-8", ...corsHeaders, "x-request-id": requestId }));
        res.end(html);
        return;
      }

      const opsDisplayPageMatch = method === "GET" ? url.pathname.match(/^\/ops\/display\/([^/]+)$/) : null;
      if (opsPortal.enabled && opsService && opsDisplayPageMatch) {
        const stationId = decodeURIComponent(opsDisplayPageMatch[1] ?? "");
        const auth = await assertOpsPortalAuth(req);
        if (!auth.ok) {
          statusCode = 401;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "text/plain; charset=utf-8", ...corsHeaders, "x-request-id": requestId }));
          res.end(auth.message);
          return;
        }
        const [snapshot, displayState] = await Promise.all([
          opsService.getPortalSnapshot(auth.principal ? opsActorContext(auth) : undefined),
          opsService.getDisplayState(stationId),
        ]);
        const sessionToken =
          auth.ok && auth.principal && opsSessionSecret
            ? createSignedOpsSessionToken(opsSessionSecret, opsSessionTtlSeconds, auth.principal)
            : null;
        const html = renderOpsPortalPage({
          snapshot,
          displayState,
          surface: "hands",
          stationId,
          sessionToken,
        });
        statusCode = 200;
        res.writeHead(statusCode, withSecurityHeaders({ "content-type": "text/html; charset=utf-8", ...corsHeaders, "x-request-id": requestId }));
        res.end(html);
        return;
      }

      if (opsPortal.enabled && opsService && method === "GET" && url.pathname === "/ops") {
        const stationId = toTrimmedString(url.searchParams.get("stationId")) || null;
        const requestedSurface = toTrimmedString(url.searchParams.get("surface")) || opsPortal.defaultSurface;
        const auth = await assertOpsPortalAuth(req);
        if (!auth.ok) {
          statusCode = 401;
          res.writeHead(statusCode, withSecurityHeaders({ "content-type": "text/plain; charset=utf-8", ...corsHeaders, "x-request-id": requestId }));
          res.end(auth.message);
          return;
        }
        const snapshot = await opsService.getPortalSnapshot(auth.principal ? opsActorContext(auth) : undefined);
        const allowedSurfaces = snapshot.session?.allowedSurfaces ?? [];
        const resolvedSurface = allowedSurfaces.includes(requestedSurface as typeof allowedSurfaces[number])
          ? requestedSurface
          : allowedSurfaces[0] ?? requestedSurface;
        const displayState = stationId ? await opsService.getDisplayState(stationId) : null;
        const sessionToken =
          auth.ok && auth.principal && opsSessionSecret
            ? createSignedOpsSessionToken(opsSessionSecret, opsSessionTtlSeconds, auth.principal)
            : null;
        const html = renderOpsPortalPage({
          snapshot,
          displayState,
          surface: resolvedSurface,
          stationId,
          sessionToken,
        });
        statusCode = 200;
        res.writeHead(statusCode, withSecurityHeaders({ "content-type": "text/html; charset=utf-8", ...corsHeaders, "x-request-id": requestId }));
        res.end(html);
        return;
      }

      if (method === "GET" && url.pathname === "/api/status") {
        const [snapshot, jobRuns, runtime, overseer] = await Promise.all([
          stateStore.getLatestStudioState(),
          stateStore.listRecentJobRuns(10),
          getRuntimeStatus ? getRuntimeStatus() : Promise.resolve({}),
          stateStore.getLatestOverseerRun(),
        ]);
        statusCode = 200;
        res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
        res.end(
          JSON.stringify({
            ok: true,
            at: new Date().toISOString(),
            snapshot: snapshot
              ? {
                  snapshotDate: snapshot.snapshotDate,
                  generatedAt: snapshot.generatedAt,
                  completeness: snapshot.diagnostics?.completeness ?? "full",
                  warningCount: snapshot.diagnostics?.warnings.length ?? 0,
                }
              : null,
            overseer: overseer
              ? {
                  runId: overseer.runId,
                  computedAt: overseer.computedAt,
                  overallStatus: overseer.overallStatus,
                  signalGapCount: overseer.signalGaps.length,
                  actionCount: overseer.coordinationActions.length,
                  createdProposalCount: overseer.createdProposalIds.length,
                }
              : null,
            jobRuns,
            runtime,
          })
        );
        return;
      }

      if (method === "GET" && url.pathname === "/api/metrics") {
        const snapshot = await stateStore.getLatestStudioState();
        const runtime = getRuntimeMetrics ? await getRuntimeMetrics() : {};
        statusCode = 200;
        res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
        res.end(
          JSON.stringify({
            ok: true,
            at: new Date().toISOString(),
            metrics: {
              process: {
                pid: process.pid,
                uptimeSec: Math.floor(process.uptime()),
                memory: process.memoryUsage(),
                cpu: process.cpuUsage(),
              },
              snapshot: {
                exists: Boolean(snapshot),
                generatedAt: snapshot?.generatedAt ?? null,
                completeness: snapshot?.diagnostics?.completeness ?? null,
                warningCount: snapshot?.diagnostics?.warnings.length ?? 0,
              },
              runtime,
            },
          })
        );
        return;
      }

      if (method === "GET" && url.pathname === "/dashboard") {
        const html = await renderDashboard(stateStore, eventStore, {
          staleThresholdMinutes: readyMaxSnapshotAgeMinutes,
        });
        statusCode = 200;
        res.writeHead(statusCode, withSecurityHeaders({ "content-type": "text/html; charset=utf-8", ...corsHeaders, "x-request-id": requestId }));
        res.end(html);
        return;
      }

      statusCode = 404;
      res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
      res.end(JSON.stringify({ ok: false, message: "Not found" }));
    } catch (error) {
      statusCode = 500;
      logger.error("studio_brain_http_handler_error", {
        ...requestMeta,
        message: error instanceof Error ? error.message : String(error),
      });
      res.writeHead(statusCode, withSecurityHeaders({ "content-type": "application/json", ...corsHeaders, "x-request-id": requestId }));
      res.end(JSON.stringify({ ok: false, message: "Internal server error" }));
    } finally {
      logger.info("studio_brain_http_request", {
        ...requestMeta,
        statusCode,
        durationMs: Date.now() - startedAt,
      });
    }
  });

  server.listen(port, host, () => {
    logger.info("studio_brain_http_listening", { host, port });
  });

  return server;
}
