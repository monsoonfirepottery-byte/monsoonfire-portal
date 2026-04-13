import assert from "node:assert/strict";
import test from "node:test";
import {
  computeStartupScorecardReport,
  parseInteractionLifecycleEntries,
  parseInteractionLog,
} from "./codex-startup-scorecard.mjs";

test("parseInteractionLog extracts clarification loops and retry friction", () => {
  const entries = parseInteractionLog(`
## 2026-04-01 (AM)

### Interaction Summary
- Commits analyzed: 2
- PR discussions analyzed: 0
- Clarification loops detected: 1

### Friction Patterns
- Stop repeated tool retry loops
- Reduce repeated workflow rule restatements

### Structural Adjustments Made
- user.md unchanged

### Next Observation Focus
- Track retry signatures.
`);

  assert.equal(entries.length, 1);
  assert.equal(entries[0].clarificationLoops, 1);
  assert.deepEqual(entries[0].frictionPatterns, [
    "Stop repeated tool retry loops",
    "Reduce repeated workflow rule restatements",
  ]);
});

test("parseInteractionLifecycleEntries extracts clarification loops from lifecycle audit rows", () => {
  const entries = parseInteractionLifecycleEntries([
    {
      tsIso: "2026-04-02T09:00:00.000Z",
      tool: "daily-interaction",
      event: "run-summary",
      metrics: {
        clarificationLoopsDetected: 2,
      },
      metadata: {
        recommendationTitles: ["Reduce repeated tool retry loops"],
      },
    },
  ]);

  assert.equal(entries.length, 1);
  assert.equal(entries[0].clarificationLoops, 2);
  assert.deepEqual(entries[0].frictionPatterns, ["Reduce repeated tool retry loops"]);
});

test("computeStartupScorecardReport measures startup quality and highlights coverage gaps", () => {
  const report = computeStartupScorecardReport({
    generatedAtIso: "2026-04-02T18:00:00.000Z",
    windowHours: 24,
    latestSample: {
      tsIso: "2026-04-02T18:00:00.000Z",
      status: "fail",
      reasonCode: "missing_token",
      continuityState: "blocked",
      itemCount: 0,
      contextSummary: "",
      groundingReady: false,
      richContext: false,
      fallbackOnly: false,
      tokenState: "missing",
      latencyMs: 1200,
      latencyState: "healthy",
      mcpBridgeOk: false,
      recoveryStep: "Refresh token.",
    },
    historySamples: [
      {
        sample: {
          tsIso: "2026-04-02T10:00:00.000Z",
          status: "pass",
          reasonCode: "ok",
          continuityState: "ready",
          itemCount: 3,
          contextSummary: "Current goal and blocker loaded.",
          groundingReady: true,
          richContext: true,
          fallbackOnly: false,
          tokenState: "fresh",
          latencyMs: 900,
          latencyState: "healthy",
          mcpBridgeOk: true,
        },
      },
      {
        sample: {
          tsIso: "2026-04-01T10:00:00.000Z",
          status: "pass",
          reasonCode: "ok",
          continuityState: "ready",
          itemCount: 2,
          contextSummary: "Previous-window continuity sample.",
          groundingReady: true,
          richContext: true,
          fallbackOnly: false,
          tokenState: "fresh",
          latencyMs: 700,
          latencyState: "healthy",
          mcpBridgeOk: true,
        },
      },
    ],
    toolcallEntries: [],
    interactionEntries: [
      {
        tsIso: "2026-04-02T09:00:00.000Z",
        clarificationLoops: 1,
        frictionPatterns: ["Stop repeated tool retry loops"],
      },
    ],
    latestDoctorSummary: {
      status: "warn",
      checks: 8,
      errors: 0,
      warnings: 1,
      infos: 7,
    },
    interactionSignalSource: "lifecycle-memory",
  });

  assert.equal(report.window.current.sampleCount, 2);
  assert.equal(report.window.previous.sampleCount, 1);
  assert.equal(report.metrics.passRate, 0.5);
  assert.equal(report.metrics.readyRate, 0.5);
  assert.equal(report.metrics.blockedContinuityRate, 0.5);
  assert.equal(report.metrics.groundingReadyRate, 0.5);
  assert.equal(report.metrics.mcpBridgeFailureRate, 0.5);
  assert.equal(report.supportingSignals.interactionLog.retryLoopMentions, 1);
  assert.equal(report.trends.passRateDelta, -0.5);
  assert.equal(report.supportingSignals.interactionLog.source, "lifecycle-memory");
  assert.equal(report.coverage.interactionSignalSource, "lifecycle-memory");
  assert.equal(
    report.coverage.gaps.includes(
      "Launcher-level startup toolcall telemetry is absent; this report relies on scorecard history samples instead."
    ),
    true
  );
  assert.equal(
    report.recommendations.includes(
      "Increase end-of-thread handoff/checkpoint writes so trusted startup continuity is ready more often."
    ),
    true
  );
  assert.equal(report.rubric.grade === "D" || report.rubric.grade === "F", true);
});

test("computeStartupScorecardReport preserves stored historical grounding and rich-context signals", () => {
  const report = computeStartupScorecardReport({
    generatedAtIso: "2026-04-12T18:00:00.000Z",
    windowHours: 24,
    latestSample: {
      tsIso: "2026-04-12T18:00:00.000Z",
      status: "pass",
      reasonCode: "ok",
      continuityState: "ready",
      itemCount: 3,
      contextSummary: "Current startup sample with trusted grounding.",
      groundingReady: true,
      richContext: true,
      fallbackOnly: false,
      tokenState: "fresh",
      latencyMs: 700,
      latencyState: "healthy",
      mcpBridgeOk: true,
    },
    historySamples: [
      {
        sample: {
          tsIso: "2026-04-12T10:00:00.000Z",
          status: "pass",
          reasonCode: "ok",
          continuityState: "ready",
          itemCount: 2,
          contextSummary: "Older live startup row captured before lane metadata existed.",
          groundingReady: false,
          richContext: true,
          fallbackOnly: false,
          tokenState: "fresh",
          latencyMs: 650,
          latencyState: "healthy",
          mcpBridgeOk: true,
        },
      },
    ],
    toolcallEntries: [],
    interactionEntries: [],
  });

  assert.equal(report.window.current.sampleCount, 2);
  assert.equal(report.metrics.groundingReadyRate, 0.5);
  assert.equal(report.metrics.richContextRate, 1);
});

test("computeStartupScorecardReport scores Grounding compliance and pre-start repo-read telemetry from startup toolcalls", () => {
  const report = computeStartupScorecardReport({
    generatedAtIso: "2026-04-03T18:00:00.000Z",
    windowHours: 24,
    latestSample: {
      tsIso: "2026-04-03T18:00:00.000Z",
      status: "pass",
      reasonCode: "ok",
      continuityState: "ready",
      itemCount: 4,
      contextSummary: "Goal, blocker, and next action were loaded.",
      groundingReady: true,
      richContext: true,
      fallbackOnly: false,
      tokenState: "fresh",
      latencyMs: 800,
      latencyState: "healthy",
      mcpBridgeOk: true,
      recoveryStep: "No recovery needed.",
    },
    historySamples: [
      {
        sample: {
          tsIso: "2026-04-03T10:00:00.000Z",
          status: "pass",
          reasonCode: "ok",
          continuityState: "ready",
          itemCount: 3,
          contextSummary: "Prior startup continuity sample.",
          groundingReady: true,
          richContext: true,
          fallbackOnly: false,
          tokenState: "fresh",
          latencyMs: 700,
          latencyState: "healthy",
          mcpBridgeOk: true,
        },
      },
    ],
    toolcallEntries: [
      {
        tsIso: "2026-04-03T10:00:01.000Z",
        tool: "codex-startup-preflight",
        action: "startup-bootstrap",
        ok: true,
        errorType: null,
        errorMessage: null,
        context: {
          startup: {
            startupToolStatus: "called",
            groundingLineEmitted: true,
            repoReadsBeforeStartupContext: 0,
          },
        },
      },
      {
        tsIso: "2026-04-03T18:00:01.000Z",
        tool: "codex-shell",
        action: "startup-bootstrap",
        ok: true,
        errorType: null,
        errorMessage: null,
        context: {
          startup: {
            startupToolStatus: "called",
            groundingLineEmitted: false,
            repoReadsBeforeStartupContext: 2,
          },
        },
      },
    ],
    interactionEntries: [],
  });

  assert.equal(report.supportingSignals.toolcalls.startupEntries, 2);
  assert.equal(report.supportingSignals.toolcalls.groundingObservedEntries, 2);
  assert.equal(report.supportingSignals.toolcalls.groundingLineComplianceRate, 0.5);
  assert.equal(report.supportingSignals.toolcalls.preStartupRepoReadObservedEntries, 2);
  assert.equal(report.supportingSignals.toolcalls.averagePreStartupRepoReads, 1);
  assert.equal(report.supportingSignals.toolcalls.preStartupRepoReadFreeRate, 0.5);
  assert.equal(report.supportingSignals.toolcalls.telemetryCoverageRate, 1);
  assert.equal(
    report.coverage.gaps.some((gap) => gap.includes("Grounding line compliance")),
    false,
  );
  assert.equal(
    report.coverage.gaps.some((gap) => gap.includes("repo reads before the first target file")),
    false,
  );
  assert.equal(
    report.recommendations.includes(
      "Tighten first-answer Grounding line compliance so startup continuity is visible before repo work fans out."
    ),
    true,
  );
  assert.equal(
    report.recommendations.includes(
      "Trim repo reads before startup continuity; the observed average is above zero in captured startup transcripts."
    ),
    true,
  );
});
