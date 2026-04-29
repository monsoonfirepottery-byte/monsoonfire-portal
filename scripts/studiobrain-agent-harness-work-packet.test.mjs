import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

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
      dirtyTrackedCount: 45,
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
          metadata: {
            evidencePathCounts: {
              a: [{ sourcePath: "website/data/faq.json", count: 2 }],
              b: [{ sourcePath: "docs/policies/service-pricing-and-membership-decommission.md", count: 1 }],
            },
            evidenceSurfaceCounts: {
              a: [{ surface: "website-redesign-paused", count: 2 }],
              b: [{ surface: "docs", count: 1 }],
            },
          },
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
  assert.deepEqual(
    nextWork.topWork[0].sourceSignals[0].contradictions[0].evidencePathCounts.a,
    [{ sourcePath: "website/data/faq.json", count: 2 }],
  );
  assert.deepEqual(
    nextWork.topWork[0].sourceSignals[0].contradictions[0].evidenceSurfaceCounts.a,
    [{ surface: "website-redesign-paused", count: 2 }],
  );
  assert.ok(nextWork.sourceFreshness.sources.some((source) => source.label === "wiki-contradictions"));
});

test("redesign-paused wiki contradictions become blocked harness work", () => {
  const nextWork = buildNextWorkFromSnapshot({
    generatedAt: "2026-04-28T20:23:00.000Z",
    runId: "wiki-redesign-block-test",
    gitState: {
      branch: "codex/auto",
      head: "abc123",
      dirtyTrackedCount: 45,
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
      summary: { contradictions: 1, hard: 1, critical: 0 },
      contradictions: [
        {
          contradictionId: "contradiction_membership",
          conflictKey: "membership-required-vs-decommission",
          severity: "hard",
          status: "open",
          owner: "policy",
          claimBId: "claim_membership_truth",
          markdownPath: "wiki/50_contradictions/membership-required-vs-decommission.md",
          metadata: {
            evidenceSurfaceCounts: {
              a: [
                { surface: "website-redesign-paused", count: 7 },
                { surface: "portal-redesign-paused", count: 2 },
              ],
              b: [{ surface: "docs", count: 5 }],
            },
          },
        },
      ],
    },
  });

  assert.equal(nextWork.topWork[0].title, "Track redesign-blocked wiki source drift");
  assert.equal(nextWork.topWork[0].status, "blocked");
  assert.match(nextWork.topWork[0].humanGate, /redesign owner/);
  assert.equal(nextWork.topWork[1].title, "Classify the dirty worktree before risky agent work");
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

test("record outcome CLI accepts note alias", () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "studiobrain-harness-outcome-"));
  try {
    const scriptPath = fileURLToPath(new URL("./studiobrain-agent-harness-work-packet.mjs", import.meta.url));
    const artifactPath = join(tempRoot, "next-work.json");
    const metricsPath = join(tempRoot, "metrics.json");
    const outcomesPath = join(tempRoot, "outcomes.jsonl");
    writeFileSync(artifactPath, JSON.stringify({
      topWork: [],
      sourceFreshness: { score: 1, staleCount: 0, missingCount: 0 },
      constraints: { readOnly: true, noNewDaemon: true, noNewDatabase: true },
    }));

    execFileSync(process.execPath, [
      scriptPath,
      "--record-outcome",
      "wp-test",
      "--outcome",
      "helpful",
      "--minutes-saved",
      "3",
      "--note",
      "packet was useful",
      "--artifact",
      artifactPath,
      "--metrics",
      metricsPath,
      "--outcomes",
      outcomesPath,
      "--json",
    ]);

    const [entry] = readFileSync(outcomesPath, "utf8").trim().split("\n").map((line) => JSON.parse(line));
    assert.equal(entry.notes, "packet was useful");
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});
