import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { buildHandoffPack, writeHandoffPack } from "./codex-handoff-pack.mjs";

test("handoff pack summarizes latest run state and memory candidate", () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "codex-handoff-"));
  const runRoot = join(repoRoot, "output", "agent-runs", "run-1");
  mkdirSync(runRoot, { recursive: true });
  writeFileSync(
    join(repoRoot, "output", "agent-runs", "latest.json"),
    JSON.stringify({
      schema: "agent-runtime-pointer.v1",
      runId: "run-1",
      missionEnvelopePath: "output/agent-runs/run-1/mission-envelope.json",
      contextPackPath: "output/agent-runs/run-1/context-pack.json",
      summaryPath: "output/agent-runs/run-1/summary.json",
      ledgerPath: "output/agent-runs/run-1/run-ledger.jsonl",
    }),
    "utf8",
  );
  writeFileSync(
    join(runRoot, "mission-envelope.json"),
    JSON.stringify({
      schema: "agent-mission-envelope.v1",
      missionId: "mission-1",
      missionTitle: "Harness upgrade",
      goal: "Take advantage of Codex app features.",
      riskLane: "background",
      verifierSpec: {
        requiredChecks: ["npm run codex:doctor"],
        requiredArtifacts: ["output/codex-app-doctor/latest.json"],
        gateVisualVerification: true,
        gateLiveDeploy: false,
      },
    }),
    "utf8",
  );
  writeFileSync(
    join(runRoot, "context-pack.json"),
    JSON.stringify({
      memory: {
        blockers: ["Need app doctor evidence"],
        recommendedNextActions: ["Run focused tests"],
      },
      memoriesInfluencingRun: ["Use Studio Brain startup context first."],
    }),
    "utf8",
  );
  writeFileSync(
    join(runRoot, "summary.json"),
    JSON.stringify({
      schema: "agent-runtime-summary.v1",
      runId: "run-1",
      missionId: "mission-1",
      status: "blocked",
      riskLane: "background",
      title: "Harness upgrade",
      goal: "Take advantage of Codex app features.",
      activeBlockers: ["Need app doctor evidence"],
      acceptance: { total: 1, pending: 1, completed: 0, failed: 0 },
      boardRow: {
        next: "Run focused tests",
      },
    }),
    "utf8",
  );

  const pack = buildHandoffPack({
    repoRoot,
    generatedAt: "2026-04-24T00:00:00.000Z",
    repoSnapshot: {
      branch: "codex/update",
      dirtyCount: 2,
      changedFiles: [" M scripts/codex-handoff-pack.mjs"],
      statusCommandOk: true,
    },
  });
  const paths = writeHandoffPack(repoRoot, pack);

  assert.equal(pack.run.runId, "run-1");
  assert.equal(pack.verification.requiredChecks[0], "npm run codex:doctor");
  assert.equal(pack.memoryCandidates[0].kind, "blocker");
  assert.equal(existsSync(paths.jsonPath), true);
  assert.match(readFileSync(paths.markdownPath, "utf8"), /Harness upgrade/);
});
