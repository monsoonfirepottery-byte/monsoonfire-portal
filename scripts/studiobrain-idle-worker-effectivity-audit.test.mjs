import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import { auditIdleWorkerEffectivity } from "./studiobrain-idle-worker-effectivity-audit.mjs";

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function cleanRun(runId, overrides = {}) {
  const completedAt = overrides.completedAt || new Date().toISOString();
  return {
    runId,
    status: "passed",
    completedAt,
    summary: { planned: 13, passed: 13, warning: 0, failed: 0, skipped: 0 },
    utilization: {
      attemptedJobs: 13,
      activeJobDurationMs: 100000,
      runDurationMs: 101000,
      averageJobDurationMs: 7692,
      longestJob: { id: "memory-consolidation", status: "passed", durationMs: 90000 },
      failedJobIds: [],
      warningJobIds: [],
      skippedJobIds: [],
      idleReason: "All planned idle jobs completed cleanly; no operator intervention is needed.",
      nextRecommendedJob: "memory-consolidation",
    },
    ...overrides,
  };
}

test("idle-worker effectivity audit scores clean runs and surfaces human gates", () => {
  const root = mkdtempSync(join(tmpdir(), "idle-worker-effectivity-"));
  try {
    const runRoot = join(root, "output", "studio-brain", "idle-worker");
    const auditRoot = join(root, "output", "studio-brain", "audits");
    mkdirSync(runRoot, { recursive: true });
    const latest = cleanRun("idle-worker-now");
    const olderWarning = cleanRun("idle-worker-prior-warning", {
      status: "passed_with_warnings",
      summary: { planned: 13, passed: 12, warning: 1, failed: 0, skipped: 0 },
      utilization: {
        ...latest.utilization,
        warningJobIds: ["wiki-export-drift-check"],
        idleReason: "Idle-worker budget was spent and warnings should be reviewed before widening write-capable work.",
        nextRecommendedJob: "wiki-export-drift-check",
      },
    });
    writeJson(join(runRoot, "latest.json"), latest);
    writeJson(join(runRoot, "history.json"), {
      schema: "studiobrain-idle-worker-history-v1",
      latestRunId: latest.runId,
      runs: [latest, olderWarning],
    });
    writeJson(join(runRoot, "wiki-idle-tasks.json"), {
      schema: "wiki-idle-task-queue-report.v1",
      summary: { tasks: 7, ready: 7, blocked: 0, readOnly: 7, writeCapable: 0 },
      tasks: [
        {
          taskKey: "wiki-human-approval-triage",
          title: "Triage wiki claims requiring human approval",
          status: "ready",
          priority: 0.7,
          readOnly: true,
          metadata: { claims: 21 },
        },
      ],
    });

    const report = auditIdleWorkerEffectivity({
      repoRoot: root,
      runRoot: "output/studio-brain/idle-worker",
      artifact: "output/studio-brain/audits/effectivity.json",
      markdown: "output/studio-brain/audits/effectivity.md",
      maxAgeMinutes: 9999,
    });

    assert.equal(report.schema, "studiobrain-idle-worker-effectivity-audit.v1");
    assert.equal(report.status, "warn");
    assert.equal(report.metrics.runsAudited, 2);
    assert.equal(report.metrics.queue.ready, 7);
    assert.equal(report.metrics.queue.humanApprovalClaims, 21);
    assert.deepEqual(report.metrics.resolvedProblemIds, ["wiki-export-drift-check"]);
    assert.equal(report.findings.some((finding) => finding.code === "human-gated-wiki-claims"), true);
    assert.match(readFileSync(join(auditRoot, "effectivity.md"), "utf8"), /Human-gated claims: 21/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("idle-worker effectivity audit fails when no artifacts exist", () => {
  const root = mkdtempSync(join(tmpdir(), "idle-worker-effectivity-missing-"));
  try {
    const report = auditIdleWorkerEffectivity({
      repoRoot: root,
      runRoot: "missing",
      artifact: "output/effectivity.json",
      markdown: "output/effectivity.md",
      strict: true,
    });
    assert.equal(report.status, "fail");
    assert.equal(report.findings.some((finding) => finding.code === "missing-idle-worker-artifacts"), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
