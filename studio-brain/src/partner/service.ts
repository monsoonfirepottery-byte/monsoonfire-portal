import crypto from "node:crypto";

import type { AgentRuntimeSummary } from "../agentRuntime/contracts";
import type {
  ControlTowerApprovalItem,
  ControlTowerMemoryBrief,
  ControlTowerRoomSummary,
} from "../controlTower/types";
import {
  appendPartnerCheckin,
  partnerArtifactPaths,
  readLatestPartnerBrief,
  readPartnerOpenLoops,
  writeLatestPartnerBrief,
  writePartnerOpenLoops,
} from "./files";
import {
  CHIEF_OF_STAFF_COMMANDS,
  CHIEF_OF_STAFF_IDLE_BUDGET,
  CHIEF_OF_STAFF_PERSONA,
  CHIEF_OF_STAFF_PROGRAMS,
} from "./persona";
import type {
  AgentRuntimePartnerContext,
  PartnerBrief,
  PartnerCheckinAction,
  PartnerCheckinRecord,
  PartnerInitiativeState,
  PartnerOpenLoop,
  PartnerOpenLoopStatus,
} from "./contracts";

type DerivePartnerBriefInput = {
  repoRoot: string;
  generatedAt: string;
  memoryBrief: ControlTowerMemoryBrief;
  rooms: ControlTowerRoomSummary[];
  approvals: ControlTowerApprovalItem[];
  agentRuntime: AgentRuntimeSummary | null;
};

type RecordPartnerCheckinInput = {
  repoRoot: string;
  brief: PartnerBrief;
  actorId: string;
  action: PartnerCheckinAction;
  note?: string;
  snoozeMinutes?: number;
};

type UpdatePartnerOpenLoopInput = {
  repoRoot: string;
  brief: PartnerBrief;
  loopId: string;
  status: Extract<PartnerOpenLoopStatus, "delegated" | "paused" | "resolved">;
  actorId: string;
  note?: string;
};

function clipText(value: string, max = 220): string {
  const trimmed = String(value || "").trim();
  if (!trimmed) return "";
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

function addMinutes(iso: string, minutes: number): string {
  const base = Date.parse(iso);
  const next = Number.isFinite(base) ? base + minutes * 60_000 : Date.now() + minutes * 60_000;
  return new Date(next).toISOString();
}

function slug(value: string): string {
  const token = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return token || "loop";
}

function dedupeStrings(values: Array<string | null | undefined>, limit = 6): string[] {
  const seen = new Set<string>();
  const rows: string[] = [];
  for (const value of values) {
    const normalized = String(value || "").trim();
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push(normalized);
    if (rows.length >= limit) break;
  }
  return rows;
}

function runtimePartnerContext(agentRuntime: AgentRuntimeSummary | null): AgentRuntimePartnerContext | null {
  return agentRuntime?.partner ?? null;
}

function buildFallbackRoomLoops(generatedAt: string, rooms: ControlTowerRoomSummary[]): PartnerOpenLoop[] {
  return rooms
    .filter((room) => room.status === "blocked" || room.status === "waiting")
    .slice(0, 4)
    .map((room) => ({
      id: `room:${room.id}`,
      title: clipText(room.objective || room.name, 120),
      status: "open" as const,
      summary: clipText(room.summary || room.objective || `Room ${room.name} is waiting on attention.`, 180),
      next: clipText(room.nextActions[0]?.title || "Inspect room", 120),
      source: `control-tower-room:${room.id}`,
      updatedAt: room.lastActivityAt || generatedAt,
      roomId: room.id,
      sessionName: room.sessionNames[0] ?? null,
      decisionNeeded:
        room.status === "blocked"
          ? "Decide whether to unblock, pause, or redirect this lane."
          : "Confirm whether this lane should continue, pause, or be redirected.",
      verifiedContext: dedupeStrings([room.summary, room.objective, `${room.project} via ${room.tool}`], 3),
      evidence: dedupeStrings([room.project, room.tool, room.sessionNames[0] ?? null], 3),
    }));
}

function buildFallbackMemoryLoops(generatedAt: string, memoryBrief: ControlTowerMemoryBrief): PartnerOpenLoop[] {
  return memoryBrief.blockers.slice(0, 3).map((blocker, index) => ({
    id: `memory:${slug(blocker)}`,
    title: clipText(blocker, 120),
    status: "open" as const,
    summary: clipText(blocker, 180),
    next: clipText(memoryBrief.recommendedNextActions[index] || memoryBrief.recommendedNextActions[0] || "Review continuity", 120),
    source: "memory-brief",
    updatedAt: memoryBrief.generatedAt || generatedAt,
    roomId: null,
    sessionName: null,
    decisionNeeded: index === 0 ? "Decide whether this open loop should stay active, pause, or move to a different lane." : null,
    verifiedContext: dedupeStrings([memoryBrief.goal, memoryBrief.summary, blocker], 3),
    evidence: dedupeStrings(memoryBrief.fallbackSources, 3),
  }));
}

function mergeOpenLoops(
  generatedAt: string,
  persisted: PartnerOpenLoop[],
  runtimeLoops: PartnerOpenLoop[],
  fallbackLoops: PartnerOpenLoop[],
): PartnerOpenLoop[] {
  const merged = new Map<string, PartnerOpenLoop>();
  const upsert = (candidate: PartnerOpenLoop) => {
    const existing = merged.get(candidate.id);
    merged.set(candidate.id, existing
      ? {
          ...candidate,
          status: existing.status || candidate.status,
          updatedAt: existing.updatedAt && existing.updatedAt > candidate.updatedAt ? existing.updatedAt : candidate.updatedAt,
          decisionNeeded: existing.decisionNeeded ?? candidate.decisionNeeded,
          verifiedContext: dedupeStrings([...(candidate.verifiedContext ?? []), ...(existing.verifiedContext ?? [])], 4),
          evidence: dedupeStrings([...(candidate.evidence ?? []), ...(existing.evidence ?? [])], 4),
        }
      : {
          ...candidate,
          updatedAt: candidate.updatedAt || generatedAt,
        });
  };

  persisted.forEach(upsert);
  runtimeLoops.forEach(upsert);
  fallbackLoops.forEach(upsert);

  return Array.from(merged.values())
    .sort((left, right) => {
      const statusRank = (value: PartnerOpenLoopStatus): number =>
        value === "open" ? 0 : value === "delegated" ? 1 : value === "paused" ? 2 : 3;
      const leftRank = statusRank(left.status);
      const rightRank = statusRank(right.status);
      if (leftRank !== rightRank) return leftRank - rightRank;
      return String(right.updatedAt || "").localeCompare(String(left.updatedAt || ""));
    })
    .slice(0, 8);
}

function deriveDecisionNeeded(
  approvals: ControlTowerApprovalItem[],
  loops: PartnerOpenLoop[],
  runtimeContext: AgentRuntimePartnerContext | null,
): string | null {
  if (runtimeContext?.singleDecisionNeeded) return runtimeContext.singleDecisionNeeded;
  const approval = approvals.find((entry) => entry.status === "pending_approval");
  if (approval) {
    return clipText(`Approve or redirect ${approval.capabilityId}: ${approval.summary}`, 180);
  }
  return loops.find((loop) => loop.status === "open" && loop.decisionNeeded)?.decisionNeeded ?? null;
}

function deriveContactReason(
  memoryBrief: ControlTowerMemoryBrief,
  approvals: ControlTowerApprovalItem[],
  loops: PartnerOpenLoop[],
  runtimeContext: AgentRuntimePartnerContext | null,
): string {
  if (runtimeContext?.contactReason) return runtimeContext.contactReason;
  if (approvals.some((entry) => entry.status === "pending_approval")) {
    return "A bounded approval or exception path needs one owner decision before Studio Brain keeps moving.";
  }
  const blockedLoop = loops.find((loop) => loop.status === "open" && loop.decisionNeeded);
  if (blockedLoop) {
    return clipText(`Studio Brain verified enough context to ask for one decision on "${blockedLoop.title}".`, 180);
  }
  if (memoryBrief.continuityState !== "ready") {
    return "Continuity is degraded, so Studio Brain is favoring a concise recovery check-in instead of extra work.";
  }
  return "Daily cadence is active and the next brief is focused on one meaningful move rather than ambient chatter.";
}

function deriveVerifiedContext(
  memoryBrief: ControlTowerMemoryBrief,
  loops: PartnerOpenLoop[],
  runtimeContext: AgentRuntimePartnerContext | null,
  existing: PartnerBrief | null,
): string[] {
  return dedupeStrings(
    [
      ...(runtimeContext?.verifiedContext ?? []),
      ...(existing?.verifiedContext ?? []),
      ...loops.flatMap((loop) => loop.verifiedContext),
      memoryBrief.goal,
      memoryBrief.summary,
      memoryBrief.recentDecisions[0] ?? null,
    ],
    5,
  );
}

function deriveRecommendedFocus(
  loops: PartnerOpenLoop[],
  singleDecisionNeeded: string | null,
  memoryBrief: ControlTowerMemoryBrief,
): string {
  if (singleDecisionNeeded) return clipText(singleDecisionNeeded, 180);
  return clipText(
    loops.find((loop) => loop.status === "open")?.next
      || memoryBrief.recommendedNextActions[0]
      || "Hold cadence and wait for the next meaningful change.",
    180,
  );
}

function deriveInitiativeState(
  generatedAt: string,
  existing: PartnerBrief | null,
  loops: PartnerOpenLoop[],
  runtimeContext: AgentRuntimePartnerContext | null,
  needsOwnerDecision: boolean,
  cooldownUntil: string | null,
): PartnerInitiativeState {
  if (cooldownUntil && Date.parse(cooldownUntil) > Date.parse(generatedAt)) return "cooldown";
  if (runtimeContext?.initiativeState === "executing") return "executing";
  if (needsOwnerDecision) return "waiting_on_owner";
  if (loops.some((loop) => loop.status === "open")) return existing ? "monitoring" : "briefing";
  return "quiet";
}

function rehydrateBrief(
  generatedAt: string,
  memoryBrief: ControlTowerMemoryBrief,
  approvals: ControlTowerApprovalItem[],
  loops: PartnerOpenLoop[],
  runtimeContext: AgentRuntimePartnerContext | null,
  existing: PartnerBrief | null,
): PartnerBrief {
  const singleDecisionNeeded = deriveDecisionNeeded(approvals, loops, runtimeContext) ?? existing?.singleDecisionNeeded ?? null;
  const needsOwnerDecision = Boolean(singleDecisionNeeded);
  const cooldownUntil = existing?.cooldownUntil ?? runtimeContext?.cooldownUntil ?? null;
  const contactReason = deriveContactReason(memoryBrief, approvals, loops, runtimeContext);
  const verifiedContext = deriveVerifiedContext(memoryBrief, loops, runtimeContext, existing);
  const recommendedFocus = deriveRecommendedFocus(loops, singleDecisionNeeded, memoryBrief);
  const initiativeState = deriveInitiativeState(generatedAt, existing, loops, runtimeContext, needsOwnerDecision, cooldownUntil);
  const openLoopCount = loops.filter((loop) => loop.status === "open").length;
  const dailyNote = clipText(
    openLoopCount > 0
      ? `Studio Brain is tracking ${openLoopCount} bounded open loop${openLoopCount === 1 ? "" : "s"}. Recommended focus: ${recommendedFocus}`
      : "No meaningful change is worth interrupting you for right now; cadence can stay quiet until the next verified shift.",
    220,
  );
  const summary = clipText(
    needsOwnerDecision
      ? `${contactReason} Decision needed: ${singleDecisionNeeded}`
      : `${contactReason} Recommended focus: ${recommendedFocus}`,
    220,
  );

  return {
    schema: "studio-brain.partner-brief.v1",
    generatedAt,
    persona: CHIEF_OF_STAFF_PERSONA,
    summary,
    initiativeState,
    lastMeaningfulContactAt:
      runtimeContext?.lastMeaningfulContactAt
      || existing?.lastMeaningfulContactAt
      || generatedAt,
    nextCheckInAt:
      cooldownUntil && Date.parse(cooldownUntil) > Date.parse(generatedAt)
        ? cooldownUntil
        : runtimeContext?.nextCheckInAt
          || existing?.nextCheckInAt
          || addMinutes(generatedAt, needsOwnerDecision ? 120 : openLoopCount > 0 ? 240 : 1_440),
    cooldownUntil,
    needsOwnerDecision,
    contactReason,
    verifiedContext,
    singleDecisionNeeded,
    recommendedFocus,
    dailyNote,
    openLoops: loops,
    idleBudget: runtimeContext?.idleBudget ?? existing?.idleBudget ?? CHIEF_OF_STAFF_IDLE_BUDGET,
    programs: CHIEF_OF_STAFF_PROGRAMS,
    collaborationCommands: CHIEF_OF_STAFF_COMMANDS,
    artifacts: partnerArtifactPaths(),
  };
}

function writePartnerArtifacts(repoRoot: string, brief: PartnerBrief): PartnerBrief {
  writeLatestPartnerBrief(repoRoot, brief);
  writePartnerOpenLoops(repoRoot, brief.openLoops, brief.generatedAt);
  return brief;
}

export function deriveAndPersistPartnerBrief(input: DerivePartnerBriefInput): PartnerBrief {
  const existing = readLatestPartnerBrief(input.repoRoot);
  const runtimeContext = runtimePartnerContext(input.agentRuntime);
  const persistedLoops = readPartnerOpenLoops(input.repoRoot);
  const runtimeLoops = runtimeContext?.openLoops ?? [];
  const fallbackLoops = [
    ...buildFallbackRoomLoops(input.generatedAt, input.rooms),
    ...buildFallbackMemoryLoops(input.generatedAt, input.memoryBrief),
  ];
  const loops = mergeOpenLoops(input.generatedAt, persistedLoops, runtimeLoops, fallbackLoops);
  const brief = rehydrateBrief(
    input.generatedAt,
    input.memoryBrief,
    input.approvals,
    loops,
    runtimeContext,
    existing,
  );
  return writePartnerArtifacts(input.repoRoot, brief);
}

function refreshBriefAfterMutation(repoRoot: string, brief: PartnerBrief): PartnerBrief {
  const openLoops = brief.openLoops
    .map((loop) => ({ ...loop }))
    .sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)));
  const refreshed = rehydrateBrief(
    new Date().toISOString(),
    {
      schema: "studio-brain.memory-brief.v1",
      generatedAt: brief.generatedAt,
      continuityState: "ready",
      summary: brief.contactReason,
      goal: brief.recommendedFocus,
      blockers: openLoops.filter((loop) => loop.status === "open").map((loop) => loop.summary),
      recentDecisions: brief.verifiedContext,
      recommendedNextActions: openLoops.map((loop) => loop.next),
      fallbackSources: [],
      sourcePath: brief.artifacts.latestBriefPath,
      layers: {
        coreBlocks: brief.verifiedContext,
        workingMemory: brief.verifiedContext,
        episodicMemory: brief.verifiedContext,
        canonicalMemory: brief.verifiedContext,
      },
      consolidation: {
        mode: "idle",
        summary: "Chief-of-staff state is being maintained by the partner layer artifacts.",
        lastRunAt: brief.generatedAt,
        nextRunAt: brief.nextCheckInAt,
        focusAreas: brief.verifiedContext,
        maintenanceActions: [],
        outputs: [brief.artifacts.latestBriefPath, brief.artifacts.openLoopsPath],
      },
    },
    [],
    openLoops,
    null,
    brief,
  );
  return writePartnerArtifacts(repoRoot, refreshed);
}

export function recordPartnerCheckin(input: RecordPartnerCheckinInput): PartnerBrief {
  const occurredAt = new Date().toISOString();
  const snoozeUntil =
    input.action === "snooze"
      ? addMinutes(occurredAt, Math.max(15, Math.min(1_440, Math.trunc(input.snoozeMinutes ?? 120))))
      : input.action === "pause"
        ? addMinutes(occurredAt, 240)
        : null;
  const record: PartnerCheckinRecord = {
    schema: "studio-brain.partner-checkin.v1",
    id: crypto.randomUUID(),
    action: input.action,
    occurredAt,
    actorId: input.actorId,
    note: input.note?.trim() || null,
    snoozeUntil,
  };
  appendPartnerCheckin(input.repoRoot, record);

  const next = {
    ...input.brief,
    generatedAt: occurredAt,
    lastMeaningfulContactAt: occurredAt,
    cooldownUntil:
      input.action === "continue" || input.action === "redirect" || input.action === "why_this" || input.action === "ack"
        ? null
        : snoozeUntil,
    initiativeState:
      input.action === "continue"
        ? ("monitoring" as const)
        : input.action === "why_this"
          ? ("briefing" as const)
          : input.action === "redirect"
            ? ("waiting_on_owner" as const)
            : snoozeUntil
              ? ("cooldown" as const)
              : input.brief.initiativeState,
    nextCheckInAt:
      input.action === "continue"
        ? addMinutes(occurredAt, 120)
        : snoozeUntil ?? input.brief.nextCheckInAt,
    contactReason:
      input.action === "why_this"
        ? input.brief.contactReason
        : input.action === "redirect"
          ? clipText(input.note?.trim() || "Owner redirected the current initiative.", 180)
          : input.brief.contactReason,
  } satisfies PartnerBrief;

  return refreshBriefAfterMutation(input.repoRoot, next);
}

export function updatePartnerOpenLoop(input: UpdatePartnerOpenLoopInput): PartnerBrief {
  const occurredAt = new Date().toISOString();
  const nextLoops = input.brief.openLoops.map((loop) =>
    loop.id === input.loopId
      ? {
          ...loop,
          status: input.status,
          updatedAt: occurredAt,
          decisionNeeded: input.status === "resolved" ? null : loop.decisionNeeded,
          summary:
            input.note?.trim()
              ? clipText(`${loop.summary} ${input.note.trim()}`, 200)
              : loop.summary,
        }
      : loop,
  );

  appendPartnerCheckin(input.repoRoot, {
    schema: "studio-brain.partner-checkin.v1",
    id: crypto.randomUUID(),
    action: input.status === "paused" ? "pause" : input.status === "delegated" ? "redirect" : "ack",
    occurredAt,
    actorId: input.actorId,
    note: input.note?.trim() || `${input.loopId} -> ${input.status}`,
    snoozeUntil: input.status === "paused" ? addMinutes(occurredAt, 240) : null,
  });

  return refreshBriefAfterMutation(input.repoRoot, {
    ...input.brief,
    generatedAt: occurredAt,
    lastMeaningfulContactAt: occurredAt,
    openLoops: nextLoops,
  });
}
