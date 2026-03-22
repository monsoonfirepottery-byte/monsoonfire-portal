import test from "node:test";
import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildPlanningPreparation,
  buildPlanningPacket,
  buildRoleScoreReport,
  buildRoleSourceSync,
  embedPlanningPacketArtifacts,
  fingerprintPlanningDocket,
  inferStakeholders,
  loadPlanningGovernance,
  normalizePlanningDocket,
  validatePlanningGovernance
} from "./lib/planning-control-plane.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..");

test("planning governance validates and exposes curated role sources", () => {
  const governance = loadPlanningGovernance(REPO_ROOT);
  const report = validatePlanningGovernance(REPO_ROOT, governance);
  assert.equal(report.status, "pass");
  assert.ok(report.summary.curatedRoleCount >= 10);
  assert.ok(report.summary.sourceCount >= 2);
});

test("fingerprinting surfaces security and approval touchpoints", () => {
  const docket = normalizePlanningDocket({
    request: "Plan a secure auth migration for billing approvals with rollback guidance.",
    requestedBy: "tester"
  }, { now: "2026-03-21T10:00:00.000Z" });
  const fingerprint = fingerprintPlanningDocket(docket, { now: "2026-03-21T10:00:00.000Z" });
  assert.equal(fingerprint.stakes, "critical");
  assert.ok(fingerprint.touchpoints.includes("auth"));
  assert.ok(fingerprint.touchpoints.includes("payments"));
});

test("stakeholder inference and packet build preserve required human decisions", () => {
  const governance = loadPlanningGovernance(REPO_ROOT);
  const payload = {
    request: "Plan a finance and compliance review path for role-source imports with policy gates.",
    requestedBy: "tester",
    docket: {
      objective: "Create a governed import path for external role corpora.",
      constraints: ["Planning-only", "No automatic trust promotion"],
      unknowns: ["Which approvals are required for future paid sources"],
      affectedSystems: [".governance/planning", "studio-brain/src/planning"]
    }
  };
  const docket = normalizePlanningDocket(payload, { now: "2026-03-21T11:00:00.000Z" });
  const fingerprint = fingerprintPlanningDocket(docket, { now: "2026-03-21T11:00:00.000Z" });
  const stakeholders = inferStakeholders(docket, fingerprint, governance, { now: "2026-03-21T11:00:00.000Z" });
  assert.ok(stakeholders.some((row) => row.stakeholderClass === "compliance-legal-owner"));
  const packetBundle = buildPlanningPacket(payload, governance, { now: "2026-03-21T11:00:00.000Z" });
  assert.equal(packetBundle.packet.status, "ready_for_human");
  assert.ok(packetBundle.packet.requiredHumanDecisions.length >= 1);
  assert.equal(packetBundle.swarmRun.roundOrder[0], "draft_capture");
  assert.ok(packetBundle.roleNotes.length >= 6);
  assert.ok(packetBundle.planRevisions.length >= 3);
  assert.ok(packetBundle.packet.upgradedPlanMarkdown.includes("## Validation Gates"));
  assert.equal(packetBundle.packet.goNoGoRecommendation, "no_go_until_human_decision");
});

test("role source sync and scoring keep candidates separate from curated seats", () => {
  const governance = loadPlanningGovernance(REPO_ROOT);
  const sync = buildRoleSourceSync(governance, { now: "2026-03-21T12:00:00.000Z" });
  const scores = buildRoleScoreReport(governance, sync.extractedCandidates, { now: "2026-03-21T12:00:00.000Z" });
  assert.ok(sync.extractedCandidates.length >= 4);
  assert.ok(scores.candidateScores.length >= 4);
  assert.ok(scores.curatedScores.every((row) => row.roleId));
});

test("draft-plan markdown is refined into a review-existing arbitration packet", () => {
  const governance = loadPlanningGovernance(REPO_ROOT);
  const payload = {
    sourceType: "draft-plan",
    requestedBy: "tester",
    draftPlan: `# Draft Plan

## Objective
- Review a Codex-generated plan before implementation starts.

## Steps
1. Generate the first plan.
2. Submit the draft plan to the planning council.
3. Refine the plan into a final go/no-go packet.

## Validation Gates
- Required human decisions are explicit.

## Required Human Decisions
- Approve the plan for implementation.

## Risks
- The first draft may miss hidden stakeholders.
`
  };
  const docket = normalizePlanningDocket(payload, { now: "2026-03-21T13:00:00.000Z" });
  assert.equal(docket.sourceType, "draft-plan");
  assert.ok(docket.draftPlan.analysis.steps.length >= 3);

  const packetBundle = buildPlanningPacket(payload, governance, { now: "2026-03-21T13:00:00.000Z" });
  assert.equal(packetBundle.fingerprint.planType, "review-existing");
  assert.ok(packetBundle.synthesizedPlan.recommendedPlan.orderedExecutionSequence.includes("Submit the draft plan to the planning council."));
  assert.ok(packetBundle.packet.requiredHumanDecisions.includes("Approve the plan for implementation."));
  assert.ok(packetBundle.packet.upgradedPlanMarkdown.includes("## Dissent"));
  assert.ok(packetBundle.roundSummaries.some((entry) => entry.roundType === "planner_revision"));
});

test("specialist roles activate only when their touchpoints are present and memory refs are surfaced", () => {
  const governance = loadPlanningGovernance(REPO_ROOT);
  const packetBundle = buildPlanningPacket({
    request: "Plan a security, privacy, and platform-sensitive rollout with customer impact and billing implications.",
    requestedBy: "tester",
    docket: {
      affectedSystems: ["studio-brain/src/planning", "web/src/views/StaffView.tsx", "scripts/lib/planning-control-plane.mjs"],
      unknowns: ["Which policy owner approves retention changes"],
    },
  }, governance, {
    now: "2026-03-21T18:00:00.000Z",
    memoryPack: {
      status: "available",
      summary: "Prior planning packets emphasize keeping security validation gates explicit.",
      refs: [{ refId: "mem-security-1", source: "planning-council", summary: "Security-first prior packet.", tags: ["security"] }],
    },
    priorPackets: [{
      packetId: "packet-prev-1",
      createdAt: "2026-03-20T10:00:00.000Z",
      objective: "Review a prior auth rollout packet",
      requiredHumanDecisions: ["Approve the rollout gate"],
      failureModes: ["authorization-regression"],
      roleNotes: [{ noteId: "note-prev-1", roleId: "security-reviewer.v1", roleName: "Security Reviewer", roundType: "parallel_critique", summary: "Kept auth validation explicit." }],
    }],
  });

  const activeRoles = packetBundle.agentRuns.map((entry) => entry.roleId);
  assert.ok(activeRoles.includes("security-reviewer.v1"));
  assert.ok(activeRoles.includes("privacy-reviewer.v1"));
  assert.ok(activeRoles.includes("platform-reviewer.v1"));
  assert.ok(activeRoles.includes("customer-reviewer.v1"));
  assert.ok(activeRoles.includes("cost-scope-reviewer.v1"));
  assert.ok(packetBundle.memoryRefs.some((entry) => entry.kind === "memory-pack-item"));
  assert.ok(packetBundle.memoryRefs.some((entry) => entry.kind === "prior-packet"));
  assert.ok(packetBundle.roleNotes.some((entry) => entry.roleId === "security-reviewer.v1"));
});

test("thin ambiguous prompts block auto-go recommendations", () => {
  const governance = loadPlanningGovernance(REPO_ROOT);
  const packetBundle = buildPlanningPacket({
    request: "help me plan this thing",
    requestedBy: "tester",
  }, governance, {
    now: "2026-03-21T19:00:00.000Z",
  });

  assert.equal(packetBundle.fingerprint.intakeCompleteness, "thin");
  assert.equal(packetBundle.packet.goNoGoRecommendation, "no_go_until_human_decision");
  assert.ok(packetBundle.packet.requiredHumanDecisions.some((entry) => /ambiguous|trustworthy execution-ready plan/i.test(entry)));
});

test("trust-safety and privacy-sensitive prompts stay guarded until human decision", () => {
  const governance = loadPlanningGovernance(REPO_ROOT);
  const packetBundle = buildPlanningPacket({
    request: "Plan a moderation escalation workflow for sensitive user data reports, abuse handling, and customer support handoff.",
    requestedBy: "tester",
  }, governance, {
    now: "2026-03-21T19:15:00.000Z",
  });

  const activeRoles = new Set(packetBundle.agentRuns.map((entry) => entry.roleId));
  assert.equal(packetBundle.fingerprint.stakes, "critical");
  assert.equal(packetBundle.packet.goNoGoRecommendation, "no_go_until_human_decision");
  assert.ok(activeRoles.has("privacy-reviewer.v1"));
  assert.ok(activeRoles.has("trust-safety-reviewer.v1"));
  assert.ok(activeRoles.has("customer-reviewer.v1"));
});

test("memory role-note summaries inform the swarm without leaking into upgraded plan summary", () => {
  const governance = loadPlanningGovernance(REPO_ROOT);
  const roleNoteSummary = "Role summary from Security Reviewer during parallel critique: keep auth validation explicit.";
  const decisionSummary = "Planning council decision for documentation cleanup: go_with_conditions because owner review is still needed.";
  const packetBundle = buildPlanningPacket({
    request: "Plan a documentation cleanup for staff onboarding notes.",
    requestedBy: "tester",
  }, governance, {
    now: "2026-03-21T19:30:00.000Z",
    memoryPack: {
      status: "available",
      summary: roleNoteSummary,
      refs: [
        {
          refId: "mem-role-1",
          source: "planning-council",
          summary: roleNoteSummary,
          tags: ["planning-council", "role-note"],
          metadata: { kind: "role-note" },
        },
        {
          refId: "mem-decision-1",
          source: "planning-council",
          summary: decisionSummary,
          tags: ["planning-council", "decision"],
          metadata: { kind: "decision" },
        },
      ],
    },
  });

  assert.ok(packetBundle.memoryRefs.some((entry) => entry.memoryKind === "role-note"));
  assert.ok(packetBundle.memoryRefs.some((entry) => entry.memoryKind === "decision"));
  assert.ok(!packetBundle.packet.upgradedPlanMarkdown.includes(roleNoteSummary));
  assert.ok(packetBundle.packet.upgradedPlanMarkdown.includes(decisionSummary));
});

test("continuity refs are projected into packet-safe allowlisted summaries", () => {
  const governance = loadPlanningGovernance(REPO_ROOT);
  const packetBundle = buildPlanningPacket({
    request: "Plan a continuity-safe follow-up for council handoffs.",
    requestedBy: "tester",
  }, governance, {
    now: "2026-03-21T19:35:00.000Z",
    memoryPack: {
      status: "available",
      summary: "Prior continuity context is available.",
      refs: [
        {
          refId: "mem-continuity-1",
          source: "codex-handoff",
          summary: "Review D:/monsoonfire-portal/output/intent/report.json before resuming.",
          tags: ["handoff", "continuity"],
          metadata: {
            schema: "codex-handoff.v1",
            threadId: "thread-123",
            runId: "run-child-1",
            parentRunId: "run-parent-1",
            agentId: "agent:intent-codex-proc",
            handoffOwner: "agent:intent-codex-proc",
            activeGoal: "Tighten continuity packet policy",
            summary: "Child run updated the continuity packet policy draft.",
            blockers: [
              {
                summary: "Wrapper drift still needs a canary gate.",
                reason: "integrity",
                unblockStep: "Add the canary assertion before rollout.",
              },
            ],
            nextRecommendedAction: "Add the continuity canary assertion before rollout.",
            artifactPointers: {
              reportPath: "D:/monsoonfire-portal/output/intent/report.json",
            },
            startupProvenance: {
              continuityEnvelopePath: "C:/Users/micah/.codex/memory/runtime/thread-123/continuity-envelope.json",
            },
            sourceShellId: "shell-a",
            targetShellId: "shell-b",
            resumeHints: [
              {
                summary: "Open the local report artifact.",
                path: "D:/monsoonfire-portal/output/intent/report.json",
              },
            ],
          },
        },
      ],
    },
  });

  const continuityRef = packetBundle.memoryRefs.find((entry) => entry.memoryKind === "continuity-summary");
  assert.ok(continuityRef);
  assert.equal(continuityRef.metadata.kind, "continuity-summary");
  assert.equal(continuityRef.metadata.activeGoal, "Tighten continuity packet policy");
  assert.equal(continuityRef.metadata.lineage.threadId, "thread-123");
  assert.equal(continuityRef.metadata.lineage.runId, "run-child-1");
  assert.equal(continuityRef.metadata.lineage.parentRunId, "run-parent-1");
  assert.equal(continuityRef.metadata.lineage.agentId, "agent:intent-codex-proc");
  assert.equal(continuityRef.metadata.lineage.handoffOwner, "agent:intent-codex-proc");
  assert.equal("artifactPointers" in continuityRef.metadata, false);
  assert.equal("startupProvenance" in continuityRef.metadata, false);
  assert.equal("resumeHints" in continuityRef.metadata, false);
  assert.equal(continuityRef.summary.includes("report.json"), false);

  const packetContinuityRef = packetBundle.packet.memoryRefs.find((entry) => entry.memoryKind === "continuity-summary");
  assert.ok(packetContinuityRef);
  assert.equal(packetContinuityRef.metadata.kind, "continuity-summary");
  assert.equal("artifactPointers" in packetContinuityRef.metadata, false);
  assert.equal("startupProvenance" in packetContinuityRef.metadata, false);
  assert.equal(packetContinuityRef.summary.includes("report.json"), false);
});

test("messy draft text is normalized into canonical plan sections before revision", () => {
  const governance = loadPlanningGovernance(REPO_ROOT);
  const packetBundle = buildPlanningPacket({
    sourceType: "draft-plan",
    requestedBy: "tester",
    draftPlan: `Objective: Rerun council on updated drafts.
Steps: compare packet versions after edits.
Risks: memory bleed and unresolved approvals.
Decision: pick how rerun lineage should be stored.`,
  }, governance, {
    now: "2026-03-21T19:45:00.000Z",
  });

  assert.ok(packetBundle.planRevisions[0].markdown.includes("## Ordered Execution Sequence"));
  assert.ok(packetBundle.planRevisions[0].markdown.includes("## Validation Gates"));
  assert.ok(!packetBundle.planRevisions[0].markdown.includes("Steps: compare packet versions after edits."));
  assert.ok(packetBundle.packet.upgradedPlanMarkdown.includes("## Required Human Decisions"));
});

test("planning preparation emits deepest-profile round plan with live role context", () => {
  const governance = loadPlanningGovernance(REPO_ROOT);
  const preparation = buildPlanningPreparation({
    request: "Plan a security-sensitive council rerun flow with reusable memory context.",
    requestedBy: "tester",
    reviewMode: "swarm",
    swarmConfig: {
      executionMode: "live",
      depthProfile: "deepest",
      maxCritiqueCycles: 2,
    },
    docket: {
      constraints: ["Planning-only", "No implementation side effects"],
      affectedSystems: ["studio-brain/src/planning", ".governance/planning"],
    },
  }, governance, {
    now: "2026-03-21T20:00:00.000Z",
    memoryPack: {
      status: "available",
      summary: "Prior council packets emphasized keeping security gates explicit.",
      refs: [{ refId: "mem-1", source: "planning-council", summary: "Prior security packet.", tags: ["security"] }],
    },
  });

  assert.equal(preparation.swarmRun.executionMode, "live");
  assert.equal(preparation.swarmRun.depthProfile, "deepest");
  assert.equal(preparation.swarmRun.maxCritiqueCycles, 2);
  assert.ok(preparation.reviewRounds.filter((entry) => entry.roundType === "parallel_critique").length === 2);
  assert.ok(preparation.reviewRounds.filter((entry) => entry.roundType === "planner_revision").length === 2);
  assert.ok(preparation.reviewRounds.filter((entry) => entry.roundType === "rebuttal").length === 2);
  assert.ok(preparation.roleManifests.length >= 6);
  assert.ok(preparation.roleMemorySlices.every((entry) => Array.isArray(entry.refs)));
  assert.ok(preparation.canonicalDraftMarkdown.includes("## Validation Gates"));
});

test("live swarm artifacts become normalized findings, address outcomes, and council detail payloads", () => {
  const governance = loadPlanningGovernance(REPO_ROOT);
  const packetBundle = buildPlanningPacket({
    request: "Plan a security-sensitive staff console for council reruns and packet inspection.",
    requestedBy: "tester",
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
  }, governance, {
    now: "2026-03-21T20:15:00.000Z",
    memoryPack: {
      status: "available",
      summary: "Prior council packets emphasized explicit security gates and packet lineage.",
      refs: [
        { refId: "mem-1", source: "planning-council", summary: "Security gates stayed explicit.", tags: ["security", "decision"] },
      ],
    },
    externalSwarmArtifacts: {
      swarmRun: {
        runId: "swarm-live-1",
        runtime: "codex-local",
        executionMode: "live",
        depthProfile: "deepest",
        maxCritiqueCycles: 2,
        completedAt: "2026-03-21T20:18:00.000Z",
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
          inputSections: ["Summary", "Validation Gates", "Failure Modes"],
        },
      ],
      roleFindings: [
        {
          findingId: "finding-1",
          roleId: "skeptic-red-team.v1",
          roleName: "Skeptic / Red Team",
          roundType: "parallel_critique",
          cycle: 1,
          severity: "high",
          findingType: "objection",
          affectedPlanSection: "Ordered Execution Sequence",
          claim: "The draft skips a reversible validation checkpoint before exposing staff tooling broadly.",
          whyItMatters: "A missing checkpoint makes rollback and safe narrowing harder if dependency assumptions are wrong.",
          evidenceRefs: ["mem-1"],
          proposedChange: "Insert a staff-only validation gate before any broader exposure decision.",
          requiresHumanDecision: false,
          noveltyScore: 0.82,
          status: "partially_resolved",
        },
        {
          findingId: "finding-2",
          roleId: "security-reviewer.v1",
          roleName: "Security Reviewer",
          roundType: "parallel_critique",
          cycle: 1,
          severity: "critical",
          findingType: "required_revision",
          affectedPlanSection: "Validation Gates",
          claim: "The plan lacks explicit security signoff for role-note visibility and memory references.",
          whyItMatters: "Staff-only tools can still leak sensitive council context if security review is implicit.",
          evidenceRefs: ["mem-1"],
          proposedChange: "Require explicit security signoff before exposing raw memory references or detailed role notes.",
          requiresHumanDecision: true,
          noveltyScore: 0.88,
          status: "still_blocked",
        },
      ],
      planRevisions: [
        {
          stage: "planner_revision",
          cycle: 1,
          authorRoleId: "lead-planner.v1",
          summary: "Planner revision added a staff-only validation gate and narrowed the first slice.",
          changedSections: ["Ordered Execution Sequence", "Validation Gates", "Required Human Decisions"],
          addressedFindingIds: ["finding-1"],
          rejectedFindingIds: ["finding-2"],
          plannerRationale: "Narrowed scope immediately, but left the visibility/signoff question for human arbitration.",
          markdown: `# Upgraded Council Plan

## Summary
- Build a staff-only council console that stays planning-only and keeps visibility scope explicit.

## Ordered Execution Sequence
- Add a staff-only validation phase before broader exposure decisions.
- Compare packet versions and rerun council on updated drafts without implementation side effects.

## Validation Gates
- Security signoff is required before exposing raw role notes or memory references.
- Validate packet lineage behavior with one reversible dry run.

## Failure Modes
- Sensitive role-note visibility leaks.
- Packet lineage confusion across reruns.

## Required Human Decisions
- Decide whether rerun history should be packet lineage or sibling council runs.
- Decide whether raw role-note detail can be exposed in the console.

## Dissent
- Security reviewer still blocks broader visibility until explicit signoff is defined.`,
        },
        {
          stage: "synthesis",
          authorRoleId: "synthesizer.v1",
          summary: "Final synthesis preserved the security blocker as a human decision.",
          markdown: `# Upgraded Council Plan

## Summary
- Build a staff-only council console that stays planning-only and keeps visibility scope explicit.

## Ordered Execution Sequence
- Add a staff-only validation phase before broader exposure decisions.
- Compare packet versions and rerun council on updated drafts without implementation side effects.

## Validation Gates
- Security signoff is required before exposing raw role notes or memory references.
- Validate packet lineage behavior with one reversible dry run.

## Failure Modes
- Sensitive role-note visibility leaks.
- Packet lineage confusion across reruns.

## Required Human Decisions
- Decide whether rerun history should be packet lineage or sibling council runs.
- Decide whether raw role-note detail can be exposed in the console.

## Dissent
- Security reviewer still blocks broader visibility until explicit signoff is defined.`,
        },
      ],
      roundSummaries: [
        {
          roundType: "parallel_critique",
          cycle: 1,
          status: "completed",
          summary: "Two live specialist findings surfaced scope and security visibility gaps.",
          participatingRoleIds: ["skeptic-red-team.v1", "security-reviewer.v1"],
          novelFindingsCount: 2,
          conflictClusters: [],
          stillBlockedFindingIds: ["finding-2"],
        },
      ],
      addressMatrix: [
        {
          findingId: "finding-1",
          status: "accepted",
          resolution: "Inserted a narrower staff-only validation phase.",
          reason: "The planner adopted the safer first-slice recommendation.",
          cycle: 1,
        },
        {
          findingId: "finding-2",
          status: "unresolved",
          resolution: "Kept as an explicit human decision and blocker.",
          reason: "Security signoff requirements still need human arbitration.",
          cycle: 1,
        },
      ],
      finalDraftMarkdown: `# Upgraded Council Plan

## Summary
- Build a staff-only council console that stays planning-only and keeps visibility scope explicit.

## Ordered Execution Sequence
- Add a staff-only validation phase before broader exposure decisions.
- Compare packet versions and rerun council on updated drafts without implementation side effects.

## Validation Gates
- Security signoff is required before exposing raw role notes or memory references.
- Validate packet lineage behavior with one reversible dry run.

## Failure Modes
- Sensitive role-note visibility leaks.
- Packet lineage confusion across reruns.

## Required Human Decisions
- Decide whether rerun history should be packet lineage or sibling council runs.
- Decide whether raw role-note detail can be exposed in the console.

## Dissent
- Security reviewer still blocks broader visibility until explicit signoff is defined.`,
      memoryRefsUsed: ["mem-1"],
    },
  });

  assert.equal(packetBundle.swarmRun.executionMode, "live");
  assert.equal(packetBundle.roleFindings.length, 2);
  assert.equal(packetBundle.addressMatrix.length, 2);
  assert.ok(packetBundle.council.roleFindings.length >= 2);
  assert.ok(packetBundle.council.addressMatrix.length >= 2);
  assert.equal(packetBundle.packet.agentRuns.length, 2);
  assert.equal(packetBundle.packet.roleFindings.length, 2);
  assert.equal(packetBundle.packet.addressMatrix.length, 2);
  assert.equal(packetBundle.packet.artifactEmbedding.mode, "full");
  assert.equal(packetBundle.packet.artifactEmbedding.canonicalSource, "planning-control-plane.packet");
  assert.ok(packetBundle.packet.upgradedPlanMarkdown.includes("Security signoff is required"));
  assert.equal(packetBundle.packet.goNoGoRecommendation, "no_go_until_human_decision");
});

test("packet artifact embedding bounds large arrays and preserves omitted stable ids", () => {
  const packet = embedPlanningPacketArtifacts({
    packetId: "packet-test",
    councilId: "council-test",
  }, {
    agentRuns: [
      { agentRunId: "run-1", roleId: "role-1" },
      { agentRunId: "run-2", roleId: "role-2" },
      { agentRunId: "run-3", roleId: "role-3" },
    ],
    roleFindings: [
      { findingId: "finding-1", roleId: "role-1" },
      { findingId: "finding-2", roleId: "role-2" },
      { findingId: "finding-3", roleId: "role-3" },
    ],
    roleNotes: [],
    planRevisions: [],
    roundSummaries: [],
    memoryRefs: [],
    addressMatrix: [],
  }, {
    packetArtifactLimits: {
      agentRuns: 2,
      roleFindings: 2,
    }
  });

  assert.equal(packet.agentRuns.length, 2);
  assert.equal(packet.roleFindings.length, 2);
  assert.equal(packet.artifactEmbedding.mode, "bounded");
  assert.deepEqual(packet.artifactEmbedding.omitted.agentRuns, ["run-3"]);
  assert.deepEqual(packet.artifactEmbedding.omitted.roleFindings, ["finding-3"]);
});
