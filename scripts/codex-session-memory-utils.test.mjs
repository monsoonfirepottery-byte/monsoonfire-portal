import test from "node:test";
import assert from "node:assert/strict";

import {
  buildThreadBootstrapQuery,
  normalizeHandoffArtifact,
  rankBootstrapRows,
  resolveBootstrapContinuityState,
} from "./lib/codex-session-memory-utils.mjs";
import { stableHash } from "./lib/pst-memory-utils.mjs";

test("normalizeHandoffArtifact preserves additive lineage fields", () => {
  const handoff = normalizeHandoffArtifact({
    threadId: "thread-1",
    runId: "run-2",
    agentId: "agent-3",
    summary: "Continue the continuity rollout.",
    parentRunId: "run-1",
    handoffOwner: "council-wrapper",
    sourceShellId: "shell-a",
    targetShellId: "shell-b",
    resumeHints: [
      "Re-run the wrapper canary first.",
      { summary: "Open the continuity loader next.", nextStep: "Inspect startup precedence." },
    ],
  }, {
    threadId: "thread-1",
  });

  assert.equal(handoff.parentRunId, "run-1");
  assert.equal(handoff.handoffOwner, "council-wrapper");
  assert.equal(handoff.sourceShellId, "shell-a");
  assert.equal(handoff.targetShellId, "shell-b");
  assert.equal(Array.isArray(handoff.resumeHints), true);
  assert.equal(handoff.resumeHints.length, 2);
});

test("resolveBootstrapContinuityState prioritizes a fresh matching startup blocker over prior handoff context", () => {
  const query = "continuity wrapper integrity";
  const decision = resolveBootstrapContinuityState({
    query,
    startupBlocker: {
      status: "blocked",
      createdAt: new Date().toISOString(),
      queryFingerprint: stableHash(query, 24),
      failureClass: "auth_missing",
      firstSignal: "Token missing.",
    },
    continuityEnvelope: {
      continuityState: "ready",
      lastHandoffSummary: "Prior handoff exists.",
    },
    handoff: {
      summary: "Continue from the prior handoff.",
    },
  });

  assert.equal(decision.continuityState, "blocked");
  assert.equal(decision.blockerActive, true);
  assert.equal(decision.source, "startup-blocker");
  assert.equal(decision.supplementalHandoffSummary, "Prior handoff exists.");
});

test("resolveBootstrapContinuityState falls back to validated local continuity when blocker is stale", () => {
  const query = "continuity wrapper integrity";
  const decision = resolveBootstrapContinuityState({
    query,
    startupBlocker: {
      status: "blocked",
      createdAt: "2026-03-20T00:00:00.000Z",
      queryFingerprint: stableHash(query, 24),
      failureClass: "auth_missing",
      firstSignal: "Old token issue.",
    },
    continuityEnvelope: {
      continuityState: "ready",
      lastHandoffSummary: "Validated prior continuity summary.",
    },
    handoff: {
      summary: "Validated prior continuity summary.",
    },
    nowMs: Date.parse("2026-03-22T12:00:00.000Z"),
  });

  assert.equal(decision.continuityState, "ready");
  assert.equal(decision.blockerActive, false);
  assert.equal(decision.source, "validated-local-continuity");
});

test("buildThreadBootstrapQuery seeds the inferred repo lane for startup retrieval", () => {
  const query = buildThreadBootstrapQuery({
    threadInfo: {
      threadId: "thread-portal-auth",
      cwd: "D:/monsoonfire-portal",
      title: "Test Studio Brain auth",
      firstUserMessage: "call studiobrain memory and test auth",
    },
    historyLines: ["audit your connection to studiobrain and memory with context"],
  });

  assert.match(query, /\bmonsoonfire-portal\b/i);
  assert.match(query, /\bmonsoonfire portal\b/i);
});

test("rankBootstrapRows boosts same-project lane rows for repo-scoped threads", () => {
  const ranked = rankBootstrapRows(
    [
      {
        id: "row-studio",
        source: "manual",
        score: 0.55,
        content: "Studio Brain auth note from a different repo lane.",
        metadata: {
          projectLane: "studio-brain",
        },
      },
      {
        id: "row-portal",
        source: "manual",
        score: 0.55,
        content: "Portal continuity note for the current repo lane.",
        metadata: {
          projectLane: "monsoonfire-portal",
        },
      },
    ],
    {
      threadId: "thread-portal-auth",
      cwd: "D:/monsoonfire-portal",
      title: "Test Studio Brain auth",
      firstUserMessage: "call studiobrain memory and test auth",
    },
  );

  assert.equal(ranked[0]?.id, "row-portal");
});

test("rankBootstrapRows can overcome a modest cross-lane score lead for repo startup context", () => {
  const ranked = rankBootstrapRows(
    [
      {
        id: "row-studio",
        source: "codex-handoff",
        score: 0.9,
        content: "Studio Brain checkpoint from a different repo lane.",
        metadata: {
          projectLane: "studio-brain",
          startupEligible: true,
        },
      },
      {
        id: "row-portal",
        source: "codex-handoff",
        score: 0.62,
        content: "Portal continuity note for the current repo lane.",
        metadata: {
          projectLane: "monsoonfire-portal",
          startupEligible: true,
        },
      },
    ],
    {
      threadId: "thread-portal-auth",
      cwd: "D:/monsoonfire-portal",
      title: "What was I doing in Monsoon Fire portal?",
      firstUserMessage: "what was I doing in monsoonfire portal",
    },
  );

  assert.equal(ranked[0]?.id, "row-portal");
});
