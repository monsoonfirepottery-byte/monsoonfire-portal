import test from "node:test";
import assert from "node:assert/strict";

import { buildIntentProcHandoff } from "./lib/intent-codex-proc-handoff.mjs";

test("intent child handoff inherits parent lineage through the shared normalizer", () => {
  const handoff = buildIntentProcHandoff(
    {
      intentId: "phase-2",
      taskId: "fix-wrapper",
      title: "Fix wrapper integrity",
    },
    {
      status: "fail",
      artifacts: {
        reportPath: "D:/monsoonfire-portal/output/intent/report.json",
        lastMessagePath: "D:/monsoonfire-portal/output/intent/last-message.txt",
      },
      result: {
        stderrPreview: "wrapper packet drift detected",
      },
    },
    {
      threadId: "thread-123",
      runId: "phase-2::fix-wrapper",
      satisfiedBy: "validated-local-continuity",
      continuityEnvelopePath: "C:/Users/micah/.codex/memory/runtime/thread-123/continuity-envelope.json",
      bootstrapContextPath: "C:/Users/micah/.codex/memory/runtime/thread-123/bootstrap-context.json",
      bootstrapMetadataPath: "C:/Users/micah/.codex/memory/runtime/thread-123/bootstrap-metadata.json",
      continuityEnvelope: {
        currentGoal: "Council Wrapper Integrity And Continuity Contract",
      },
      handoff: {
        schema: "codex-handoff.v1",
        threadId: "thread-123",
        runId: "parent-run-77",
        parentRunId: "root-run-1",
        handoffOwner: "agent:codex-desktop",
        sourceShellId: "shell-parent",
        targetShellId: "shell-current",
        resumeHints: [{ summary: "Check the council canary regression." }],
      },
    },
    {
      now: "2026-03-22T18:00:00.000Z",
      env: {
        CODEX_OPEN_MEMORY_SESSION_ID: "shell-child",
      },
    }
  );

  assert.equal(handoff.threadId, "thread-123");
  assert.equal(handoff.runId, "phase-2::fix-wrapper");
  assert.equal(handoff.parentRunId, "parent-run-77");
  assert.equal(handoff.handoffOwner, "agent:intent-codex-proc");
  assert.equal(handoff.sourceShellId, "shell-current");
  assert.equal(handoff.targetShellId, "shell-child");
  assert.equal(handoff.activeGoal, "Fix wrapper integrity");
  assert.equal(handoff.startupProvenance.satisfiedBy, "validated-local-continuity");
  assert.deepEqual(handoff.blockers, [
    {
      summary: "wrapper packet drift detected",
      reason: "child-intent-failure",
      unblockStep: "Resolve the child intent failure and rerun with the same continuity lineage.",
    },
  ]);
  assert.equal(handoff.resumeHints.some((entry) => entry.summary === "Check the council canary regression."), true);
  assert.equal(
    handoff.resumeHints.some((entry) => entry.path === "D:/monsoonfire-portal/output/intent/report.json"),
    true
  );
});
