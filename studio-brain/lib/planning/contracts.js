"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.planningPacketCompareRequestSchema = exports.planningSubmitRequestSchema = void 0;
const zod_1 = require("zod");
const stringList = zod_1.z.array(zod_1.z.string().trim().min(1).max(256)).max(128);
exports.planningSubmitRequestSchema = zod_1.z.object({
    request: zod_1.z.string().trim().min(1).max(8_000).optional(),
    planningBrief: zod_1.z.record(zod_1.z.string(), zod_1.z.unknown()).optional(),
    draftPlan: zod_1.z.union([
        zod_1.z.string().trim().min(1).max(40_000),
        zod_1.z.record(zod_1.z.string(), zod_1.z.unknown())
    ]).optional(),
    sourceType: zod_1.z.enum(["raw-request", "draft-plan", "planning-brief"]).optional(),
    submissionStage: zod_1.z.enum(["prepare", "complete", "single_pass"]).default("single_pass"),
    preparedRunId: zod_1.z.string().trim().min(1).max(128).optional(),
    reviewMode: zod_1.z.enum(["auto", "swarm", "deterministic"]).default("auto"),
    swarmConfig: zod_1.z.object({
        runtime: zod_1.z.enum(["hybrid", "studio-brain", "codex-local", "deterministic"]).optional(),
        executionMode: zod_1.z.enum(["live", "deterministic"]).optional(),
        depthProfile: zod_1.z.enum(["fast", "balanced", "deepest"]).optional(),
        maxCritiqueCycles: zod_1.z.number().int().min(1).max(4).optional(),
        roundOrder: zod_1.z.array(zod_1.z.enum([
            "draft_capture",
            "memory_pack",
            "parallel_critique",
            "planner_revision",
            "rebuttal",
            "synthesis",
            "legitimacy_check",
        ])).min(1).max(12).optional(),
        maxAgents: zod_1.z.number().int().min(1).max(32).optional(),
        allowSpecialists: zod_1.z.boolean().optional(),
        specialistRoleIds: stringList.default([]),
    }).default({ specialistRoleIds: [] }),
    externalSwarmArtifacts: zod_1.z.object({
        swarmRun: zod_1.z.record(zod_1.z.string(), zod_1.z.unknown()).optional(),
        agentRuns: zod_1.z.array(zod_1.z.record(zod_1.z.string(), zod_1.z.unknown())).default([]),
        roleFindings: zod_1.z.array(zod_1.z.record(zod_1.z.string(), zod_1.z.unknown())).default([]),
        roleNotes: zod_1.z.array(zod_1.z.record(zod_1.z.string(), zod_1.z.unknown())).default([]),
        planRevisions: zod_1.z.array(zod_1.z.record(zod_1.z.string(), zod_1.z.unknown())).default([]),
        roundSummaries: zod_1.z.array(zod_1.z.record(zod_1.z.string(), zod_1.z.unknown())).default([]),
        finalDraftMarkdown: zod_1.z.string().trim().min(1).max(80_000).optional(),
        addressMatrix: zod_1.z.array(zod_1.z.record(zod_1.z.string(), zod_1.z.unknown())).default([]),
        memoryRefsUsed: zod_1.z.array(zod_1.z.string().trim().min(1).max(256)).max(512).default([]),
    }).optional(),
    memoryPolicy: zod_1.z.object({
        mode: zod_1.z.enum(["detailed_role_notes", "structured_summaries", "final_packet_only", "none"]).default("detailed_role_notes"),
        writeback: zod_1.z.boolean().default(true),
        includePriorPackets: zod_1.z.boolean().default(true),
        includeRoleNotes: zod_1.z.boolean().default(true),
        maxSharedItems: zod_1.z.number().int().min(1).max(32).optional(),
        maxRoleItems: zod_1.z.number().int().min(1).max(16).optional(),
    }).default({
        mode: "detailed_role_notes",
        writeback: true,
        includePriorPackets: true,
        includeRoleNotes: true,
    }),
    draftSource: zod_1.z.enum(["thread_latest", "explicit_draft", "prompt_generated"]).optional(),
    priorPacketIds: zod_1.z.array(zod_1.z.string().trim().min(1).max(128)).max(20).default([]),
    requestedBy: zod_1.z.string().trim().min(1).max(128).default("unknown-requestor"),
    tenantId: zod_1.z.string().trim().min(1).max(128).default("monsoonfire-main"),
    metadata: zod_1.z.record(zod_1.z.string(), zod_1.z.unknown()).default({}),
    docket: zod_1.z.object({
        objective: zod_1.z.string().trim().min(1).max(8_000).optional(),
        whyNow: zod_1.z.string().trim().max(4_000).optional(),
        successCriteria: stringList.default([]),
        constraints: stringList.default([]),
        knownFacts: stringList.default([]),
        unknowns: stringList.default([]),
        assumptions: zod_1.z.array(zod_1.z.object({
            statement: zod_1.z.string().trim().min(1).max(1_000),
            evidenceLabel: zod_1.z.enum(["verified", "inferred", "speculative", "unknown", "requires_human_confirmation"])
        })).max(128).default([]),
        budgetTimeSensitivity: zod_1.z.enum(["low", "medium", "high", "critical"]).optional(),
        reversibility: zod_1.z.enum(["reversible", "partially_reversible", "hard_to_reverse"]).optional(),
        domain: zod_1.z.string().trim().min(1).max(128).optional(),
        affectedSystems: stringList.default([]),
        humanPriorities: stringList.default([]),
        requestedDeadline: zod_1.z.string().datetime().optional(),
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
exports.planningPacketCompareRequestSchema = zod_1.z.object({
    packetIds: zod_1.z.array(zod_1.z.string().trim().min(1).max(128)).min(2).max(10)
});
