import test from "node:test";
import assert from "node:assert/strict";
import { createInMemoryMemoryStoreAdapter } from "../memory/inMemoryAdapter";
import { createMemoryService } from "../memory/service";
import { MemoryEventStore } from "../stores/memoryStores";
import { findPlanningRepoRoot } from "./governance";
import { PlanningNotFoundError, PlanningService, PlanningValidationError } from "./service";
import { MemoryPlanningStore } from "./store";

const repoRoot = findPlanningRepoRoot(process.cwd());

test("planning service submits a packet bundle and seeds the curated role library", async () => {
  const eventStore = new MemoryEventStore();
  const service = new PlanningService({
    store: new MemoryPlanningStore(),
    eventStore,
    repoRoot,
    now: () => "2026-03-21T14:00:00.000Z",
  });

  const bundle = await service.submit({
    request: "Plan a security-sensitive auth and billing migration with rollback guidance.",
    requestedBy: "staff-test-uid",
    docket: {
      constraints: ["Planning-only", "No irreversible actions"],
      affectedSystems: ["studio-brain/src/planning", ".governance/planning"],
    },
  });

  assert.equal(bundle.packet.status, "ready_for_human");
  assert.ok(bundle.fingerprint.touchpoints.includes("security"));
  assert.equal(bundle.swarmRun.roundOrder[0], "draft_capture");
  assert.ok(bundle.agentRuns.length >= 6);
  assert.ok(bundle.roleNotes.length >= 6);
  assert.ok(bundle.planRevisions.length >= 3);
  const requiredHumanDecisions = (bundle.packet.requiredHumanDecisions ?? []) as string[];
  assert.ok(requiredHumanDecisions.length >= 1);
  assert.equal(typeof bundle.packet.goNoGoRecommendation, "string");

  const roles = await service.listRoleLibrary(20);
  assert.ok(roles.length >= 10);
  assert.ok(roles.some((role) => role.roleId === "lead-planner.v1"));

  const events = await eventStore.listRecent(5);
  assert.ok(events.some((event) => event.action === "planning.packet.generated"));
});

test("planning service prepares a live swarm run and completes it with structured role artifacts", async () => {
  const eventStore = new MemoryEventStore();
  const service = new PlanningService({
    store: new MemoryPlanningStore(),
    eventStore,
    repoRoot,
    now: () => "2026-03-21T14:15:00.000Z",
  });

  const preparation = await service.prepare({
    request: "Plan a staff-only council console with packet comparison and council reruns.",
    requestedBy: "staff-live-test",
    metadata: {
      requestId: "req-live-service-test",
      submittedObjective: "Plan a staff-only council console with packet comparison and council reruns.",
    },
    reviewMode: "swarm",
    swarmConfig: {
      executionMode: "live",
      depthProfile: "deepest",
      maxCritiqueCycles: 2,
    },
    docket: {
      constraints: ["Planning-only", "No implementation side effects"],
      affectedSystems: ["studio-brain/src/planning", "web/src/views/staff"],
    },
  });

  assert.ok(preparation.preparedRunId.startsWith("planning_council_"));
  assert.equal(preparation.swarmRun.executionMode, "live");
  assert.equal(preparation.reviewRounds.filter((entry) => entry.roundType === "parallel_critique").length, 2);
  assert.ok(preparation.roleManifests.length >= 6);
  assert.equal((preparation as { wrapperIntegrity?: { requestId?: string } }).wrapperIntegrity?.requestId, "req-live-service-test");
  assert.equal(
    typeof (preparation as { wrapperIntegrity?: { draftFingerprint?: string } }).wrapperIntegrity?.draftFingerprint,
    "string"
  );

  const bundle = await service.complete({
    request: "Plan a staff-only council console with packet comparison and council reruns.",
    requestedBy: "staff-live-test",
    submissionStage: "complete",
    preparedRunId: preparation.preparedRunId,
    metadata: {
      ...(preparation as { wrapperIntegrity?: Record<string, unknown> }).wrapperIntegrity,
    },
    reviewMode: "swarm",
    externalSwarmArtifacts: {
      swarmRun: {
        runId: "swarm-live-service-test",
        runtime: "codex-local",
        executionMode: "live",
        depthProfile: "deepest",
        maxCritiqueCycles: 2,
        ...(preparation as { wrapperIntegrity?: Record<string, unknown> }).wrapperIntegrity,
      },
      controlPlane: {
        ...(preparation as { wrapperIntegrity?: Record<string, unknown> }).wrapperIntegrity,
      },
      agentRuns: [
        {
          roleId: "skeptic-red-team.v1",
          roleName: "Skeptic / Red Team",
          roundType: "parallel_critique",
          cycle: 1,
          status: "completed",
          provider: "openai.responses",
          promptVersion: "planning-council.live.v1",
          inputSections: ["Ordered Execution Sequence", "Validation Gates"],
        },
        {
          roleId: "lead-planner.v1",
          roleName: "Lead Planner",
          roundType: "planner_revision",
          cycle: 1,
          status: "completed",
          provider: "openai.responses",
          promptVersion: "planning-council.live.v1",
          inputSections: ["Summary", "Validation Gates", "Required Human Decisions"],
        },
      ],
      roleFindings: [
        {
          findingId: "finding-live-1",
          roleId: "skeptic-red-team.v1",
          roleName: "Skeptic / Red Team",
          roundType: "parallel_critique",
          cycle: 1,
          severity: "high",
          findingType: "objection",
          affectedPlanSection: "Ordered Execution Sequence",
          claim: "The first slice still needs an explicit staff-only checkpoint before broader rollout decisions.",
          whyItMatters: "A smaller reversible checkpoint reduces coordination risk if packet lineage behavior is wrong.",
          evidenceRefs: [],
          proposedChange: "Make the first slice staff-only and require packet-lineage validation before broader decisions.",
          requiresHumanDecision: false,
          noveltyScore: 0.81,
          status: "partially_resolved",
        },
        {
          findingId: "finding-live-2",
          roleId: "security-reviewer.v1",
          roleName: "Security Reviewer",
          roundType: "parallel_critique",
          cycle: 1,
          severity: "critical",
          findingType: "required_revision",
          affectedPlanSection: "Validation Gates",
          claim: "The plan must isolate a security signoff before exposing raw role-note detail or memory references.",
          whyItMatters: "Sensitive council context can leak even in a staff-only tool if visibility boundaries are implicit.",
          evidenceRefs: [],
          proposedChange: "Require explicit security signoff before exposing raw role-note detail or memory references.",
          requiresHumanDecision: true,
          noveltyScore: 0.9,
          status: "still_blocked",
        },
      ],
      planRevisions: [
        {
          stage: "planner_revision",
          cycle: 1,
          authorRoleId: "lead-planner.v1",
          summary: "Planner revision narrowed the first slice and preserved the security blocker.",
          changedSections: ["Ordered Execution Sequence", "Validation Gates", "Required Human Decisions"],
          addressedFindingIds: ["finding-live-1"],
          rejectedFindingIds: ["finding-live-2"],
          plannerRationale: "Narrow the slice immediately, but keep the visibility question for human arbitration.",
          markdown: `# Upgraded Council Plan

## Summary
- Build a staff-only council console that remains planning-only.

## Ordered Execution Sequence
- Start with a staff-only slice.
- Validate packet lineage and rerun behavior before broader exposure decisions.

## Validation Gates
- Require explicit security signoff before exposing raw role-note detail or memory references.

## Failure Modes
- Packet lineage confusion across reruns.
- Sensitive council context leaks.

## Required Human Decisions
- Decide whether raw role-note detail can be exposed in the console.

## Dissent
- Security reviewer still blocks broader visibility until signoff is explicit.`,
        },
      ],
      roundSummaries: [
        {
          roundType: "parallel_critique",
          cycle: 1,
          status: "completed",
          summary: "Live critique found rollout-narrowing and security-visibility issues.",
          participatingRoleIds: ["skeptic-red-team.v1", "security-reviewer.v1"],
          novelFindingsCount: 2,
          conflictClusters: [],
          stillBlockedFindingIds: ["finding-live-2"],
        },
      ],
      addressMatrix: [
        {
          findingId: "finding-live-1",
          status: "accepted",
          resolution: "Narrowed the first slice to staff-only validation.",
          reason: "The planner accepted the safer sequencing change.",
          cycle: 1,
        },
        {
          findingId: "finding-live-2",
          status: "unresolved",
          resolution: "Security signoff remains a human decision.",
          reason: "The blocker stays active until human arbitration.",
          cycle: 1,
        },
      ],
      finalDraftMarkdown: `# Upgraded Council Plan

## Summary
- Build a staff-only council console that remains planning-only.

## Ordered Execution Sequence
- Start with a staff-only slice.
- Validate packet lineage and rerun behavior before broader exposure decisions.

## Validation Gates
- Require explicit security signoff before exposing raw role-note detail or memory references.

## Failure Modes
- Packet lineage confusion across reruns.
- Sensitive council context leaks.

## Required Human Decisions
- Decide whether raw role-note detail can be exposed in the console.

## Dissent
- Security reviewer still blocks broader visibility until signoff is explicit.`,
      memoryRefsUsed: [],
    },
  });

  assert.equal(bundle.council.councilId, preparation.council.councilId);
  assert.equal(bundle.swarmRun.executionMode, "live");
  assert.equal(bundle.roleFindings.length, 2);
  assert.equal(bundle.addressMatrix.length, 2);
  assert.equal((bundle.packet.agentRuns as unknown[]).length, 2);
  assert.equal((bundle.packet.roleFindings as unknown[]).length, 2);
  assert.equal((bundle.packet.addressMatrix as unknown[]).length, 2);
  assert.equal((bundle.packet.artifactEmbedding as { canonicalSource?: string }).canonicalSource, "planning-control-plane.packet");
  assert.ok(String(bundle.packet.upgradedPlanMarkdown).includes("staff-only slice"));
  assert.equal(bundle.packet.goNoGoRecommendation, "no_go_until_human_decision");
  assert.equal(
    (bundle.packet.wrapperIntegrity as { requestId?: string }).requestId,
    "req-live-service-test"
  );
  assert.equal(
    (bundle.packet.wrapperIntegrity as { preparedRunId?: string }).preparedRunId,
    preparation.preparedRunId
  );

  const council = await service.getCouncil(bundle.packet.councilId);
  assert.equal(council.roleFindings.length, 2);
  assert.equal(council.addressMatrix.length, 2);

  const events = await eventStore.listRecent(10);
  assert.ok(events.some((event) => event.action === "planning.swarm.prepared"));
  assert.ok(events.some((event) => event.action === "planning.packet.generated"));
});

test("planning service rejects live completion when wrapper integrity metadata drifts", async () => {
  const service = new PlanningService({
    store: new MemoryPlanningStore(),
    eventStore: new MemoryEventStore(),
    repoRoot,
    now: () => "2026-03-21T15:00:00.000Z",
  });

  const preparation = await service.prepare({
    request: "Plan a narrow continuity rollout with a council canary gate.",
    requestedBy: "staff-live-test",
    reviewMode: "swarm",
    swarmConfig: {
      executionMode: "live",
      depthProfile: "deepest",
      maxCritiqueCycles: 1,
    },
  });

  await assert.rejects(() => service.complete({
    request: "Plan a narrow continuity rollout with a council canary gate.",
    requestedBy: "staff-live-test",
    submissionStage: "complete",
    preparedRunId: preparation.preparedRunId,
    metadata: {
      ...(preparation as { wrapperIntegrity?: Record<string, unknown> }).wrapperIntegrity,
      draftFingerprint: "wrong-draft-fingerprint",
    },
    reviewMode: "swarm",
    externalSwarmArtifacts: {
      controlPlane: {
        ...(preparation as { wrapperIntegrity?: Record<string, unknown> }).wrapperIntegrity,
        draftFingerprint: "wrong-draft-fingerprint",
      },
      swarmRun: {
        runId: "swarm-live-mismatch",
        runtime: "codex-local",
        executionMode: "live",
        depthProfile: "deepest",
        maxCritiqueCycles: 1,
      },
      planRevisions: [
        {
          stage: "planner_revision",
          cycle: 1,
          authorRoleId: "lead-planner.v1",
          summary: "Minimal revision output for mismatch testing.",
          changedSections: ["Validation Gates"],
          addressedFindingIds: [],
          rejectedFindingIds: [],
          plannerRationale: "Mismatch test only.",
          markdown: `# Upgraded Council Plan

## Summary
- Minimal draft for mismatch testing.

## Ordered Execution Sequence
- Keep the council path narrow.

## Validation Gates
- Fail if wrapper integrity drifts.

## Failure Modes
- Draft identity mismatch.

## Required Human Decisions
- None.

## Dissent
- None.`,
        },
      ],
      finalDraftMarkdown: `# Upgraded Council Plan

## Summary
- Minimal draft for mismatch testing.`,
    },
  }), PlanningValidationError);
});

test("planning service compares packets and reports field differences", async () => {
  const service = new PlanningService({
    store: new MemoryPlanningStore(),
    eventStore: new MemoryEventStore(),
    repoRoot,
    now: () => "2026-03-21T14:30:00.000Z",
  });

  const security = await service.submit({
    request: "Plan a guarded auth migration for billing approvals.",
    requestedBy: "planner-a",
  });
  const customer = await service.submit({
    request: "Plan a customer-facing support rollout with constrained time.",
    requestedBy: "planner-b",
  });

  const comparison = await service.comparePackets({
    packetIds: [security.packet.packetId, customer.packet.packetId],
  });

  const summaries = (comparison.summaries ?? []) as Array<{ packetId: string }>;
  const fieldDifferences = (comparison.fieldDifferences ?? []) as Array<{ field: string }>;
  assert.equal(summaries.length, 2);
  assert.ok(fieldDifferences.some((entry) => entry.field === "objective"));
});

test("planning service raises not found for unknown packets", async () => {
  const service = new PlanningService({
    store: new MemoryPlanningStore(),
    eventStore: new MemoryEventStore(),
    repoRoot,
  });

  await assert.rejects(() => service.getPacket("missing-packet"), PlanningNotFoundError);
});

test("planning service accepts raw draft plan markdown and preserves draft-plan sequencing", async () => {
  const service = new PlanningService({
    store: new MemoryPlanningStore(),
    eventStore: new MemoryEventStore(),
    repoRoot,
    now: () => "2026-03-21T17:00:00.000Z",
  });

  const bundle = await service.submit({
    sourceType: "draft-plan",
    requestedBy: "codex-thread",
    draftPlan: `# Draft Plan

## Objective
- Refine the initial plan before implementation.

## Steps
1. Generate the first draft in planning mode.
2. Submit the draft plan to the council.
3. Produce a final go/no-go packet.

## Required Human Decisions
- Decide whether implementation should begin.
`,
  });

  assert.equal(bundle.docket.sourceType, "draft-plan");
  const orderedExecutionSequence = (bundle.synthesizedPlan.recommendedPlan as { orderedExecutionSequence?: string[] }).orderedExecutionSequence ?? [];
  assert.ok(orderedExecutionSequence.includes("Submit the draft plan to the council."));
  const requiredHumanDecisions = (bundle.packet.requiredHumanDecisions ?? []) as string[];
  assert.ok(requiredHumanDecisions.includes("Decide whether implementation should begin."));
  assert.ok((bundle.packet.upgradedPlanMarkdown as string).includes("## Required Human Decisions"));
});

test("planning service builds a Studio Brain memory pack and writes structured council summaries back to memory", async () => {
  const memoryService = createMemoryService({
    store: createInMemoryMemoryStoreAdapter(),
    defaultTenantId: "monsoonfire-main",
    defaultAgentId: "planning-test",
    defaultRunId: "planning-test-run",
  });
  await memoryService.capture({
    content: "Prior planning note: keep security validation gates explicit during council review.",
    source: "manual",
    tags: ["planning", "security"],
    metadata: { subject: "planning-council" },
  });

  const service = new PlanningService({
    store: new MemoryPlanningStore(),
    eventStore: new MemoryEventStore(),
    memoryService,
    repoRoot,
    now: () => "2026-03-21T18:30:00.000Z",
  });

  const bundle = await service.submit({
    request: "Plan a security review swarm for a billing approval change.",
    requestedBy: "staff-memory",
    docket: {
      affectedSystems: ["studio-brain/src/planning", ".governance/planning"],
    },
  });

  assert.equal(bundle.swarmRun.memoryPackStatus, "available");
  assert.ok(bundle.memoryRefs.some((entry) => entry.scope === "writeback"));
  const stats = await memoryService.stats({});
  assert.ok(stats.total >= 6);
});

test("planning service degrades gracefully when Studio Brain memory is unavailable", async () => {
  const memoryService = createMemoryService({
    store: createInMemoryMemoryStoreAdapter(),
    defaultTenantId: "monsoonfire-main",
    defaultAgentId: "planning-test",
    defaultRunId: "planning-test-run",
  });
  memoryService.context = async () => {
    throw new Error("missing auth context");
  };
  memoryService.importBatch = async () => {
    throw new Error("writeback unavailable");
  };

  const service = new PlanningService({
    store: new MemoryPlanningStore(),
    eventStore: new MemoryEventStore(),
    memoryService,
    repoRoot,
    now: () => "2026-03-21T19:00:00.000Z",
  });

  const bundle = await service.submit({
    request: "Plan a guarded rollout when memory auth is unavailable.",
    requestedBy: "staff-memory-fail",
  });

  assert.equal(bundle.packet.status, "ready_for_human");
  assert.equal(bundle.swarmRun.memoryPackStatus, "unavailable");
  assert.equal(bundle.packet.memoryWritebackStatus, "failed");
});
