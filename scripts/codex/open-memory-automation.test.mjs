import test from "node:test";
import assert from "node:assert/strict";
import { buildMemoryBrief } from "./open-memory-automation.mjs";

test("buildMemoryBrief filters placeholder startup lines and reports unavailable consolidation truthfully", () => {
  const brief = buildMemoryBrief({
    generatedAt: "2026-04-04T08:00:00.000Z",
    continuityState: "ready",
    query: "codex shell startup preflight",
    contextSummary: [
      "1. [startup-context] [startup-context] [startup-context]",
      "2. Resume startup query: codex shell startup preflight.",
      "3. [manual] Tooling sync runbook: use scripts/sync-codex-home-runtime.mjs after changing secrets.",
    ].join("\n"),
    consolidationArtifactOverride: {},
    fallbackSources: ["codex", "manual"],
  });

  assert.equal(brief.summary.includes("[startup-context]"), false);
  assert.equal(brief.goal.includes("[startup-context]"), false);
  assert.deepEqual(brief.recentDecisions, [
    "[manual] Tooling sync runbook: use scripts/sync-codex-home-runtime.mjs after changing secrets.",
  ]);
  assert.equal(brief.consolidation.mode, "unavailable");
  assert.equal(brief.consolidation.status, "unavailable");
  assert.equal(brief.consolidation.actionabilityStatus, "repair");
  assert.equal(brief.blockers.includes("Dream consolidation artifact is missing."), true);
});

test("buildMemoryBrief surfaces dream actionability and top actions from the consolidation artifact", () => {
  const brief = buildMemoryBrief({
    generatedAt: "2026-04-04T08:00:00.000Z",
    continuityState: "ready",
    contextSummary: "1. [manual] Approval summary thread verified.",
    consolidationArtifactOverride: {
      mode: "overnight",
      status: "success",
      summary: "Dream rescue pass succeeded.",
      finishedAt: "2026-04-04T07:30:00.000Z",
      nextRunAt: "2026-04-05T07:30:00.000Z",
      actionabilityStatus: "passed",
      actionableInsightCount: 2,
      suppressedConnectionNoteCount: 3,
      suppressedPseudoDecisionCount: 4,
      promotionCount: 1,
      quarantineCount: 1,
      repairedEdgeCount: 7,
      topActions: [
        "Reuse the promoted approval summary memory as the canonical startup thread.",
        "Review and split the unknown mail-thread cluster before the next dream pass.",
      ],
    },
  });

  assert.equal(brief.consolidation.mode, "scheduled");
  assert.equal(brief.consolidation.status, "success");
  assert.equal(brief.consolidation.actionabilityStatus, "passed");
  assert.equal(brief.consolidation.actionableInsightCount, 2);
  assert.equal(brief.consolidation.suppressedConnectionNoteCount, 3);
  assert.equal(brief.consolidation.suppressedPseudoDecisionCount, 4);
  assert.deepEqual(brief.consolidation.topActions, [
    "Reuse the promoted approval summary memory as the canonical startup thread.",
    "Review and split the unknown mail-thread cluster before the next dream pass.",
  ]);
  assert.deepEqual(brief.recommendedNextActions.slice(0, 2), brief.consolidation.topActions);
});

test("buildMemoryBrief suppresses compaction trace noise in goal and recent decisions", () => {
  const brief = buildMemoryBrief({
    generatedAt: "2026-04-04T09:30:00.000Z",
    continuityState: "continuity_degraded",
    query: "dream rescue post-deploy",
    contextSummary: [
      "1. [codex-compaction-raw] Tool call update_plan {\"plan\":[{\"step\":\"inspect brief pollution\"}]}",
      "2. [codex-compaction-raw] Command: \"C:\\Program Files\\PowerShell\\7\\pwsh.exe\" -Command 'Get-Content output/studio-brain/memory-brief/latest.json'",
    ].join("\n"),
    contextRows: [
      {
        source: "codex-compaction-raw",
        content: "Tool call update_plan {\"plan\":[{\"step\":\"inspect brief pollution\"}]}",
        metadata: { kind: "trace" },
      },
      {
        source: "codex-compaction-raw",
        content: "Command: \"C:\\Program Files\\PowerShell\\7\\pwsh.exe\" -Command 'Get-Content output/studio-brain/memory-brief/latest.json'",
        metadata: { kind: "trace" },
      },
      {
        source: "codex-handoff",
        content: "Keep the dream rescue focused on startup brief filtering and re-run host preflight after sync.",
        metadata: { kind: "handoff", memoryLayer: "episodic" },
      },
      {
        source: "manual",
        content: "Use the live control-tower state as the truth surface for actionability and next actions.",
        metadata: { kind: "decision", memoryLayer: "episodic" },
      },
    ],
    consolidationArtifactOverride: {
      mode: "overnight",
      status: "success",
      summary: "Dream rescue cleanup pass succeeded.",
      finishedAt: "2026-04-04T09:00:00.000Z",
      nextRunAt: "2026-04-05T09:00:00.000Z",
      actionabilityStatus: "passed",
      actionableInsightCount: 1,
      topActions: [
        "Re-run host startup preflight after syncing the startup filter cleanup.",
      ],
    },
    fallbackSources: ["codex-compaction-raw", "codex-handoff", "manual"],
  });

  assert.equal(/Tool call update_plan|Command:/.test(brief.goal), false);
  assert.deepEqual(brief.recentDecisions, [
    "[codex-handoff] Keep the dream rescue focused on startup brief filtering and re-run host preflight after sync.",
    "[manual] Use the live control-tower state as the truth surface for actionability and next actions.",
  ]);
});

test("buildMemoryBrief suppresses lifecycle audit rows unless they are explicitly startup-eligible", () => {
  const brief = buildMemoryBrief({
    generatedAt: "2026-04-04T10:30:00.000Z",
    continuityState: "ready",
    contextRows: [
      {
        source: "codex",
        content: "Codex lifecycle daily-interaction run-summary applied.",
        metadata: {
          lifecycleMemory: true,
          startupEligible: false,
          kind: "checkpoint",
        },
      },
      {
        source: "codex-handoff",
        content: "Resume the current goal from the last trusted handoff.",
        metadata: {
          kind: "handoff",
          memoryLayer: "episodic",
        },
      },
    ],
    contextSummary: "1. [codex-handoff] Resume the current goal from the last trusted handoff.",
    consolidationArtifactOverride: {
      mode: "overnight",
      status: "success",
      actionabilityStatus: "passed",
      topActions: [],
    },
  });

  assert.equal(/Codex lifecycle daily-interaction/.test(brief.goal), false);
  assert.deepEqual(brief.recentDecisions, [
    "[codex-handoff] Resume the current goal from the last trusted handoff.",
  ]);
});
