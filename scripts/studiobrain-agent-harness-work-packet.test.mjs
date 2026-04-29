import test from "node:test";
import assert from "node:assert/strict";

import {
  buildNextWorkFromSnapshot,
  buildSuccessMetrics,
  summarizeOutcomeLedger,
} from "./studiobrain-agent-harness-work-packet.mjs";

function freshSource(label, status = "pass") {
  return {
    label,
    path: `output/${label}.json`,
    exists: true,
    status,
    generatedAt: "2026-04-28T20:00:00.000Z",
    ageMinutes: 5,
    stale: false,
  };
}

test("buildNextWorkFromSnapshot keeps packets bounded and actionable", () => {
  const nextWork = buildNextWorkFromSnapshot({
    generatedAt: "2026-04-28T20:10:00.000Z",
    runId: "unit-test",
    gitState: {
      branch: "codex/websiteclean",
      head: "abc123",
      dirtyTrackedCount: 31,
      untrackedCount: 4,
      dirtyFiles: [
        { code: " M", path: "docs/generated/studiobrain-runtime-contract.generated.md", trackedDirty: true },
      ],
    },
    artifacts: {
      idleWorker: freshSource("idle-worker", "passed"),
      repoInventory: freshSource("repo-agentic-health-inventory", "pass"),
      memoryConsolidation: freshSource("memory-consolidation", "success"),
    },
    idleWorker: { status: "passed" },
    memoryConsolidation: { status: "success", actionabilityStatus: "passed" },
    repoInventory: {
      summary: {
        surfaces: { "unknown-owner": 267 },
        highRiskRootScripts: 123,
        rootPackageScripts: 489,
      },
    },
  });

  assert.equal(nextWork.schema, "studiobrain-agent-harness-next-work.v1");
  assert.ok(nextWork.topWork.length > 0);
  assert.ok(nextWork.topWork.length <= 3);
  assert.equal(nextWork.constraints.readOnly, true);
  assert.equal(nextWork.constraints.noNewDaemon, true);
  assert.equal(nextWork.constraints.noNewDatabase, true);
  assert.ok(nextWork.topWork.some((packet) => packet.title.includes("runtime contract")));
  assert.ok(nextWork.topWork.every((packet) => packet.packetId.startsWith("wp-")));
});

test("fresh idle-worker failures outrank generic dirty-worktree packets", () => {
  const nextWork = buildNextWorkFromSnapshot({
    generatedAt: "2026-04-28T20:20:00.000Z",
    runId: "fresh-failure-test",
    gitState: {
      branch: "codex/websiteclean",
      head: "abc123",
      dirtyTrackedCount: 208,
      untrackedCount: 135,
      dirtyFiles: [],
    },
    artifacts: {
      idleWorker: freshSource("idle-worker", "degraded"),
      repoInventory: freshSource("repo-agentic-health-inventory", "pass"),
      memoryConsolidation: freshSource("memory-consolidation", "success"),
      destructiveSurfaceAudit: freshSource("destructive-surface-audit", "fail"),
    },
    idleWorker: {
      status: "degraded",
      jobs: [
        { id: "repo-destructive-surface-audit", label: "Destructive command surface audit", status: "failed" },
      ],
    },
    destructiveSurfaceAudit: {
      status: "fail",
      failedCount: 2,
      surfaces: [
        {
          id: "portal-namecheap-remote-cleanup",
          file: "scripts/deploy-namecheap-portal.mjs",
          status: "fail",
          missingEvidence: ["rm -rf"],
          missingGuards: ["assertSafeRemotePath(options.remotePath"],
        },
        {
          id: "firebase-preview-channel-prune",
          file: "scripts/prune-firebase-preview-channels.mjs",
          status: "fail",
          missingEvidence: ["options.dryRun"],
          missingGuards: ["output.plannedDelete.push(channel.id)"],
        },
      ],
    },
    memoryConsolidation: { status: "success", actionabilityStatus: "passed" },
    repoInventory: { summary: { surfaces: {}, highRiskRootScripts: 0, rootPackageScripts: 0 } },
  });

  assert.equal(nextWork.topWork[0].title, "Fix the fresh destructive-surface audit failure");
  assert.equal(nextWork.topWork[0].priority, 0);
  assert.ok(nextWork.topWork[0].why.includes("portal-namecheap-remote-cleanup"));
  assert.ok(nextWork.topWork.some((packet) => packet.title.includes("dirty worktree")));
});

test("hard wiki contradictions become human-gated harness work", () => {
  const nextWork = buildNextWorkFromSnapshot({
    generatedAt: "2026-04-28T20:22:00.000Z",
    runId: "wiki-contradiction-test",
    gitState: {
      branch: "codex/auto",
      head: "abc123",
      dirtyTrackedCount: 2,
      untrackedCount: 0,
      dirtyFiles: [],
    },
    artifacts: {
      idleWorker: freshSource("idle-worker", "passed_with_warnings"),
      repoInventory: freshSource("repo-agentic-health-inventory", "pass"),
      memoryConsolidation: freshSource("memory-consolidation", "success"),
      wikiContradictions: freshSource("wiki-contradictions", "warning"),
      wikiContextPack: freshSource("wiki-context-pack", "pass"),
    },
    idleWorker: { status: "passed_with_warnings" },
    memoryConsolidation: { status: "success", actionabilityStatus: "passed" },
    repoInventory: { summary: { surfaces: {}, highRiskRootScripts: 0, rootPackageScripts: 0 } },
    wikiContradictions: {
      status: "warning",
      summary: { contradictions: 2, hard: 2, critical: 0 },
      contradictions: [
        {
          contradictionId: "contradiction_membership",
          conflictKey: "membership-required-vs-decommission",
          severity: "hard",
          status: "open",
          owner: "policy",
          markdownPath: "wiki/50_contradictions/membership-required-vs-decommission.md",
          sourceRefs: [{ sourcePath: "docs/epics/EPIC-MEMBERSHIP-DECOMMISSION-AND-STUDIO-FOCUS.md" }],
        },
        {
          contradictionId: "contradiction_pricing",
          conflictKey: "volume-pricing-vs-no-volume-billing",
          severity: "hard",
          status: "open",
          owner: "policy",
          markdownPath: "wiki/50_contradictions/volume-pricing-vs-no-volume-billing.md",
          sourceRefs: [{ sourcePath: "docs/runbooks/PRICING_COMMUNITY_SHELF_QA.md" }],
        },
      ],
    },
  });

  assert.equal(nextWork.topWork[0].title, "Review hard wiki source drift before customer-facing use");
  assert.equal(nextWork.topWork[0].status, "needs_human");
  assert.match(nextWork.topWork[0].why, /membership-required-vs-decommission/);
  assert.match(nextWork.topWork[0].why, /OPERATIONAL_TRUTH/);
  assert.match(nextWork.topWork[0].humanGate, /Human approval is required/);
  assert.ok(nextWork.topWork[0].files.includes("wiki/50_contradictions/membership-required-vs-decommission.md"));
  assert.ok(nextWork.sourceFreshness.sources.some((source) => source.label === "wiki-contradictions"));
});

test("resolved destructive-audit artifacts do not emit stale failure packets", () => {
  const nextWork = buildNextWorkFromSnapshot({
    generatedAt: "2026-04-28T20:25:00.000Z",
    runId: "resolved-failure-test",
    gitState: {
      branch: "codex/websiteclean",
      head: "abc123",
      dirtyTrackedCount: 208,
      untrackedCount: 135,
      dirtyFiles: [],
    },
    artifacts: {
      idleWorker: freshSource("idle-worker", "degraded"),
      repoInventory: freshSource("repo-agentic-health-inventory", "pass"),
      memoryConsolidation: freshSource("memory-consolidation", "success"),
      destructiveSurfaceAudit: freshSource("destructive-surface-audit", "pass"),
    },
    idleWorker: {
      status: "degraded",
      jobs: [
        { id: "repo-destructive-surface-audit", label: "Destructive command surface audit", status: "failed" },
      ],
    },
    destructiveSurfaceAudit: {
      status: "pass",
      failedCount: 0,
      surfaces: [{ id: "portal-namecheap-remote-cleanup", status: "pass" }],
    },
    memoryConsolidation: { status: "success", actionabilityStatus: "passed" },
    repoInventory: { summary: { surfaces: {}, highRiskRootScripts: 0, rootPackageScripts: 0 } },
  });

  assert.equal(nextWork.topWork[0].title, "Classify the dirty worktree before risky agent work");
  assert.equal(nextWork.topWork[0].priority, 1);
  assert.ok(!nextWork.topWork.some((packet) => packet.title === "Fix the fresh idle-worker failed job"));
});

test("success metrics fail closed until real usage is recorded", () => {
  const nextWork = {
    topWork: [
      { status: "ready", nextCommand: "npm run docs:contract:check" },
      { status: "needs_human", nextCommand: "git status --short --branch" },
    ],
    sourceFreshness: { score: 1, staleCount: 0, missingCount: 0 },
    constraints: { readOnly: true, noNewDaemon: true, noNewDatabase: true },
  };

  const metrics = buildSuccessMetrics(nextWork, []);

  assert.equal(metrics.candidateStatus, "candidate_success");
  assert.equal(metrics.realUsageVerdict, "insufficient_real_usage");
  assert.equal(metrics.readiness.packetCount, 2);
  assert.ok(metrics.readiness.readinessScore >= 0.6);
});

test("outcome ledger declares success only after useful recorded outcomes", () => {
  const outcomes = [
    { outcome: "helpful", minutesSaved: 8 },
    { outcome: "used", minutesSaved: 5 },
    { outcome: "resolved", minutesSaved: 6 },
  ];
  const summary = summarizeOutcomeLedger(outcomes);
  const metrics = buildSuccessMetrics(
    {
      topWork: [{ status: "ready", nextCommand: "npm run studio:ops:agent-harness:json" }],
      sourceFreshness: { score: 1, staleCount: 0, missingCount: 0 },
      constraints: { readOnly: true, noNewDaemon: true, noNewDatabase: true },
    },
    outcomes,
  );

  assert.equal(summary.helpfulRate, 1);
  assert.equal(summary.totalMinutesSaved, 19);
  assert.equal(metrics.realUsageVerdict, "success");
});
