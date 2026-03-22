import { z } from "zod";

const stringList = z.array(z.string().trim().min(1).max(256)).max(128);

export const planningSubmitRequestSchema = z.object({
  request: z.string().trim().min(1).max(8_000).optional(),
  planningBrief: z.record(z.string(), z.unknown()).optional(),
  draftPlan: z.union([
    z.string().trim().min(1).max(40_000),
    z.record(z.string(), z.unknown())
  ]).optional(),
  sourceType: z.enum(["raw-request", "draft-plan", "planning-brief"]).optional(),
  submissionStage: z.enum(["prepare", "complete", "single_pass"]).default("single_pass"),
  preparedRunId: z.string().trim().min(1).max(128).optional(),
  reviewMode: z.enum(["auto", "swarm", "deterministic"]).default("auto"),
  swarmConfig: z.object({
    runtime: z.enum(["hybrid", "studio-brain", "codex-local", "deterministic"]).optional(),
    executionMode: z.enum(["live", "deterministic"]).optional(),
    depthProfile: z.enum(["fast", "balanced", "deepest"]).optional(),
    maxCritiqueCycles: z.number().int().min(1).max(4).optional(),
    roundOrder: z.array(z.enum([
      "draft_capture",
      "memory_pack",
      "parallel_critique",
      "planner_revision",
      "rebuttal",
      "synthesis",
      "legitimacy_check",
    ])).min(1).max(12).optional(),
    maxAgents: z.number().int().min(1).max(32).optional(),
    allowSpecialists: z.boolean().optional(),
    specialistRoleIds: stringList.default([]),
  }).default({ specialistRoleIds: [] }),
  externalSwarmArtifacts: z.object({
    swarmRun: z.record(z.string(), z.unknown()).optional(),
    agentRuns: z.array(z.record(z.string(), z.unknown())).default([]),
    roleFindings: z.array(z.record(z.string(), z.unknown())).default([]),
    roleNotes: z.array(z.record(z.string(), z.unknown())).default([]),
    planRevisions: z.array(z.record(z.string(), z.unknown())).default([]),
    roundSummaries: z.array(z.record(z.string(), z.unknown())).default([]),
    finalDraftMarkdown: z.string().trim().min(1).max(80_000).optional(),
    addressMatrix: z.array(z.record(z.string(), z.unknown())).default([]),
    memoryRefsUsed: z.array(z.string().trim().min(1).max(256)).max(512).default([]),
  }).optional(),
  memoryPolicy: z.object({
    mode: z.enum(["detailed_role_notes", "structured_summaries", "final_packet_only", "none"]).default("detailed_role_notes"),
    writeback: z.boolean().default(true),
    includePriorPackets: z.boolean().default(true),
    includeRoleNotes: z.boolean().default(true),
    maxSharedItems: z.number().int().min(1).max(32).optional(),
    maxRoleItems: z.number().int().min(1).max(16).optional(),
  }).default({
    mode: "detailed_role_notes",
    writeback: true,
    includePriorPackets: true,
    includeRoleNotes: true,
  }),
  draftSource: z.enum(["thread_latest", "explicit_draft", "prompt_generated"]).optional(),
  priorPacketIds: z.array(z.string().trim().min(1).max(128)).max(20).default([]),
  requestedBy: z.string().trim().min(1).max(128).default("unknown-requestor"),
  tenantId: z.string().trim().min(1).max(128).default("monsoonfire-main"),
  metadata: z.record(z.string(), z.unknown()).default({}),
  docket: z.object({
    objective: z.string().trim().min(1).max(8_000).optional(),
    whyNow: z.string().trim().max(4_000).optional(),
    successCriteria: stringList.default([]),
    constraints: stringList.default([]),
    knownFacts: stringList.default([]),
    unknowns: stringList.default([]),
    assumptions: z.array(z.object({
      statement: z.string().trim().min(1).max(1_000),
      evidenceLabel: z.enum(["verified", "inferred", "speculative", "unknown", "requires_human_confirmation"])
    })).max(128).default([]),
    budgetTimeSensitivity: z.enum(["low", "medium", "high", "critical"]).optional(),
    reversibility: z.enum(["reversible", "partially_reversible", "hard_to_reverse"]).optional(),
    domain: z.string().trim().min(1).max(128).optional(),
    affectedSystems: stringList.default([]),
    humanPriorities: stringList.default([]),
    requestedDeadline: z.string().datetime().optional(),
    initialEvidence: stringList.default([])
  }).default(() => ({
    successCriteria: [],
    constraints: [],
    knownFacts: [],
    unknowns: [],
    assumptions: [],
    affectedSystems: [],
    humanPriorities: [],
    initialEvidence: [],
  }))
}).refine((payload) => Boolean(payload.request || payload.docket.objective || payload.draftPlan || payload.planningBrief), {
  message: "A request, docket objective, planning brief, or draft plan is required."
});

export const planningPacketCompareRequestSchema = z.object({
  packetIds: z.array(z.string().trim().min(1).max(128)).min(2).max(10)
});

export type PlanningSubmitRequest = z.infer<typeof planningSubmitRequestSchema>;
export type PlanningPacketCompareRequest = z.infer<typeof planningPacketCompareRequestSchema>;

export type PlanningRecord = Record<string, unknown>;

export type PlanningRoleSource = PlanningRecord & { sourceId: string };
export type PlanningRoleSourceSnapshot = PlanningRecord & { snapshotId: string; sourceId: string };
export type PlanningRoleCandidate = PlanningRecord & { candidateId: string; sourceId: string };
export type PlanningRoleScore = PlanningRecord & { scoreId: string; subjectType: string };
export type PlanningRoleManifest = PlanningRecord & { roleId: string; roleName: string };

export type PlanningDocket = PlanningRecord & { docketId: string; objective: string; requestedBy: string; tenantId: string };
export type PlanFingerprint = PlanningRecord & { fingerprintId: string; docketId: string; stakes: string; touchpoints: string[] };
export type StakeholderInference = PlanningRecord & { inferenceId: string; docketId: string; stakeholderClass: string };
export type PlanningCouncil = PlanningRecord & { councilId: string; docketId: string; fingerprintId: string };
export type PlanningCouncilSeat = PlanningRecord & { seatId: string; councilId: string; seatName: string; selectedRoleId: string };
export type PlanningReviewRound = PlanningRecord & { roundId: string; councilId: string; roundType: string };
export type PlanningReviewItem = PlanningRecord & { itemId: string; councilId: string; roundId: string; seatId: string; type: string; severity: string };
export type PlanningObjectionLedgerEntry = PlanningRecord & { ledgerId: string; itemId: string; councilId: string; resolutionState: string };
export type PlanningSynthesizedPlan = PlanningRecord & { planId: string; councilId: string; docketId: string };
export type HumanArbitrationPacket = PlanningRecord & { packetId: string; councilId: string; docketId: string; status: string };
export type PlanningSwarmRun = PlanningRecord & { runId: string; councilId: string; status: string; roundOrder: string[] };
export type PlanningSwarmAgentRun = PlanningRecord & { agentRunId: string; runId: string; roleId: string; roundType: string; status: string };
export type PlanningRoundSummary = PlanningRecord & { summaryId: string; runId: string; roundType: string; status: string };
export type PlanningMemoryRef = PlanningRecord & { refId: string; scope: string; kind: string };
export type PlanningRoleFinding = PlanningRecord & { findingId: string; councilId: string; roleId: string; roundType: string; status: string };
export type PlanningRoleNote = PlanningRecord & { noteId: string; councilId: string; roleId: string; roundType: string; status: string };
export type PlanningPlanRevision = PlanningRecord & { revisionId: string; councilId: string; stage: string };
export type PlanningAddressMatrixEntry = PlanningRecord & { entryId: string; councilId: string; findingId: string; status: string };

export type PlanningPreparedCouncilRun = {
  preparedRunId: string;
  generatedAt: string;
  docket: PlanningDocket;
  fingerprint: PlanFingerprint;
  council: PlanningCouncil;
  seats: PlanningCouncilSeat[];
  reviewRounds: PlanningReviewRound[];
  swarmRun: PlanningSwarmRun;
  roleManifests: PlanningRoleManifest[];
  canonicalDraftMarkdown: string;
  roundPlan: Array<Record<string, unknown>>;
  memoryRefs: PlanningMemoryRef[];
  sharedMemoryPack: Record<string, unknown>;
  roleMemorySlices: Array<Record<string, unknown>>;
  fallbackInstructions: string[];
};

export type PlanningRunBundle = {
  generatedAt: string;
  docket: PlanningDocket;
  fingerprint: PlanFingerprint;
  sourceSync: {
    generatedAt: string;
    sources: PlanningRoleSource[];
    snapshots: PlanningRoleSourceSnapshot[];
    extractedCandidates: PlanningRoleCandidate[];
  };
  roleScoreReport: {
    generatedAt: string;
    curatedScores: PlanningRoleScore[];
    candidateScores: PlanningRoleScore[];
  };
  stakeholders: StakeholderInference[];
  council: PlanningCouncil;
  councilSeats: PlanningCouncilSeat[];
  reviewRounds: PlanningReviewRound[];
  reviewItems: PlanningReviewItem[];
  objectionLedger: PlanningObjectionLedgerEntry[];
  swarmRun: PlanningSwarmRun;
  agentRuns: PlanningSwarmAgentRun[];
  roundSummaries: PlanningRoundSummary[];
  memoryRefs: PlanningMemoryRef[];
  roleFindings: PlanningRoleFinding[];
  roleNotes: PlanningRoleNote[];
  planRevisions: PlanningPlanRevision[];
  addressMatrix: PlanningAddressMatrixEntry[];
  synthesizedPlan: PlanningSynthesizedPlan;
  packet: HumanArbitrationPacket;
};

export type PlanningCouncilDetails = {
  council: PlanningCouncil;
  seats: PlanningCouncilSeat[];
  reviewRounds: PlanningReviewRound[];
  reviewItems: PlanningReviewItem[];
  objectionLedger: PlanningObjectionLedgerEntry[];
  swarmRun: PlanningSwarmRun | null;
  agentRuns: PlanningSwarmAgentRun[];
  roundSummaries: PlanningRoundSummary[];
  memoryRefs: PlanningMemoryRef[];
  roleFindings: PlanningRoleFinding[];
  roleNotes: PlanningRoleNote[];
  planRevisions: PlanningPlanRevision[];
  addressMatrix: PlanningAddressMatrixEntry[];
  synthesizedPlan: PlanningSynthesizedPlan | null;
  packets: HumanArbitrationPacket[];
};

export type PlanningRoleLibrarySeed = {
  sources: PlanningRoleSource[];
  snapshots: PlanningRoleSourceSnapshot[];
  candidates: PlanningRoleCandidate[];
  curatedRoles: PlanningRoleManifest[];
  curatedScores: PlanningRoleScore[];
  candidateScores: PlanningRoleScore[];
};
