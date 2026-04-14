import test from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import {
  buildMemoryBrief,
  buildStartupContextPack,
  buildStartupArtifactRepair,
  deriveStartupGroundingDiagnostics,
  loadAutomationStartupMemoryContext,
  selectStartupArtifactRepairCandidate,
  selectStartupRows,
} from "./open-memory-automation.mjs";
import {
  refreshLocalBootstrapArtifacts,
  runtimePathsForThread,
  writeContinuityEnvelope,
  writeHandoffArtifact,
} from "../lib/codex-session-memory-utils.mjs";

function cleanupThreadRuntime(threadId) {
  const paths = runtimePathsForThread(threadId);
  rmSync(paths.runtimeDir, { recursive: true, force: true });
  return paths;
}

const TEST_FRESH_TOKEN = "test~header.eyJleHAiOjQxMDI0NDQ4MDB9.test~signature";

test("buildStartupContextPack keeps cross-thread fallback guidance in advisory fields only", () => {
  const pack = buildStartupContextPack({
    brief: {
      goal: "Resume an unrelated startup thread.",
      blockers: ["Dream consolidation artifact is missing."],
      recommendedNextActions: ["Open the foreign startup thread."],
    },
    continuityState: "continuity_degraded",
    reasonCode: "ok",
    groundingAuthority: "cross-thread-fallback",
  });

  assert.equal(pack.publishTrustedGrounding, false);
  assert.equal(pack.dominantGoal, "");
  assert.equal(pack.topBlocker, "");
  assert.equal(pack.nextRecommendedAction, "");
  assert.equal(pack.goalAuthority, "");
  assert.equal(pack.blockerAuthority, "");
  assert.deepEqual(pack.grounding, {});
  assert.deepEqual(pack.advisory, {
    dominantGoal: "Resume an unrelated startup thread.",
    topBlocker: "Dream consolidation artifact is missing.",
    nextRecommendedAction: "Open the foreign startup thread.",
  });
  assert.equal(pack.fallbackOnly, true);
});

test("buildStartupContextPack filters generic consolidation blockers out of trusted grounding", () => {
  const pack = buildStartupContextPack({
    brief: {
      goal: "Resume the current startup audit.",
      blockers: [
        "Dream consolidation artifact is missing.",
        "Checkpoint emitter still skips local runtime artifact sync.",
      ],
      recommendedNextActions: ["Patch the checkpoint emitter."],
    },
    continuityState: "ready",
    reasonCode: "ok",
    groundingAuthority: "thread-scoped",
  });

  assert.equal(pack.publishTrustedGrounding, true);
  assert.equal(pack.dominantGoal, "Resume the current startup audit.");
  assert.equal(pack.topBlocker, "Checkpoint emitter still skips local runtime artifact sync.");
  assert.equal(pack.nextRecommendedAction, "Patch the checkpoint emitter.");
  assert.equal(pack.blockerAuthority, "thread-scoped");
  assert.deepEqual(pack.advisory, {});
});

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

test("deriveStartupGroundingDiagnostics infers the presentation lane from thread context when rows omit it", () => {
  const diagnostics = deriveStartupGroundingDiagnostics({
    rows: [
      {
        source: "codex-handoff",
        content: "Continue the current portal startup continuity work.",
        metadata: {
          startupEligible: true,
        },
      },
    ],
    threadInfo: {
      threadId: "thread-portal-startup",
      cwd: "D:/monsoonfire-portal",
      title: "Audit startup hardening",
      firstUserMessage: "what was I doing in monsoonfire portal",
    },
    continuityState: "ready",
  });

  assert.equal(diagnostics.presentationProjectLane, "monsoonfire-portal");
  assert.equal(diagnostics.projectLane, "monsoonfire-portal");
  assert.equal(diagnostics.laneResolutionSource, "thread-inference");
  assert.equal(diagnostics.threadScopedItemCount, 0);
  assert.equal(diagnostics.groundingQuality, "lane-resolved");
});

test("deriveStartupGroundingDiagnostics prefers the repo cwd lane over broader thread text", () => {
  const diagnostics = deriveStartupGroundingDiagnostics({
    rows: [
      {
        source: "codex-compaction-promoted",
        content: "Audit startup hardening claims for the current repo thread.",
        metadata: {
          threadId: "thread-portal-startup",
          cwd: "D:/monsoonfire-portal",
        },
      },
    ],
    threadInfo: {
      threadId: "thread-portal-startup",
      cwd: "D:/monsoonfire-portal",
      title: "Studio Brain startup hardening audit",
      firstUserMessage: "audit studio brain startup hardening in the monsoonfire portal repo",
    },
    continuityState: "ready",
  });

  assert.equal(diagnostics.presentationProjectLane, "monsoonfire-portal");
  assert.equal(diagnostics.laneResolutionSource, "thread-inference");
  assert.equal(diagnostics.threadScopedItemCount, 1);
  assert.equal(diagnostics.groundingQuality, "thread-scoped");
});

test("deriveStartupGroundingDiagnostics prefers the repo cwd lane over conflicting diagnostics", () => {
  const diagnostics = deriveStartupGroundingDiagnostics({
    rows: [
      {
        source: "codex-compaction-promoted",
        content: "Audit startup hardening claims for the current repo thread.",
        metadata: {
          threadId: "thread-portal-startup",
          cwd: "D:/monsoonfire-portal",
        },
      },
    ],
    diagnostics: {
      presentationProjectLane: "studio-brain",
      projectLane: "studio-brain",
      dominantProjectLane: "studio-brain",
    },
    threadInfo: {
      threadId: "thread-portal-startup",
      cwd: "D:/monsoonfire-portal",
      title: "Studio Brain startup hardening audit",
      firstUserMessage: "audit studio brain startup hardening in the monsoonfire portal repo",
    },
    continuityState: "ready",
  });

  assert.equal(diagnostics.presentationProjectLane, "monsoonfire-portal");
  assert.equal(diagnostics.projectLane, "monsoonfire-portal");
  assert.equal(diagnostics.dominantProjectLane, "monsoonfire-portal");
  assert.equal(diagnostics.laneResolutionSource, "thread-inference");
  assert.equal(diagnostics.threadScopedItemCount, 1);
  assert.equal(diagnostics.groundingQuality, "thread-scoped");
});

test("deriveStartupGroundingDiagnostics overrides a conflicting thread-scoped row lane with the repo cwd lane", () => {
  const diagnostics = deriveStartupGroundingDiagnostics({
    rows: [
      {
        source: "codex-compaction-promoted",
        content: "Audit startup hardening claims for the current repo thread.",
        metadata: {
          threadId: "thread-portal-startup",
          cwd: "D:/monsoonfire-portal",
          projectLane: "studio-brain",
        },
      },
    ],
    threadInfo: {
      threadId: "thread-portal-startup",
      cwd: "D:/monsoonfire-portal",
      title: "Studio Brain startup hardening audit",
      firstUserMessage: "audit studio brain startup hardening in the monsoonfire portal repo",
    },
    continuityState: "ready",
  });

  assert.equal(diagnostics.presentationProjectLane, "monsoonfire-portal");
  assert.equal(diagnostics.projectLane, "monsoonfire-portal");
  assert.equal(diagnostics.dominantProjectLane, "monsoonfire-portal");
  assert.equal(diagnostics.laneResolutionSource, "thread-inference-override");
  assert.equal(diagnostics.threadScopedItemCount, 1);
  assert.equal(diagnostics.groundingQuality, "thread-scoped");
});

test("deriveStartupGroundingDiagnostics prefers the repo cwd lane over cross-lane ranked rows", () => {
  const diagnostics = deriveStartupGroundingDiagnostics({
    rows: [
      {
        source: "codex-handoff",
        content: "Keep working on generic Studio Brain startup history.",
        metadata: {
          projectLane: "studio-brain",
        },
      },
    ],
    threadInfo: {
      threadId: "thread-portal-startup",
      cwd: "D:/monsoonfire-portal",
      title: "Portal startup audit",
      firstUserMessage: "audit startup lane handling in the monsoonfire portal repo",
    },
    continuityState: "ready",
  });

  assert.equal(diagnostics.presentationProjectLane, "monsoonfire-portal");
  assert.equal(diagnostics.projectLane, "monsoonfire-portal");
  assert.equal(diagnostics.dominantProjectLane, "monsoonfire-portal");
  assert.equal(diagnostics.laneResolutionSource, "thread-inference");
  assert.equal(diagnostics.threadScopedItemCount, 0);
  assert.equal(diagnostics.groundingQuality, "lane-resolved");
});

test("deriveStartupGroundingDiagnostics does not mark startup as compaction-dominant when rich thread-scoped artifacts exist", () => {
  const diagnostics = deriveStartupGroundingDiagnostics({
    rows: [
      {
        source: "codex-handoff",
        content: "Current goal: finish startup continuity. Next action: capture a trusted handoff before broad repo reads.",
        metadata: {
          threadId: "thread-portal-startup",
          cwd: "D:/monsoonfire-portal",
          activeGoal: "Finish startup continuity.",
          summary: "Trusted handoff for the current thread.",
          nextRecommendedAction: "Capture a trusted handoff before broad repo reads.",
          blockers: [{ summary: "External checkpoint emitter still skips local handoff sync." }],
        },
      },
      {
        source: "codex-continuity-envelope",
        content: "Current goal: finish startup continuity. Trusted handoff: trusted thread summary. Next action: patch the emitter.",
        metadata: {
          threadId: "thread-portal-startup",
          cwd: "D:/monsoonfire-portal",
          currentGoal: "Finish startup continuity.",
          lastHandoffSummary: "Trusted thread summary.",
          nextRecommendedAction: "Patch the emitter.",
        },
      },
      {
        source: "codex-compaction-promoted",
        content: "Earlier transcript summary for the same thread.",
        metadata: {
          threadId: "thread-portal-startup",
          cwd: "D:/monsoonfire-portal",
        },
      },
      {
        source: "codex-compaction-promoted",
        content: "Another promoted transcript summary for the same thread.",
        metadata: {
          threadId: "thread-portal-startup",
          cwd: "D:/monsoonfire-portal",
        },
      },
      {
        source: "codex-compaction-raw",
        content: "Tool output from the same thread.",
        metadata: {
          threadId: "thread-portal-startup",
          cwd: "D:/monsoonfire-portal",
        },
      },
    ],
    threadInfo: {
      threadId: "thread-portal-startup",
      cwd: "D:/monsoonfire-portal",
      title: "Portal startup audit",
      firstUserMessage: "take another slice on startup continuity",
    },
    continuityState: "ready",
  });

  assert.equal(diagnostics.threadScopedItemCount, 5);
  assert.equal(diagnostics.compactionDominated, false);
  assert.equal(diagnostics.startupSourceQuality, "thread-scoped-dominant");
  assert.equal(diagnostics.laneSourceQuality, "thread-scoped-dominant");
});

test("selectStartupRows prefers rich thread-scoped handoff rows over compaction-promoted search fallback", () => {
  const selected = selectStartupRows(
    [
      {
        id: "row-compaction",
        source: "codex-compaction-promoted",
        score: 0.96,
        content: "Generic promoted summary of earlier startup work.",
        metadata: {
          threadId: "thread-portal-startup",
          cwd: "D:/monsoonfire-portal",
          projectLane: "monsoonfire-portal",
        },
      },
      {
        id: "row-handoff",
        source: "codex-handoff",
        score: 0.71,
        content: "Resume the Monsoon Fire portal startup continuity pass.",
        metadata: {
          threadId: "thread-portal-startup",
          cwd: "D:/monsoonfire-portal",
          projectLane: "monsoonfire-portal",
          startupEligible: true,
          activeGoal: "Fix startup continuity quality.",
          nextRecommendedAction: "Prefer handoff rows over compaction fallback.",
          blockers: [{ summary: "Compaction-only context is dominating startup." }],
          resumeHints: [{ summary: "Re-run preflight after the ranking patch." }],
        },
      },
    ],
    {
      threadInfo: {
        threadId: "thread-portal-startup",
        cwd: "D:/monsoonfire-portal",
        title: "Portal startup continuity",
        firstUserMessage: "improve startup continuity quality",
      },
    }
  );

  assert.equal(selected[0]?.id, "row-handoff");
  assert.equal(Number(selected[0]?.metadata?.bootstrapRankScore) > Number(selected[1]?.metadata?.bootstrapRankScore), true);
});

test("selectStartupArtifactRepairCandidate prefers a thread-scoped startup-eligible checkpoint row", () => {
  const candidate = selectStartupArtifactRepairCandidate(
    [
      {
        id: "row-cross-thread",
        source: "codex",
        content: "A startup-eligible checkpoint from a different thread.",
        metadata: {
          threadId: "thread-other",
          cwd: "D:/monsoonfire-portal",
          startupEligible: true,
          summary: "Other thread checkpoint.",
        },
      },
      {
        id: "row-checkpoint",
        source: "codex",
        content: "Progress: finish startup continuity quality loop.",
        metadata: {
          threadId: "thread-portal-startup",
          cwd: "D:/monsoonfire-portal",
          startupEligible: true,
          checkpointKind: "checkpoint",
          activeGoal: "Finish startup continuity quality loop.",
          nextRecommendedAction: "Sync a local handoff from this checkpoint row.",
          blockers: [{ summary: "External checkpoint emitter skipped local handoff sync." }],
        },
      },
    ],
    {
      threadInfo: {
        threadId: "thread-portal-startup",
        cwd: "D:/monsoonfire-portal",
        title: "Portal startup continuity",
        firstUserMessage: "take another slice on startup continuity",
      },
    }
  );

  assert.equal(candidate?.id, "row-checkpoint");
});

test("buildStartupArtifactRepair produces a ready thread-scoped handoff scaffold from a checkpoint row", () => {
  const repair = buildStartupArtifactRepair(
    {
      id: "row-checkpoint",
      source: "codex",
      content: "Progress: finish startup continuity quality loop.",
      createdAt: "2026-04-12T01:10:00.000Z",
      metadata: {
        threadId: "thread-portal-startup",
        cwd: "D:/monsoonfire-portal",
        startupEligible: true,
        checkpointKind: "checkpoint",
        activeGoal: "Finish startup continuity quality loop.",
        summary: "Checkpoint: startup continuity hardening progressed.",
        workCompleted: "Checkpoint: startup continuity hardening progressed.",
        nextRecommendedAction: "Write the repaired handoff scaffold locally.",
        blockers: [{ summary: "External checkpoint emitter skipped local handoff sync." }],
        capturedFrom: "codex-checkpoint-cli",
        runId: "run-startup-1",
        agentId: "agent:codex",
        projectLane: "monsoonfire-portal",
      },
    },
    {
      threadInfo: {
        threadId: "thread-portal-startup",
        cwd: "D:/monsoonfire-portal",
        title: "Portal startup continuity",
        firstUserMessage: "take another slice on startup continuity",
      },
      threadScopedItemCount: 3,
    }
  );

  assert.equal(repair?.handoff?.threadId, "thread-portal-startup");
  assert.equal(repair?.handoff?.summary, "Checkpoint: startup continuity hardening progressed.");
  assert.equal(repair?.handoff?.startupProvenance?.repairedFromCapturedFrom, "codex-checkpoint-cli");
  assert.equal(repair?.continuityEnvelope?.continuityState, "ready");
  assert.equal(repair?.continuityEnvelope?.presentationProjectLane, "monsoonfire-portal");
  assert.equal(repair?.continuityEnvelope?.startupSourceQuality, "thread-scoped-dominant");
  assert.equal(repair?.continuityEnvelope?.threadScopedItemCount, 3);
});

test("loadAutomationStartupMemoryContext short-circuits on trusted local startup artifacts", async () => {
  const threadId = "startup-local-short-circuit-test";
  cleanupThreadRuntime(threadId);
  const originalFetch = global.fetch;
  let fetchCalls = 0;

  try {
    writeHandoffArtifact(threadId, {
      summary: "Handoff: resume the current startup audit.",
      activeGoal: "Resume the current startup audit.",
      nextRecommendedAction: "Run startup preflight.",
    });
    writeContinuityEnvelope(threadId, {
      threadId,
      cwd: "D:/monsoonfire-portal",
      continuityState: "ready",
      startupSatisfiedBy: "validated-local-continuity",
      currentGoal: "Resume the current startup audit.",
      lastHandoffSummary: "Handoff: resume the current startup audit.",
      nextRecommendedAction: "Run startup preflight.",
      presentationProjectLane: "monsoonfire-portal",
      threadScopedItemCount: 2,
      fallbackOnly: false,
      startupSourceQuality: "thread-scoped-dominant",
      laneSourceQuality: "thread-scoped-dominant",
      startup: {
        satisfiedBy: "validated-local-continuity",
        threadScopedItemCount: 2,
        startupSourceQuality: "thread-scoped-dominant",
      },
    });
    refreshLocalBootstrapArtifacts({
      threadId,
      cwd: "D:/monsoonfire-portal",
      threadTitle: "Startup audit",
      firstUserMessage: "resume the current startup audit",
    });

    global.fetch = async () => {
      fetchCalls += 1;
      throw new Error("fetch should not be called when trusted local startup artifacts are present");
    };

    const result = await loadAutomationStartupMemoryContext({
      tool: "codex-shell",
      query: "resume the current startup audit",
      env: {
        CODEX_THREAD_ID: threadId,
        CODEX_CWD: "D:/monsoonfire-portal",
        STUDIO_BRAIN_MCP_ID_TOKEN: TEST_FRESH_TOKEN,
        STUDIO_BRAIN_BASE_URL: "http://127.0.0.1:8787",
      },
    });

    assert.equal(fetchCalls, 0);
    assert.equal(result.continuityState, "ready");
    assert.equal(result.groundingAuthority, "validated-local");
    assert.equal(result.diagnostics.startupContextStage, "local-validated-short-circuit");
    assert.equal(result.diagnostics.startupCache.shortCircuitLocal, true);
  } finally {
    global.fetch = originalFetch;
    cleanupThreadRuntime(threadId);
  }
});

test("loadAutomationStartupMemoryContext reuses a fresh startup cache entry without a second remote lookup", async () => {
  const threadId = "startup-cache-hit-test";
  cleanupThreadRuntime(threadId);
  const originalFetch = global.fetch;
  let fetchCalls = 0;

  try {
    global.fetch = async () => {
      fetchCalls += 1;
      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            context: {
              summary: "1. [manual] Resume the startup cache test.",
              items: [
                {
                  source: "manual",
                  content: "Resume the startup cache test.",
                  metadata: {
                    threadId,
                    cwd: "D:/monsoonfire-portal",
                    projectLane: "monsoonfire-portal",
                  },
                },
              ],
              diagnostics: {
                continuityState: "ready",
                presentationProjectLane: "monsoonfire-portal",
                threadScopedItemCount: 1,
                startupSourceQuality: "thread-scoped-dominant",
                laneSourceQuality: "thread-scoped-dominant",
              },
            },
          }),
      };
    };

    const env = {
      CODEX_THREAD_ID: threadId,
      CODEX_CWD: "D:/monsoonfire-portal",
      STUDIO_BRAIN_MCP_ID_TOKEN: TEST_FRESH_TOKEN,
      STUDIO_BRAIN_BASE_URL: "http://127.0.0.1:8787",
      CODEX_STARTUP_CONTEXT_CACHE_TTL_MS: "60000",
    };

    const first = await loadAutomationStartupMemoryContext({
      tool: "codex-shell",
      query: "startup cache test",
      env,
    });
    const fetchCallsAfterFirst = fetchCalls;
    const second = await loadAutomationStartupMemoryContext({
      tool: "codex-shell",
      query: "startup cache test",
      env,
    });

    assert.equal(fetchCallsAfterFirst > 0, true);
    assert.equal(fetchCalls, fetchCallsAfterFirst);
    assert.equal(first.diagnostics.startupCache.cacheHit, false);
    assert.equal(second.diagnostics.startupCache.cacheHit, true);
    assert.equal(second.diagnostics.startupCache.hitType, "warm-cache");
    assert.equal(second.continuityState, "ready");
  } finally {
    global.fetch = originalFetch;
    cleanupThreadRuntime(threadId);
  }
});
